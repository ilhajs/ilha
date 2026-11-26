// oxlint-disable max-classes-per-file -- queries, infinite queries, the cache, tags and runs live in one module by design; splitting would break the single-entry public API.
/**
 * A keyed data cache. Each query is a class service with a name, argument and
 * result Schemas, and a freshness duration. The cache keeps one entry per query
 * and arguments, shares in-flight fetches, refetches stale entries on demand,
 * and collects unused entries.
 *
 * Attach a fetcher with `toLayer`: it builds once per Layer build and captures
 * its dependencies, so `get` requires only the query and cache. Fake it in
 * tests with `GetUser.toLayer(fn)`.
 *
 * Plain Effect code provides the cache with `Query.layer()`. Every time-based
 * rule runs on the `Clock`, so `TestClock` drives it, and
 * `@ilha/model/test`'s `TestQuery` is the harness for tests.
 *
 * Server dehydration omits entries whose args, success or error Schema holds
 * a `Schema.Redacted`, even when the current value contains no secret. The
 * client fetches omitted entries instead of hydrating them. Ordinary entries
 * still dehydrate and hydrate through their JSON codecs.
 *
 * **Example** (Defining a query and sharing its fetch)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer, Schema } from "effect"
 * import { Query } from "@ilha/model"
 *
 * let requests = 0
 *
 * class GetUser extends Query.Service<GetUser>()("users/GetUser", {
 *   args: { id: Schema.String },
 *   success: Schema.Struct({ id: Schema.String, name: Schema.String }),
 *   error: Schema.Never,
 *   staleTime: "30 seconds"
 * }) {
 *   static readonly layer = this.toLayer(({ id }) =>
 *     Effect.sync(() => ({ id, name: `User ${++requests}` }))
 *   )
 * }
 *
 * const program = Effect.gen(function*() {
 *   // Two callers at once share one fetch, and the second call is served from the cache.
 *   const [a, b] = yield* Effect.all([GetUser.get({ id: "1" }), GetUser.get({ id: "1" })], {
 *     concurrency: "unbounded"
 *   })
 *   const c = yield* GetUser.get({ id: "1" })
 *   return [a.name, b.name, c.name, requests]
 * }).pipe(Effect.provide(Layer.merge(GetUser.layer, Query.layer())))
 *
 * await Effect.runPromise(program) // => ["User 1", "User 1", "User 1", 1]
 * ```
 *
 * @since 0.1.0
 */
import * as Cause from "effect/Cause";
import * as Channel from "effect/Channel";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Hash from "effect/Hash";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaParser from "effect/SchemaParser";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";

import * as queryCore from "./internal/query-core.ts";
import { addListener, NonJsonLeaf } from "./internal/query-core.ts";
import { holdsRedacted, redactAST } from "./internal/schema-redact.ts";

/**
 * Identifies a query: a class made by `Service`.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const TypeId: TypeId = "~@effect/ui/Query";

/**
 * Identifies a query: a class made by `Service`.
 *
 * @since 0.1.0
 */
export type TypeId = "~@effect/ui/Query";

/**
 * How often a watched entry refetches: a duration, or a function of the last
 * settled result and the arguments that returns one, or `undefined` to stop.
 *
 * **Details**
 *
 * The function form is called once per settle with the result the fetcher
 * produced, a Success or a Failure. A duration under one second has to be
 * spelt as a Duration string such as `"500 millis"`: a bare number under 1000
 * is rejected, since `refetchInterval: 5` is a 5 ms poll written by mistake.
 *
 * @since 0.1.0
 */
export type RefetchInterval<Args, A, E> =
  | Duration.Input
  | ((
      result: AsyncResult.Success<A, E> | AsyncResult.Failure<A, E>,
      args: Args
    ) => Duration.Input | undefined);

/**
 * What every query has in common: its name, and the types of its arguments,
 * its result and its error.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional interface+namespace pair: the interface is the query contract, the namespace its companion types.
export interface Query<in out Args, in out A, in out E> {
  readonly [TypeId]: Query.Variance<Args, A, E>;
}

/**
 * Helper types for `Query`.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line typescript/no-namespace -- the namespace holds the companion types; merging it into the interface pair is the public API.
export declare namespace Query {
  /**
   * Phantom variance for a query's arguments, result and error.
   *
   * @since 0.1.0
   */
  // oxlint-disable-next-line eslint/no-shadow -- Args is the query args-struct name throughout; the generic binding is intentional.
  export interface Variance<in out Args, in out A, in out E> {
    readonly _Args: Types.Invariant<Args>;
    readonly _A: Types.Invariant<A>;
    readonly _E: Types.Invariant<E>;
  }

  /**
   * Any query.
   *
   * @since 0.1.0
   */
  // oxlint-disable-next-line typescript/no-explicit-any -- Any erases Args/A/E by design; variance is carried by the phantom marker.
  export type Any = Query<any, any, any> | Query<any, any, never>;

  /**
   * The arguments of a query.
   *
   * @since 0.1.0
   */
  export type Args<R> =
    // oxlint-disable-next-line eslint/no-shadow -- Args is the query args-struct name throughout; the infer binding is intentional.
    R extends Query<infer Args, infer _A, infer _E> ? Args : never;

  /**
   * The result of a query.
   *
   * @since 0.1.0
   */
  export type Success<R> =
    R extends Query<infer _Args, infer A, infer _E> ? A : never;

  /**
   * The error of a query.
   *
   * @since 0.1.0
   */
  export type Error<R> =
    R extends Query<infer _Args, infer _A, infer E> ? E : never;
}

/**
 * A query class, as returned by `Service`.
 *
 * **Details**
 *
 * A `Context.Service` holding the query's fetcher. Attach one with `toLayer`;
 * static methods look up the cache and require the query when they may fetch.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional interface+namespace pair: the interface is the service contract, the namespace its companion types.
export interface Service<
  in out Self,
  in out Name extends string,
  in out Args,
  in out A,
  in out E,
>
  extends
    Context.ServiceClass<Self, Name, (args: Args) => Effect.Effect<A, E>>,
    Query<Args, A, E> {
  /**
   * Builds a Layer providing the fetcher from a function or an Effect. Fetches
   * are interrupted when the Layer's Scope closes, waiting for cleanup before
   * releasing captured resources.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  toLayer<LE = never, LR = never>(
    build:
      | ((args: Args) => Effect.Effect<A, E>)
      | Effect.Effect<(args: Args) => Effect.Effect<A, E>, LE, LR>
  ): Layer.Layer<Self, LE, Exclude<LR, Scope.Scope>>;
  /**
   * Returns the stored value when it's fresh, and fetches otherwise, joining
   * a fetch already in flight. The result of the fetch is stored.
   *
   * **Gotchas**
   *
   * A call waiting on a fetch that reverts is interrupted. A fetch reverts
   * when the fetcher interrupts itself, and when the Scope of the caller's
   * build closes while no other build watches or waits for the entry. The
   * call never fails with an error the fetcher didn't raise, and never
   * returns a stale value in its place.
   *
   * It returns the server value, never a patched one. Under a run's live
   * patch it returns a fresh entry's value, and otherwise calls the fetcher
   * for its callers alone, storing nothing. Inside a run, on an entry the
   * run invalidates, it always calls the fetcher in the caller's fiber, and
   * stores nothing.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  get(args: Args): Effect.Effect<A, E, Self | Cache>;
  /**
   * Starts a fetch that outlives the caller, unless the entry is fresh, and
   * returns nothing.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  prefetch(args: Args): Effect.Effect<void, never, Self | Cache>;
  /**
   * Marks one entry, or every entry of the query when called without
   * arguments, stale. A watched entry refetches at once, a fetch in flight is
   * restarted, and any other entry refetches the next time it's asked for.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  invalidate(args?: Args): Effect.Effect<void, never, Cache>;
  /**
   * Watches an entry: loads it if it's cold or stale and nothing else watches
   * it, then emits every change. The Stream starts with the current state
   * when the entry is settled, skips a state equal to the last one, and dies
   * with a fetcher's defect.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  changes(
    args: Args
  ): Stream.Stream<AsyncResult.AsyncResult<A, E>, never, Self | Cache>;
  /**
   * Reads an entry's state without fetching. It doesn't create the entry or
   * keep it alive.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  peek(args: Args): Effect.Effect<AsyncResult.AsyncResult<A, E>, never, Cache>;
  /** One entry, as an invalidation target. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  entry(args: Args): EntryTarget<Query<Args, A, E>>;
  /**
   * An optimistic patch of one entry, applied over its server value while the
   * run that declares it is queued or running. It implies invalidation of
   * the entry.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  patch(args: Args, f: (value: A) => A): Patch<Query<Args, A, E>>;
  /**
   * An optimistic patch of every entry of the query that holds a Success when
   * the run is issued. It implies invalidation of the whole query.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  patchAll(f: (value: A, args: Args) => A): Patch<Query<Args, A, E>>;
  /** A write of a run's result into one entry, for a Command's `writes`. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  set(args: Args, value: A): Write<Query<Args, A, E>>;
}

/**
 * Helper types for `Service`.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare, typescript/no-namespace -- intentional interface+namespace pair; the namespace holds the companion types.
export declare namespace Service {
  /**
   * The arguments type of an `args` option: the Schema's type, or the type of
   * the struct a fields record makes.
   *
   * @since 0.1.0
   */
  export type ArgsType<Args extends Schema.Top | Schema.Struct.Fields> =
    Args extends Schema.Top
      ? Args["Type"]
      : Args extends Schema.Struct.Fields
        ? Schema.Struct<Args>["Type"]
        : never;

  /**
   * A Schema whose JSON encoding needs no services, which is what an entry's
   * arguments, result and error have to be.
   *
   * @since 0.1.0
   */
  export type NoServices = Schema.Top & {
    readonly DecodingServices: never;
    readonly EncodingServices: never;
  };
}

/**
 * Defines a query service class. Attach its fetcher with `toLayer`.
 *
 * **When to use**
 *
 * Use when data is loaded by its arguments and shared: every caller of the
 * same query with the same arguments sees one entry and one fetch.
 *
 * **Details**
 *
 * - `args` is a fields record or any Schema. The cache derives an entry's key
 *   from the encoded arguments, so a query with no arguments writes `args: {}`.
 * - `success` and `error` are required Schemas. A query that can't fail
 *   writes `error: Schema.Never`.
 * - `staleTime` is required. Zero means always stale and `"Infinity"` means
 *   never stale by age. A stale entry is still served at once; it refetches
 *   when its first watcher arrives, on `get` or `prefetch`, on a host edge,
 *   on its interval, or when it's invalidated.
 * - `idleTimeToLive` is how long an entry nothing watches stays in the cache.
 *   It overrides the cache's default of 5 minutes.
 * - `refetchInterval` polls an entry while it's watched.
 * - `tags` lists the invalidation tags the query belongs to.
 *
 * `toLayer` takes a fetcher function or an Effect that builds one once per
 * Layer build. Retries go inside the fetcher (`Effect.retry`); the cache never
 * retries.
 *
 * **Gotchas**
 *
 * - The definition throws on a negative `staleTime` or `idleTimeToLive`, and
 *   on a constant `refetchInterval` that is zero, negative or a bare number
 *   under 1000.
 * - Calling a query throws when its arguments don't encode, or encode to
 *   something JSON can't carry.
 * - `{ id }` and `{ id, page: 1 }` are two entries, even when a default makes
 *   them one request.
 * - An optional field of the `args` struct that is `undefined` is the same
 *   as a missing one: `{ id, page: undefined }` and `{ id }` are one entry.
 *   The property is dropped before the `args` Schema checks or encodes the
 *   arguments.
 * - Only the fields of the `args` struct itself are covered. What a field
 *   holds reaches the Schema as it was passed: a nested struct, a union, a
 *   class, a record, a tuple, an `Option` or a collection. So do arguments
 *   that are not a struct, such as a `Schema.Class` or a union.
 * - Everywhere else the Schema's encoding decides. The default JSON encoding
 *   of a type that allows both `undefined` and `null` encodes both as
 *   `null`. So for a nested `page: Schema.optional(Schema.NullOr(Schema.Number))`,
 *   `{ filter: { page: undefined } }` and `{ filter: { page: null } }` are
 *   one entry, and the later call gets the data of the earlier one.
 *   `{ filter: {} }` is another entry. The same goes for a required key, a
 *   record's value and a tuple's element of such a type.
 * - Other Schemas differ. `Schema.Any` passes values through, so an
 *   `undefined` property is the same as a missing one. An encoding that
 *   distinguishes `undefined` from `null` gives them separate entries; use
 *   one when the fetcher treats them differently.
 * - The property's type decides whether `undefined` is allowed, so a
 *   `Schema.optionalKey(Schema.Number)` property rejects it. A type made with
 *   `Schema.declare` is not asked: under `Schema.optionalKey` its `undefined`
 *   is left to the Schema. An `undefined` that the Schema's own encoding
 *   produces is left to the Schema too.
 * - Only a property the arguments hold as their own plain data is dropped.
 *   One they inherit, or one behind a getter, is left to the Schema.
 * - The arguments are never changed. When a property is dropped, the Schema
 *   gets a copy without it.
 * - The fetcher gets the arguments of the call that created the entry, so it
 *   can see either form.
 *
 * **Example** (A query that captures a service)
 *
 * ```ts import.meta.vitest
 * import { Context, Effect, Layer, Schema } from "effect"
 * import { Query } from "@ilha/model"
 *
 * class UsersApi extends Context.Service<UsersApi, {
 *   readonly name: (id: string) => Effect.Effect<string>
 * }>()("UsersApi") {}
 *
 * class GetUserName extends Query.Service<GetUserName>()("users/GetUserName", {
 *   args: { id: Schema.String },
 *   success: Schema.String,
 *   error: Schema.Never,
 *   staleTime: "1 minute"
 * }) {
 *   static readonly layer = this.toLayer(Effect.gen(function*() {
 *     const api = yield* UsersApi
 *     return ({ id }) => api.name(id)
 *   }))
 * }
 *
 * const layer = GetUserName.layer.pipe(
 *   Layer.provide(Layer.succeed(UsersApi, { name: (id) => Effect.succeed(`user-${id}`) })),
 *   Layer.merge(Query.layer())
 * )
 *
 * await Effect.runPromise(GetUserName.get({ id: "1" }).pipe(Effect.provide(layer))) // => "user-1"
 * ```
 *
 * @since 0.1.0
 */
export const Service: <Self>() => <
  const Name extends string,
  const Args extends
    | Service.NoServices
    | Readonly<Record<string, Service.NoServices>>,
  Success extends Service.NoServices,
  Error extends Service.NoServices,
>(
  name: Name,
  options: {
    readonly args: Args;
    readonly success: Success;
    readonly error: Error;
    readonly staleTime: Duration.Input;
    readonly idleTimeToLive?: Duration.Input | undefined;
    readonly refetchInterval?:
      | RefetchInterval<Service.ArgsType<Args>, Success["Type"], Error["Type"]>
      | undefined;
    readonly tags?: readonly Tag[] | undefined;
  }
) => Service<
  Self,
  Name,
  Service.ArgsType<Args>,
  Success["Type"],
  Error["Type"]
> =
  () =>
  (
    name: string,
    options: {
      readonly args: Schema.Top | Schema.Struct.Fields;
      readonly success: Schema.Top;
      readonly error: Schema.Top;
      readonly staleTime: Duration.Input;
      readonly idleTimeToLive?: Duration.Input | undefined;
      // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
      readonly refetchInterval?: RefetchInterval<any, any, any> | undefined;
      readonly tags?: readonly Tag[] | undefined;
    }
    // oxlint-disable-next-line typescript/no-explicit-any -- the factory builds the query class dynamically; the Service interface above types it.
  ): any => {
    // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
    const def = makeDef(name, options);
    // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
    const QueryService = queryClass(def);
    return class extends QueryService {
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the static set takes the query's erased args and value; the query's args and success Schemas decode them at the fetch boundary.
      static set(args: unknown, value: unknown) {
        // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
        return write(QueryService, args, value);
      }
    };
  };

/**
 * The class every query is: the fetcher's service, its `toLayer` and the
 * statics that look the cache up. An infinite query adds its own.
 */
const queryClass = (def: QueryDef) => {
  // oxlint-disable-next-line typescript/no-explicit-any -- the Self type is supplied by the caller's generic; the factory erases it while building.
  const Base = Context.Service<any, Fetcher>()(def.name);
  class QueryService extends Base {
    // oxlint-disable-next-line typescript/no-explicit-any -- the tag carries the QueryDef for defOf; the class type comes from the caller.
    static readonly [TypeId]: any = def;
    static toLayer(
      // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
      build: Fetcher | Effect.Effect<Fetcher, any, any>
      // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
    ): Layer.Layer<any, any, any> {
      return Layer.effect(
        Base,
        Effect.gen(function* buildFetcher() {
          const scope = yield* Effect.scope;
          const fetcher = Effect.isEffect(build) ? yield* build : build;
          // oxlint-disable-next-line eslint/no-use-before-define -- the layer builder closes over the module helpers; it runs at Layer construction, after module init.
          const built = makeBuild(fetcher);
          // oxlint-disable-next-line eslint/no-use-before-define -- the layer builder closes over the module helpers; it runs at Layer construction, after module init.
          yield* Scope.addFinalizer(scope, closeBuild(built));
          return built.fetcher;
        })
      );
    }
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the static takes the query's erased args; the query's args Schema decodes them at the fetch boundary.
    static get(args: unknown) {
      // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
      return withCache((cache, context) =>
        cache.get(
          def,
          args,
          // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
          fetcherOf(context, Base),
          // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
          Context.get(context, CurrentRun)
        )
      );
    }
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the static takes the query's erased args; the query's args Schema decodes them at the fetch boundary.
    static prefetch(args: unknown) {
      // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
      return withCache((cache, context) =>
        // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
        Effect.sync(() => cache.prefetch(def, args, fetcherOf(context, Base)))
      );
    }
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the static takes the query's erased args; the query's args Schema decodes them at the fetch boundary.
    static invalidate(args?: unknown) {
      // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
      return withCache((cache) =>
        Effect.sync(() =>
          cache.invalidate(
            [
              args === undefined
                ? QueryService
                : // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
                  entryTarget(QueryService, args),
            ],
            {
              byHand: true,
            }
          )
        )
      );
    }
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the static takes the query's erased args; the query's args Schema decodes them at the fetch boundary.
    static changes(args: unknown) {
      return Stream.fromChannel(
        Channel.fromTransform((_, scope) =>
          Effect.uninterruptible(
            // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
            withCache((cache, context) =>
              Effect.suspend(() => {
                // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
                type Item = AsyncResult.AsyncResult<any, any>;
                const pending: Item[] = [];
                // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
                let failed: Cause.Cause<any> | undefined;
                let resume:
                  | ((
                      // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
                      effect: Effect.Effect<readonly [Item, ...Item[]], any>
                    ) => void)
                  | undefined;
                let last: Item | undefined;
                const wake = () => {
                  if (resume === undefined) {
                    return;
                  }
                  const r = resume;
                  if (pending.length > 0) {
                    resume = undefined;
                    // SAFETY: splice(0) drains the whole pending queue; the length check above guarantees a non-empty tuple for the callback contract.
                    r(Effect.succeed(pending.splice(0) as [Item, ...Item[]]));
                  } else if (failed !== undefined) {
                    resume = undefined;
                    r(Effect.failCause(failed));
                  }
                };
                const offer = (result: Item): void => {
                  if (failed !== undefined) {
                    return;
                  }
                  if (last !== undefined && Equal.equals(result, last)) {
                    return;
                  }
                  last = result;
                  pending.push(result);
                  wake();
                };
                const handle = cache.watch(
                  def,
                  args,
                  // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
                  fetcherOf(context, Base),
                  offer,
                  (cause) => {
                    if (failed !== undefined) {
                      return;
                    }
                    failed = cause;
                    wake();
                  }
                );
                const current = handle.current();
                if (current._tag !== "Initial") {
                  offer(current);
                }
                // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
                const pull = Effect.callback<readonly [Item, ...Item[]], any>(
                  (r) => {
                    if (pending.length > 0) {
                      // SAFETY: splice(0) drains the whole pending queue; the length check above guarantees a non-empty tuple for the callback contract.
                      r(Effect.succeed(pending.splice(0) as [Item, ...Item[]]));
                      return;
                    }
                    if (failed !== undefined) {
                      r(Effect.failCause(failed));
                      return;
                    }
                    resume = r;
                    return Effect.sync(() => {
                      if (resume === r) {
                        resume = undefined;
                      }
                    });
                  }
                );
                return Effect.as(
                  Scope.addFinalizer(scope, Effect.sync(handle.unregister)),
                  pull
                );
              })
            )
          )
        )
      );
    }
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the static takes the query's erased args; the query's args Schema decodes them at the fetch boundary.
    static peek(args: unknown) {
      // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
      return withCache((cache) => Effect.sync(() => cache.peek(def, args)));
    }
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the static takes the query's erased args; the query's args Schema decodes them at the fetch boundary.
    static entry(args: unknown) {
      // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
      return entryTarget(QueryService, args);
    }
    // oxlint-disable-next-line typescript/no-explicit-any, anti-slop/no-unknown-parameters -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary, and the static takes the query's erased args.
    static patch(args: unknown, f: (value: any) => any) {
      // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
      return patchOne(QueryService, args, f);
    }
    // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
    static patchAll(f: (value: any, args: any) => any) {
      // oxlint-disable-next-line eslint/no-use-before-define -- the query statics close over the module helpers; they run when a query is called, after module init.
      return patchAll(QueryService, f);
    }
  }
  return QueryService;
};

const withCache = <A, E, R>(
  f: (
    cache: CacheInternals,
    context: Context.Context<never>
  ) => Effect.Effect<A, E, R>
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
): Effect.Effect<A, E, any> =>
  Effect.flatMap(Effect.context<never>(), (context) =>
    // oxlint-disable-next-line eslint/no-use-before-define -- the internals record is assembled from the module helpers; its reads run with the cache, after module init.
    f(internals(Context.getUnsafe(context, Cache)), context)
  );

const fetcherOf = (
  context: Context.Context<never>,
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  service: Context.Key<any, Fetcher>
): Fetcher => Context.getUnsafe(context, service);

/**
 * Identifies an infinite query: a class made by `InfiniteService`.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const InfiniteTypeId: InfiniteTypeId = "~@effect/ui/Query/Infinite";

/**
 * Identifies an infinite query: a class made by `InfiniteService`.
 *
 * @since 0.1.0
 */
export type InfiniteTypeId = "~@effect/ui/Query/Infinite";

/**
 * An infinite query: a query whose entry holds every page loaded so far, as an
 * array. Its result is the page array, so `peek`, `changes` and `get`
 * return the pages, and a patch maps them one page at a time.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional interface+namespace pair: the interface is the query contract, the namespace its companion types.
export interface InfiniteQuery<
  in out Args,
  in out Page,
  in out Item,
  in out E,
> extends Query<Args, readonly Page[], E> {
  readonly [InfiniteTypeId]: InfiniteQuery.Variance<Page, Item>;
}

/**
 * Helper types for `InfiniteQuery`.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line typescript/no-namespace -- the namespace holds the companion types; merging it into the interface pair is the public API.
export declare namespace InfiniteQuery {
  /**
   * Phantom variance for an infinite query's page and item.
   *
   * @since 0.1.0
   */
  // oxlint-disable-next-line eslint/no-shadow -- Page and Item are the infinite-query element names throughout; the generic bindings are intentional.
  export interface Variance<in out Page, in out Item> {
    readonly _Page: Types.Invariant<Page>;
    readonly _Item: Types.Invariant<Item>;
  }

  /**
   * Any infinite query.
   *
   * @since 0.1.0
   */
  export type Any =
    // oxlint-disable-next-line typescript/no-explicit-any -- Any erases Args/A/E by design; variance is carried by the phantom marker.
    | InfiniteQuery<any, any, any, any>
    // oxlint-disable-next-line typescript/no-explicit-any -- Any erases Args/A/E by design; variance is carried by the phantom marker.
    | InfiniteQuery<any, any, any, never>;

  /**
   * The page of an infinite query.
   *
   * @since 0.1.0
   */
  export type Page<R> =
    // oxlint-disable-next-line eslint/no-shadow -- Page is the infinite-query element name throughout; the infer binding is intentional.
    R extends InfiniteQuery<infer _Args, infer Page, infer _Item, infer _E>
      ? Page
      : never;

  /**
   * The item of an infinite query: what its `items` returns for a page.
   *
   * @since 0.1.0
   */
  export type Item<R> =
    // oxlint-disable-next-line eslint/no-shadow -- Item is the infinite-query element name throughout; the infer binding is intentional.
    R extends InfiniteQuery<infer _Args, infer _Page, infer Item, infer _E>
      ? Item
      : never;
}

/**
 * Whether a list holds more pages to load, as a view sees it.
 *
 * **Details**
 *
 * - `End`: the definition's `next` returned `None` for the last page.
 * - `Available`: there is a next page, and nothing is loading it.
 * - `Loading`: a load more is running or waiting its turn, such as behind a
 *   refetch of the held pages or a live patch.
 * - `Failed`: the last load more failed with `error`. The held pages stay.
 *   The next load more, or the next refetch from page 1, clears it, and so
 *   does the last watcher leaving.
 *
 * @since 0.1.0
 */
export type More<E> =
  | { readonly _tag: "End" }
  | { readonly _tag: "Available" }
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failed"; readonly error: E };

/**
 * What an infinite query's `loadMore` resolves with: every page held once the
 * load ended, and whether there is a next one.
 *
 * @since 0.1.0
 */
export interface LoadedMore<Page> {
  readonly pages: readonly Page[];
  readonly hasMore: boolean;
}

/**
 * An infinite query class, as returned by `InfiniteService`.
 *
 * **Details**
 *
 * It's a `Context.Service` whose value is the query's fetcher, which takes
 * the arguments and the cursor of the page to load, `None` for the first.
 * Its result is the page array. It has the statics of a query, except `set`,
 * and adds `loadMore`, `reset` and `items`.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional interface+const pair: the interface is the service contract, the const its factory.
export interface InfiniteService<
  in out Self,
  in out Name extends string,
  in out Args,
  in out Page,
  in out Item,
  in out Cursor,
  in out E,
>
  extends
    Context.ServiceClass<
      Self,
      Name,
      (args: Args, cursor: Option.Option<Cursor>) => Effect.Effect<Page, E>
    >,
    InfiniteQuery<Args, Page, Item, E> {
  /** Builds a Layer providing the fetcher. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  toLayer<LE = never, LR = never>(
    build:
      | ((args: Args, cursor: Option.Option<Cursor>) => Effect.Effect<Page, E>)
      | Effect.Effect<
          (args: Args, cursor: Option.Option<Cursor>) => Effect.Effect<Page, E>,
          LE,
          LR
        >
  ): Layer.Layer<Self, LE, Exclude<LR, Scope.Scope>>;
  /**
   * Returns the held pages when they're fresh, and otherwise loads the list
   * again from the first page, as many pages as it holds, joining a load in
   * flight. As for any query, a call waiting on a load that reverts is
   * interrupted.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  get(args: Args): Effect.Effect<readonly Page[], E, Self | Cache>;
  /**
   * Loads the first page when the list is cold. When it holds pages, stale
   * ones included, it only keeps the entry from being collected.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  prefetch(args: Args): Effect.Effect<void, never, Self | Cache>;
  /** Marks one list, or every list of the query, stale, as for any query. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  invalidate(args?: Args): Effect.Effect<void, never, Cache>;
  /** Watches a list and emits its page array, as `changes` does for any query. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  changes(
    args: Args
  ): Stream.Stream<
    AsyncResult.AsyncResult<readonly Page[], E>,
    never,
    Self | Cache
  >;
  /** Reads a list's page array without loading anything. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  peek(
    args: Args
  ): Effect.Effect<AsyncResult.AsyncResult<readonly Page[], E>, never, Cache>;
  /**
   * Loads the page after the held ones, and resolves with every page held
   * and whether there is a next one.
   *
   * **Details**
   *
   * It appends from the last held page, whatever the list's age. When a
   * refetch from the first page is running or waiting, it makes that refetch
   * load one page more instead. Under a live patch it waits for the patch's
   * run to exit. It fails with the error of the page it waited for, and does
   * nothing when the list has ended.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  loadMore(args: Args): Effect.Effect<LoadedMore<Page>, E, Self | Cache>;
  /**
   * Drops every held page after the first, then invalidates the list, so it
   * loads again from the first page with only that page held.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  reset(args: Args): Effect.Effect<void, never, Cache>;
  /**
   * The items of a page array, in order, with a later item whose `key` was
   * already seen left out.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  items(pages: readonly Page[]): readonly Item[];
  /** One list, as an invalidation target. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  entry(args: Args): EntryTarget<InfiniteQuery<Args, Page, Item, E>>;
  /**
   * An optimistic patch of one list, applied to each held page. It can't
   * change the page count, and implies invalidation of the list.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  patch(
    args: Args,
    f: (page: Page, index: number) => Page
  ): Patch<InfiniteQuery<Args, Page, Item, E>>;
  /**
   * An optimistic patch of every list of the query that holds pages when the
   * run is issued, applied to each page. It implies invalidation of the whole
   * query.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  patchAll(
    f: (page: Page, args: Args, index: number) => Page
  ): Patch<InfiniteQuery<Args, Page, Item, E>>;
}

/**
 * Defines an infinite query: a query that holds every page of an accumulating list
 * in one entry, and loads more of them on request.
 *
 * **When to use**
 *
 * Use when a new page appends to what the screen shows, such as an infinite
 * feed or a "load more" button, on a cursor API or an offset one. When a new
 * page replaces the old one, use an ordinary query with the page in its args
 * and `h.previous`, even on a cursor API.
 *
 * **Details**
 *
 * - `page` is the Schema of one page. The entry's value is the page array.
 * - `items` lists a page's items and `key` identifies each item. Both are
 *   required. Items are deduplicated by `key`, keeping the first occurrence,
 *   including when an offset API shifts items between pages.
 * - `cursor` is the Schema of a cursor, and `next` derives the cursor of
 *   the page after `lastPage` from the server's pages, `None` when the
 *   list has ended. It must be pure. The cursor is never stored.
 * - Attach the fetcher with `toLayer`; it takes `(args, cursor)`, with `None`
 *   for the first page.
 * - The other options are a query's. `staleTime` counts from the end of the
 *   last load that started at the first page: loading more changes no
 *   timestamp.
 *
 * One entry holds every page of one list, and one load runs per list. A
 * refetch loads the pages again from the first one, in sequence, as many as
 * the list holds, and swaps them in at the end; a list that got shorter ends
 * early. An invalidation, a patch and the close of the build that loads
 * restart it from the first page, keeping the pages to reach. A visibility,
 * connectivity or interval refetch that arrives while a page is being
 * appended runs once that page is in.
 *
 * A failed load more keeps the held pages and sets an error that a view
 * reads as `More`'s `Failed`. A refetch that fails on a page the list
 * holds is a Failure with the held pages as its previous Success; one that
 * fails on the page past them swaps the pages it loaded in, and sets that
 * error. Nothing retries.
 *
 * **Gotchas**
 *
 * - Write `items` before `key`. TypeScript infers the item type from the
 *   first of the two it reads, so with `key` first an item is `unknown`.
 * - A refetch of a list of 30 pages is 30 requests, one after the other.
 * - Every infinite query with the same arguments shares its page count, which
 *   only goes up until `reset` or the entry is collected.
 * - The server renders the first page only, so the page size is the one
 *   lever on how much of a list a server render shows.
 * - Every page a list field holds is saved in `history.state` on each
 *   navigation. `$.reset` drops the pages after the first, and is the way
 *   to keep that small.
 * - For replacement pagination with an ordinary query, reset the cursor when
 *   a filter changes, or the new filter opens at the old cursor.
 *
 * **Example** (A list of messages)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer, Option, Schema } from "effect"
 * import { Query } from "@ilha/model"
 *
 * const Page = Schema.Struct({
 *   messages: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
 *   next: Schema.NullOr(Schema.Number)
 * })
 *
 * class ListMessages extends Query.InfiniteService<ListMessages>()("chat/ListMessages", {
 *   args: { room: Schema.String },
 *   page: Page,
 *   items: (page) => page.messages,
 *   key: (message) => message.id,
 *   error: Schema.Never,
 *   cursor: Schema.Number,
 *   next: (lastPage) => Option.fromNullishOr(lastPage.next),
 *   staleTime: "30 seconds"
 * }) {
 *   static readonly layer = this.toLayer(({ room }, cursor) => {
 *     const from = Option.getOrElse(cursor, () => 0)
 *     return Effect.succeed({
 *       messages: [{ id: `${room}-${from}`, text: `message ${from}` }],
 *       next: from < 2 ? from + 1 : null
 *     })
 *   })
 * }
 *
 * const program = Effect.gen(function*() {
 *   yield* ListMessages.get({ room: "a" })
 *   const { pages, hasMore } = yield* ListMessages.loadMore({ room: "a" })
 *   return [ListMessages.items(pages).map((message) => message.text), hasMore]
 * }).pipe(Effect.provide(Layer.merge(ListMessages.layer, Query.layer())))
 *
 * await Effect.runPromise(program) // => [["message 0", "message 1"], true]
 * ```
 *
 * @since 0.1.0
 */
export const InfiniteService: <Self>() => <
  const Name extends string,
  const Args extends
    | Service.NoServices
    | Readonly<Record<string, Service.NoServices>>,
  PageSchema extends Service.NoServices,
  Item,
  CursorSchema extends Service.NoServices,
  Error extends Service.NoServices,
>(
  name: Name,
  options: {
    readonly args: Args;
    readonly page: PageSchema;
    readonly items: (page: PageSchema["Type"]) => readonly Item[];
    readonly key: (item: NoInfer<Item>) => string;
    readonly error: Error;
    readonly cursor: CursorSchema;
    readonly next: (
      lastPage: PageSchema["Type"],
      allPages: readonly [PageSchema["Type"], ...PageSchema["Type"][]]
    ) => Option.Option<CursorSchema["Type"]>;
    readonly staleTime: Duration.Input;
    readonly idleTimeToLive?: Duration.Input | undefined;
    readonly refetchInterval?:
      | RefetchInterval<
          Service.ArgsType<Args>,
          readonly PageSchema["Type"][],
          Error["Type"]
        >
      | undefined;
    readonly tags?: readonly Tag[] | undefined;
  }
) => InfiniteService<
  Self,
  Name,
  Service.ArgsType<Args>,
  PageSchema["Type"],
  Item,
  CursorSchema["Type"],
  Error["Type"]
> =
  () =>
  (
    name: string,
    options: {
      readonly args: Schema.Top | Schema.Struct.Fields;
      readonly page: Schema.Top;
      // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
      readonly items: (page: any) => readonly any[];
      // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
      readonly key: (item: any) => string;
      readonly error: Schema.Top;
      readonly cursor: Schema.Top;
      // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
      readonly next: (lastPage: any, allPages: any) => Option.Option<any>;
      readonly staleTime: Duration.Input;
      readonly idleTimeToLive?: Duration.Input | undefined;
      // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
      readonly refetchInterval?: RefetchInterval<any, any, any> | undefined;
      readonly tags?: readonly Tag[] | undefined;
    }
    // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
  ): any => {
    // oxlint-disable-next-line eslint/no-use-before-define -- the infinite statics close over the module helpers; they run when a query is called, after module init.
    const def = makeDef(
      name,
      { ...options, success: Schema.Array(options.page) },
      // oxlint-disable-next-line eslint/no-use-before-define -- the infinite statics close over the module helpers; they run when a query is called, after module init.
      makeListDef({
        cursor: options.cursor,
        items: options.items,
        key: options.key,
        next: options.next,
      })
    );
    const QueryService = queryClass(def);
    return class extends QueryService {
      // oxlint-disable-next-line typescript/no-explicit-any -- the tag carries the QueryDef for defOf; the class type comes from the caller.
      static readonly [InfiniteTypeId]: any = InfiniteTypeId;
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the static takes the query's erased args; the query's args Schema decodes them at the fetch boundary.
      static loadMore(args: unknown) {
        return withCache((cache, context) =>
          // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
          Effect.callback<any, any>((resume) => {
            const cancel = cache.loadMore(
              def,
              args,
              fetcherOf(context, QueryService),
              resume
            );
            return Effect.sync(cancel);
          })
        );
      }
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the static takes the query's erased args; the query's args Schema decodes them at the fetch boundary.
      static reset(args: unknown) {
        return withCache((cache) => Effect.sync(() => cache.reset(def, args)));
      }
      static items(pages: readonly unknown[]) {
        // oxlint-disable-next-line eslint/no-use-before-define -- the infinite statics close over the module helpers; they run when a query is called, after module init.
        return infiniteItems(def, pages);
      }
      static override patch(
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the patch impl takes the erased page array; the page Schema decodes it at the list boundary.
        args: unknown,
        // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
        f: (page: any, index: number) => any
      ) {
        // oxlint-disable-next-line eslint/no-use-before-define -- the infinite statics close over the module helpers; they run when a query is called, after module init.
        return patchOne(QueryService, args, (pages: readonly unknown[]) =>
          pages.map((page, i) => f(page, i))
        );
      }
      static override patchAll(
        // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
        f: (page: any, args: any, index: number) => any
      ) {
        // oxlint-disable-next-line eslint/no-use-before-define -- the infinite statics close over the module helpers; they run when a query is called, after module init.
        return patchAll(
          QueryService,
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the patch impl takes the erased pages and args; the page and args Schemas decode them at the list boundary.
          (pages: readonly unknown[], args: unknown) =>
            pages.map((page, i) => f(page, args, i))
        );
      }
    };
  };

/**
 * The items of a page array, in order, with a later item whose key was
 * already seen left out.
 *
 * @internal
 */
export const infiniteItems = (
  def: QueryDef,
  pages: readonly unknown[]
): readonly unknown[] => {
  // oxlint-disable-next-line typescript/no-non-null-assertion -- infiniteItems runs only for list queries; the def carries the list.
  const list = def.list!;
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const page of pages) {
    for (const item of list.items(page)) {
      const key = list.key(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(item);
    }
  }
  return out;
};

/**
 * A declared invalidation tag. A tag is a plain name, so two
 * `Query.Tag("users")` calls are one tag.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional interface+const pair: the interface is the tag contract, the const its factory.
export interface Tag {
  readonly _tag: "Tag";
  readonly name: string;
}

/**
 * Declares an invalidation tag, to list in a query's `tags`.
 *
 * **When to use**
 *
 * Use to invalidate several queries together, such as everything that shows a
 * user, without naming each query where the invalidation happens.
 *
 * @since 0.1.0
 */
export const Tag = (name: string): Tag => ({ _tag: "Tag", name });

/**
 * One entry of a query, as an invalidation target. Built by a query's `entry`.
 *
 * @since 0.1.0
 */
export interface EntryTarget<R extends Query.Any = Query.Any> {
  readonly _tag: "Entry";
  readonly query: R;
  readonly args: Query.Args<R>;
}

/**
 * What a run invalidates: a whole query, one entry or a tag.
 *
 * @since 0.1.0
 */
export type Target = Query.Any | EntryTarget | Tag;

/**
 * An optimistic patch, built by a query's `patch` or `patchAll`. It is a
 * pure function from a server value to the value to show.
 *
 * **Details**
 *
 * A patch is live while its run is queued or running: nothing fetches the
 * entry, and its watchers see the patched value. After the run succeeds the
 * patch is held until the entry settles or a write is stored. A failure, an
 * interrupt or a defect drops it at once.
 *
 * @since 0.1.0
 */
export type Patch<R extends Query.Any = Query.Any> =
  | {
      readonly _tag: "Patch";
      readonly query: R;
      readonly args: Query.Args<R>;
      readonly patch: (value: Query.Success<R>) => Query.Success<R>;
    }
  | {
      readonly _tag: "PatchAll";
      readonly query: R;
      readonly patch: (
        value: Query.Success<R>,
        args: Query.Args<R>
      ) => Query.Success<R>;
    };

/**
 * A write of a run's result into one entry, built by a query's `set`. A
 * Command's `writes` is the only place one is used.
 *
 * @since 0.1.0
 */
export interface Write<R extends Query.Any = Query.Any> {
  readonly _tag: "Set";
  readonly query: R;
  readonly args: Query.Args<R>;
  readonly value: Query.Success<R>;
}

/**
 * Applies, in order, every patch that targets the entry of `read` at `args`
 * to `value`, and leaves the others out.
 *
 * **When to use**
 *
 * Use to test a Command's `optimistic` patches without a cache. It is the
 * function the cache itself calls.
 *
 * **Example** (Testing a patch)
 *
 * ```ts import.meta.vitest
 * import { Schema } from "effect"
 * import { Query } from "@ilha/model"
 *
 * class GetCount extends Query.Service<GetCount>()("counts/GetCount", {
 *   args: { id: Schema.String },
 *   success: Schema.Number,
 *   error: Schema.Never,
 *   staleTime: "1 minute"
 * }) {}
 *
 * const patches = [GetCount.patch({ id: "a" }, (n) => n + 1)]
 * Query.applyPatches(patches, GetCount, { id: "a" }, 1) // => 2
 * Query.applyPatches(patches, GetCount, { id: "b" }, 1) // => 1
 * ```
 *
 * @since 0.1.0
 */
export const applyPatches = <R extends Query.Any>(
  patches: readonly Patch[],
  query: R,
  args: Query.Args<R>,
  value: Query.Success<R>
): Query.Success<R> => {
  // oxlint-disable-next-line eslint/no-use-before-define -- run helpers invoke each other while a run executes, after module init.
  const def = defOf(query);
  const argsKey = def.argsKey(args);
  let next = value;
  for (const patch of patches) {
    // SAFETY: patches preserve the success type; each applier maps Success to Success.
    // oxlint-disable-next-line eslint/no-use-before-define -- run helpers invoke each other while a run executes, after module init.
    next = applyPatch(patch, def.name, argsKey, args, next) as Query.Success<R>;
  }
  return next;
};

/**
 * Whether a run with these `invalidates` and `optimistic` declarations
 * invalidates the entry of `read` at `args`: a declared target hits it, or
 * a patch targets it.
 *
 * **When to use**
 *
 * Use to test a Command's declarations without a cache, using the same
 * predicate as the cache and `get` inside a run.
 *
 * **Details**
 *
 * A write stored fresh is left out of its run's invalidation. This predicate
 * doesn't know about writes: it answers before they are subtracted.
 *
 * **Example** (Testing a Command's targets)
 *
 * ```ts import.meta.vitest
 * import { Schema } from "effect"
 * import { Query } from "@ilha/model"
 *
 * const Users = Query.Tag("users")
 *
 * class GetUser extends Query.Service<GetUser>()("users/GetUser", {
 *   args: { id: Schema.String },
 *   success: Schema.String,
 *   error: Schema.Never,
 *   staleTime: "1 minute",
 *   tags: [Users]
 * }) {}
 *
 * Query.invalidatesEntry({ invalidates: [Users] }, GetUser, { id: "1" }) // => true
 * Query.invalidatesEntry({ invalidates: [GetUser.entry({ id: "1" })] }, GetUser, { id: "2" }) // => false
 * ```
 *
 * @since 0.1.0
 */
export const invalidatesEntry = <R extends Query.Any>(
  run: {
    readonly invalidates: readonly Target[];
    readonly optimistic?: readonly Patch[] | undefined;
  },
  query: R,
  args: Query.Args<R>
): boolean => {
  // oxlint-disable-next-line eslint/no-use-before-define -- run helpers invoke each other while a run executes, after module init.
  const def = defOf(query);
  // oxlint-disable-next-line eslint/no-use-before-define -- run helpers invoke each other while a run executes, after module init.
  return targetsHit(
    // oxlint-disable-next-line eslint/no-use-before-define -- run helpers invoke each other while a run executes, after module init.
    compileTargets(run.invalidates, run.optimistic),
    def.name,
    def.tags,
    def.argsKey(args)
  );
};

/**
 * What started a fetch. Every fetch records exactly one, and the fetcher
 * never sees it.
 *
 * **Details**
 *
 * - `watch`: an entry's watcher count went from zero to one over a cold or
 *   stale entry. A watcher that joins others never refetches.
 * - `get` and `prefetch`: the call found a cold or stale entry with no
 *   fetch in flight. A `get` that calls the fetcher for its callers alone,
 *   storing nothing, records `get` too.
 * - `visibility` and `connectivity`: the host signal went from false to
 *   true, and a watched entry was stale or its interval had elapsed.
 * - `interval`: a watched entry's `refetchInterval` fired.
 * - `invalidation`: an invalidation hit a watched entry.
 * - `loadMore`: an infinite query's `loadMore`.
 * - `reset`: an infinite query's `reset` hit a watched list.
 *
 * @since 0.1.0
 */
export type Trigger =
  | "watch"
  | "get"
  | "prefetch"
  | "visibility"
  | "connectivity"
  | "interval"
  | "invalidation"
  | "loadMore"
  | "reset";

/**
 * A boolean a host reports, with a synchronous getter and a listener. It is
 * state, not a pulse: the cache reads the level as well as its edges.
 *
 * @since 0.1.0
 */
export interface Signal {
  /** The current value. */
  readonly get: () => boolean;
  /** Calls `listener` with the new value on every change. Returns the unsubscribe. */
  readonly subscribe: (listener: (value: boolean) => void) => () => void;
}

/**
 * Whether the host is visible, such as a browser tab in the foreground.
 * Defaults to always true, so servers and CLIs provide nothing.
 *
 * **Details**
 *
 * When it goes from false to true, and `Connectivity` is true as well, the
 * cache refetches every watched entry that is stale or whose interval elapsed
 * meanwhile. While it's false, intervals don't fire. The cache reads it once,
 * when it's built.
 *
 * @since 0.1.0
 */
export const Visibility: Context.Reference<Signal> = queryCore.Visibility;

/**
 * Whether the host is online. Defaults to always true, so servers and CLIs
 * provide nothing.
 *
 * **Details**
 *
 * When it goes from false to true, and `Visibility` is true as well, the cache
 * refetches every watched entry that is stale or whose interval elapsed
 * meanwhile. While it's false, intervals don't fire. Being offline never
 * blocks a fetch: the fetcher fails, and the reconnect refetches. The cache
 * reads it once, when it's built.
 *
 * @since 0.1.0
 */
export const Connectivity: Context.Reference<Signal> = queryCore.Connectivity;

/**
 * A second query was defined under a name already in the cache. The first
 * definition wins: it pins the Schemas, the stale and idle times, the interval
 * and the tags.
 *
 * @since 0.1.0
 */
export class DuplicateName extends Data.TaggedClass("DuplicateName")<{
  readonly message: string;
  readonly query: string;
}> {}

/**
 * A function-form `refetchInterval` threw. The entry has no interval until
 * its next settle. `error` is what was thrown.
 *
 * @since 0.1.0
 */
export class IntervalThrew extends Data.TaggedClass("IntervalThrew")<{
  readonly message: string;
  readonly query: string;
  readonly logKey: string;
  readonly error: unknown;
}> {}

/**
 * A function-form `refetchInterval` returned zero, a negative, or a bare
 * number under 1000. The entry has no interval until its next settle.
 *
 * @since 0.1.0
 */
export class IntervalInvalid extends Data.TaggedClass("IntervalInvalid")<{
  readonly message: string;
  readonly query: string;
  readonly logKey: string;
}> {}

/**
 * One entry's fetch was restarted 10 times in a row with no settle between.
 * Nothing changes; it's reported once per streak.
 *
 * @since 0.1.0
 */
export class FetchRestarted extends Data.TaggedClass("FetchRestarted")<{
  readonly message: string;
  readonly query: string;
  readonly logKey: string;
}> {}

/**
 * A list's walk got a page again: `next` returned a cursor that encodes
 * equal to one the walk already used. Nothing changes; it's reported once per
 * walk.
 *
 * @since 0.1.0
 */
export class PageRepeated extends Data.TaggedClass("PageRepeated")<{
  readonly message: string;
  readonly query: string;
  readonly logKey: string;
}> {}

/**
 * A page of a list holds two items with one `key`. The first survives in
 * `items`. A duplicate across two pages is left out without a report.
 *
 * @since 0.1.0
 */
export class DuplicateKeyInPage extends Data.TaggedClass("DuplicateKeyInPage")<{
  readonly message: string;
  readonly query: string;
  readonly logKey: string;
}> {}

/**
 * A patch made a value the query's `success` Schema rejects, the first time it
 * was applied. The value is used as is.
 *
 * @since 0.1.0
 */
export class PatchInvalid extends Data.TaggedClass("PatchInvalid")<{
  readonly message: string;
  readonly query: string;
  readonly logKey: string;
  readonly command: string;
}> {}

/**
 * A patch changed the server value it was given, the first time it was
 * applied. A patch must return a new value.
 *
 * **Details**
 *
 * The cache encodes the server value with the query's `success` Schema before
 * a run's patches are first applied and after, and compares snapshots of the
 * two encodings with `Equal.equals`. The check sees everything the Schema
 * encodes. Where the Schema passes a value through as it is, as `Schema.Any`
 * does, it sees the value's own data properties, and not:
 *
 * - inside a value that implements `Equal`;
 * - state that only a getter reaches, such as a private field or a
 *   `WeakMap`.
 *
 * The check runs no getter and no `Equal` or `Hash` method of the value,
 * and finds an `Equal` value by the presence of its key. A patch that reads
 * a getter which memoizes into the value's own data is reported, since the
 * stored value changed. A `Proxy` has its `getPrototypeOf`, `has`,
 * `ownKeys` and `getOwnPropertyDescriptor` traps called, never `get` or
 * `set`, and one whose traps answer differently each time can be reported on
 * a patch that changed nothing. If a mutation goes unreported,
 * give the query a `success` Schema that encodes the value. A value the Schema
 * can't encode is not checked.
 *
 * @since 0.1.0
 */
export class PatchMutated extends Data.TaggedClass("PatchMutated")<{
  readonly message: string;
  readonly query: string;
  readonly logKey: string;
  readonly command: string;
}> {}

/**
 * A run wrote an entry that existed when it started and that neither its
 * `invalidates` nor a patch covers. The write applies.
 *
 * @since 0.1.0
 */
export class UncoveredWrite extends Data.TaggedClass("UncoveredWrite")<{
  readonly message: string;
  readonly query: string;
  readonly logKey: string;
  readonly command: string;
}> {}

/**
 * A query's own `invalidate` was called on a per-request server cache, where
 * an entry settles once. Nothing changes.
 *
 * @since 0.1.0
 */
export class InvalidateIgnored extends Data.TaggedClass("InvalidateIgnored")<{
  readonly message: string;
  readonly query: string | undefined;
}> {}

/**
 * An entry failed to encode when the server cache was serialised. It is left
 * out, and the client fetches it.
 *
 * @since 0.1.0
 */
export class EncodeFailed extends Data.TaggedClass("EncodeFailed")<{
  readonly message: string;
  readonly query: string;
  readonly logKey: string;
}> {}

/**
 * The serialised cache the client hydrates from isn't the expected shape. It
 * is ignored whole.
 *
 * @since 0.1.0
 */
export class HydrationMalformed extends Data.TaggedClass("HydrationMalformed")<{
  readonly message: string;
}> {}

/**
 * A hydrated entry's arguments or value failed to decode when its query
 * registered. The entry is cold. `logKey` is there only when the arguments
 * decoded.
 *
 * @since 0.1.0
 */
export class HydrationDecodeFailed extends Data.TaggedClass(
  "HydrationDecodeFailed"
)<{
  readonly message: string;
  readonly query: string;
  readonly part: "value" | "args";
  /** Only when `part` is `"value"`: decoded args are what a log key is built from. */
  readonly logKey: string | undefined;
}> {}

/**
 * Diagnostic problems reported by the cache without changing its behavior.
 *
 * **Details**
 *
 * A problem names its query and the entry's log key, which is the entry's key
 * built with every `Schema.Redacted` argument redacted. It never carries a
 * value or the key itself.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional type+namespace pair: the type is the problem contract, the namespace its companion types.
export type Problem =
  | DuplicateName
  | IntervalThrew
  | IntervalInvalid
  | FetchRestarted
  | PageRepeated
  | DuplicateKeyInPage
  | PatchInvalid
  | PatchMutated
  | UncoveredWrite
  | InvalidateIgnored
  | EncodeFailed
  | HydrationMalformed
  | HydrationDecodeFailed;

/**
 * Helper types for `Problem`.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line typescript/no-namespace -- the namespace holds the companion types; merging it into the pair is the public API.
export declare namespace Problem {
  /**
   * What the `Problems` sink takes: any tagged problem with a message. It is
   * open, since modules built on the cache report their own.
   *
   * @since 0.1.0
   */
  export interface Any {
    readonly _tag: string;
    readonly message: string;
  }
}

/**
 * Where the cache reports problems: a synchronous function, called with each
 * one. The default is `console.warn(problem.message)`.
 *
 * **When to use**
 *
 * Use to send problems somewhere else, such as a Logger, by providing a
 * function that forks `Effect.logWarning`.
 *
 * **Details**
 *
 * Every check runs in every build. The cache reads the sink once, when it's
 * built, and swallows anything the sink throws.
 *
 * @since 0.1.0
 */
export const Problems: Context.Reference<(problem: Problem.Any) => void> =
  queryCore.Problems;

/**
 * The cache service used by queries.
 *
 * @since 0.1.0
 */
export class Cache extends Context.Service<
  Cache,
  {
    readonly "~@effect/ui/Query/Cache": "~@effect/ui/Query/Cache";
  }
>()("@effect/ui/Query/Cache") {}

/**
 * Layer that provides a cache for plain Effect code.
 *
 * **Details**
 *
 * `idleTimeToLive` is how long an entry stays once nothing watches it, 5
 * minutes by default; a query can override it. The cache takes `Visibility`,
 * `Connectivity`, `Problems` and the `Clock` from where the Layer is built,
 * and is disposed with the Layer's Scope: fetches in flight are interrupted,
 * and the close waits for their cleanup.
 *
 * **Gotchas**
 *
 * Throws on a negative `idleTimeToLive`.
 *
 * @since 0.1.0
 */
export const layer = (options?: {
  readonly idleTimeToLive?: Duration.Input | undefined;
}): Layer.Layer<Cache> => {
  // oxlint-disable-next-line eslint/no-use-before-define -- the layer builds the cache at Layer construction, after module init.
  const idleMs = cacheIdleMs(options?.idleTimeToLive);
  return Layer.effect(
    Cache,
    Effect.gen(function* makeLayer() {
      const context = yield* Effect.context<never>();
      // oxlint-disable-next-line eslint/no-use-before-define -- the layer builds the cache at Layer construction, after module init.
      return yield* makeCache({
        connectivity: Context.get(context, Connectivity),
        idleMs,
        report: Context.get(context, Problems),
        visibility: Context.get(context, Visibility),
      });
    })
  );
};

// =============================================================================
// Internals
// =============================================================================

// -----------------------------------------------------------------------------
// Type ids
// -----------------------------------------------------------------------------

const CacheTypeId = "~@effect/ui/Query/Cache";

const BuildTypeId = "~@effect/ui/Query/Build";

// -----------------------------------------------------------------------------
// Keys
// -----------------------------------------------------------------------------

const { canonical } = queryCore;

/** The stand-ins for values held by reference: equal only to themselves, with no `Equal` or `Hash` method. */
const standIns = new WeakMap<object, object>();
// oxlint-disable-next-line anti-slop/no-object-parameters -- standIn walks arbitrary structured-cloneable values; object is the honest seam.
const standIn = (u: object): object => {
  let out = standIns.get(u);
  if (out === undefined) {
    // SAFETY: Object.create(null) makes a fresh identity token; the cast types the brand-free token.
    out = Equal.byReferenceUnsafe(Object.create(null) as object);
    standIns.set(u, out);
  }
  return out;
};
const typedArrayKey = Symbol("@effect/ui/Query/typedArray");
/** Where an array has an accessor element: it is never read. */
const accessorSlot = Symbol("@effect/ui/Query/accessor");

// The built-in getters and methods, called directly: they read internal slots and nothing through the object, and
// throw on an object without the slot, a `Proxy` included.
// oxlint-disable-next-line typescript/no-explicit-any, anti-slop/no-unknown-parameters -- intrinsic slot readers forward arbitrary receiver arguments, erased at this seam.
type Intrinsic = (this: unknown, ...args: any[]) => any;
// oxlint-disable-next-line anti-slop/no-object-parameters -- intrinsic slot readers take arbitrary receivers; object is the honest seam.
const getter = (proto: object, key: PropertyKey): Intrinsic =>
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the builtin getters exist on their prototypes; the descriptors are installed.
  Object.getOwnPropertyDescriptor(proto, key)!.get!;
// oxlint-disable-next-line anti-slop/no-object-parameters -- slot probes take arbitrary values; object is the honest seam.
const hasSlot = (intrinsic: Intrinsic, u: object): boolean => {
  try {
    intrinsic.call(u);
    return true;
  } catch {
    return false;
  }
};
const typedArrayProto: object = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayTag = getter(typedArrayProto, Symbol.toStringTag);
const typedArrayBuffer = getter(typedArrayProto, "buffer");
const typedArrayOffset = getter(typedArrayProto, "byteOffset");
const typedArrayLength = getter(typedArrayProto, "byteLength");
const dataViewBuffer = getter(DataView.prototype, "buffer");
const dataViewOffset = getter(DataView.prototype, "byteOffset");
const dataViewLength = getter(DataView.prototype, "byteLength");
const arrayBufferLength = getter(ArrayBuffer.prototype, "byteLength");
const sharedArrayBufferLength =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : getter(SharedArrayBuffer.prototype, "byteLength");
const dateTime: Intrinsic = Date.prototype.getTime;
const regExpSource = getter(RegExp.prototype, "source");
// Each flag on its own: the `flags` getter reads them through the object.
const regExpFlagGetters = (
  [
    ["d", "hasIndices"],
    ["g", "global"],
    ["i", "ignoreCase"],
    ["m", "multiline"],
    ["s", "dotAll"],
    ["u", "unicode"],
    ["v", "unicodeSets"],
    ["y", "sticky"],
  ] as const
).flatMap(([flag, key]) =>
  key in RegExp.prototype
    ? [[flag, getter(RegExp.prototype, key)] as const]
    : []
);
// oxlint-disable-next-line anti-slop/no-object-parameters -- the flag reader takes an arbitrary value; object is the honest seam.
const regExpFlags = (u: object): string => {
  let flags = "";
  for (const [flag, get] of regExpFlagGetters) {
    if (get.call(u)) {
      flags += flag;
    }
  }
  return flags;
};
const mapSize = getter(Map.prototype, "size");
const setSize = getter(Set.prototype, "size");
const mapForEach: (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the forEach aliases mirror the builtin signatures; unknown carries any value the collection holds.
  this: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the forEach aliases mirror the builtin signatures; unknown carries any value the collection holds.
  f: (value: unknown, key: unknown) => void
) => void = Map.prototype.forEach;
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the forEach aliases mirror the builtin signatures; unknown carries any value the collection holds.
const setForEach: (this: unknown, f: (value: unknown) => void) => void =
  Set.prototype.forEach;
/** A copy of a buffer's bytes in a new `ArrayBuffer`. A detached buffer throws, skipping the check. */
const copyBytes = (
  buffer: ArrayBufferLike,
  offset: number,
  length: number
): Uint8Array<ArrayBuffer> => new Uint8Array(buffer, offset, length).slice();
/**
 * A snapshot of a value for the `PatchMutated` check, deep and following
 * cycles, that runs none of the value's own code. It only reflects on a
 * value, so of a `Proxy` only the `getPrototypeOf`, `has`, `ownKeys` and
 * `getOwnPropertyDescriptor` traps run, never `get` or `set`.
 *
 * - An `Equal` value, found by the presence of the `Equal` key without
 *   reading it, and a function become an inert stand-in, the same one for
 *   the same object, so that no `Equal` or `Hash` method of theirs runs when
 *   snapshots are compared.
 * - `Date`, `RegExp`, `Map`, `Set` and binary data are recognized by their
 *   internal slots and read through the built-in getters and methods called
 *   directly, which read nothing through the object.
 * - An array is copied by element, read through its own property descriptors.
 *   An accessor element is not read, and its slot holds a marker.
 * - Any other object becomes a prototype-less record of its own data
 *   properties, non-enumerable and symbol keys included, without its `Hash`
 *   method. An accessor is never read, and nothing inherited is copied.
 * - Binary data is kept as its bytes, each kind apart, so an unchanged float
 *   array holding `NaN` stays equal to itself.
 *
 * Two snapshots compare with `Equal.equals` as the data did when each was
 * taken, and neither holds a live object: `Equal.equals` and `Hash.hash`
 * cache by object, and a hash cached before one mutation would hide the next.
 * Throws when a trap throws or a buffer is detached.
 */
// oxlint-disable-next-line eslint/complexity -- materialize walks every cloneable shape in one pass; splitting it would scatter the shape dispatch.
const materialize = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- materialize walks arbitrary JSON values; unknown is the honest seam.
  u: unknown,
  seen = new Map<object, unknown>()
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- materialize returns the walked JSON value; the snapshot Schema decodes it at the boundary.
): unknown => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the walk dispatches on the value's representation; the branch rebuilds the matching shape.
  if (typeof u === "function") {
    return standIn(u);
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the walk dispatches on the value's representation; the branch rebuilds the matching shape.
  if (typeof u !== "object" || u === null) {
    return u;
  }
  if (Equal.symbol in u) {
    return standIn(u);
  }
  const known = seen.get(u);
  if (known !== undefined) {
    return known;
  }
  if (ArrayBuffer.isView(u)) {
    const kind: string | undefined = typedArrayTag.call(u);
    if (kind === undefined) {
      // A `DataView`: its getter throws on a detached buffer, skipping the check.
      // oxlint-disable-next-line anti-slop/no-known-value-widening -- materialize returns rebuilt values of many shapes; unknown is the honest result.
      return new DataView(
        copyBytes(
          dataViewBuffer.call(u),
          dataViewOffset.call(u),
          dataViewLength.call(u)
        ).buffer
      );
    }
    // `Equal.equals` compares typed array elements with `!==`, which never matches `NaN` and matches `0` with `-0`,
    // and doesn't tell kinds apart. A record under a private key holds the kind and the bytes instead.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the rebuilt record holds arbitrary walked values; the snapshot Schema states the contract.
    const out: Record<PropertyKey, unknown> = Object.create(null);
    out[typedArrayKey] = [
      kind,
      copyBytes(
        typedArrayBuffer.call(u),
        typedArrayOffset.call(u),
        typedArrayLength.call(u)
      ).buffer,
    ];
    return out;
  }
  if (Array.isArray(u)) {
    // SAFETY: the length own-descriptor of an array holds its numeric length.
    // oxlint-disable-next-line typescript/no-non-null-assertion -- arrays always carry their length descriptor.
    const length = Object.getOwnPropertyDescriptor(u, "length")!
      .value as number;
    const out: unknown[] = Array.from({ length });
    seen.set(u, out);
    for (let i = 0; i < length; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(u, i);
      if (descriptor === undefined) {
        out[i] = undefined;
      } else {
        out[i] =
          "value" in descriptor
            ? materialize(descriptor.value, seen)
            : accessorSlot;
      }
    }
    return out;
  }
  // `instanceof` only walks the prototypes; the slot check then tells a built-in object from a `Proxy` or an
  // object made from its prototype, which are copied as records.
  if (u instanceof Date && hasSlot(dateTime, u)) {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- materialize returns rebuilt values of many shapes; unknown is the honest result.
    return new Date(dateTime.call(u));
  }
  if (u instanceof RegExp && hasSlot(regExpSource, u)) {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- materialize returns rebuilt values of many shapes; unknown is the honest result.
    return new RegExp(regExpSource.call(u), regExpFlags(u));
  }
  if (u instanceof ArrayBuffer && hasSlot(arrayBufferLength, u)) {
    // SAFETY: instanceof ArrayBuffer plus the length slot check establish the buffer.
    return copyBytes(u as ArrayBuffer, 0, arrayBufferLength.call(u)).buffer;
  }
  if (
    sharedArrayBufferLength !== undefined &&
    u instanceof SharedArrayBuffer &&
    hasSlot(sharedArrayBufferLength, u)
  ) {
    const length: number = sharedArrayBufferLength.call(u);
    const out = new SharedArrayBuffer(length);
    // SAFETY: instanceof SharedArrayBuffer plus the slot check establish the buffer.
    new Uint8Array(out).set(new Uint8Array(u as SharedArrayBuffer, 0, length));
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- materialize returns rebuilt values of many shapes; unknown is the honest result.
    return out;
  }
  if (u instanceof Map && hasSlot(mapSize, u)) {
    const out = new Map();
    seen.set(u, out);
    mapForEach.call(u, (value, key) =>
      out.set(materialize(key, seen), materialize(value, seen))
    );
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- materialize returns rebuilt values of many shapes; unknown is the honest result.
    return out;
  }
  if (u instanceof Set && hasSlot(setSize, u)) {
    const out = new Set();
    seen.set(u, out);
    setForEach.call(u, (value) => out.add(materialize(value, seen)));
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- materialize returns rebuilt values of many shapes; unknown is the honest result.
    return out;
  }
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the rebuilt record holds arbitrary walked values; the snapshot Schema states the contract.
  const out: Record<PropertyKey, unknown> = Object.create(null);
  seen.set(u, out);
  for (const key of Reflect.ownKeys(u)) {
    if (key === Hash.symbol) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(u, key);
    if (descriptor !== undefined && "value" in descriptor) {
      out[key] = materialize(descriptor.value, seen);
    }
  }
  return out;
};

/**
 * A snapshot of the encoding of a server value, for the `PatchMutated`
 * check, or `undefined` when the check can't be made: the encoding or the
 * snapshot throws. Never throws, since the check only reports.
 */
const materializedEncoding = (
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the encoder returns the schema-erased encoding; the codec Schema states the contract.
  encode: () => unknown
): { readonly encoded: unknown } | undefined => {
  try {
    return { encoded: materialize(encode()) };
  } catch {
    return undefined;
  }
};

const lazy = <A>(make: () => A): (() => A) => {
  let made: { readonly value: A } | undefined;
  return () => (made ??= { value: make() }).value;
};

/**
 * Whether a type names `undefined`: `Schema.optional` and `Schema.UndefinedOr`
 * name it, and `Schema.Unknown` holds anything. A union names it when any of
 * its members does, whatever the union's mode. A declaration doesn't name it,
 * since only its guard could say. A `suspend` is followed, once.
 */
const namesUndefined = (
  ast: SchemaAST.AST,
  seen = new Set<SchemaAST.AST>()
): boolean => {
  switch (ast._tag) {
    case "Undefined":
    case "Void":
    case "Unknown":
    case "Any": {
      return true;
    }
    case "Union": {
      return ast.types.some((type) => namesUndefined(type, seen));
    }
    case "Suspend": {
      if (seen.has(ast)) {
        return false;
      }
      seen.add(ast);
      return namesUndefined(ast.thunk(), seen);
    }
    default: {
      return false;
    }
  }
};

/**
 * A copy of `o` without the named properties. Every other own property keeps
 * its descriptor, so no getter runs and a property that isn't enumerable
 * stays. The copy has the prototype of `o`, and is frozen, sealed or closed to
 * extension when `o` is.
 */
// oxlint-disable-next-line anti-slop/no-object-parameters -- copyWithout copies arbitrary option bags; object is the honest seam.
const copyWithout = (o: object, names: readonly PropertyKey[]): object => {
  const descriptors: Record<PropertyKey, PropertyDescriptor> =
    Object.getOwnPropertyDescriptors(o);
  for (const name of names) {
    Reflect.deleteProperty(descriptors, name);
  }
  const out = Object.create(Object.getPrototypeOf(o), descriptors);
  if (Object.isFrozen(o)) {
    Object.freeze(out);
  } else if (Object.isSealed(o)) {
    Object.seal(out);
  } else if (!Object.isExtensible(o)) {
    Object.preventExtensions(out);
  }
  return out;
};

/**
 * Drops every optional property that is `undefined` from args that are a
 * struct, so `{ id, page: undefined }` and `{ id }` build one key. `null` when
 * the args Schema isn't a struct, or is one with no such property.
 *
 * Only the struct the args themselves are is looked at. What a property holds
 * goes to the args Schema as it is: a nested struct, a union, a class, a
 * record, a tuple, an `Option` or a collection. So do args that are a union, a
 * class or a `suspend`.
 *
 * The drop happens before the args Schema checks or encodes anything, so the
 * read behaves as it does for the same args without the property. It goes by
 * the type side of the Schema: what an encoding produces is the Schema's
 * business.
 *
 * A property is dropped when it is the args' own data property, it is
 * `undefined`, the struct says it may be missing, and its type names
 * `undefined`. Nothing is matched against a value, and no check, encoding,
 * declaration's guard or getter runs to decide. So the Schema still rejects an
 * `undefined` that `Schema.optionalKey` forbids, and a property behind a getter
 * or one the args inherit is the Schema's as it is.
 *
 * Args with nothing to drop are returned as they are, not as a copy.
 */
const dropUndefinedOf = (
  ast: SchemaAST.AST
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the encoder factory takes schema-erased args and returns the encoding; the args Schema states the contract.
): ((args: unknown) => unknown) | null => {
  if (ast._tag !== "Objects") {
    return null;
  }
  const optional = ast.propertySignatures.flatMap((property) => {
    const { type } = property;
    // Asked on first use: the type may be behind a `suspend` that can't be followed yet.
    return SchemaAST.isOptional(type)
      ? [{ allowed: lazy(() => namesUndefined(type)), name: property.name }]
      : [];
  });
  if (optional.length === 0) {
    return null;
  }
  return (args) => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates the args value's shape before decoding; the Schema decode states the contract.
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      return args;
    }
    let names: PropertyKey[] | undefined;
    for (const { allowed, name } of optional) {
      const descriptor = Object.getOwnPropertyDescriptor(args, name);
      if (
        descriptor !== undefined &&
        "value" in descriptor &&
        descriptor.value === undefined &&
        allowed()
      ) {
        (names ??= []).push(name);
      }
    }
    return names === undefined ? args : copyWithout(args, names);
  };
};

/**
 * The JSON encoder of an args Schema, run on the args once the optional
 * `undefined` properties of an args struct are dropped.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the args encoder takes schema-erased args and returns the encoding; the args Schema states the contract.
const argsEncoder = (ast: SchemaAST.AST): ((args: unknown) => unknown) => {
  const encode = Schema.encodeUnknownSync(
    Schema.toCodecJson(Schema.make<Schema.Codec<unknown, unknown>>(ast))
  );
  const drop = dropUndefinedOf(ast);
  return drop === null ? encode : (args) => encode(drop(args));
};

// -----------------------------------------------------------------------------
// Host signals
// -----------------------------------------------------------------------------

interface SettableSignal extends Signal {
  readonly set: (value: boolean) => void;
}

/**
 * A settable signal, for tests and for host Layers.
 *
 * @internal
 */
export const makeSignal: (initial?: boolean) => SettableSignal =
  queryCore.makeSignal;

// -----------------------------------------------------------------------------
// Problems
// -----------------------------------------------------------------------------

/** How many restarts of one fetch in a row, with no settle between, are reported. */
const restartLimit = 10;

// -----------------------------------------------------------------------------
// Query definitions
// -----------------------------------------------------------------------------

// oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
type Settled = AsyncResult.Success<any, any> | AsyncResult.Failure<any, any>;

/**
 * The data of a query. A query's identity is this object, not its class.
 *
 * @internal
 */
export interface QueryDef {
  readonly name: string;
  readonly args: Schema.Top;
  readonly success: Schema.Top;
  readonly error: Schema.Top;
  readonly staleMs: number;
  readonly idleMs: number | undefined;
  /** The constant form in milliseconds (`Infinity` is no interval), or the function form. */
  readonly refetchInterval:
    | number
    // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
    | ((result: Settled, args: any) => Duration.Input | undefined)
    | undefined;
  readonly tags: readonly string[];
  /** Throws when the args don't encode, or encode to something JSON can't carry. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- def fields carry schema-erased values; each query's Schemas state the contract.
  readonly argsKey: (args: unknown) => string;
  /** The args with the optional `undefined` properties of an args struct dropped, as the key sees them. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- def fields carry schema-erased values; each query's Schemas state the contract.
  readonly normalize: (args: unknown) => unknown;
  /** The key through the redacting args codec. Never throws. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- def fields carry schema-erased values; each query's Schemas state the contract.
  readonly logKey: (args: unknown, argsKey: string) => string;
  /** The JSON codecs of the query's Schemas, built on first use. Each throws on a value that doesn't fit. */
  readonly codec: () => QueryCodec;
  /** Set on an infinite query. Its `success` is the page array. */
  readonly list: ListDef | undefined;
}

interface ListDef {
  // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
  readonly items: (page: any) => readonly any[];
  // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
  readonly key: (item: any) => string;
  // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
  readonly next: (lastPage: any, allPages: any) => Option.Option<any>;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- def fields carry schema-erased values; each query's Schemas state the contract.
  readonly encodeCursor: (cursor: unknown) => unknown;
  readonly ops: ListOps;
}

interface QueryCodec {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- def fields carry schema-erased values; each query's Schemas state the contract.
  readonly encodeSuccess: (value: unknown) => unknown;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- def fields carry schema-erased values; each query's Schemas state the contract.
  readonly decodeSuccess: (encoded: unknown) => unknown;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- def fields carry schema-erased values; each query's Schemas state the contract.
  readonly encodeError: (error: unknown) => unknown;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- def fields carry schema-erased values; each query's Schemas state the contract.
  readonly decodeError: (encoded: unknown) => unknown;
  /** Whether a value is of the `success` Schema's type. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- def fields carry schema-erased values; each query's Schemas state the contract.
  readonly isSuccess: (value: unknown) => boolean;
  /** The args an args key was built from: `JSON.parse`, then the args codec. */
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- def fields carry schema-erased values; each query's Schemas state the contract.
  readonly decodeArgs: (argsKey: string) => unknown;
}

const jsonCodec = (schema: Schema.Top) =>
  // SAFETY: query Schemas are full codecs by construction; toCodecJson needs the codec view.
  Schema.toCodecJson(schema as Schema.Codec<unknown, unknown>);

const makeCodec = (
  args: Schema.Top,
  success: Schema.Top,
  error: Schema.Top
): QueryCodec => {
  const successJson = jsonCodec(success);
  const errorJson = jsonCodec(error);
  const argsJson = jsonCodec(args);
  const decodeArgs = Schema.decodeUnknownSync(argsJson);
  return {
    decodeArgs: (argsKey) => decodeArgs(JSON.parse(argsKey)),
    decodeError: Schema.decodeUnknownSync(errorJson),
    decodeSuccess: Schema.decodeUnknownSync(successJson),
    encodeError: Schema.encodeUnknownSync(errorJson),
    encodeSuccess: Schema.encodeUnknownSync(successJson),
    // SAFETY: the success Schema is a full codec by construction; Schema.is needs the codec view.
    isSuccess: Schema.is(success as Schema.Codec<unknown, unknown>),
  };
};

const quote = (name: string): string => JSON.stringify(name);

const nonNegative = (
  name: string,
  field: string,
  input: Duration.Input
): number => {
  const duration = Duration.fromInputUnsafe(input);
  if (Duration.isNegative(duration)) {
    throw new Error(`[Query] ${quote(name)}: ${field} can't be negative`);
  }
  return Duration.toMillis(duration);
};

const subSecondHint =
  "A bare number is milliseconds: write a sub-second interval as a Duration string, such as " +
  '"500 millis".';

/** The interval in milliseconds, or why the input isn't one. */
const parseInterval = (input: Duration.Input): number | "invalid" => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- branches the interval's bare-number form; Duration.fromInput states the contract.
  if (typeof input === "number" && !(input >= 1000)) {
    return "invalid";
  }
  const duration = Duration.fromInput(input);
  if (Option.isNone(duration)) {
    return "invalid";
  }
  const ms = Duration.toMillis(duration.value);
  return ms > 0 ? ms : "invalid";
};

/**
 * Builds a query's data, and throws on what a definition may not say.
 */
const makeDef = (
  name: string,
  options: {
    readonly args: Schema.Top | Schema.Struct.Fields;
    readonly success: Schema.Top;
    readonly error: Schema.Top;
    readonly staleTime: Duration.Input;
    readonly idleTimeToLive?: Duration.Input | undefined;
    // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
    readonly refetchInterval?: RefetchInterval<any, any, any> | undefined;
    readonly tags?: readonly { readonly name: string }[] | undefined;
  },
  list?: ListDef
): QueryDef => {
  const staleMs = nonNegative(name, "staleTime", options.staleTime);
  const idleMs =
    options.idleTimeToLive === undefined
      ? undefined
      : nonNegative(name, "idleTimeToLive", options.idleTimeToLive);
  let refetchInterval: QueryDef["refetchInterval"];
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- branches the two refetchInterval forms; both are typed domain values.
  if (typeof options.refetchInterval === "function") {
    ({ refetchInterval } = options);
  } else if (options.refetchInterval !== undefined) {
    const ms = parseInterval(options.refetchInterval);
    if (ms === "invalid") {
      throw new Error(
        `[Query] ${quote(
          name
        )}: refetchInterval must be positive, and not a bare number under 1000. ${
          subSecondHint
        }`
      );
    }
    refetchInterval = ms;
  }
  const args: Schema.Top = Schema.isSchema(options.args)
    ? options.args
    : Schema.Struct(options.args);
  // Built on first use: deriving a codec walks the Schema.
  const encodeArgs = lazy(() => argsEncoder(args.ast));
  const encodeLogArgs = lazy(() => {
    const redacted = redactAST(args.ast);
    // No `Schema.Redacted` in the args: the log key is the args key.
    return redacted === args.ast ? undefined : argsEncoder(redacted);
  });
  const drop = lazy(() => dropUndefinedOf(args.ast));
  const codec = lazy(() => makeCodec(args, options.success, options.error));
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the key helper takes schema-erased args; the args Schema states the contract.
  const argsKey = (value: unknown): string => {
    const encode = encodeArgs();
    let encoded: unknown;
    try {
      encoded = encode(value);
    } catch {
      // The Schema issue prints the value, so it isn't passed on.
      throw new Error(
        `[Query] ${quote(
          name
        )}: the args don't encode with the query's args Schema`
      );
    }
    try {
      return canonical(encoded);
    } catch (error) {
      throw new Error(
        `[Query] ${quote(
          name
        )}: the encoded args hold a value JSON can't carry (${
          error instanceof NonJsonLeaf ? error.kind : "unknown"
        }). Give the args Schema a JSON encoding.`,
        { cause: error }
      );
    }
  };
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the log-key helper takes the schema-erased value; the success Schema states the contract.
  const logKey = (value: unknown, key: string): string => {
    const encode = encodeLogArgs();
    if (encode === undefined) {
      return key;
    }
    try {
      return canonical(encode(value));
    } catch {
      return '"~unserialisable"';
    }
  };
  return {
    args,
    argsKey,
    codec,
    error: options.error,
    idleMs,
    list,
    logKey,
    name,
    normalize: (value) => {
      const dropFrom = drop();
      return dropFrom === null ? value : dropFrom(value);
    },
    refetchInterval,
    staleMs,
    success: options.success,
    tags: (options.tags ?? []).map((tag) => tag.name),
  };
};

const makeListDef = (options: {
  // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
  readonly items: (page: any) => readonly any[];
  // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
  readonly key: (item: any) => string;
  // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
  readonly next: (lastPage: any, allPages: any) => Option.Option<any>;
  readonly cursor: Schema.Top;
}): ListDef => {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the cursor codec takes and returns schema-erased cursors; the cursor Schema states the contract.
  let encode: ((cursor: unknown) => unknown) | undefined;
  return {
    encodeCursor: (cursor) =>
      (encode ??= Schema.encodeUnknownSync(jsonCodec(options.cursor)))(cursor),
    items: options.items,
    key: options.key,
    next: options.next,
    // oxlint-disable-next-line eslint/no-use-before-define -- the list options read the shared list ops defined below; read when a list is built, after module init.
    ops: listOps,
  };
};

/** @internal */
export const defOf = (query: { readonly [TypeId]: unknown }): QueryDef =>
  // SAFETY: Service classes carry their QueryDef under the brand; the factory sets it at construction.
  query[TypeId] as QueryDef;

const isQuery = <T>(u: T): u is Extract<T, { readonly [TypeId]: unknown }> =>
  (typeof u === "function" || (typeof u === "object" && u !== null)) &&
  TypeId in u;

// -----------------------------------------------------------------------------
// Targets, patches and writes
// -----------------------------------------------------------------------------

/**
 * Where the args key of an entry target, a patch or a write is kept. It is
 * built when the target is, so args that don't encode throw where the target
 * is made: in `invalidates`, `optimistic` or `writes`.
 */
const ArgsKey = "~argsKey";

// The args key a target, patch or write was built with.
const argsKeyOf = (x: { readonly _tag: "Entry" | "Patch" | "Set" }): string =>
  // SAFETY: targets, patches and writes carry ArgsKey outside their public types; the key is set when each is built.
  // oxlint-disable-next-line typescript/no-explicit-any -- targets, patches and writes carry ArgsKey outside their public types; the key is set when each is built.
  (x as any)[ArgsKey];

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- entry helpers take the query's erased args; the query's args Schema decodes them at the fetch boundary.
const entryTarget = (query: Query.Any, args: unknown): EntryTarget =>
  // SAFETY: the literal supplies every field of the target; the cast types the tagged union.
  // oxlint-disable-next-line eslint/sort-keys -- entry literals list the tag first for readability; key order carries no meaning.
  ({
    _tag: "Entry",
    query,
    args,
    [ArgsKey]: defOf(query).argsKey(args),
  }) as EntryTarget;

const patchOne = (
  query: Query.Any,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- entry helpers take the query's erased args; the query's args Schema decodes them at the fetch boundary.
  args: unknown,
  // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
  patch: (value: any) => any
): Patch =>
  // SAFETY: the literal supplies every field of the target; the cast types the tagged union.
  // oxlint-disable-next-line eslint/sort-keys -- entry literals list the tag first for readability; key order carries no meaning.
  ({
    _tag: "Patch",
    query,
    args,
    patch,
    [ArgsKey]: defOf(query).argsKey(args),
  }) as Patch;

const patchAll = (
  query: Query.Any,
  // oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
  patch: (value: any, args: any) => any
): Patch => ({
  _tag: "PatchAll",
  patch,
  query,
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- write takes the query's erased args and value; the query's Schemas decode them at the fetch boundary.
const write = (query: Query.Any, args: unknown, value: unknown): Write =>
  // SAFETY: the literal supplies every field of the target; the cast types the tagged union.
  // oxlint-disable-next-line eslint/sort-keys -- entry literals list the tag first for readability; key order carries no meaning.
  ({
    _tag: "Set",
    query,
    args,
    value,
    [ArgsKey]: defOf(query).argsKey(args),
  }) as Write;

/**
 * A run's declarations compiled for matching: the queries it names whole, the
 * entries it names one by one, and its tags.
 */
interface Targets {
  readonly queries: ReadonlySet<string>;
  readonly entries: ReadonlyMap<string, ReadonlySet<string>>;
  readonly tags: ReadonlySet<string>;
}

/**
 * Declared targets plus those implied by patches: one entry for `patch`, the
 * whole query for `patchAll`.
 */
const compileTargets = (
  invalidates: readonly Target[],
  optimistic: readonly Patch[] = []
): Targets => {
  const queries = new Set<string>();
  const entries = new Map<string, Set<string>>();
  const tags = new Set<string>();
  const addEntry = (name: string, argsKey: string): void => {
    let keys = entries.get(name);
    if (keys === undefined) {
      entries.set(name, (keys = new Set()));
    }
    keys.add(argsKey);
  };
  for (const target of invalidates) {
    if (isQuery(target)) {
      queries.add(defOf(target).name);
    } else if (target._tag === "Entry") {
      addEntry(defOf(target.query).name, argsKeyOf(target));
    } else {
      tags.add(target.name);
    }
  }
  for (const patch of optimistic) {
    if (patch._tag === "Patch") {
      addEntry(defOf(patch.query).name, argsKeyOf(patch));
    } else {
      queries.add(defOf(patch.query).name);
    }
  }
  return { entries, queries, tags };
};

/**
 * Whether compiled targets hit an entry. `tags` is `undefined` for a raw
 * hydrated entry, whose read the cache hasn't seen: every tag hits it.
 */
const targetsHit = (
  targets: Targets,
  name: string,
  tags: readonly string[] | undefined,
  argsKey: string
): boolean => {
  if (
    targets.queries.has(name) ||
    targets.entries.get(name)?.has(argsKey) === true
  ) {
    return true;
  }
  if (targets.tags.size === 0) {
    return false;
  }
  if (tags === undefined) {
    return true;
  }
  return tags.some((tag) => targets.tags.has(tag));
};

/**
 * Applies one patch to a value of the entry of `name` at `argsKey`. A patch
 * of another entry leaves it as it is.
 */
const applyPatch = (
  patch: Patch,
  name: string,
  argsKey: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the patch applier takes erased args and value; the query's Schemas state the contract.
  args: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the patch applier takes erased args and value; the query's Schemas state the contract.
  value: unknown
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the patch applier returns the erased value when the patch doesn't apply; the success Schema states the contract.
): unknown => {
  if (defOf(patch.query).name !== name) {
    return value;
  }
  if (patch._tag === "PatchAll") {
    return patch.patch(value, args);
  }
  return argsKeyOf(patch) === argsKey ? patch.patch(value) : value;
};

// -----------------------------------------------------------------------------
// Builds: which Layer build owns a fetch
// -----------------------------------------------------------------------------

/** An infinite query's fetcher takes the cursor as well. */
// oxlint-disable-next-line typescript/no-explicit-any -- per-query Args/A/E erase to any at this public boundary; each query's Schema validates values at its own call boundary.
type Fetcher = (args: any, cursor?: any) => Effect.Effect<any, any>;

/**
 * One Layer build of a query's service. The service value is a plain function,
 * so a fake is `Layer.succeed(Query, fn)`; a function from a real build carries
 * its build, and a fake gets one per cache that never closes.
 */
interface Build {
  readonly fetcher: Fetcher;
  closed: boolean;
  readonly listeners: Set<(build: Build) => void>;
  /** The fetches running under this build, in any cache, until their cleanup has finished. */
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  readonly fibers: Set<Fiber.Fiber<any, any>>;
}

/**
 * Wraps a fetcher for one Layer build. A new function per build, so two builds
 * never share an identity.
 */
const makeBuild = (fetcher: Fetcher): Build => {
  const wrapped: Fetcher = (args, cursor) => fetcher(args, cursor);
  const build: Build = {
    closed: false,
    fetcher: wrapped,
    fibers: new Set(),
    listeners: new Set(),
  };
  Object.defineProperty(wrapped, BuildTypeId, { value: build });
  return build;
};

/**
 * Closes a build: every cache that used it restarts or reverts its fetches.
 * It ends when every fetch that ran under the build has finished its cleanup,
 * so a build's finalizer that runs this first releases nothing a fetch still
 * uses.
 */
const closeBuild = (build: Build): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (build.closed) {
      return Effect.void;
    }
    build.closed = true;
    // oxlint-disable-next-line unicorn/no-useless-spread -- a listener may unsubscribe while notified; iterate over a snapshot.
    for (const listener of [...build.listeners]) {
      listener(build);
    }
    build.listeners.clear();
    return Fiber.interruptAll(build.fibers);
  });

// -----------------------------------------------------------------------------
// Cache: the internal API
// -----------------------------------------------------------------------------

interface FetchEvent {
  readonly query: string;
  readonly logKey: string;
  readonly trigger: Trigger;
  /** True when this start replaces an interrupted fetch. It keeps the trigger. */
  readonly restart: boolean;
  /** The entry was hydrated and the fetch-free window is still open. */
  readonly inWindow: boolean;
  /**
   * False for a fetcher call whose result is handed to `get` callers and never
   * stored: a run reading back its own target, or a `get` under a live patch.
   */
  readonly stored: boolean;
  /** On an infinite query: the index of the page this request loads. */
  readonly page?: number;
  /** On an infinite query: the encoded cursor of the page, absent for the first. */
  readonly cursor?: Schema.Json;
}

interface WatchHandle {
  readonly logKey: () => string;
  /** The entry's server state right now: `Initial` over a cold entry. */
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  readonly current: () => AsyncResult.AsyncResult<any, any>;
  /** The patched view right now, and whether it includes an unconfirmed patch. */
  readonly patchedView: () => PatchedView;
  /** On an infinite query, whether it holds more pages to load. `undefined` otherwise. */
  // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
  readonly more: () => More<any> | undefined;
  /**
   * Drops the watcher count synchronously. Idempotent. With `abandon`, the
   * last watcher leaving interrupts a fetch a watcher started that nothing
   * else waits for, and the entry reverts.
   */
  readonly unregister: (abandon?: boolean) => void;
}

interface PatchedView {
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  readonly result: AsyncResult.AsyncResult<any, any>;
  readonly patched: boolean;
}

interface EntryInfo {
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  readonly stored: AsyncResult.AsyncResult<any, any>;
  /** The server state with every patch applied: what a query field shows. */
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  readonly view: AsyncResult.AsyncResult<any, any>;
  /** Whether `view` includes an unconfirmed patch. */
  readonly patched: boolean;
  readonly stale: boolean;
  readonly watchers: number;
  /** `held`: a refetch waits for the last live patch's run to exit. */
  readonly fetch: "none" | "running" | "held";
  /** The trigger of the fetch in flight, or the one a held fetch will start with. */
  readonly trigger: Trigger | undefined;
  readonly patches: { readonly live: number; readonly held: number };
  /** On an infinite query only: whether it holds more pages to load. */
  // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
  readonly more?: More<any> | undefined;
}

/**
 * How a run ended. `Stopped` is a run stopped before its work began: its
 * patches go and it invalidates nothing. `Failure` covers a typed failure,
 * an interrupt and a defect.
 */
type RunExit =
  | { readonly _tag: "Success"; readonly writes: readonly Write[] }
  | { readonly _tag: "Failure" }
  | { readonly _tag: "Stopped" };

/**
 * One run of a Command, handed to the cache when it is issued.
 *
 * @internal
 */
export interface RunHandle {
  readonly command: string;
  /** The predicate of `Query.invalidatesEntry` over the run's declarations. */
  readonly invalidates: (def: QueryDef, argsKey: string) => boolean;
  /** The work begins. A queued run is issued before it starts. */
  readonly start: () => void;
  readonly isStarted: () => boolean;
  /** Called once, at fiber exit. Later calls do nothing. */
  readonly finish: (exit: RunExit) => void;
  /**
   * Runs a Command body in this run: starts it, provides it as `CurrentRun`,
   * and finishes it when the body's fiber exits. `writes` runs on success
   * only. When it throws, the run still settles, as a success with no
   * writes, and the body dies with what it threw.
   */
  readonly run: <A, E, R>(
    body: Effect.Effect<A, E, R>,
    writes?: ((success: A) => readonly Write[]) | undefined
  ) => Effect.Effect<A, E, R>;
  /**
   * For a run begun with `afterRefetch`, once a success has applied its
   * invalidation: the awaited set, fixed then. It is every entry the run
   * invalidated, minus those its own writes stored fresh, that had a watcher
   * and was owed a refetch, in flight or held. `undefined` before that, after
   * any other exit, and without `afterRefetch`.
   */
  readonly awaited: () => readonly AwaitedEntry[] | undefined;
  /** The entries of the awaited set whose refetch is still in flight or owed. */
  readonly outstanding: () => readonly AwaitedEntry[];
  /**
   * Calls `f` once no entry of the awaited set is outstanding: after the
   * emission of the last one to settle, and after its `get` callers resume.
   * Calls nothing when none is outstanding now. Returns the cancel.
   */
  readonly onRefetched: (f: () => void) => () => void;
  /**
   * The milliseconds on the cache's `Clock` since a success applied the
   * invalidation of a run begun with `afterRefetch`, and `0` before that.
   */
  readonly sinceApplied: () => number;
}

/**
 * An entry a run waits for, as the log names it.
 *
 * @internal
 */
export interface AwaitedEntry {
  readonly query: string;
  readonly logKey: string;
}

/**
 * The `state["~query"]` payload: entries by query name, as tagged tuples.
 */
type Dehydrated = Record<
  string,
  (
    | readonly [
        argsKey: string,
        tag: 0,
        encodedSuccess: unknown,
        timestamp: number,
      ]
    | readonly [
        argsKey: string,
        tag: 1,
        encodedErrors: readonly unknown[],
        timestamp: number,
      ]
  )[]
>;

/**
 * The synchronous API of a cache, for the generated statics, the model
 * runtime and the test harnesses. The value of `Query.Cache` is one of these.
 */
interface CacheInternals {
  readonly [CacheTypeId]: typeof CacheTypeId;
  /** Hands the cache a query's definition. Its hydrated entries are decoded now. */
  readonly register: (def: QueryDef) => void;
  /**
   * Registers a watcher. The count rises and the zero-to-one fetch decision is
   * made here, but the fetcher starts one scheduler step later and `onChange`
   * is never called for the state at registration: read `current()` or
   * `patchedView()`. With `patched`, `onChange` gets the patched view;
   * otherwise the server value, and `patched` is always false.
   */
  readonly watch: (
    def: QueryDef,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- cache internals carry heterogeneous erased values; each query's Schemas state the contract.
    args: unknown,
    fetcher: Fetcher,
    onChange: (
      result: Settled,
      patched: boolean,
      // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
      more: More<any> | undefined
    ) => void,
    onDefect?: ((cause: Cause.Cause<never>) => void) | undefined,
    options?: { readonly patched?: boolean | undefined } | undefined
  ) => WatchHandle;
  /**
   * Holds the zero-to-one decisions until the returned release is called, by
   * every holder. Watchers register and unregister at once, and `onChange`
   * works as usual. At release, an entry fetches, if it is stale, and arms its
   * interval when every watcher it has was registered during the hold: no
   * watcher from before the hold survived it, whatever order the releases and
   * registrations came in. It skips the fetch when one of those watchers
   * registered inside the fetch-free window. The model runtime holds for
   * each render pass.
   *
   * A bare Failure that the last watcher leaving would drop is withheld from a
   * watcher registering on it during a hold: the watcher reads `Initial` and
   * gets no `onChange` until release. Then, if no watcher that has seen the
   * Failure survived, it is dropped and the entry fetches, as if the last
   * watcher had left first. Otherwise it is delivered.
   */
  readonly hold: () => () => void;
  /** The server value. Doesn't create the entry or reset its idle timer. */
  readonly peek: (
    def: QueryDef,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- cache internals carry heterogeneous erased values; each query's Schemas state the contract.
    args: unknown
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  ) => AsyncResult.AsyncResult<any, any>;
  /** `run` is the caller's, from `CurrentRun`. */
  readonly get: (
    def: QueryDef,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- cache internals carry heterogeneous erased values; each query's Schemas state the contract.
    args: unknown,
    fetcher: Fetcher,
    run: RunHandle | undefined
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  ) => Effect.Effect<any, any>;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- cache internals carry heterogeneous erased values; each query's Schemas state the contract.
  readonly prefetch: (def: QueryDef, args: unknown, fetcher: Fetcher) => void;
  /**
   * A list's load more. `resume` gets the pages and whether there is more
   * once the walk or append reaching the next page ends. Returns the cancel.
   */
  readonly loadMore: (
    def: QueryDef,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- cache internals carry heterogeneous erased values; each query's Schemas state the contract.
    args: unknown,
    fetcher: Fetcher,
    // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
    resume: (exit: Exit.Exit<LoadedMore<any>, any>) => void
  ) => () => void;
  /** A list's reset: drops the pages after the first, then invalidates. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- cache internals carry heterogeneous erased values; each query's Schemas state the contract.
  readonly reset: (def: QueryDef, args: unknown) => void;
  /**
   * One synchronous batch: an entry hit twice restarts once. `byHand` is a
   * query's own `invalidate`, which a settle-once cache reports and ignores.
   */
  readonly invalidate: (
    targets: readonly Target[],
    options?: { readonly byHand?: boolean | undefined } | undefined
  ) => void;
  /**
   * Begins a run at issue: registers its patches, which are live from now on.
   * Throws, registering nothing, when a patch throws on first application.
   */
  readonly beginRun: (options: {
    readonly command: string;
    readonly invalidates: readonly Target[];
    readonly optimistic?: readonly Patch[] | undefined;
    /** Fix the awaited set when a success applies its invalidation: see `RunHandle.awaited`. */
    readonly afterRefetch?: boolean | undefined;
  }) => RunHandle;
  /**
   * Interrupts every fetch in flight and every pending `get`, and returns
   * every settled entry for `~query`. An entry that can't be encoded is
   * left out and reported. Entries whose args, success or error Schema holds
   * a `Schema.Redacted` are left out without an encoding diagnostic; the client fetches them.
   */
  readonly dehydrate: () => Dehydrated;
  /**
   * Holds the `~query` payload's entries raw until their query registers.
   * Opens the fetch-free window unless `static`, where every entry has an
   * unknown age instead.
   */
  readonly hydrate: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- cache internals carry heterogeneous erased values; each query's Schemas state the contract.
    raw: unknown,
    options?:
      | {
          readonly static?: boolean | undefined;
          /** When the entries arrived, if before this call: they age from then. */
          readonly at?: number | undefined;
        }
      | undefined
  ) => void;
  /** Closes the fetch-free window: unwatched hydrated Failures go, raw ones included. */
  readonly closeWindow: () => void;
  readonly isWindowOpen: () => boolean;
  /**
   * History restore: fills a cold entry from a snapshot's Success, stored
   * stale. Never from a snapshot taken under a patch. Returns whether it did.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- cache internals carry heterogeneous erased values; each query's Schemas state the contract.
  readonly seed: (snapshot: unknown) => boolean;
  /** Called at every fetch start. */
  readonly onFetch: (listener: (event: FetchEvent) => void) => () => void;
  /** Called once a stored fetch has ended and its entry has emitted. */
  readonly onFetchEnd: (listener: () => void) => () => void;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- cache internals carry heterogeneous erased values; each query's Schemas state the contract.
  readonly inspect: (def: QueryDef, args: unknown) => EntryInfo | undefined;
  /** The stored fetches in flight, and those held until a live patch's run exits. */
  readonly pending: () => readonly PendingFetch[];
  /**
   * The entries with no settled result whose fetch is in flight, or, with
   * fetches off, that a watcher or `get` waits on. An entry whose fetcher
   * died isn't one: its fetch ended.
   */
  readonly misses: () => readonly {
    readonly query: string;
    readonly logKey: string;
  }[];
  /**
   * Decodes every entry of a `~query` payload with the queries this cache
   * knows, args key included, and encodes it again. Returns a line per entry
   * that doesn't come back as it was shipped.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the wire checker takes the unknown snapshot; the snapshot Schema states the contract.
  readonly checkWire: (raw: unknown) => readonly string[];
}

interface PendingFetch {
  readonly query: string;
  readonly logKey: string;
  readonly status: "running" | "held";
  readonly trigger: Trigger;
}

/**
 * The cache behind the `Cache` service. A root that started before this module
 * loaded provides a cell in its place, and makes its cache here.
 *
 * @internal
 */
export const internals = (cache: {
  readonly [CacheTypeId]: unknown;
}): CacheInternals => {
  // SAFETY: internals probes the optional test cell; the undefined check guards the fallback.
  const make = (cache as Partial<queryCore.CacheCell>)[
    queryCore.CacheCellTypeId
  ];
  // SAFETY: the non-cell path is the live cache; the check above selects the branch.
  return make === undefined ? (cache as CacheInternals) : make();
};

/**
 * The run a Command body runs in. The model runtime provides it, so a
 * `get` in the body can tell its run's own targets.
 */
const CurrentRun: Context.Reference<RunHandle | undefined> = Context.Reference<
  RunHandle | undefined
>("@effect/ui/Query/CurrentRun", { defaultValue: () => {} }); // oxlint-disable-line eslint/no-empty-function -- no run is active outside one; the default resolves to undefined.

// -----------------------------------------------------------------------------
// Snapshots
// -----------------------------------------------------------------------------

const SnapshotTypeId = "~@effect/ui/Query/Snapshot";

/**
 * What a snapshot holds. A snapshot is what the model runtime keeps in an
 * instance's query result, beside its Model: it is internal, and never part
 * of a Model or a message.
 */
interface SnapshotData {
  readonly def: QueryDef;
  readonly label: string;
  /** `undefined` only for the empty snapshot. */
  readonly argsKey: string | undefined;
  readonly args: unknown;
  /** `undefined` only for the empty snapshot. `waiting` lives in memory only. */
  readonly result: Settled | undefined;
  /** The value includes an unconfirmed patch. Only ever true over a Success. */
  readonly patched: boolean;
  /** A list's: whether it holds more pages. `undefined` for any other query, and the empty snapshot. */
  // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
  readonly more: More<any> | undefined;
}

const moreLoading: More<never> = { _tag: "Loading" };
const moreAvailable: More<never> = { _tag: "Available" };
const moreEnd: More<never> = { _tag: "End" };

/** @internal */
export const sameMore = (
  // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
  a: More<any> | undefined,
  // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
  b: More<any> | undefined
): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a._tag === b._tag &&
    (a._tag !== "Failed" ||
      // SAFETY: the tag equality above selects the Failed branch for both; b carries the error.
      Equal.equals(a.error, (b as { readonly error: unknown }).error)));

class SnapshotImpl implements Equal.Equal {
  readonly [SnapshotTypeId]: SnapshotData;

  constructor(data: SnapshotData) {
    this[SnapshotTypeId] = data;
  }
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Equal.symbol takes the unknown comparand by Effect convention.
  [Equal.symbol](that: unknown): boolean {
    if (!(that instanceof SnapshotImpl)) {
      return false;
    }
    const a = this[SnapshotTypeId];
    const b = that[SnapshotTypeId];
    return (
      a.def.name === b.def.name &&
      a.label === b.label &&
      a.argsKey === b.argsKey &&
      a.patched === b.patched &&
      sameMore(a.more, b.more) &&
      Equal.equals(a.result, b.result)
    );
  }
  [Hash.symbol](): number {
    const data = this[SnapshotTypeId];
    return Hash.string(
      `${data.def.name}\u0000${data.label}\u0000${data.argsKey}`
    );
  }
}

/** @internal */
export const makeSnapshot = (
  def: QueryDef,
  label: string,
  entry: { readonly args: unknown; readonly argsKey: string } | undefined,
  result: Settled | undefined,
  patched = false,
  // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
  more?: More<any> | undefined
): SnapshotImpl =>
  // oxlint-disable-next-line eslint/sort-keys -- snapshot fields list identity first for readability; the wire order is fixed by the tuple Schema.
  new SnapshotImpl({
    def,
    label,
    argsKey: entry?.argsKey,
    // As the key sees them, so the args Schema never meets an `undefined` the key dropped.
    args: entry === undefined ? undefined : def.normalize(entry.args),
    result: entry === undefined ? undefined : result,
    patched: entry !== undefined && patched && result?._tag === "Success",
    more:
      def.list === undefined || entry === undefined || result === undefined
        ? undefined
        : (more ?? moreEnd),
  });

/** @internal */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the snapshot guard narrows unknown wire values; the Schema decode states the contract.
export const snapshotData = (u: unknown): SnapshotData | undefined =>
  u instanceof SnapshotImpl ? u[SnapshotTypeId] : undefined;

const settledMap = (
  result: Settled,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the snapshot decoder takes the schema-erased value; the success and error codecs state the contract.
  success: (u: unknown) => Effect.Effect<unknown, SchemaIssue.Issue>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the snapshot decoder takes the schema-erased value; the success and error codecs state the contract.
  error: (u: unknown) => Effect.Effect<unknown, SchemaIssue.Issue>
): Effect.Effect<Settled, SchemaIssue.Issue> => {
  // `waiting` is carried over, so a check of a query result keeps it. The JSON codec never sets it, so a decoded
  // snapshot is never waiting.
  const { waiting } = result;
  if (result._tag === "Success") {
    return Effect.map(success(result.value), (value) =>
      AsyncResult.success(value, { timestamp: result.timestamp, waiting })
    );
  }
  const fails = result.cause.reasons.filter(Cause.isFailReason);
  return Effect.flatMap(
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument -- Effect.forEach runs an Effect per failure, it is not Array#forEach; the second argument is the mapping function, not a thisArg.
    Effect.forEach(fails, (reason) => error(reason.error)),
    (errors) => {
      const cause = Cause.fromReasons(
        errors.map((e) => Cause.makeFailReason(e))
      );
      if (Option.isNone(result.previousSuccess)) {
        return Effect.succeed(AsyncResult.failure(cause, { waiting }));
      }
      const previous = result.previousSuccess.value;
      return Effect.map(success(previous.value), (value) =>
        AsyncResult.failure(cause, {
          previousSuccess: Option.some(
            AsyncResult.success(value, { timestamp: previous.timestamp })
          ),
          waiting,
        })
      );
    }
  );
};

/**
 * The Schema of a query result that holds a snapshot of a query. Its type
 * parameters are the query's `args`, `success` and `error` Schemas, so a walk
 * over the results' AST, such as the log's redaction, reaches what a snapshot
 * holds. On the wire a snapshot is a tuple: `[]` when empty,
 * `[argsKey, 0, value, timestamp, patched]` for a Success, and
 * `[argsKey, 1, [error, ...], [value, timestamp] | null]` for a Failure with
 * its previous Success.
 *
 * The args key on the wire is built through the `args` type parameter, so
 * it is the entry's key in page state and its log key under the log's
 * redaction. Decoding takes the args from the key, decodes them all the way
 * and checks that they key back to it.
 *
 * With `log`, a settled tuple ends with `[waiting, more]` too: the message
 * log replays `update`, which can read both, so its form keeps what page
 * state drops. `more` is `null` for a query that isn't a list.
 *
 * @internal
 */
export const snapshotSchema = (
  query: { readonly [TypeId]: unknown },
  label: string,
  log = false
): Schema.Top => {
  const def = defOf(query);
  return Schema.make(
    new SchemaAST.Declaration(
      [def.args.ast, def.success.ast, def.error.ast],
      // oxlint-disable-next-line eslint/no-use-before-define -- snapshot helpers invoke each other at decode time, after module init.
      snapshotRun(def, label, true),
      // SAFETY: the annotations object carries the snapshot declaration; the cast types the Schema annotations.
      {
        expected: `a query result ${quote(label)} of ${quote(def.name)}`,
        // oxlint-disable-next-line eslint/no-use-before-define -- snapshot helpers invoke each other at decode time, after module init.
        toCodecJson: snapshotJson(def, label, log),
      } as Schema.Annotations.Annotations,
      undefined,
      undefined,
      undefined,
      undefined,
      // oxlint-disable-next-line eslint/no-use-before-define -- snapshot helpers invoke each other at decode time, after module init.
      snapshotRun(def, label, false)
    )
  );
};

const isSnapshotOf =
  (def: QueryDef, label: string) =>
  (u: unknown): u is SnapshotImpl =>
    u instanceof SnapshotImpl &&
    u[SnapshotTypeId].def.name === def.name &&
    u[SnapshotTypeId].label === label;

const snapshotIssue = (def: QueryDef, message: string) =>
  new SchemaIssue.InvalidValue({
    message: `a snapshot of ${quote(def.name)}: ${message}`,
  });

/** Checks a snapshot against the query's Schemas, the type parameters. */
const snapshotRun = (def: QueryDef, label: string, decoding: boolean) => {
  const is = isSnapshotOf(def, label);
  return (typeParameters: readonly SchemaAST.AST[]) => {
    const [args, success, error] = typeParameters.map((ast) =>
      SchemaParser.decodeUnknownEffect(
        Schema.make<Schema.Codec<unknown, unknown>>(ast)
      )
    );
    if (args === undefined || success === undefined || error === undefined) {
      throw new Error(
        "A query snapshot needs args, success and error Schemas, in that order"
      );
    }
    return (
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the declaration parser takes the unknown wire input; the Schema declaration states the contract.
      input: unknown,
      ast: SchemaAST.Declaration,
      options: SchemaAST.ParseOptions
    ): Effect.Effect<SnapshotImpl, SchemaIssue.Issue> => {
      if (!is(input)) {
        return Effect.fail(new SchemaIssue.InvalidType(ast, input, options));
      }
      const data = input[SnapshotTypeId];
      if (data.result === undefined) {
        return Effect.succeed(input);
      }
      const { result } = data;
      // The key stays as it is: it is the snapshot's identity. A decoded snapshot is accepted only when its
      // args, decoded all the way, key back to it, so it never names an entry other than the one it was taken from.
      return Effect.flatMap(
        Effect.all([
          args(data.args, options),
          // A patched value is used as it is: a patch that fails `success` is reported as `PatchInvalid`, and a
          // check of a query result mustn't throw on it.
          settledMap(
            result,
            (u) => (data.patched ? Effect.succeed(u) : success(u, options)),
            (u) => error(u, options)
          ),
          // A failed load more holds a typed error too, which the message log's form carries.
          data.more?._tag === "Failed"
            ? Effect.map(
                error(data.more.error, options),
                (failure): More<unknown> => ({ _tag: "Failed", error: failure })
              )
            : Effect.succeed(data.more),
        ]),
        // oxlint-disable-next-line eslint/no-shadow -- the callback bindings mirror the wire field names; the outer Schema bindings are untouched.
        ([args, result, more]) => {
          if (decoding) {
            let back: string | undefined;
            try {
              back = def.argsKey(args);
            } catch {
              back = undefined;
            }
            if (back !== data.argsKey) {
              return Effect.fail(
                snapshotIssue(def, "the args key isn't the key of its args")
              );
            }
          }
          return Effect.succeed(
            new SnapshotImpl({ ...data, args, more, result })
          );
        }
      );
    };
  };
};

/**
 * The JSON form of a snapshot, built from the query's Schemas as a walk over the results passes them: the
 * tuple Schema and the two steps between a tuple and a snapshot.
 */
const snapshotWire = (
  def: QueryDef,
  label: string,
  schemas: readonly Schema.Top[],
  log: boolean
) => {
  const [args, success, error] = schemas;
  if (args === undefined || success === undefined || error === undefined) {
    throw new Error(
      "A query snapshot needs args, success and error Schemas, in that order"
    );
  }
  const invalid = (message: string) => snapshotIssue(def, message);
  // SAFETY: the args Schema is a full codec by construction; toCodecJson needs the codec view.
  const argsJson = Schema.toCodecJson(args as Schema.Codec<unknown, unknown>);
  const encodeArgs = SchemaParser.encodeUnknownEffect(argsJson);
  const decodeArgs = SchemaParser.decodeUnknownEffect(argsJson);
  // `args` here is the encoded side of the args Schema, so these see the args as the declaration passes them.
  const toKey = (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the tuple decoder takes the unknown wire tuple; the tuple Schema states the contract.
    raw: unknown,
    options: SchemaAST.ParseOptions
  ): Effect.Effect<string, SchemaIssue.Issue> =>
    Effect.flatMap(encodeArgs(raw, options), (encoded) => {
      try {
        return Effect.succeed(canonical(encoded));
      } catch {
        return Effect.fail(
          invalid("the encoded args hold a value JSON can't carry")
        );
      }
    });
  const fromKey = (
    key: string,
    options: SchemaAST.ParseOptions
  ): Effect.Effect<unknown, SchemaIssue.Issue> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(key);
    } catch {
      return Effect.fail(invalid("the args key isn't JSON"));
    }
    // The declaration checks the key once the args are decoded all the way.
    return decodeArgs(parsed, options);
  };
  // The log's form adds what page state drops: whether a fetch is in flight, and a list's exact more.
  const transient = Schema.Tuple([
    Schema.Boolean,
    Schema.NullOr(
      Schema.Union([
        Schema.Literals(["End", "Available", "Loading"]),
        Schema.Struct({ Failed: error }),
      ])
    ),
  ]);
  const settled = (elements: readonly Schema.Top[]) =>
    Schema.Tuple(log ? [...elements, transient] : elements);
  const decodeSettled = (
    // oxlint-disable-next-line typescript/no-explicit-any -- wire tuples are untyped until the snapshot Schema decodes them.
    tuple: any,
    options: SchemaAST.ParseOptions
  ): Effect.Effect<SnapshotImpl, SchemaIssue.Issue> => {
    if (!log) {
      // oxlint-disable-next-line eslint/no-use-before-define -- snapshot helpers invoke each other at decode time, after module init.
      return decodeState(tuple, options);
    }
    const [waiting, more] = tuple.at(-1);
    // oxlint-disable-next-line eslint/no-use-before-define -- snapshot helpers invoke each other at decode time, after module init.
    return Effect.map(decodeState(tuple.slice(0, -1), options), (snapshot) => {
      const data = snapshot[SnapshotTypeId];
      // oxlint-disable-next-line typescript/no-non-null-assertion -- wire tuples always carry a settled result; the empty snapshot never encodes with log.
      const result = data.result!;
      return new SnapshotImpl({
        ...data,
        more:
          // SAFETY: more is "Loading" on the string branch; the cast types the Loading member.
          // oxlint-disable-next-line eslint/no-nested-ternary -- the more field mirrors the wire tuple's shape; flattening would split the single snapshot construction.
          def.list === undefined || more === null
            ? data.more
            : // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the more field dispatches on its JSON representation; the branch rebuilds the matching More.
              typeof more === "string"
              ? ({ _tag: more } as More<never>)
              : { _tag: "Failed", error: more.Failed },
        // oxlint-disable-next-line eslint/no-nested-ternary -- the result mirrors the settled shape; flattening would split the single snapshot construction.
        result: waiting
          ? result._tag === "Success"
            ? AsyncResult.success(result.value, {
                timestamp: result.timestamp,
                waiting: true,
              })
            : AsyncResult.failure(result.cause, {
                previousSuccess: result.previousSuccess,
                waiting: true,
              })
          : result,
      });
    });
  };
  const decodeState = (
    // oxlint-disable-next-line typescript/no-explicit-any -- wire tuples are untyped until the snapshot Schema decodes them.
    tuple: any,
    options: SchemaAST.ParseOptions
  ): Effect.Effect<SnapshotImpl, SchemaIssue.Issue> => {
    const [key, tag, payload, fourth, fifth, sixth] = tuple;
    return Effect.map(fromKey(key, options), (decoded) => {
      // SAFETY: fromKey decodes the key string the tuple carries.
      const data = { args: decoded, argsKey: key as string, def, label };
      if (tag === 0) {
        return new SnapshotImpl({
          ...data,
          more:
            // oxlint-disable-next-line eslint/no-nested-ternary -- the list flag mirrors the tuple shape; flattening would split the single snapshot construction.
            def.list === undefined
              ? undefined
              : sixth === true
                ? moreAvailable
                : moreEnd,
          patched: fifth === true,
          result: AsyncResult.success(payload, { timestamp: fourth }),
        });
      }
      return new SnapshotImpl({
        ...data,
        more: def.list === undefined ? undefined : moreEnd,
        patched: false,
        result: AsyncResult.failure(
          Cause.fromReasons(
            // SAFETY: failure payloads decode as unknown arrays per the tuple Schema.
            (payload as readonly unknown[]).map((e) => Cause.makeFailReason(e))
          ),
          {
            previousSuccess:
              fourth === null
                ? Option.none()
                : Option.some(
                    AsyncResult.success(fourth[0], { timestamp: fourth[1] })
                  ),
          }
        ),
      });
    });
  };
  return {
    decode: (
      // oxlint-disable-next-line typescript/no-explicit-any -- wire tuples are untyped until the snapshot Schema decodes them.
      tuple: any,
      options: SchemaAST.ParseOptions
    ): Effect.Effect<SnapshotImpl, SchemaIssue.Issue> =>
      tuple.length === 0
        ? // oxlint-disable-next-line unicorn/no-useless-undefined -- entry and result are required parameters; undefined seeds the empty snapshot.
          Effect.succeed(makeSnapshot(def, label, undefined, undefined))
        : decodeSettled(tuple, options),
    encode: (
      snapshot: SnapshotImpl,
      options: SchemaAST.ParseOptions
      // oxlint-disable-next-line typescript/no-explicit-any -- wire tuples are untyped until the snapshot Schema decodes them.
    ): Effect.Effect<any, SchemaIssue.Issue> => {
      const data = snapshot[SnapshotTypeId];
      const { result } = data;
      if (result === undefined) {
        return Effect.succeed([]);
      }
      const more =
        // oxlint-disable-next-line eslint/no-nested-ternary -- the encoded more mirrors the wire shape; flattening would split the single tuple construction.
        def.list === undefined || data.more === undefined
          ? null
          : data.more._tag === "Failed"
            ? { Failed: data.more.error }
            : data.more._tag;
      return Effect.map(toKey(data.args, options), (key) => {
        const tuple: unknown[] =
          // oxlint-disable-next-line eslint/no-nested-ternary -- the tuple mirrors the settled shape; flattening would split the single tuple construction.
          result._tag === "Success"
            ? def.list === undefined
              ? [key, 0, result.value, result.timestamp, data.patched]
              : [
                  key,
                  0,
                  result.value,
                  result.timestamp,
                  data.patched,
                  data.more !== undefined && data.more._tag !== "End",
                ]
            : [
                key,
                1,
                result.cause.reasons
                  .filter(Cause.isFailReason)
                  .map((reason) => reason.error),
                Option.isSome(result.previousSuccess)
                  ? [
                      result.previousSuccess.value.value,
                      result.previousSuccess.value.timestamp,
                    ]
                  : null,
              ];
        if (log) {
          tuple.push([result.waiting, more]);
        }
        return tuple;
      });
    },
    tuple: Schema.Union([
      Schema.Tuple([]),
      // A list adds whether it holds more pages: `Loading` and `Failed` are written as more.
      def.list === undefined
        ? settled([
            Schema.String,
            Schema.Literal(0),
            success,
            Schema.Number,
            Schema.Boolean,
          ])
        : settled([
            Schema.String,
            Schema.Literal(0),
            success,
            Schema.Number,
            Schema.Boolean,
            Schema.Boolean,
          ]),
      settled([
        Schema.String,
        Schema.Literal(1),
        Schema.Array(error),
        Schema.NullOr(Schema.Tuple([success, Schema.Number])),
      ]),
    ]),
  };
};

/** The JSON codec of a snapshot. */
const snapshotJson =
  (def: QueryDef, label: string, log: boolean) =>
  (typeParameters: readonly Schema.Top[]) => {
    const wire = snapshotWire(def, label, typeParameters, log);
    return Schema.link<SnapshotImpl>()(
      wire.tuple,
      // oxlint-disable-next-line typescript/no-explicit-any -- the transform crosses between wire values and decoded snapshots; the Schemas either side check it.
      SchemaTransformation.transformEffect<SnapshotImpl, any>({
        decode: wire.decode,
        encode: wire.encode,
      })
    );
  };

// -----------------------------------------------------------------------------
// Snapshot maps
// -----------------------------------------------------------------------------

const SnapshotMapTypeId = "~@effect/ui/Query/SnapshotMap";

/** What a snapshot map holds: one settled snapshot per args key. */
interface SnapshotMapData {
  readonly def: QueryDef;
  readonly label: string;
  readonly entries: ReadonlyMap<string, SnapshotImpl>;
}

class SnapshotMapImpl implements Equal.Equal {
  readonly [SnapshotMapTypeId]: SnapshotMapData;
  constructor(data: SnapshotMapData) {
    this[SnapshotMapTypeId] = data;
  }
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Equal.symbol takes the unknown comparand by Effect convention.
  [Equal.symbol](that: unknown): boolean {
    if (!(that instanceof SnapshotMapImpl)) {
      return false;
    }
    const a = this[SnapshotMapTypeId];
    const b = that[SnapshotMapTypeId];
    if (
      a.def.name !== b.def.name ||
      a.label !== b.label ||
      a.entries.size !== b.entries.size
    ) {
      return false;
    }
    for (const [key, snapshot] of a.entries) {
      if (!Equal.equals(snapshot, b.entries.get(key))) {
        return false;
      }
    }
    return true;
  }
  [Hash.symbol](): number {
    const data = this[SnapshotMapTypeId];
    return Hash.string(
      `${data.def.name}\u0000${data.label}\u0000${data.entries.size}`
    );
  }
}

/**
 * A snapshot map of the given snapshots, each one settled and of `def` and
 * `label`, with no two sharing an args key.
 *
 * @internal
 */
export const makeSnapshotMap = (
  def: QueryDef,
  label: string,
  snapshots: Iterable<unknown>
): SnapshotMapImpl => {
  const entries = new Map<string, SnapshotImpl>();
  for (const snapshot of snapshots) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- map entries decode through snapshotRun, which yields SnapshotImpls.
    const data = snapshotData(snapshot)!;
    // SAFETY: decoded map snapshots always carry their args key; snapshot is the SnapshotImpl snapshotData just opened.
    // oxlint-disable-next-line typescript/no-non-null-assertion -- decoded map snapshots always carry their args key.
    entries.set(data.argsKey!, snapshot as SnapshotImpl);
  }
  return new SnapshotMapImpl({ def, entries, label });
};

/** @internal */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the snapshot-map guard narrows unknown wire values; the Schema decode states the contract.
export const snapshotMapData = (u: unknown): SnapshotMapData | undefined =>
  u instanceof SnapshotMapImpl ? u[SnapshotMapTypeId] : undefined;

/**
 * The Schema of a keyed query result: one snapshot per args key. On the wire
 * it is an array of `snapshotSchema`'s tuples, in no meaningful order, and a
 * duplicate args key is a decode error. `log` is as for `snapshotSchema`.
 *
 * @internal
 */
export const snapshotMapSchema = (
  query: { readonly [TypeId]: unknown },
  label: string,
  log = false
): Schema.Top => {
  const def = defOf(query);
  const is = (u: unknown): u is SnapshotMapImpl =>
    u instanceof SnapshotMapImpl &&
    u[SnapshotMapTypeId].def.name === def.name &&
    u[SnapshotMapTypeId].label === label;
  const makeRun =
    (decoding: boolean) => (typeParameters: readonly SchemaAST.AST[]) => {
      const one = snapshotRun(def, label, decoding)(typeParameters);
      return (
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the map parser takes the unknown wire input; the Schema declaration states the contract.
        input: unknown,
        ast: SchemaAST.Declaration,
        options: SchemaAST.ParseOptions
      ): Effect.Effect<SnapshotMapImpl, SchemaIssue.Issue> => {
        if (!is(input)) {
          return Effect.fail(new SchemaIssue.InvalidType(ast, input, options));
        }
        return Effect.map(
          // oxlint-disable-next-line unicorn/no-array-for-each -- Effect.forEach runs an Effect per snapshot, it is not Array#forEach; no loop can run it.
          Effect.forEach(
            input[SnapshotMapTypeId].entries.values(),
            (snapshot) => one(snapshot, ast, options)
          ),
          (snapshots) => makeSnapshotMap(def, label, snapshots)
        );
      };
    };
  const toCodecJson = (typeParameters: readonly Schema.Top[]) => {
    const wire = snapshotWire(def, label, typeParameters, log);
    return Schema.link<SnapshotMapImpl>()(
      Schema.Array(wire.tuple),
      // oxlint-disable-next-line typescript/no-explicit-any -- the transform crosses between wire values and decoded snapshots; the Schemas either side check it.
      SchemaTransformation.transformEffect<SnapshotMapImpl, readonly any[]>({
        decode: (tuples, options) =>
          Effect.flatMap(
            // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument -- Effect.forEach runs an Effect per tuple, it is not Array#forEach; the second argument is the mapping function, not a thisArg.
            Effect.forEach(tuples, (tuple) => wire.decode(tuple, options)),
            (snapshots) => {
              const keys = new Set<string>();
              for (const snapshot of snapshots) {
                const key = snapshot[SnapshotTypeId].argsKey;
                if (key === undefined) {
                  return Effect.fail(
                    snapshotIssue(def, "a keyed field holds an empty snapshot")
                  );
                }
                if (keys.has(key)) {
                  return Effect.fail(
                    snapshotIssue(def, "a keyed field holds one args key twice")
                  );
                }
                keys.add(key);
              }
              return Effect.succeed(makeSnapshotMap(def, label, snapshots));
            }
          ),
        encode: (map, options) =>
          // oxlint-disable-next-line unicorn/no-array-for-each -- Effect.forEach runs an Effect per snapshot, it is not Array#forEach; no loop can run it.
          Effect.forEach(map[SnapshotMapTypeId].entries.values(), (snapshot) =>
            wire.encode(snapshot, options)
          ),
      })
    );
  };
  return Schema.make(
    new SchemaAST.Declaration(
      [def.args.ast, def.success.ast, def.error.ast],
      makeRun(true),
      // SAFETY: the annotations object carries the keyed declaration; the cast types the Schema annotations.
      {
        expected: `a keyed query result ${quote(label)} of ${quote(def.name)}`,
        toCodecJson,
      } as Schema.Annotations.Annotations,
      undefined,
      undefined,
      undefined,
      undefined,
      makeRun(false)
    )
  );
};

// -----------------------------------------------------------------------------
// Cache: implementation
// -----------------------------------------------------------------------------

interface Watcher {
  readonly onChange: (
    result: Settled,
    patched: boolean,
    // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
    more: More<any> | undefined
  ) => void;
  readonly onDefect: ((cause: Cause.Cause<never>) => void) | undefined;
  readonly build: Build;
  /** On an infinite query, the `More` it last saw. */
  // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
  lastMore: More<any> | undefined;
  /** Gets the patched view, not the server value. */
  readonly patched: boolean;
  /** The hold it registered under, or -1. */
  readonly generation: number;
  /** Registered inside the fetch-free window. */
  readonly windowed: boolean;
  /**
   * The bare Failure stored when it registered during a hold, withheld until the hold is released: the watcher
   * reads `Initial` meanwhile. Cleared once the entry stores anything else, or at release.
   */
  provisional: Settled | undefined;
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  last: AsyncResult.AsyncResult<any, any>;
  lastPatched: boolean;
  active: boolean;
}

interface Waiter {
  readonly build: Build;
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  readonly resume: (exit: Exit.Exit<any, any>) => void;
  /** Set when the waiter is a caller of a caller-only fetch, not of the stored one. */
  shared: Shared | undefined;
}

interface FetchRec {
  readonly trigger: Trigger;
  readonly build: Build;
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  fiber: Fiber.Fiber<any, any> | undefined;
  /** On an infinite query: an append of one page, instead of a walk from the first. */
  readonly append: boolean;
}

/** A `loadMore` caller, waiting for the walk or append that reaches its page. */
interface MoreWaiter {
  readonly build: Build;
  // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
  readonly resume: (exit: Exit.Exit<LoadedMore<any>, any>) => void;
}

/** What a list's walk ended with. A Fail on a page ends it early, with the pages before. */
interface WalkOutcome {
  readonly pages: readonly unknown[];
  readonly hasMore: boolean;
  readonly failedAt: number | undefined;
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  readonly cause: Cause.Cause<any> | undefined;
}

/**
 * A caller-only fetch: a fetcher call made for `get` callers under a live
 * patch, whose result is handed to them and never stored. The entry doesn't
 * see it.
 */
interface Shared {
  readonly entry: Entry;
  build: Build;
  readonly callers: Set<Waiter>;
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  fiber: Fiber.Fiber<any, any> | undefined;
}

interface Idle {
  expiresAt: number;
  cancel: () => void;
}

interface Run {
  readonly command: string;
  /** Issue order. */
  readonly issue: number;
  readonly targets: Targets;
  /** The sequence number at the run's start: a write or invalidation after it makes a write stale. */
  startSeq: number;
  started: boolean;
  done: boolean;
  /** The entries its patches registered on. */
  readonly entries: Set<Entry>;
}

/** A run's awaited set: the entries still owed their refetch, and who hears when none is. */
interface Await {
  readonly entries: Set<Entry>;
  listener: (() => void) | undefined;
}

interface PatchRec {
  readonly run: Run;
  readonly patch: Patch;
  /** Live while the run is queued or running. Held after its success, until a settle or a stored write. */
  live: boolean;
}

type RawTuple = Dehydrated[string][number];

interface Entry {
  readonly def: QueryDef;
  readonly argsKey: string;
  readonly args: unknown;
  logKey: string | undefined;
  /** The settled server state, never waiting. `undefined` is cold. */
  result: Settled | undefined;
  /** From `Clock`. Never `AsyncResult`'s timestamp, which is display-only. */
  settledAt: number;
  invalidated: boolean;
  removed: boolean;
  readonly watchers: Set<Watcher>;
  /** Pending `get` callers of the stored fetch. */
  readonly waiters: Set<Waiter>;
  fetch: FetchRec | undefined;
  /** Restarts since the last settle. */
  restarts: number;
  /** A list's walk a patch dropped: the walk that starts once nothing holds it is its restart. */
  heldRestart: boolean;
  /**
   * A prefetch joined the fetch in flight. It and the fetches that restart it outlive their watchers, until one
   * settles or the entry reverts.
   */
  kept: boolean;
  idle: Idle | undefined;
  /** The interval worked out for the current settle. `undefined`: not worked out yet. */
  interval: { readonly ms: number | undefined } | undefined;
  intervalDue: number | undefined;
  intervalCancel: (() => void) | undefined;
  /** In issue order. */
  patches: PatchRec[];
  /** The first trigger deferred under a live patch. */
  deferred: Trigger | undefined;
  /** The caller-only fetch `get` callers join, while a patch is live. */
  shared: Shared | undefined;
  /** Sequence numbers: when the entry was made, and the last write or invalidation that hit it. */
  readonly born: number;
  touched: number;
  /** The issue number of the latest run that wrote or invalidated the entry. */
  reached: number;
  /** Hydrated, and nothing has fetched or written it since. Only means something while the window is open. */
  hydrated: boolean;
  // -- infinite queries only --
  /** The page count a running or owed walk loads to. */
  target: number | undefined;
  /** A trigger that arrived during an append, run as a walk when it ends. */
  owed: Trigger | undefined;
  /** The error of the last failed append, until the next load more or walk, or the last watcher leaving. */
  moreError: { readonly error: unknown } | undefined;
  /** Whether the list's settled pages have a next one, worked out once per result. */
  hasMore: { readonly result: Settled; readonly value: boolean } | undefined;
  readonly moreWaiters: Set<MoreWaiter>;
}

const runBody = <A, E, R>(
  handle: RunHandle,
  body: Effect.Effect<A, E, R>,
  writes: ((success: A) => readonly Write[]) | undefined
): Effect.Effect<A, E, R> =>
  Effect.uninterruptibleMask((restore) => {
    handle.start();
    return Effect.flatMap(
      Effect.exit(restore(Effect.provideService(body, CurrentRun, handle))),
      (exit): Effect.Effect<A, E> => {
        if (exit._tag === "Failure") {
          handle.finish({ _tag: "Failure" });
          return exit;
        }
        let sets: readonly Write[] = [];
        try {
          if (writes !== undefined) {
            sets = writes(exit.value);
          }
        } catch (error) {
          handle.finish({ _tag: "Success", writes: [] });
          return Effect.die(error);
        }
        handle.finish({ _tag: "Success", writes: sets });
        return exit;
      }
    );
  });

const isBareFailure = (result: Settled | undefined): boolean =>
  result !== undefined &&
  result._tag === "Failure" &&
  Option.isNone(result.previousSuccess);

// A fetched Failure holds only its Fails, so it has the shape of a hydrated one.
const failsOnly = <E>(cause: Cause.Cause<E>): Cause.Cause<E> =>
  Cause.fromReasons(
    cause.reasons
      .filter(Cause.isFailReason)
      .map((reason) => Cause.makeFailReason(reason.error))
  );

const diesOnly = <E>(cause: Cause.Cause<E>): Cause.Cause<never> =>
  Cause.fromReasons(
    cause.reasons
      .filter(Cause.isDieReason)
      .map((reason) => Cause.makeDieReason(reason.defect))
  );

/** What a caller of a fetch gets: a defect, the Fails only, or an interrupt for a revert. */
const callerExit = <A, E>(exit: Exit.Exit<A, E>): Exit.Exit<A, E> => {
  if (exit._tag === "Success") {
    return exit;
  }
  if (Cause.hasDies(exit.cause)) {
    return Exit.failCause(diesOnly(exit.cause));
  }
  return Cause.hasFails(exit.cause)
    ? Exit.failCause(failsOnly(exit.cause))
    : Exit.interrupt();
};

const withWaiting = (result: Settled, waiting: boolean): Settled => {
  if (result.waiting === waiting) {
    return result;
  }
  return result._tag === "Success"
    ? AsyncResult.success(result.value, {
        timestamp: result.timestamp,
        waiting,
      })
    : AsyncResult.failure(result.cause, {
        previousSuccess: result.previousSuccess,
        waiting,
      });
};

// oxlint-disable-next-line eslint/no-empty-function -- the unarmed cancel and waiter cleanup are intentionally no-ops; arming replaces them.
const constVoid = (): void => {};

interface PageRef {
  readonly page: number;
  readonly cursor: Schema.Json | undefined;
}

/** The `page` and `cursor` of a list's `FetchEvent`. */
const pageFields = (
  page: PageRef | undefined
): { readonly page?: number; readonly cursor?: Schema.Json } => {
  if (page === undefined) {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- pageFields returns the event's page shape; the annotation states the contract.
    return {};
  }
  if (page.cursor === undefined) {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- pageFields returns the event's page shape; the annotation states the contract.
    return { page: page.page };
  }
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- pageFields returns the event's page shape; the annotation states the contract.
  return { cursor: page.cursor, page: page.page };
};

/** A cursor as the log shows it: encoded, or `undefined` when it doesn't encode. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- list cursors are schema-erased at the list seam; the cursor Schema states the contract.
const logCursor = (list: ListDef, cursor: unknown): Schema.Json | undefined => {
  try {
    // SAFETY: the cursor codec's encoding is JSON by construction.
    return list.encodeCursor(cursor) as Schema.Json;
  } catch {
    return undefined;
  }
};

/** A cursor's identity within one walk: its encoding as JSON. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- list cursors are schema-erased at the list seam; the cursor Schema states the contract.
const cursorKey = (list: ListDef, cursor: unknown): string | undefined => {
  try {
    return JSON.stringify(list.encodeCursor(cursor));
  } catch {
    return undefined;
  }
};

// oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
const settledEffect = (result: Settled): Effect.Effect<any, any> =>
  result._tag === "Success"
    ? Effect.succeed(result.value)
    : Effect.failCause(result.cause);

const isRawTuple = (u: unknown): u is RawTuple =>
  Array.isArray(u) &&
  u.length === 4 &&
  typeof u[0] === "string" &&
  typeof u[3] === "number" &&
  (u[1] === 0 || (u[1] === 1 && Array.isArray(u[2])));

/** The `~query` payload by query name and args key, or `undefined` when it isn't the tuple shape. */
const parseRaw = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the snapshot walker takes the unknown payload; the Schema states the contract.
  input: unknown
): Map<string, Map<string, RawTuple>> | undefined => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates the wire value's shape before decoding; the Schema decode states the contract.
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  const out = new Map<string, Map<string, RawTuple>>();
  for (const [name, tuples] of Object.entries(input)) {
    if (!Array.isArray(tuples)) {
      return undefined;
    }
    const byKey = new Map<string, RawTuple>();
    for (const tuple of tuples) {
      if (!isRawTuple(tuple)) {
        return undefined;
      }
      if (!byKey.has(tuple[0])) {
        byKey.set(tuple[0], tuple);
      }
    }
    if (byKey.size > 0) {
      out.set(name, byKey);
    }
  }
  return out;
};

/**
 * Builds a cache. The Effect's context supplies the `Clock` and the
 * scheduler, and every fetch and timer is forked with it. The cache is
 * disposed when the Effect's `Scope` closes.
 *
 * @internal
 */
export const makeCache = (options: {
  readonly visibility: Signal;
  readonly connectivity: Signal;
  /** The problems sink. A throw from it is swallowed. */
  readonly report: (problem: Problem) => void;
  /** In milliseconds, from `cacheIdleMs`. */
  readonly idleMs: number;
  /**
   * The server's per-request mode: an entry settles at most once and is never
   * stale after, every settle is stored, a query's own `invalidate` is ignored
   * and reported, and no idle timer, interval or host edge runs.
   */
  readonly settleOnce?: boolean | undefined;
  /** `false`: no fetch ever starts, as on a server render with a budget of 0. */
  readonly fetches?: boolean | undefined;
}): Effect.Effect<CacheInternals, never, Scope.Scope> =>
  Effect.map(
    // Uninterruptible from the build to the finalizer's registration, so no build goes without disposal.
    Effect.acquireRelease(
      Effect.contextWith((context: Context.Context<never>) =>
        // oxlint-disable-next-line eslint/no-use-before-define -- the cache reads its build helper while running, after module init.
        Effect.sync(() => buildCache(context, options))
      ),
      (built) => built.dispose
    ),
    (built) => built.cache
  );

const cacheIdleMs = (input: Duration.Input | undefined): number => {
  const duration = Duration.fromInputUnsafe(input ?? "5 minutes");
  if (Duration.isNegative(duration)) {
    throw new Error("[Query] idleTimeToLive can't be negative");
  }
  return Duration.toMillis(duration);
};

interface ListCacheEnv {
  readonly settleOnce: boolean;
  readonly fetches: boolean;
  readonly isDisposed: () => boolean;
  readonly now: () => number;
  readonly report: (problem: Problem) => void;
  readonly register: (def: QueryDef) => QueryDef;
  readonly lookup: (def: QueryDef, argsKey: string) => Entry | undefined;
  readonly ensureEntry: (
    def: QueryDef,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- list env helpers take the query's erased args; the args Schema states the contract.
    args: unknown,
    argsKey?: string
  ) => Entry;
  readonly buildOf: (fetcher: Fetcher) => Build;
  readonly survivingBuild: (entry: Entry) => Build | undefined;
  readonly logKeyOf: (entry: Entry) => string;
  readonly isStale: (entry: Entry) => boolean;
  readonly hasLive: (entry: Entry) => boolean;
  readonly inWindow: (entry: Entry) => boolean;
  readonly cancelIdle: (entry: Entry) => void;
  readonly emit: (entry: Entry) => void;
  readonly emitFetch: (
    entry: Entry,
    trigger: Trigger,
    restart: boolean,
    stored: boolean,
    page?: PageRef | undefined
  ) => void;
  readonly startFetch: (
    entry: Entry,
    trigger: Trigger,
    build: Build,
    restart: boolean,
    append?: boolean
  ) => void;
  readonly ensureFetch: (entry: Entry, trigger: Trigger, build: Build) => void;
  readonly store: (entry: Entry, result: Settled) => void;
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  readonly storeFailure: (entry: Entry, cause: Cause.Cause<any>) => boolean;
  readonly markDefect: (
    entry: Entry,
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    cause: Cause.Cause<any>
  ) => Cause.Cause<never>;
  readonly afterFetch: (
    entry: Entry,
    stored: boolean,
    defect: Cause.Cause<never> | undefined
  ) => void;
  readonly afterQuiet: (entry: Entry) => void;
  readonly resumeAll: <A>(
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    waiters: Set<{ readonly resume: (exit: Exit.Exit<A, any>) => void }>,
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    exit: Exit.Exit<A, any>
  ) => void;
  readonly invalidateEntry: (entry: Entry, cause?: Trigger) => void;
}

interface ListOps {
  readonly itemsOf: (
    def: QueryDef,
    pages: readonly unknown[]
  ) => readonly unknown[];
  readonly heldPages: (entry: Entry) => readonly unknown[];
  // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
  readonly moreOf: (entry: Entry) => More<any>;
  readonly prepareFetch: (
    env: ListCacheEnv,
    entry: Entry,
    fetch: FetchRec,
    trigger: Trigger,
    build: Build,
    append: boolean
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  ) => { readonly body: () => Effect.Effect<any, any>; readonly page: PageRef };
  readonly onWalkExit: (
    env: ListCacheEnv,
    entry: Entry,
    fetch: FetchRec,
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    exit: Exit.Exit<WalkOutcome, any>
  ) => void;
  readonly callerWalk: (
    env: ListCacheEnv,
    def: QueryDef,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- list env helpers take the query's erased args; the args Schema states the contract.
    args: unknown,
    logKey: () => string,
    build: Build,
    count: number,
    onPage: (page: number, cursor: Schema.Json | undefined) => void
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  ) => Effect.Effect<readonly unknown[], any>;
  readonly loadMore: (
    env: ListCacheEnv,
    def: QueryDef,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- list env helpers take the query's erased args; the args Schema states the contract.
    args: unknown,
    fetcher: Fetcher,
    // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
    resume: (exit: Exit.Exit<LoadedMore<any>, any>) => void
  ) => () => void;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- list env helpers take the query's erased args; the args Schema states the contract.
  readonly reset: (env: ListCacheEnv, def: QueryDef, args: unknown) => void;
  readonly heldLoadMore: (
    env: ListCacheEnv,
    entry: Entry,
    trigger: Trigger
  ) => void;
}

const listHeldPages = (entry: Entry): readonly unknown[] => {
  const { result } = entry;
  if (result === undefined) {
    return [];
  }
  if (result._tag === "Success") {
    return result.value;
  }
  return Option.isSome(result.previousSuccess)
    ? result.previousSuccess.value.value
    : [];
};

const listHasMoreOf = (entry: Entry): boolean => {
  const { result } = entry;
  if (result === undefined || result._tag !== "Success") {
    return false;
  }
  if (entry.hasMore?.result === result) {
    return entry.hasMore.value;
  }
  // SAFETY: listHasMoreOf returns early unless the result is a Success; list successes hold page arrays.
  const pages = result.value as readonly unknown[];
  let value = false;
  if (pages.length > 0) {
    try {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- listHasMoreOf runs on list entries; the def carries the list.
      value = Option.isSome(entry.def.list!.next(pages.at(-1), pages));
    } catch {
      // A hydrated or seeded list: the walk that loads past it reports the defect.
    }
  }
  entry.hasMore = { result, value };
  return value;
};

// oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
const listMoreOf = (entry: Entry): More<any> => {
  if (
    entry.target !== undefined &&
    entry.target > listHeldPages(entry).length
  ) {
    return moreLoading;
  }
  if (entry.moreError !== undefined) {
    return { _tag: "Failed", error: entry.moreError.error };
  }
  return listHasMoreOf(entry) ? moreAvailable : moreEnd;
};

// oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
const listLoadedMore = (entry: Entry): LoadedMore<any> => ({
  hasMore: listHasMoreOf(entry),
  pages: listHeldPages(entry),
});

const listCheckPage = (
  env: ListCacheEnv,
  def: QueryDef,
  logKey: () => string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the page walker takes the schema-erased page; the page Schema states the contract.
  page: unknown
): void => {
  // oxlint-disable-next-line typescript/no-non-null-assertion -- listCheckPage runs only for list queries; the def carries the list.
  const list = def.list!;
  const seen = new Set<string>();
  for (const item of list.items(page)) {
    const key = list.key(item);
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    const at = logKey();
    env.report(
      new DuplicateKeyInPage({
        logKey: at,
        message: `[Query] a page of ${quote(def.name)} at ${
          at
        } holds two items with one key. The first is kept.`,
        query: def.name,
      })
    );
    return;
  }
};

const listWalk = (
  env: ListCacheEnv,
  def: QueryDef,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- list walkers take the query's erased args; the args Schema states the contract.
  args: unknown,
  logKey: () => string,
  build: Build,
  base: readonly unknown[],
  target: () => number,
  onPage: (page: number, cursor: Schema.Json | undefined) => void
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
): Effect.Effect<WalkOutcome, any> =>
  Effect.suspend(() => {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- listWalk runs only for list queries; the def carries the list.
    const list = def.list!;
    const pages = [...base];
    const used = new Set<string>();
    let repeated = false;
    const ended = (hasMore: boolean): Effect.Effect<WalkOutcome> =>
      Effect.succeed({
        cause: undefined,
        failedAt: undefined,
        hasMore,
        pages,
      });
    const step = (
      cursor: Option.Option<unknown>,
      first: boolean
      // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    ): Effect.Effect<WalkOutcome, any> => {
      const index = pages.length;
      if (Option.isSome(cursor)) {
        const key = cursorKey(list, cursor.value);
        if (key !== undefined) {
          if (used.has(key) && !repeated) {
            repeated = true;
            const at = logKey();
            env.report(
              new PageRepeated({
                logKey: at,
                message: `[Query] a walk of ${quote(def.name)} at ${
                  at
                } got page ${
                  index
                } with a cursor it already used. Check the list's next.`,
                query: def.name,
              })
            );
          }
          used.add(key);
        }
      }
      if (!first) {
        onPage(
          index,
          Option.isSome(cursor) ? logCursor(list, cursor.value) : undefined
        );
      }
      return Effect.flatMap(
        Effect.exit(build.fetcher(args, cursor)),
        // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
        (exit): Effect.Effect<WalkOutcome, any> => {
          if (exit._tag === "Failure") {
            if (Cause.hasDies(exit.cause) || !Cause.hasFails(exit.cause)) {
              return exit;
            }
            return Effect.succeed({
              cause: failsOnly(exit.cause),
              failedAt: index,
              hasMore: true,
              pages,
            });
          }
          return Effect.suspend(() => {
            const page = exit.value;
            listCheckPage(env, def, logKey, page);
            pages.push(page);
            const next = list.next(page, pages);
            if (Option.isNone(next)) {
              return ended(false);
            }
            if (pages.length >= target()) {
              return ended(true);
            }
            return step(next, false);
          });
        }
      );
    };
    if (pages.length === 0) {
      return step(Option.none(), true);
    }
    const next = list.next(pages.at(-1), pages);
    return Option.isNone(next) ? ended(false) : step(next, true);
  });

const listStart = (
  env: ListCacheEnv,
  entry: Entry,
  trigger: Trigger,
  build: Build
): void => {
  const held = listHeldPages(entry).length;
  const append = entry.result?._tag === "Success" && entry.target === held + 1;
  if (append && !listHasMoreOf(entry)) {
    if (!env.isStale(entry)) {
      entry.target = undefined;
      env.resumeAll(entry.moreWaiters, Exit.succeed(listLoadedMore(entry)));
      env.emit(entry);
      return env.afterQuiet(entry);
    }
    return env.startFetch(entry, trigger, build, false);
  }
  env.startFetch(entry, trigger, build, false, append);
};

const listOps: ListOps = {
  callerWalk: (env, def, args, logKey, build, count, onPage) =>
    Effect.flatMap(
      listWalk(env, def, args, logKey, build, [], () => count, onPage),
      (out) =>
        out.failedAt === undefined
          ? Effect.succeed(out.pages)
          : // oxlint-disable-next-line typescript/no-non-null-assertion -- a failed walk always carries its cause; failedAt is set with it.
            Effect.failCause(out.cause!)
    ),
  heldLoadMore: (env, entry, trigger) => {
    if (
      entry.target === undefined ||
      entry.target <= listHeldPages(entry).length
    ) {
      entry.target = undefined;
      return;
    }
    const build = env.survivingBuild(entry);
    if (build !== undefined) {
      return listStart(env, entry, trigger, build);
    }
    entry.target = undefined;
    env.resumeAll(entry.moreWaiters, Exit.interrupt());
  },
  heldPages: listHeldPages,
  itemsOf: infiniteItems,
  loadMore: (env, def, args, fetcher, resume) => {
    if (env.isDisposed()) {
      resume(Exit.interrupt());
      return constVoid;
    }
    const entry = env.ensureEntry(env.register(def), args);
    const build = env.buildOf(fetcher);
    const { result } = entry;
    if (env.settleOnce && result !== undefined) {
      resume(
        result._tag === "Success"
          ? Exit.succeed(listLoadedMore(entry))
          : Exit.failCause(result.cause)
      );
      return constVoid;
    }
    const waiter: MoreWaiter = { build, resume };
    entry.moreWaiters.add(waiter);
    env.cancelIdle(entry);
    const held = listHeldPages(entry).length;
    const { fetch } = entry;
    if (fetch !== undefined) {
      if (!fetch.append) {
        entry.target = Math.max(entry.target ?? held, held + 1);
      }
    } else if (
      result?._tag === "Success" &&
      !listHasMoreOf(entry) &&
      entry.target === undefined
    ) {
      entry.moreWaiters.delete(waiter);
      resume(Exit.succeed(listLoadedMore(entry)));
      env.afterQuiet(entry);
      return constVoid;
    } else {
      entry.target = Math.max(entry.target ?? held, held + 1);
      if (env.hasLive(entry)) {
        entry.deferred ??= "loadMore";
      } else if (!env.inWindow(entry) && env.fetches) {
        listStart(env, entry, "loadMore", build);
      }
    }
    entry.moreError = undefined;
    env.emit(entry);
    return () => {
      if (entry.moreWaiters.delete(waiter)) {
        env.afterQuiet(entry);
      }
    };
  },
  moreOf: listMoreOf,
  // oxlint-disable-next-line eslint/complexity -- onWalkExit settles every fetch shape in one pass; splitting it would scatter the exit handling.
  onWalkExit: (env, entry, fetch, exit) => {
    entry.fetch = undefined;
    const previous = entry.result;
    const held = listHeldPages(entry).length;
    entry.target = undefined;
    const { owed } = entry;
    entry.owed = undefined;
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    let getExit: Exit.Exit<any, any>;
    // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
    let moreExit: Exit.Exit<LoadedMore<any>, any>;
    let defect: Cause.Cause<never> | undefined;
    let stored = false;
    if (exit._tag === "Success") {
      const out = exit.value;
      const failed =
        out.cause === undefined ? undefined : Exit.failCause(out.cause);
      const error =
        out.cause === undefined ? undefined : Cause.findErrorOption(out.cause);
      if (fetch.append) {
        if (failed === undefined && previous?._tag === "Success") {
          entry.result = AsyncResult.success(out.pages, {
            timestamp: previous.timestamp,
          });
          entry.hasMore = { result: entry.result, value: out.hasMore };
          entry.hydrated = false;
        } else if (error !== undefined && Option.isSome(error)) {
          entry.moreError = { error: error.value };
        }
      } else if (
        failed === undefined ||
        // oxlint-disable-next-line typescript/no-non-null-assertion -- the walk failed here, so failedAt is set.
        (out.failedAt! >= held && out.failedAt! > 0)
      ) {
        env.store(
          entry,
          AsyncResult.success(out.pages, { timestamp: env.now() })
        );
        // oxlint-disable-next-line typescript/no-non-null-assertion -- store just wrote the fresh success above; entry.result is set.
        entry.hasMore = { result: entry.result!, value: out.hasMore };
        if (error !== undefined && Option.isSome(error)) {
          entry.moreError = { error: error.value };
        }
        stored = true;
      } else {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- failed is defined here, and failure derives from out.cause.
        stored = env.storeFailure(entry, out.cause!);
      }
      const server = entry.result;
      getExit =
        server?._tag === "Success"
          ? Exit.succeed(server.value)
          : (failed ?? Exit.interrupt());
      moreExit = failed ?? Exit.succeed(listLoadedMore(entry));
    } else {
      moreExit = callerExit(exit);
      getExit = moreExit;
      if (Cause.hasDies(exit.cause)) {
        defect = env.markDefect(entry, exit.cause);
      }
    }
    const more = [...entry.moreWaiters];
    entry.moreWaiters.clear();
    let waiters: Waiter[] = [];
    const build =
      owed !== undefined &&
      fetch.append &&
      defect === undefined &&
      (entry.watchers.size > 0 || entry.waiters.size > 0)
        ? env.survivingBuild(entry)
        : undefined;
    if (build === undefined) {
      waiters = [...entry.waiters];
      entry.waiters.clear();
    } else {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- the build is defined only when the condition held, which requires owed.
      env.ensureFetch(entry, owed!, build);
    }
    env.afterFetch(entry, stored, defect);
    for (const waiter of more) {
      waiter.resume(moreExit);
    }
    for (const waiter of waiters) {
      waiter.resume(getExit);
    }
  },
  prepareFetch: (env, entry, fetch, trigger, build, append) => {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- prepareFetch runs only for list fetches; the def carries the list.
    const list = entry.def.list!;
    entry.moreError = undefined;
    const logKey = () => env.logKeyOf(entry);
    const onPage = (index: number, cursor: Schema.Json | undefined): void => {
      if (entry.fetch === fetch) {
        env.emitFetch(entry, trigger, false, true, { cursor, page: index });
      }
    };
    if (append) {
      const base = listHeldPages(entry);
      let cursor: Schema.Json | undefined;
      try {
        const next = list.next(base.at(-1), base);
        if (Option.isSome(next)) {
          cursor = logCursor(list, next.value);
        }
      } catch {
        // The walk dies with it.
      }
      return {
        body: () =>
          listWalk(
            env,
            entry.def,
            entry.args,
            logKey,
            build,
            base,
            () => base.length + 1,
            onPage
          ),
        page: { cursor, page: base.length },
      };
    }
    entry.target = env.settleOnce
      ? 1
      : Math.max(entry.target ?? 0, listHeldPages(entry).length, 1);
    return {
      body: () =>
        listWalk(
          env,
          entry.def,
          entry.args,
          logKey,
          build,
          [],
          () => entry.target ?? 1,
          onPage
        ),
      page: { cursor: undefined, page: 0 },
    };
  },
  reset: (env, def, args) => {
    if (env.isDisposed() || env.settleOnce) {
      return;
    }
    const registered = env.register(def);
    const entry = env.lookup(registered, registered.argsKey(args));
    if (entry === undefined) {
      return;
    }
    const { result } = entry;
    if (result?._tag === "Success" && result.value.length > 1) {
      entry.result = AsyncResult.success(result.value.slice(0, 1), {
        timestamp: result.timestamp,
      });
    } else if (
      result?._tag === "Failure" &&
      Option.isSome(result.previousSuccess)
    ) {
      const previous = result.previousSuccess.value;
      if (previous.value.length > 1) {
        entry.result = AsyncResult.failure(result.cause, {
          previousSuccess: Option.some(
            AsyncResult.success(previous.value.slice(0, 1), {
              timestamp: previous.timestamp,
            })
          ),
        });
      }
    }
    entry.moreError = undefined;
    if (entry.target !== undefined) {
      entry.target = 1;
    }
    env.invalidateEntry(entry, "reset");
    env.emit(entry);
  },
};

const buildCache = (
  context: Context.Context<never>,
  options: Omit<Parameters<typeof makeCache>[0], "idleMs"> & {
    readonly idleMs?: number | undefined;
    readonly idleTimeToLive?: Duration.Input | undefined;
  }
): {
  readonly cache: CacheInternals;
  readonly dispose: Effect.Effect<void>;
} => {
  const { connectivity, visibility } = options;
  const clock = Context.get(context, Clock.Clock);
  const defaultIdleMs = options.idleMs ?? cacheIdleMs(options.idleTimeToLive);
  const settleOnce = options.settleOnce === true;
  const fetches = options.fetches !== false;

  const queries = new Map<string, QueryDef>();
  const duplicates = new WeakSet<QueryDef>();
  const index = new Map<string, Map<string, Entry>>();
  // Builds made for fakes, and every build this cache listens to.
  const fakeBuilds = new WeakMap<Fetcher, Build>();
  const attached = new Set<Build>();
  const fetchListeners = new Set<(event: FetchEvent) => void>();
  const fetchEndListeners = new Set<() => void>();
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  const timers = new Set<Fiber.Fiber<any, any>>();
  // Every fetch fiber until its cleanup has finished, and per entry the interrupted one its next fetch waits for.
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  const fetchFibers = new Set<Fiber.Fiber<any, any>>();
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  const draining = new Map<string, Fiber.Fiber<any, any>>();
  const sharedFetches = new Set<Shared>();
  // The awaited sets still waiting on an entry.
  const awaits = new Set<Await>();
  // Hydrated entries whose query hasn't registered yet.
  let raw = new Map<string, Map<string, RawTuple>>();
  let hydratedAt = 0;
  let hydratedStatic = false;
  let windowOpen = false;
  // Writes and invalidations, entry creation and run starts share one sequence.
  let seq = 0;
  let issued = 0;
  let disposed = false;

  const now = (): number => clock.currentTimeMillisUnsafe();
  const runFork = Effect.runForkWith(context);
  /** Runs `f` one scheduler step later. */
  const defer = (f: () => void): void => {
    runFork(
      Effect.andThen(
        Effect.yieldNow,
        Effect.sync(() => (disposed ? undefined : f()))
      )
    );
  };
  /** A `Clock` sleep. Returns its cancel. */
  const timer = (ms: number, f: () => void): (() => void) => {
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    const fiber: Fiber.Fiber<any, any> = runFork(
      Effect.andThen(
        Effect.sleep(ms),
        Effect.sync(() => {
          timers.delete(fiber);
          if (!disposed) {
            f();
          }
        })
      )
    );
    timers.add(fiber);
    return () => {
      timers.delete(fiber);
      fiber.interruptUnsafe();
    };
  };
  const report = (problem: Problem): void => {
    try {
      options.report(problem);
    } catch {
      // A check only reports: a sink that throws changes nothing.
    }
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- scoped to the cache build; hoisting would separate it from its only use.
  const notify = <A>(listeners: ReadonlySet<(a: A) => void>, a: A): void => {
    // oxlint-disable-next-line unicorn/no-useless-spread -- a listener may unsubscribe while notified; iterate over a snapshot.
    for (const listener of [...listeners]) {
      try {
        listener(a);
      } catch {
        // A listener can't change what the cache does.
      }
    }
  };
  /** Taken before any resumes: a caller resumed here can run before this returns, and call again. */
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- scoped to the cache build; hoisting would separate it from its only use.
  const resumeAll = <A>(
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    waiters: Set<{ readonly resume: (exit: Exit.Exit<A, any>) => void }>,
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    exit: Exit.Exit<A, any>
  ): void => {
    if (waiters.size === 0) {
      return;
    }
    const taken = [...waiters];
    waiters.clear();
    for (const waiter of taken) {
      waiter.resume(exit);
    }
  };

  // -- registry and index -----------------------------------------------------
  /** First wins: the first definition under a name pins everything about the query. */
  const register = (def: QueryDef): QueryDef => {
    const existing = queries.get(def.name);
    if (existing === undefined) {
      queries.set(def.name, def);
      // oxlint-disable-next-line eslint/no-use-before-define -- entry lifecycle helpers invoke each other while the cache runs, after module init.
      decodeRaw(def);
      return def;
    }
    if (existing !== def && !duplicates.has(def)) {
      duplicates.add(def);
      report(
        new DuplicateName({
          message: `[Query] a second query named ${quote(
            def.name
          )} was registered in one cache. The first definition wins.`,
          query: def.name,
        })
      );
    }
    return existing;
  };
  const allEntries = (): Entry[] => {
    const out: Entry[] = [];
    for (const byKey of index.values()) {
      for (const entry of byKey.values()) {
        out.push(entry);
      }
    }
    return out;
  };
  const lookup = (def: QueryDef, argsKey: string): Entry | undefined =>
    index.get(def.name)?.get(argsKey);
  const ensureEntry = (
    def: QueryDef,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- entry helpers take the query's erased args; the query's args Schema decodes them at the fetch boundary.
    args: unknown,
    argsKey = def.argsKey(args)
  ): Entry => {
    const found = lookup(def, argsKey);
    if (found !== undefined) {
      return found;
    }
    const entry: Entry = {
      args,
      argsKey,
      born: (seq += 1),
      def,
      deferred: undefined,
      fetch: undefined,
      hasMore: undefined,
      heldRestart: false,
      hydrated: false,
      idle: undefined,
      interval: undefined,
      intervalCancel: undefined,
      intervalDue: undefined,
      invalidated: false,
      kept: false,
      logKey: undefined,
      moreError: undefined,
      moreWaiters: new Set(),
      owed: undefined,
      patches: [],
      reached: 0,
      removed: false,
      restarts: 0,
      result: undefined,
      settledAt: 0,
      shared: undefined,
      target: undefined,
      touched: 0,
      waiters: new Set(),
      watchers: new Set(),
    };
    let byKey = index.get(def.name);
    if (byKey === undefined) {
      index.set(def.name, (byKey = new Map()));
    }
    byKey.set(argsKey, entry);
    return entry;
  };
  const removeEntry = (entry: Entry): void => {
    if (entry.removed) {
      return;
    }
    entry.removed = true;
    // oxlint-disable-next-line eslint/no-use-before-define -- entry lifecycle helpers invoke each other while the cache runs, after module init.
    cancelIdle(entry);
    // oxlint-disable-next-line eslint/no-use-before-define -- entry lifecycle helpers invoke each other while the cache runs, after module init.
    stopInterval(entry);
    const byKey = index.get(entry.def.name);
    if (byKey !== undefined && byKey.get(entry.argsKey) === entry) {
      byKey.delete(entry.argsKey);
      if (byKey.size === 0) {
        index.delete(entry.def.name);
      }
    }
    // oxlint-disable-next-line eslint/no-use-before-define -- entry lifecycle helpers invoke each other while the cache runs, after module init.
    checkAwaits(entry);
  };
  /** A refetch in flight, or one owed: held by a live patch, or owed after a list's append. */
  const owesRefetch = (entry: Entry): boolean =>
    !entry.removed &&
    (entry.fetch !== undefined ||
      entry.deferred !== undefined ||
      entry.owed !== undefined);
  /** An entry that may have gone quiet leaves the awaited sets, and a set it empties is heard. */
  const checkAwaits = (entry: Entry): void => {
    if (awaits.size === 0 || owesRefetch(entry)) {
      return;
    }
    // oxlint-disable-next-line unicorn/no-useless-spread -- the loop removes heard sets from awaits; iterate over a snapshot.
    for (const rec of [...awaits]) {
      if (!rec.entries.delete(entry) || rec.entries.size > 0) {
        continue;
      }
      awaits.delete(rec);
      const { listener } = rec;
      rec.listener = undefined;
      listener?.();
    }
  };
  const drainKey = (entry: Entry): string =>
    quote(entry.def.name) + entry.argsKey;
  const logKeyOf = (entry: Entry): string =>
    (entry.logKey ??= entry.def.logKey(entry.args, entry.argsKey));

  // -- builds -----------------------------------------------------------------
  const buildOf = (fetcher: Fetcher): Build => {
    // SAFETY: the cast reads only the optional build brand; the undefined path builds fresh.
    let build = (fetcher as { readonly [BuildTypeId]?: Build })[BuildTypeId];
    if (build === undefined) {
      build = fakeBuilds.get(fetcher);
      if (build === undefined) {
        build = {
          closed: false,
          fetcher,
          fibers: new Set(),
          listeners: new Set(),
        };
        fakeBuilds.set(fetcher, build);
      }
      return build;
    }
    if (!build.closed && !attached.has(build)) {
      attached.add(build);
      // oxlint-disable-next-line eslint/no-use-before-define -- entry lifecycle helpers invoke each other while the cache runs, after module init.
      build.listeners.add(buildClosed);
    }
    return build;
  };
  /** The build the cache uses when it asks itself: the earliest live watcher's, then a waiter's. */
  const survivingBuild = (entry: Entry): Build | undefined => {
    for (const watcher of entry.watchers) {
      if (!watcher.build.closed) {
        return watcher.build;
      }
    }
    for (const waiter of entry.waiters) {
      if (!waiter.build.closed) {
        return waiter.build;
      }
    }
    for (const waiter of entry.moreWaiters) {
      if (!waiter.build.closed) {
        return waiter.build;
      }
    }
    return undefined;
  };

  // -- state ------------------------------------------------------------------
  const isStale = (entry: Entry): boolean =>
    settleOnce
      ? entry.result === undefined
      : entry.result === undefined ||
        entry.result._tag === "Failure" ||
        entry.invalidated ||
        now() - entry.settledAt >= entry.def.staleMs;
  const hasLive = (entry: Entry): boolean =>
    entry.patches.some((patch) => patch.live);
  /** Inside the fetch-free window, a hydrated entry. */
  const inWindow = (entry: Entry): boolean => windowOpen && entry.hydrated;
  /** The server value. `waiting` means only that a stored fetch is in flight, and not a list's append. */
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  const view = (entry: Entry): AsyncResult.AsyncResult<any, any> => {
    const waiting = entry.fetch !== undefined && !entry.fetch.append;
    return entry.result === undefined
      ? AsyncResult.initial(waiting)
      : withWaiting(entry.result, waiting);
  };
  /** The server value with every patch applied in issue order. A patch that throws is dropped from the entry. */
  const patchedViewOf = (
    entry: Entry,
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    server: AsyncResult.AsyncResult<any, any>
  ): PatchedView => {
    if (entry.patches.length === 0 || server._tag !== "Success") {
      return { patched: false, result: server };
    }
    let { value } = server;
    // oxlint-disable-next-line unicorn/no-useless-spread -- patch appliers run user code while iterating; iterate over a snapshot.
    for (const rec of [...entry.patches]) {
      try {
        value = applyPatch(
          rec.patch,
          entry.def.name,
          entry.argsKey,
          entry.args,
          value
        );
      } catch {
        entry.patches = entry.patches.filter((other) => other !== rec);
      }
    }
    if (entry.patches.length === 0) {
      return { patched: false, result: server };
    }
    return {
      patched: true,
      result: AsyncResult.success(value, {
        timestamp: server.timestamp,
        waiting: server.waiting,
      }),
    };
  };
  /** Quiet over a cold entry, and skips a state equal to a watcher's last. */
  const emit = (entry: Entry): void => {
    if (entry.watchers.size === 0) {
      return;
    }
    const server = view(entry);
    if (server._tag === "Initial") {
      return;
    }
    // oxlint-disable-next-line eslint/no-use-before-define -- entry lifecycle helpers invoke each other while the cache runs, after module init.
    const more = moreOf(entry);
    let patchedView: PatchedView | undefined;
    // oxlint-disable-next-line unicorn/no-useless-spread -- onChange runs user code while iterating; iterate over a snapshot.
    for (const watcher of [...entry.watchers]) {
      if (!watcher.active) {
        continue;
      }
      if (watcher.provisional !== undefined) {
        // The withheld Failure, waiting or not: still withheld.
        if (watcher.provisional === entry.result) {
          continue;
        }
        watcher.provisional = undefined;
      }
      // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
      let result: AsyncResult.AsyncResult<any, any> = server;
      let patched = false;
      if (watcher.patched) {
        patchedView ??= patchedViewOf(entry, server);
        ({ result, patched } = patchedView);
      }
      if (
        patched === watcher.lastPatched &&
        sameMore(more, watcher.lastMore) &&
        Equal.equals(result, watcher.last)
      ) {
        continue;
      }
      watcher.last = result;
      watcher.lastPatched = patched;
      watcher.lastMore = more;
      // SAFETY: the entry result is settled where watchers run; Settled is the watcher contract.
      watcher.onChange(result as Settled, patched, more);
    }
  };
  const emitFetch = (
    entry: Entry,
    trigger: Trigger,
    restart: boolean,
    stored: boolean,
    page?: PageRef | undefined
  ): void => {
    if (fetchListeners.size === 0) {
      return;
    }
    notify(fetchListeners, {
      inWindow: inWindow(entry),
      logKey: logKeyOf(entry),
      query: entry.def.name,
      restart,
      stored,
      trigger,
      ...pageFields(page),
    });
  };

  // -- idle timer -------------------------------------------------------------
  const cancelIdle = (entry: Entry): void => {
    if (entry.idle !== undefined) {
      entry.idle.cancel();
      entry.idle = undefined;
    }
  };
  // A live patch blocks collection. A patch held after success doesn't.
  const idleEligible = (entry: Entry): boolean =>
    !entry.removed &&
    entry.watchers.size === 0 &&
    entry.waiters.size === 0 &&
    entry.moreWaiters.size === 0 &&
    entry.fetch === undefined &&
    !hasLive(entry);
  const idleTtl = (entry: Entry): number => entry.def.idleMs ?? defaultIdleMs;
  // Built like `RcMap`'s: an `expiresAt` a reset moves, and a sleep that goes round again.
  const startIdle = (entry: Entry): void => {
    cancelIdle(entry);
    // The server starts no idle timers.
    if (settleOnce) {
      return;
    }
    const ttl = idleTtl(entry);
    if (ttl === Infinity) {
      return;
    }
    if (ttl <= 0) {
      return removeEntry(entry);
    }
    const idle: Idle = { cancel: () => {}, expiresAt: now() + ttl }; // oxlint-disable-line eslint/no-empty-function -- idle starts with a no-op cancel; sleep replaces it when armed.
    entry.idle = idle;
    const sleep = (ms: number): void => {
      idle.cancel = timer(ms, () => {
        if (entry.idle !== idle) {
          return;
        }
        const remaining = idle.expiresAt - now();
        if (remaining > 0) {
          return sleep(remaining);
        }
        entry.idle = undefined;
        if (idleEligible(entry)) {
          removeEntry(entry);
        }
      });
    };
    sleep(ttl);
  };
  /** Called whenever the entry may have gone quiet: removes a cold one, starts the timer on a settled one. */
  const afterQuiet = (entry: Entry): void => {
    // Called after the entry's emission, so a run's wait ends after its watchers have seen the settle.
    checkAwaits(entry);
    if (disposed || !idleEligible(entry)) {
      return;
    }
    if (entry.result === undefined) {
      return removeEntry(entry);
    }
    if (entry.idle === undefined) {
      startIdle(entry);
    }
  };
  const resetIdle = (entry: Entry): void => {
    if (entry.idle !== undefined) {
      entry.idle.expiresAt = now() + idleTtl(entry);
    }
  };

  // -- interval ---------------------------------------------------------------
  const paused = (): boolean => !visibility.get() || !connectivity.get();
  const stopInterval = (entry: Entry): void => {
    if (entry.intervalCancel !== undefined) {
      entry.intervalCancel();
      entry.intervalCancel = undefined;
    }
    entry.intervalDue = undefined;
  };
  /** Worked out once per settle: a function form that throws or returns nonsense means none until the next. */
  const intervalMs = (entry: Entry): number | undefined => {
    if (entry.result === undefined) {
      return undefined;
    }
    if (entry.interval !== undefined) {
      return entry.interval.ms;
    }
    // oxlint-disable-next-line eslint/no-use-before-define -- fetch-machine steps invoke each other while a fetch runs, after module init.
    const ms = evaluateInterval(entry, entry.result);
    entry.interval = { ms };
    return ms;
  };
  const evaluateInterval = (
    entry: Entry,
    result: Settled
  ): number | undefined => {
    const interval = entry.def.refetchInterval;
    if (interval === undefined) {
      return undefined;
    }
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- branches the interval's bare-number form; Duration.fromInput states the contract.
    if (typeof interval === "number") {
      return interval === Infinity ? undefined : interval;
    }
    let input: Duration.Input | undefined;
    try {
      input = interval(result, entry.args);
    } catch (error) {
      const logKey = logKeyOf(entry);
      report(
        new IntervalThrew({
          error,
          logKey,
          message: `[Query] refetchInterval of ${quote(
            entry.def.name
          )} threw at ${logKey}. There is no interval until the next settle.`,
          query: entry.def.name,
        })
      );
      return undefined;
    }
    if (input === undefined) {
      return undefined;
    }
    const ms = parseInterval(input);
    if (ms === "invalid") {
      const logKey = logKeyOf(entry);
      report(
        new IntervalInvalid({
          logKey,
          message: `[Query] refetchInterval of ${quote(
            entry.def.name
          )} returned zero, a negative or a bare number under 1000 at ${
            logKey
          }. There is no interval until the next settle. ${subSecondHint}`,
          query: entry.def.name,
        })
      );
      return undefined;
    }
    return ms === Infinity ? undefined : ms;
  };
  const fireInterval = (entry: Entry): void => {
    // Paused: the due time stays, and the edge pass picks it up.
    if (paused() || entry.watchers.size === 0) {
      return;
    }
    if (entry.fetch !== undefined) {
      // During a list's append it is owed. During a walk it is dropped, as during any fetch.
      if (entry.fetch.append) {
        entry.owed ??= "interval";
      }
      return;
    }
    const build = survivingBuild(entry);
    if (build !== undefined) {
      // oxlint-disable-next-line eslint/no-use-before-define -- fetch-machine steps invoke each other while a fetch runs, after module init.
      ensureFetch(entry, "interval", build);
    }
  };
  const armInterval = (entry: Entry): void => {
    if (entry.intervalCancel !== undefined) {
      entry.intervalCancel();
    }
    entry.intervalCancel = undefined;
    if (entry.intervalDue === undefined) {
      return;
    }
    const remaining = entry.intervalDue - now();
    if (remaining <= 0) {
      let cancelled = false;
      entry.intervalCancel = () => {
        cancelled = true;
      };
      defer(() => {
        if (cancelled) {
          return;
        }
        entry.intervalCancel = undefined;
        fireInterval(entry);
      });
      return;
    }
    entry.intervalCancel = timer(remaining, () => {
      entry.intervalCancel = undefined;
      fireInterval(entry);
    });
  };
  /** Counts from the last settle. Called at a settle and at the zero-to-one watch. */
  const scheduleInterval = (entry: Entry): void => {
    stopInterval(entry);
    if (settleOnce || entry.removed || entry.watchers.size === 0) {
      return;
    }
    const ms = intervalMs(entry);
    if (ms === undefined) {
      return;
    }
    entry.intervalDue = entry.settledAt + ms;
    armInterval(entry);
  };
  /**
   * A fetch ended without a settle. If the interval's timer already fired,
   * nothing else would arm it again, so a new interval counts from now and
   * polling carries on. While paused the due time stays for the edge pass.
   */
  const rearmInterval = (entry: Entry): void => {
    if (
      settleOnce ||
      disposed ||
      entry.removed ||
      entry.watchers.size === 0 ||
      entry.fetch !== undefined
    ) {
      return;
    }
    if (entry.intervalCancel !== undefined || paused()) {
      return;
    }
    const ms = intervalMs(entry);
    if (ms === undefined) {
      return;
    }
    entry.intervalDue = now() + ms;
    armInterval(entry);
  };
  const intervalElapsed = (entry: Entry): boolean =>
    entry.intervalDue !== undefined && entry.intervalDue <= now();

  // oxlint-disable-next-line typescript/no-explicit-any -- More pages carry the query's page type, erased in the walker; the list's items Schema decodes at the page boundary.
  const moreOf = (entry: Entry): More<any> | undefined =>
    entry.def.list?.ops.moreOf(entry);

  let listEnvCache: ListCacheEnv | undefined;
  const listEnv = (): ListCacheEnv =>
    (listEnvCache ??= {
      // oxlint-disable-next-line eslint/no-use-before-define -- fetch-machine steps invoke each other while a fetch runs, after module init.
      afterFetch,
      afterQuiet,
      buildOf,
      cancelIdle,
      emit,
      emitFetch,
      ensureEntry,
      // oxlint-disable-next-line eslint/no-use-before-define -- fetch-machine steps invoke each other while a fetch runs, after module init.
      ensureFetch,
      fetches,
      hasLive,
      inWindow,
      // oxlint-disable-next-line eslint/no-use-before-define -- fetch-machine steps invoke each other while a fetch runs, after module init.
      invalidateEntry,
      isDisposed: () => disposed,
      isStale,
      logKeyOf,
      lookup,
      // oxlint-disable-next-line eslint/no-use-before-define -- fetch-machine steps invoke each other while a fetch runs, after module init.
      markDefect,
      now,
      register,
      report,
      resumeAll,
      settleOnce,
      // oxlint-disable-next-line eslint/no-use-before-define -- fetch-machine steps invoke each other while a fetch runs, after module init.
      startFetch,
      // oxlint-disable-next-line eslint/no-use-before-define -- fetch-machine steps invoke each other while a fetch runs, after module init.
      store,
      // oxlint-disable-next-line eslint/no-use-before-define -- fetch-machine steps invoke each other while a fetch runs, after module init.
      storeFailure,
      survivingBuild,
    });

  // -- fetching ---------------------------------------------------------------
  const startFetch = (
    entry: Entry,
    trigger: Trigger,
    build: Build,
    restart: boolean,
    append = false
  ): void => {
    const resumed = entry.heldRestart && !append;
    if (resumed) {
      entry.heldRestart = false;
    }
    const fetch: FetchRec = { append, build, fiber: undefined, trigger };
    entry.fetch = fetch;
    cancelIdle(entry);
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    let body: () => Effect.Effect<any, any> = () => build.fetcher(entry.args);
    let page: PageRef | undefined;
    if (entry.def.list !== undefined) {
      ({ body, page } = entry.def.list.ops.prepareFetch(
        listEnv(),
        entry,
        fetch,
        trigger,
        build,
        append
      ));
    }
    // Reported before the entry turns ordinary, so the event says whether it fetched inside the window.
    emitFetch(entry, trigger, restart || resumed, true, page);
    // A fetch after hydration makes the entry ordinary: a `get` joins it.
    entry.hydrated = false;
    // The fetcher never starts inside the call that asked for it, nor before the fetch it replaces has finished
    // its cleanup. The wait is uninterruptible, so a chain of restarts still ends in order.
    const key = drainKey(entry);
    const previous = draining.get(key);
    const fiber = runFork(
      Effect.andThen(
        previous === undefined
          ? Effect.yieldNow
          : Effect.uninterruptible(Fiber.await(previous)),
        Effect.suspend(body)
      )
    );
    fetch.fiber = fiber;
    fetchFibers.add(fiber);
    build.fibers.add(fiber);
    fiber.addObserver((exit) => {
      fetchFibers.delete(fiber);
      build.fibers.delete(fiber);
      if (draining.get(key) === fiber) {
        draining.delete(key);
      }
      // oxlint-disable-next-line eslint/no-use-before-define -- fetch-machine steps invoke each other while a fetch runs, after module init.
      onFetchExit(entry, fetch, exit);
      // oxlint-disable-next-line unicorn/no-useless-undefined -- both parameters are required; explicit undefined means no payload.
      notify(fetchEndListeners, undefined);
    });
    emit(entry);
  };
  /**
   * Interrupts the fetch without settling anything, and without waiting for its cleanup: the entry's next fetch,
   * the build's close and the cache's disposal wait for that. The caller restarts or reverts.
   */
  const dropFetch = (entry: Entry, fetch: FetchRec): void => {
    entry.fetch = undefined;
    if (fetch.fiber === undefined) {
      return;
    }
    draining.set(drainKey(entry), fetch.fiber);
    fetch.fiber.interruptUnsafe();
  };
  /**
   * One fetch per entry: a caller that finds one in flight joins it. Under a
   * live patch nothing fetches, and the first trigger is kept for the check
   * made when the last live owner exits.
   */
  const ensureFetch = (entry: Entry, trigger: Trigger, build: Build): void => {
    if (entry.fetch !== undefined || disposed || !fetches) {
      return;
    }
    if (settleOnce && entry.result !== undefined) {
      return;
    }
    if (hasLive(entry)) {
      entry.deferred ??= trigger;
      return;
    }
    startFetch(entry, trigger, build, false);
  };
  /** Ten restarts in a row with no settle between are reported, once. */
  const countRestart = (entry: Entry): void => {
    entry.restarts += 1;
    if (entry.restarts === restartLimit) {
      const logKey = logKeyOf(entry);
      report(
        new FetchRestarted({
          logKey,
          message: `[Query] the fetch of ${quote(entry.def.name)} at ${
            logKey
          } was restarted ${restartLimit} times in a row without settling.`,
          query: entry.def.name,
        })
      );
    }
  };
  /** A settle or a stored write: patches held after success are confirmed and go. */
  const store = (entry: Entry, result: Settled): void => {
    entry.result = result;
    entry.settledAt = now();
    entry.invalidated = false;
    entry.restarts = 0;
    entry.heldRestart = false;
    entry.interval = undefined;
    entry.hydrated = false;
    if (entry.patches.length > 0) {
      entry.patches = entry.patches.filter((patch) => patch.live);
    }
    scheduleInterval(entry);
  };
  /**
   * Stores a fetch's Fails over the entry's last Success, and returns whether it did. An unwatched entry never
   * holds a Failure with no previous Success, except on the server, so that one isn't stored.
   */
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  const storeFailure = (entry: Entry, cause: Cause.Cause<any>): boolean => {
    const previous = entry.result;
    const previousSuccess: Option.Option<
      AsyncResult.Success<unknown, unknown>
    > =
      previous?._tag === "Success"
        ? Option.some(previous)
        : (previous?.previousSuccess ?? Option.none());
    if (
      entry.watchers.size === 0 &&
      !settleOnce &&
      Option.isNone(previousSuccess)
    ) {
      return false;
    }
    store(entry, AsyncResult.failure(cause, { previousSuccess }));
    return true;
  };
  /** A fetcher's defect is never stored: the previous state stays, marked stale, so a remount fetches fresh. */
  const markDefect = (
    entry: Entry,
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    cause: Cause.Cause<any>
  ): Cause.Cause<never> => {
    if (entry.result !== undefined) {
      entry.invalidated = true;
    }
    return diesOnly(cause);
  };
  /** What ends every fetch, after its result is in: the defect and the emission, then the timers. */
  const afterFetch = (
    entry: Entry,
    stored: boolean,
    defect: Cause.Cause<never> | undefined
  ): void => {
    if (defect !== undefined) {
      // oxlint-disable-next-line unicorn/no-useless-spread -- defect handlers run user code while iterating; iterate over a snapshot.
      for (const watcher of [...entry.watchers]) {
        if (watcher.active) {
          watcher.onDefect?.(defect);
        }
      }
    }
    emit(entry);
    if (!stored) {
      rearmInterval(entry);
    }
    afterQuiet(entry);
  };
  /**
   * A fetch ended with nothing to store and nothing to restart it: the entry keeps its previous state, its
   * freshness included. Only a defect marks the previous Success stale.
   */
  const revert = (entry: Entry): void => {
    entry.kept = false;
    entry.target = undefined;
    entry.owed = undefined;
    resumeAll(entry.waiters, Exit.interrupt());
    resumeAll(entry.moreWaiters, Exit.interrupt());
    emit(entry);
    rearmInterval(entry);
    afterQuiet(entry);
  };
  const onFetchExit = (
    entry: Entry,
    fetch: FetchRec,
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    exit: Exit.Exit<any, any>
  ): void => {
    if (entry.fetch !== fetch || disposed) {
      return;
    }
    entry.kept = false;
    if (entry.def.list !== undefined) {
      return entry.def.list.ops.onWalkExit(listEnv(), entry, fetch, exit);
    }
    entry.fetch = undefined;
    let defect: Cause.Cause<never> | undefined;
    let stored = false;
    if (exit._tag === "Success") {
      store(entry, AsyncResult.success(exit.value, { timestamp: now() }));
      stored = true;
    } else if (Cause.hasDies(exit.cause)) {
      defect = markDefect(entry, exit.cause);
    } else if (Cause.hasFails(exit.cause)) {
      stored = storeFailure(entry, failsOnly(exit.cause));
    }
    // Otherwise interrupted, such as by the fetcher itself: a revert, never a Failure.
    resumeAll(entry.waiters, callerExit(exit));
    afterFetch(entry, stored, defect);
  };
  /**
   * Interrupts the fetch and restarts it with its trigger, under a surviving build or else its own, which is all
   * a prefetch has. With no open build the entry reverts.
   */
  const replaceFetch = (entry: Entry, fetch: FetchRec): void => {
    dropFetch(entry, fetch);
    const build =
      survivingBuild(entry) ?? (fetch.build.closed ? undefined : fetch.build);
    if (build === undefined) {
      return revert(entry);
    }
    countRestart(entry);
    startFetch(entry, fetch.trigger, build, true);
  };
  const buildClosed = (build: Build): void => {
    attached.delete(build);
    if (disposed) {
      return;
    }
    for (const entry of allEntries()) {
      const { fetch } = entry;
      if (fetch !== undefined && fetch.build === build) {
        replaceFetch(entry, fetch);
      }
    }
    // oxlint-disable-next-line unicorn/no-useless-spread -- ending a shared fetch unregisters it; iterate over a snapshot.
    for (const shared of [...sharedFetches]) {
      if (shared.build !== build) {
        continue;
      }
      let next: Build | undefined;
      for (const caller of shared.callers) {
        if (!caller.build.closed) {
          next = caller.build;
          break;
        }
      }
      if (next === undefined) {
        // oxlint-disable-next-line eslint/no-use-before-define -- shared-fetch helpers invoke each other while a fetch runs, after module init.
        endShared(shared, Exit.interrupt());
      } else {
        shared.build = next;
        // oxlint-disable-next-line eslint/no-use-before-define -- shared-fetch helpers invoke each other while a fetch runs, after module init.
        runShared(shared, true);
      }
    }
  };

  // -- caller-only fetches ----------------------------------------------------
  /**
   * Like a stored fetch, a caller-only one starts only once what it replaces has finished its cleanup: the stored
   * fetch it was converted from, or its own fetch under a build that closed.
   */
  const runShared = (shared: Shared, restart: boolean): void => {
    emitFetch(
      shared.entry,
      "get",
      restart,
      false,
      shared.entry.def.list === undefined
        ? undefined
        : { cursor: undefined, page: 0 }
    );
    const { build } = shared;
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    const previous: Fiber.Fiber<any, any>[] = [];
    const stored = draining.get(drainKey(shared.entry));
    if (stored !== undefined) {
      previous.push(stored);
    }
    const replaced = shared.fiber;
    if (replaced !== undefined) {
      // Cleared first, so the replaced fiber's exit doesn't end the callers' fetch.
      shared.fiber = undefined;
      replaced.interruptUnsafe();
      previous.push(replaced);
    }
    const { entry } = shared;
    const body =
      entry.def.list === undefined
        ? Effect.suspend(() => build.fetcher(entry.args))
        : entry.def.list.ops.callerWalk(
            listEnv(),
            entry.def,
            entry.args,
            () => logKeyOf(entry),
            build,
            Math.max(entry.def.list.ops.heldPages(entry).length, 1),
            (page, cursor) => {
              // oxlint-disable-next-line eslint/no-use-before-define -- the fetch callback reads the forked fiber below; the callback runs after the fork, after module init.
              if (shared.fiber === fiber) {
                emitFetch(entry, "get", false, false, { cursor, page });
              }
            }
          );
    const fiber = runFork(
      Effect.andThen(
        previous.length === 0
          ? Effect.yieldNow
          : Effect.uninterruptible(Fiber.awaitAll(previous)),
        body
      )
    );
    shared.fiber = fiber;
    fetchFibers.add(fiber);
    build.fibers.add(fiber);
    fiber.addObserver((exit) => {
      fetchFibers.delete(fiber);
      build.fibers.delete(fiber);
      if (shared.fiber === fiber && !disposed) {
        // oxlint-disable-next-line eslint/no-use-before-define -- shared-fetch helpers invoke each other while a fetch runs, after module init.
        endShared(shared, exit);
      }
    });
  };
  /** Hands the exit to the callers. Nothing is stored and the entry doesn't change. */
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  const endShared = (shared: Shared, exit: Exit.Exit<any, any>): void => {
    sharedFetches.delete(shared);
    if (shared.entry.shared === shared) {
      shared.entry.shared = undefined;
    }
    const { fiber } = shared;
    shared.fiber = undefined;
    if (exit._tag === "Failure" && fiber !== undefined) {
      fiber.interruptUnsafe();
    }
    resumeAll(shared.callers, callerExit(exit));
  };
  const startShared = (
    entry: Entry,
    build: Build,
    callers: Iterable<Waiter>,
    restart: boolean
  ): Shared => {
    const shared: Shared = {
      build,
      callers: new Set(),
      entry,
      fiber: undefined,
    };
    for (const caller of callers) {
      caller.shared = shared;
      shared.callers.add(caller);
    }
    entry.shared = shared;
    sharedFetches.add(shared);
    runShared(shared, restart);
    return shared;
  };
  /** A caller leaves: the fetch lives while it has callers. */
  const leave = (entry: Entry, waiter: Waiter): void => {
    const { shared } = waiter;
    if (shared === undefined) {
      entry.waiters.delete(waiter);
    } else if (shared.callers.delete(waiter) && shared.callers.size === 0) {
      endShared(shared, Exit.interrupt());
    }
    afterQuiet(entry);
  };

  // Hold bookkeeping, ahead of `watch`, which reads it while registering.
  let holds = 0;
  // Raised when a hold begins with none open. A watcher at this generation or later registered during it.
  let generation = 0;
  // Each entry a watcher registered on during the hold.
  const held = new Set<Entry>();
  // -- watch, peek, get, prefetch ---------------------------------------------
  const watch: CacheInternals["watch"] = (
    def,
    args,
    fetcher,
    onChange,
    onDefect,
    watchOptions
  ) => {
    const entry = ensureEntry(register(def), args);
    const build = buildOf(fetcher);
    const first = entry.watchers.size === 0;
    const windowed = inWindow(entry);
    if (holds > 0) {
      // Decided at release. The window is read now, as the decision would have been.
      held.add(entry);
    } else if (first && isStale(entry) && !windowed) {
      // Only the zero-to-one transition is a fetch trigger: a joining watcher never refetches. Inside the
      // fetch-free window a hydrated entry isn't fetched.
      ensureFetch(entry, "watch", build);
    }
    const patched = watchOptions?.patched === true;
    // A bare Failure that the last watcher leaving would drop is withheld until release, which drops it if no
    // watcher that has seen it survives, so the order of releases and registrations never shows it.
    const provisional =
      holds > 0 && isBareFailure(entry.result) && !settleOnce && !windowed
        ? entry.result
        : undefined;
    const withheld = (): boolean =>
      // oxlint-disable-next-line eslint/no-use-before-define -- the hold helper reads the watcher below while entries run, after module init.
      watcher.provisional !== undefined && watcher.provisional === entry.result;
    // What it would read had the Failure already been dropped.
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    const provisionalView = (): AsyncResult.AsyncResult<any, any> =>
      AsyncResult.initial(entry.fetch !== undefined);
    const current =
      // oxlint-disable-next-line eslint/no-nested-ternary -- the current value mirrors the hold state; flattening would split the single view construction.
      provisional === undefined
        ? patched
          ? patchedViewOf(entry, view(entry))
          : { patched: false, result: view(entry) }
        : { patched: false, result: provisionalView() };
    const watcher: Watcher = {
      active: true,
      build,
      generation: holds > 0 ? generation : -1,
      last: current.result,
      lastMore: moreOf(entry),
      lastPatched: current.patched,
      onChange,
      onDefect,
      patched,
      provisional,
      windowed,
    };
    entry.watchers.add(watcher);
    cancelIdle(entry);
    if (first && holds === 0) {
      scheduleInterval(entry);
    }
    return {
      current: () => (withheld() ? provisionalView() : view(entry)),
      logKey: () => logKeyOf(entry),
      more: () => moreOf(entry),
      patchedView: () =>
        withheld()
          ? { patched: false, result: provisionalView() }
          : patchedViewOf(entry, view(entry)),
      unregister: (abandon) => {
        if (!watcher.active) {
          return;
        }
        watcher.active = false;
        entry.watchers.delete(watcher);
        if (entry.watchers.size > 0) {
          return;
        }
        stopInterval(entry);
        entry.moreError = undefined;
        if (isBareFailure(entry.result) && !settleOnce && !inWindow(entry)) {
          entry.result = undefined;
        }
        const { fetch } = entry;
        if (
          abandon === true &&
          fetch !== undefined &&
          fetch.trigger === "watch" &&
          !entry.kept &&
          entry.waiters.size === 0 &&
          entry.moreWaiters.size === 0
        ) {
          // Nothing else asked for it: a `get` waits, and a prefetch is kept.
          dropFetch(entry, fetch);
          return revert(entry);
        }
        afterQuiet(entry);
      },
    };
  };

  // -- hold -------------------------------------------------------------------
  const hold: CacheInternals["hold"] = () => {
    const first = holds === 0;
    holds += 1;
    if (first) {
      generation += 1;
    }
    const since = generation;
    let released = false;
    // oxlint-disable-next-line eslint/complexity -- the release path settles held entries in one pass; splitting it would scatter the release flow.
    return () => {
      if (released) {
        return;
      }
      released = true;
      if (holds > 1) {
        holds -= 1;
        return;
      }
      // Still held while deciding: a fetch started here can reach a watcher whose handler registers another,
      // which is decided in the next round, as part of this hold.
      while (held.size > 0) {
        const entries = [...held];
        held.clear();
        for (const entry of entries) {
          if (entry.removed || entry.watchers.size === 0) {
            continue;
          }
          let build: Build | undefined;
          let fresh = true;
          // Only the watchers that survive count: one that registered inside the window and left is gone.
          let windowed = false;
          let withheld = false;
          let seen = false;
          for (const watcher of entry.watchers) {
            if (watcher.generation < since) {
              fresh = false;
            } else if (watcher.windowed) {
              windowed = true;
            }
            if (
              watcher.provisional !== undefined &&
              watcher.provisional === entry.result
            ) {
              withheld = true;
            } else {
              seen = true;
            }
            watcher.provisional = undefined;
            if (build === undefined && !watcher.build.closed) {
              ({ build } = watcher);
            }
          }
          if (withheld && !seen) {
            // No watcher that has seen the Failure survived: it goes, as when the last watcher leaves first.
            entry.result = undefined;
            for (const watcher of entry.watchers) {
              watcher.last = AsyncResult.initial();
              watcher.lastPatched = false;
            }
          }
          if (fresh) {
            if (!windowed && build !== undefined && isStale(entry)) {
              ensureFetch(entry, "watch", build);
            }
            scheduleInterval(entry);
          }
          // Otherwise the withheld Failure is delivered, to the watchers that haven't seen it.
          if (withheld && seen) {
            emit(entry);
          }
        }
      }
      holds -= 1;
    };
  };

  const peek: CacheInternals["peek"] = (def, args) => {
    const registered = register(def);
    const entry = lookup(registered, registered.argsKey(args));
    return entry === undefined ? AsyncResult.initial() : view(entry);
  };

  /** Waits for a caller-only fetch, joining the one in flight. */
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  const getShared = (entry: Entry, build: Build): Effect.Effect<any, any> =>
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    Effect.callback<any, any>((resume) => {
      const waiter: Waiter = { build, resume, shared: undefined };
      if (entry.shared === undefined) {
        startShared(entry, build, [waiter], false);
      } else {
        waiter.shared = entry.shared;
        entry.shared.callers.add(waiter);
      }
      return Effect.sync(() => leave(entry, waiter));
    });

  /** Waits for the stored fetch, starting one when none is in flight. */
  // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
  const getStored = (entry: Entry, build: Build): Effect.Effect<any, any> =>
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    Effect.callback<any, any>((resume) => {
      const waiter: Waiter = { build, resume, shared: undefined };
      entry.waiters.add(waiter);
      cancelIdle(entry);
      // During a list's append, the walk it waits for is owed.
      if (entry.fetch?.append) {
        entry.owed ??= "get";
      }
      ensureFetch(entry, "get", build);
      return Effect.sync(() => leave(entry, waiter));
    });

  // The order of checks: own target, hydration window, live patch, staleness.
  const get: CacheInternals["get"] = (def, args, fetcher, run) =>
    // oxlint-disable-next-line typescript/no-explicit-any -- entries hold heterogeneous queries, so effects, causes and results erase to any inside the cache; values re-enter typed code through each query's Schema at the subscription boundary.
    Effect.suspend((): Effect.Effect<any, any> => {
      if (disposed) {
        return Effect.interrupt;
      }
      const registered = register(def);
      const argsKey = registered.argsKey(args);
      // A started run reading back an entry it invalidates calls the fetcher itself: never from the store, never
      // joined and never stored.
      if (
        run !== undefined &&
        run.isStarted() &&
        run.invalidates(registered, argsKey)
      ) {
        const existing = lookup(registered, argsKey);
        const logKey = () => registered.logKey(args, argsKey);
        const event = (page: PageRef | undefined): void => {
          if (existing !== undefined) {
            return emitFetch(existing, "get", false, false, page);
          }
          if (fetchListeners.size === 0) {
            return;
          }
          notify<FetchEvent>(fetchListeners, {
            inWindow: false,
            logKey: logKey(),
            query: registered.name,
            restart: false,
            stored: false,
            trigger: "get",
            ...pageFields(page),
          });
        };
        if (existing !== undefined) {
          resetIdle(existing);
        }
        if (registered.list === undefined) {
          // oxlint-disable-next-line unicorn/no-useless-undefined -- the payload parameter is required; undefined means no payload.
          event(undefined);
          return buildOf(fetcher).fetcher(args);
        }
        event({ cursor: undefined, page: 0 });
        const count =
          existing === undefined
            ? 1
            : Math.max(registered.list.ops.heldPages(existing).length, 1);
        return registered.list.ops.callerWalk(
          listEnv(),
          registered,
          args,
          logKey,
          buildOf(fetcher),
          count,
          (page, cursor) => event({ cursor, page })
        );
      }
      const entry = ensureEntry(registered, args, argsKey);
      const { result } = entry;
      if (result !== undefined && (inWindow(entry) || settleOnce)) {
        resetIdle(entry);
        return settledEffect(result);
      }
      const build = buildOf(fetcher);
      if (hasLive(entry)) {
        resetIdle(entry);
        // A live patch only registers over a Success, and no stored fetch runs under it.
        if (
          result !== undefined &&
          result._tag === "Success" &&
          !isStale(entry)
        ) {
          return Effect.succeed(result.value);
        }
        return getShared(entry, build);
      }
      if (
        result !== undefined &&
        result._tag === "Success" &&
        !isStale(entry)
      ) {
        resetIdle(entry);
        return Effect.succeed(result.value);
      }
      return getStored(entry, build);
    });

  const prefetch: CacheInternals["prefetch"] = (def, args, fetcher) => {
    if (disposed) {
      return;
    }
    const entry = ensureEntry(register(def), args);
    // Nothing under a live patch.
    if (hasLive(entry)) {
      return;
    }
    // A list that holds pages, stale ones included, isn't loaded again.
    if (
      inWindow(entry) ||
      !isStale(entry) ||
      (entry.def.list !== undefined &&
        entry.def.list.ops.heldPages(entry).length > 0)
    ) {
      return resetIdle(entry);
    }
    if (entry.fetch !== undefined) {
      entry.kept = true;
    }
    ensureFetch(entry, "prefetch", buildOf(fetcher));
    afterQuiet(entry);
  };

  const loadMore: CacheInternals["loadMore"] = (def, args, fetcher, resume) =>
    def.list === undefined
      ? constVoid
      : def.list.ops.loadMore(listEnv(), def, args, fetcher, resume);

  const reset: CacheInternals["reset"] = (def, args) => {
    def.list?.ops.reset(listEnv(), def, args);
  };

  // -- invalidation -----------------------------------------------------------
  /** Naming a query registers it, so its hydrated entries are decoded and matched exactly. */
  const registerTargets = (targets: readonly Target[]): void => {
    for (const target of targets) {
      if (isQuery(target)) {
        register(defOf(target));
      } else if (target._tag === "Entry") {
        register(defOf(target.query));
      }
    }
  };
  /** Target resolution, written over the predicate: every entry it hits. A tag drops every raw entry. */
  const resolve = (targets: Targets): Set<Entry> => {
    const out = new Set<Entry>();
    for (const entry of allEntries()) {
      if (targetsHit(targets, entry.def.name, entry.def.tags, entry.argsKey)) {
        out.add(entry);
      }
    }
    if (targets.tags.size > 0) {
      raw.clear();
    }
    return out;
  };
  const invalidateEntry = (
    entry: Entry,
    cause: Trigger = "invalidation"
  ): void => {
    seq += 1;
    entry.touched = seq;
    // A never-fetched entry is a no-op.
    if (entry.result === undefined && entry.fetch === undefined) {
      return;
    }
    if (entry.result !== undefined) {
      entry.invalidated = true;
    }
    // Under a live patch the refetch waits for the last live owner.
    if (hasLive(entry)) {
      entry.deferred ??= cause;
      return;
    }
    // A refetch held back by a patch keeps the trigger it was held with.
    const trigger = entry.deferred ?? cause;
    entry.deferred = undefined;
    // In flight: interrupted and restarted, watched or not.
    if (entry.fetch !== undefined) {
      return replaceFetch(entry, entry.fetch);
    }
    if (entry.watchers.size > 0) {
      const build = survivingBuild(entry);
      if (build !== undefined) {
        ensureFetch(entry, trigger, build);
      }
    }
  };
  const invalidate: CacheInternals["invalidate"] = (
    targets,
    invalidateOptions
  ) => {
    if (disposed) {
      return;
    }
    registerTargets(targets);
    if (settleOnce) {
      if (invalidateOptions?.byHand === true) {
        const named = targets.find(
          (target) => isQuery(target) || target._tag === "Entry"
        );
        let query: string | undefined;
        if (named !== undefined) {
          // SAFETY: invalidations name queries or EntryTargets; the branch selects the EntryTarget form.
          query = isQuery(named)
            ? defOf(named).name
            : defOf((named as EntryTarget).query).name;
        }
        report(
          new InvalidateIgnored({
            message: `[Query] invalidate${
              query === undefined ? "" : ` of ${quote(query)}`
            } was called on a per-request server cache, where it does nothing.`,
            query,
          })
        );
      }
      return;
    }
    for (const entry of resolve(compileTargets(targets))) {
      invalidateEntry(entry);
    }
  };

  // -- runs, patches and writes -----------------------------------------------
  /** The check made when a run's patches stop being live on an entry: a refetch that was held back. */
  const settleRunEntry = (entry: Entry): void => {
    if (entry.removed) {
      return;
    }
    if (!hasLive(entry)) {
      // A caller-only fetch in flight finishes for its callers. Later `get`s don't join it.
      entry.shared = undefined;
      const { deferred } = entry;
      entry.deferred = undefined;
      if (entry.fetch === undefined && entry.watchers.size > 0) {
        if (isStale(entry) || (intervalElapsed(entry) && !paused())) {
          const build = survivingBuild(entry);
          if (build !== undefined) {
            ensureFetch(entry, deferred ?? "invalidation", build);
          }
        } else if (
          entry.intervalDue !== undefined &&
          entry.intervalCancel === undefined &&
          !paused()
        ) {
          armInterval(entry);
        }
      }
      if (entry.def.list !== undefined && entry.fetch === undefined) {
        entry.def.list.ops.heldLoadMore(
          listEnv(),
          entry,
          deferred ?? "loadMore"
        );
      }
      // A dropped walk nothing restarted isn't owed a restart by a later fetch, and a prefetch's claim is spent.
      if (entry.fetch === undefined) {
        entry.heldRestart = false;
        entry.kept = false;
      }
    }
    emit(entry);
    afterQuiet(entry);
  };
  /** `Equal.equals`, true when it throws: a check that only reports never fails a run. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, unicorn/consistent-function-scoping -- cache equality takes schema-erased values; the query's Schemas state the contract; the helper is scoped to the cache build.
  const equalsOrTrue = (a: unknown, b: unknown): boolean => {
    try {
      return Equal.equals(a, b);
    } catch {
      return true;
    }
  };
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the success check takes the schema-erased value; the success Schema states the contract.
  const isValidSuccess = (entry: Entry, value: unknown): boolean => {
    try {
      return entry.def.codec().isSuccess(value);
    } catch {
      return true;
    }
  };
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the store helper takes the schema-erased value; the success Schema states the contract.
  const storeWrite = (entry: Entry, value: unknown, fresh: boolean): void => {
    const { fetch } = entry;
    store(entry, AsyncResult.success(value, { timestamp: now() }));
    if (!fresh) {
      entry.invalidated = true;
    }
    // A fetch that began before the write would overwrite it with older data.
    if (fetch !== undefined) {
      replaceFetch(entry, fetch);
    }
    if (entry.idle !== undefined) {
      startIdle(entry);
    }
    emit(entry);
    afterQuiet(entry);
  };
  /** Returns the entries stored fresh, and adds those whose write was skipped to `skipped`. */
  const applyWrites = (
    run: Run,
    writes: readonly Write[],
    skipped: Set<Entry>
  ): Set<Entry> => {
    const fresh = new Set<Entry>();
    for (const set of writes) {
      const def = register(defOf(set.query));
      const argsKey = argsKeyOf(set);
      const existing = lookup(def, argsKey);
      if (
        existing !== undefined &&
        existing.born <= run.startSeq &&
        !targetsHit(run.targets, def.name, def.tags, argsKey)
      ) {
        const logKey = logKeyOf(existing);
        report(
          new UncoveredWrite({
            command: run.command,
            logKey,
            message: `[Query] ${quote(run.command)} wrote ${quote(
              def.name
            )} at ${
              logKey
            }, which neither its invalidates nor a patch covers. The write applies.`,
            query: def.name,
          })
        );
      }
      const entry = existing ?? ensureEntry(def, set.args, argsKey);
      // A run issued later has already reached the entry: this answer may be the older one, so it isn't stored,
      // and the entry is invalidated.
      if (entry.reached > run.issue) {
        skipped.add(entry);
        continue;
      }
      entry.reached = run.issue;
      if (entry.patches.some((patch) => patch.live && patch.run !== run)) {
        // Under another run's live patch it isn't stored, and the entry goes stale.
        seq += 1;
        entry.touched = seq;
        if (entry.result !== undefined) {
          entry.invalidated = true;
        }
        entry.deferred ??= "invalidation";
        continue;
      }
      const isFresh = entry.touched <= run.startSeq;
      seq += 1;
      entry.touched = seq;
      storeWrite(entry, set.value, isFresh);
      if (isFresh) {
        fresh.add(entry);
      }
    }
    return fresh;
  };
  // oxlint-disable-next-line eslint/complexity -- beginRun plans, stores and settles a run in one pass; splitting it would scatter the run flow.
  const beginRun: CacheInternals["beginRun"] = (runOptions) => {
    const optimistic = runOptions.optimistic ?? [];
    registerTargets(runOptions.invalidates);
    const targets = compileTargets(runOptions.invalidates, optimistic);
    // A patch over an entry with no Success isn't registered, silently.
    const planned: { readonly entry: Entry; readonly patch: Patch }[] = [];
    for (const patch of optimistic) {
      const def = register(defOf(patch.query));
      if (patch._tag === "Patch") {
        const entry = lookup(def, argsKeyOf(patch));
        if (entry !== undefined && entry.result?._tag === "Success") {
          planned.push({ entry, patch });
        }
      } else {
        for (const entry of index.get(def.name)?.values() ?? []) {
          if (entry.result?._tag === "Success") {
            planned.push({ entry, patch });
          }
        }
      }
    }
    // First application is all-or-nothing: a throw here leaves nothing registered.
    const values = new Map<Entry, unknown>();
    const before = new Map<Entry, { readonly encoded: unknown } | undefined>();
    const invalid = new Set<Entry>();
    for (const { entry, patch } of planned) {
      if (!values.has(entry)) {
        // SAFETY: planned entries carry a Success result; both plan branches select Success results only.
        const server = (entry.result as AsyncResult.Success<unknown, unknown>)
          .value;
        // Materialized: an encoding can share parts with the value, such as under `Schema.Any`.
        before.set(
          entry,
          materializedEncoding(() => entry.def.codec().encodeSuccess(server))
        );
        // SAFETY: planned entries carry a Success result; both plan branches select Success results only.
        // oxlint-disable-next-line typescript/no-non-null-assertion -- planned entries carry a Success result; the planner selects it.
        const currentResult = entry.result!;
        // SAFETY: planned entries carry a Success result; both plan branches select Success results only.
        const patched = patchedViewOf(entry, currentResult) as {
          readonly result: AsyncResult.Success<unknown, unknown>;
        };
        values.set(entry, patched.result.value);
      }
      const next = applyPatch(
        patch,
        entry.def.name,
        entry.argsKey,
        entry.args,
        values.get(entry)
      );
      values.set(entry, next);
      if (!isValidSuccess(entry, next)) {
        invalid.add(entry);
      }
    }
    const run: Run = {
      command: runOptions.command,
      done: false,
      entries: new Set(),
      issue: (issued += 1),
      startSeq: seq,
      started: false,
      targets,
    };
    for (const { entry, patch } of planned) {
      entry.patches.push({ live: true, patch, run });
      run.entries.add(entry);
    }
    for (const entry of run.entries) {
      const logKey = logKeyOf(entry);
      if (invalid.has(entry)) {
        report(
          new PatchInvalid({
            command: run.command,
            logKey,
            message: `[Query] a patch of ${quote(run.command)} on ${quote(
              entry.def.name
            )} at ${
              logKey
            } made a value the query's success Schema rejects. It is used as is.`,
            query: entry.def.name,
          })
        );
      }
      const encoded = before.get(entry);
      if (encoded !== undefined && entry.result?._tag === "Success") {
        const { value } = entry.result;
        const after = materializedEncoding(() =>
          entry.def.codec().encodeSuccess(value)
        );
        if (
          after !== undefined &&
          !equalsOrTrue(encoded.encoded, after.encoded)
        ) {
          report(
            new PatchMutated({
              command: run.command,
              logKey,
              message: `[Query] a patch of ${quote(run.command)} on ${quote(
                entry.def.name
              )} at ${
                logKey
              } changed the value it was given. A patch must return a new value.`,
              query: entry.def.name,
            })
          );
        }
      }
      // No stored fetch runs on an entry with a live patch. `get` callers waiting on it get a caller-only fetch.
      const { fetch } = entry;
      if (fetch !== undefined) {
        dropFetch(entry, fetch);
        entry.deferred ??= fetch.trigger;
        // A patch restarts a list's walk from the first page, once nothing holds it. A dropped append is a held
        // load more, not a restart.
        if (entry.def.list !== undefined && !fetch.append) {
          countRestart(entry);
          entry.heldRestart = true;
        }
        if (entry.waiters.size > 0) {
          const waiters = [...entry.waiters];
          entry.waiters.clear();
          const build = waiters.find((waiter) => !waiter.build.closed)?.build;
          if (build === undefined) {
            for (const waiter of waiters) {
              waiter.resume(Exit.interrupt());
            }
          } else {
            startShared(entry, build, waiters, true);
          }
        }
      }
      cancelIdle(entry);
      emit(entry);
    }
    let awaited: Await | undefined;
    let awaitedEntries: readonly AwaitedEntry[] | undefined;
    let appliedAt: number | undefined;
    const entryRef = (entry: Entry): AwaitedEntry => ({
      logKey: logKeyOf(entry),
      query: entry.def.name,
    });
    const handle: RunHandle = {
      awaited: () => awaitedEntries,
      command: run.command,
      // oxlint-disable-next-line eslint/complexity -- finish settles every awaited entry in one pass; splitting it would scatter the settle flow.
      finish: (exit) => {
        if (run.done) {
          return;
        }
        run.done = true;
        // A run may outlive the cache.
        if (disposed) {
          return;
        }
        if (exit._tag === "Success") {
          for (const entry of run.entries) {
            for (const patch of entry.patches) {
              if (patch.run === run) {
                patch.live = false;
              }
            }
          }
          const skipped = new Set<Entry>();
          const fresh = applyWrites(run, exit.writes, skipped);
          const invalidated: Entry[] = [];
          if (!settleOnce) {
            const hit = resolve(targets);
            for (const entry of skipped) {
              hit.add(entry);
            }
            for (const entry of hit) {
              // Only a write stored fresh is left out of its run's own invalidation.
              if (fresh.has(entry)) {
                continue;
              }
              if (run.issue > entry.reached) {
                entry.reached = run.issue;
              }
              invalidateEntry(entry);
              invalidated.push(entry);
            }
          }
          if (runOptions.afterRefetch === true) {
            // Fixed now: a watcher that comes later doesn't join, and an unwatched refetch isn't awaited.
            for (const entry of run.entries) {
              settleRunEntry(entry);
            }
            const entries = new Set(
              invalidated.filter(
                (entry) => entry.watchers.size > 0 && owesRefetch(entry)
              )
            );
            awaitedEntries = Array.from(entries, entryRef);
            appliedAt = now();
            if (entries.size > 0) {
              awaits.add((awaited = { entries, listener: undefined }));
            }
            return;
          }
        } else {
          for (const entry of run.entries) {
            entry.patches = entry.patches.filter((patch) => patch.run !== run);
          }
          if (exit._tag === "Failure" && !settleOnce) {
            // A failed run may still have landed its server write, so an older answer is no longer the latest.
            for (const entry of resolve(targets)) {
              if (run.issue > entry.reached) {
                entry.reached = run.issue;
              }
              invalidateEntry(entry);
            }
          }
        }
        for (const entry of run.entries) {
          settleRunEntry(entry);
        }
      },
      invalidates: (def, argsKey) =>
        targetsHit(targets, def.name, def.tags, argsKey),
      isStarted: () => run.started && !run.done,
      onRefetched: (f) => {
        const rec = awaited;
        if (rec === undefined || !awaits.has(rec)) {
          return constVoid;
        }
        rec.listener = f;
        return () => {
          if (rec.listener === f) {
            rec.listener = undefined;
          }
        };
      },
      outstanding: () =>
        awaited === undefined ? [] : Array.from(awaited.entries, entryRef),
      run: (body, writes) => runBody(handle, body, writes),
      sinceApplied: () => (appliedAt === undefined ? 0 : now() - appliedAt),
      start: () => {
        if (run.started || run.done) {
          return;
        }
        run.started = true;
        run.startSeq = seq;
      },
    };
    return handle;
  };

  // -- hydration --------------------------------------------------------------
  /** Decodes the raw hydrated entries of a query that just registered. */
  const decodeRaw = (def: QueryDef): void => {
    const byKey = raw.get(def.name);
    if (byKey === undefined) {
      return;
    }
    raw.delete(def.name);
    for (const [wireKey, tuple] of byKey) {
      let args: unknown;
      let argsKey: string;
      try {
        args = def.codec().decodeArgs(wireKey);
        argsKey = def.argsKey(args);
      } catch {
        report(
          new HydrationDecodeFailed({
            logKey: undefined,
            message: `[Query] the args of a hydrated entry of ${quote(
              def.name
            )} failed to decode. The entry is cold.`,
            part: "args",
            query: def.name,
          })
        );
        continue;
      }
      const existing = lookup(def, argsKey);
      if (existing?.result !== undefined) {
        continue;
      }
      let result: Settled;
      try {
        const codec = def.codec();
        result =
          tuple[1] === 0
            ? AsyncResult.success(codec.decodeSuccess(tuple[2]), {
                timestamp: tuple[3],
              })
            : AsyncResult.failure(
                Cause.fromReasons(
                  tuple[2].map((error) =>
                    Cause.makeFailReason(codec.decodeError(error))
                  )
                )
              );
      } catch {
        const logKey = def.logKey(args, argsKey);
        report(
          new HydrationDecodeFailed({
            logKey,
            message: `[Query] a hydrated entry of ${quote(def.name)} at ${
              logKey
            } failed to decode. The entry is cold.`,
            part: "value",
            query: def.name,
          })
        );
        continue;
      }
      const entry = existing ?? ensureEntry(def, args, argsKey);
      entry.result = result;
      // It ages from the client's mount. Under `static` its age is unknown: stale unless never stale by age.
      entry.settledAt = hydratedAt;
      entry.invalidated = hydratedStatic && def.staleMs !== Infinity;
      entry.hydrated = windowOpen;
      afterQuiet(entry);
    }
  };
  const hydrate: CacheInternals["hydrate"] = (input, hydrateOptions) => {
    if (disposed) {
      return;
    }
    const parsed = parseRaw(input);
    if (parsed === undefined) {
      report(
        new HydrationMalformed({
          message:
            "[Query] the ~query state isn't the tuple shape. It was ignored.",
        })
      );
      return;
    }
    hydratedAt = hydrateOptions?.at ?? now();
    hydratedStatic = hydrateOptions?.static === true;
    windowOpen = !hydratedStatic;
    raw = parsed;
    // Reads the cache has already seen decode at once.
    // oxlint-disable-next-line unicorn/no-useless-spread -- decoding unregisters the query's raw entries; iterate over a snapshot.
    for (const name of [...raw.keys()]) {
      const def = queries.get(name);
      if (def !== undefined) {
        decodeRaw(def);
      }
    }
  };
  const closeWindow = (): void => {
    if (!windowOpen) {
      return;
    }
    windowOpen = false;
    for (const [name, byKey] of raw) {
      for (const [argsKey, tuple] of byKey) {
        if (tuple[1] === 1) {
          byKey.delete(argsKey);
        }
      }
      if (byKey.size === 0) {
        raw.delete(name);
      }
    }
    for (const entry of allEntries()) {
      if (!entry.hydrated) {
        continue;
      }
      entry.hydrated = false;
      if (entry.watchers.size === 0 && isBareFailure(entry.result)) {
        entry.result = undefined;
        afterQuiet(entry);
      }
      if (
        entry.def.list !== undefined &&
        entry.fetch === undefined &&
        !hasLive(entry)
      ) {
        entry.def.list.ops.heldLoadMore(listEnv(), entry, "loadMore");
      }
    }
  };
  const dehydrate: CacheInternals["dehydrate"] = () => {
    const out: Dehydrated = {};
    for (const entry of allEntries()) {
      if (entry.fetch !== undefined) {
        dropFetch(entry, entry.fetch);
      }
      resumeAll(entry.waiters, Exit.interrupt());
      resumeAll(entry.moreWaiters, Exit.interrupt());
      entry.target = undefined;
      if (entry.shared !== undefined) {
        endShared(entry.shared, Exit.interrupt());
      }
      const { result } = entry;
      if (
        result === undefined ||
        holdsRedacted(entry.def.args.ast) ||
        holdsRedacted(entry.def.success.ast) ||
        holdsRedacted(entry.def.error.ast)
      ) {
        afterQuiet(entry);
        continue;
      }
      try {
        const codec = entry.def.codec();
        const tuple: RawTuple =
          result._tag === "Success"
            ? [
                entry.argsKey,
                0,
                codec.encodeSuccess(result.value),
                result.timestamp,
              ]
            : [
                entry.argsKey,
                1,
                result.cause.reasons
                  .filter(Cause.isFailReason)
                  .map((reason) => codec.encodeError(reason.error)),
                entry.settledAt,
              ];
        (out[entry.def.name] ??= []).push(tuple);
      } catch {
        const logKey = logKeyOf(entry);
        report(
          new EncodeFailed({
            logKey,
            message: `[Query] the entry of ${quote(entry.def.name)} at ${
              logKey
            } failed to encode. It was left out, and the client fetches it.`,
            query: entry.def.name,
          })
        );
      }
    }
    return out;
  };
  const checkWire: CacheInternals["checkWire"] = (input) => {
    const parsed = parseRaw(input);
    if (parsed === undefined) {
      return ["the ~query state isn't the tuple shape"];
    }
    const out: string[] = [];
    for (const [name, byKey] of parsed) {
      const def = queries.get(name);
      if (def === undefined) {
        out.push(
          `the query ${quote(
            name
          )} shipped entries, and this cache doesn't know it`
        );
        continue;
      }
      const codec = def.codec();
      for (const [wireKey, tuple] of byKey) {
        let args: unknown;
        let logKey: string;
        try {
          args = codec.decodeArgs(wireKey);
          const argsKey = def.argsKey(args);
          logKey = def.logKey(args, argsKey);
          if (argsKey !== wireKey) {
            out.push(
              `an entry of ${quote(name)} at ${
                logKey
              } has args that key differently once decoded`
            );
            continue;
          }
        } catch {
          out.push(`the args of an entry of ${quote(name)} failed to decode`);
          continue;
        }
        try {
          const again =
            tuple[1] === 0
              ? codec.encodeSuccess(codec.decodeSuccess(tuple[2]))
              : tuple[2].map((error) =>
                  codec.encodeError(codec.decodeError(error))
                );
          if (JSON.stringify(again) !== JSON.stringify(tuple[2])) {
            out.push(
              `the entry of ${quote(name)} at ${
                logKey
              } encodes differently once decoded`
            );
          }
        } catch {
          out.push(
            `the entry of ${quote(name)} at ${
              logKey
            } failed to decode or encode again`
          );
        }
      }
    }
    return out;
  };
  const seed: CacheInternals["seed"] = (snapshot) => {
    const data = snapshotData(snapshot);
    // A per-request cache never refetches a settled entry, so a seed there would be final.
    if (disposed || settleOnce || data === undefined) {
      return false;
    }
    // Never from a value that may never have been saved.
    if (
      data.patched ||
      data.argsKey === undefined ||
      data.result?._tag !== "Success"
    ) {
      return false;
    }
    const def = register(data.def);
    const existing = lookup(def, data.argsKey);
    if (existing?.result !== undefined) {
      return false;
    }
    const entry = existing ?? ensureEntry(def, data.args, data.argsKey);
    entry.result = AsyncResult.success(data.result.value, {
      timestamp: data.result.timestamp,
    });
    entry.settledAt = now();
    entry.invalidated = true;
    afterQuiet(entry);
    return true;
  };

  // -- host signals -----------------------------------------------------------
  /** One synchronous pass over watched entries, on a false-to-true edge with both signals then true. */
  const edgePass = (trigger: "visibility" | "connectivity"): void => {
    for (const entry of allEntries()) {
      if (entry.watchers.size === 0) {
        continue;
      }
      if (entry.fetch !== undefined) {
        if (entry.fetch.append && (isStale(entry) || intervalElapsed(entry))) {
          entry.owed ??= trigger;
        }
        continue;
      }
      if (isStale(entry) || intervalElapsed(entry)) {
        const build = survivingBuild(entry);
        if (build !== undefined) {
          ensureFetch(entry, trigger, build);
        }
      } else if (
        entry.intervalDue !== undefined &&
        entry.intervalCancel === undefined
      ) {
        // Not due yet: it sleeps for the remainder.
        armInterval(entry);
      }
    }
  };
  const listen = (
    signal: Signal,
    trigger: "visibility" | "connectivity"
  ): (() => void) => {
    let last = signal.get();
    return signal.subscribe((value) => {
      const was = last;
      last = value;
      if (disposed || settleOnce || was || !value || paused()) {
        return;
      }
      edgePass(trigger);
    });
  };
  const offVisibility = listen(visibility, "visibility");
  const offConnectivity = listen(connectivity, "connectivity");

  // -- the service ------------------------------------------------------------
  // oxlint-disable-next-line eslint/sort-keys -- self lists the cache operations in lifecycle order; key order carries no meaning.
  const self: CacheInternals = {
    [CacheTypeId]: CacheTypeId,
    register: (def) => {
      register(def);
    },
    watch,
    hold,
    peek,
    get,
    prefetch,
    loadMore,
    reset,
    invalidate,
    beginRun,
    dehydrate,
    hydrate,
    closeWindow,
    isWindowOpen: () => windowOpen,
    seed,
    onFetch: (listener) => addListener(fetchListeners, listener),
    onFetchEnd: (listener) => addListener(fetchEndListeners, listener),
    misses: () => {
      const out: { readonly query: string; readonly logKey: string }[] = [];
      for (const entry of allEntries()) {
        if (entry.result !== undefined) {
          continue;
        }
        const missed =
          entry.fetch !== undefined ||
          (!fetches && (entry.watchers.size > 0 || entry.waiters.size > 0));
        if (missed) {
          out.push({ logKey: logKeyOf(entry), query: entry.def.name });
        }
      }
      return out;
    },
    checkWire,
    pending: () => {
      const out: PendingFetch[] = [];
      for (const entry of allEntries()) {
        const trigger = entry.fetch?.trigger ?? entry.deferred;
        if (trigger === undefined) {
          continue;
        }
        out.push({
          logKey: logKeyOf(entry),
          query: entry.def.name,
          status: entry.fetch === undefined ? "held" : "running",
          trigger,
        });
      }
      return out;
    },
    inspect: (def, args) => {
      const registered = register(def);
      const entry = lookup(registered, registered.argsKey(args));
      if (entry === undefined) {
        return;
      }
      const stored = view(entry);
      const patched = patchedViewOf(entry, stored);
      let fetchState: "held" | "none" | "running";
      if (entry.fetch !== undefined) {
        fetchState = "running";
      } else if (entry.deferred === undefined) {
        fetchState = "none";
      } else {
        fetchState = "held";
      }
      return {
        fetch: fetchState,
        patched: patched.patched,
        patches: {
          held: entry.patches.filter((patch) => !patch.live).length,
          live: entry.patches.filter((patch) => patch.live).length,
        },
        stale: isStale(entry),
        stored,
        trigger: entry.fetch?.trigger ?? entry.deferred,
        view: patched.result,
        watchers: entry.watchers.size,
        ...(entry.def.list === undefined ? undefined : { more: moreOf(entry) }),
      };
    },
  };

  const dispose = Effect.suspend(() => {
    disposed = true;
    offVisibility();
    offConnectivity();
    for (const build of attached) {
      build.listeners.delete(buildClosed);
    }
    attached.clear();
    for (const entry of allEntries()) {
      if (entry.fetch !== undefined) {
        dropFetch(entry, entry.fetch);
      }
      resumeAll(entry.waiters, Exit.interrupt());
      resumeAll(entry.moreWaiters, Exit.interrupt());
    }
    // oxlint-disable-next-line unicorn/no-useless-spread -- ending a shared fetch unregisters it; iterate over a snapshot.
    for (const shared of [...sharedFetches]) {
      endShared(shared, Exit.interrupt());
    }
    // oxlint-disable-next-line unicorn/no-useless-spread -- interrupting a timer runs its cleanup; iterate over a snapshot.
    for (const fiber of [...timers]) {
      fiber.interruptUnsafe();
    }
    timers.clear();
    // A run's wait outlives no cache: its owner is closing too.
    awaits.clear();
    // Disposal ends when every fetch has finished its cleanup.
    return Fiber.interruptAll(fetchFibers);
  });

  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the annotated pair is the public contract; inference would inline it.
  return { cache: self, dispose };
};

// The runtime reaches the cache half of this module through
// `queryCore.loaded`, so an app without queries doesn't bundle it. The
// component binding (`bind`) and watch sync (`run`) register through
// `queryCore.registerComponentBinding` from `internal/query-run.ts` (imported
// by `internal/kernel.ts` for the side effect); see `internal/query-core.ts`.
queryCore.load({
  buildCache,
  defOf,
  internals,
  makeSnapshot,
  makeSnapshotMap,
  sameMore,
  snapshotData,
  snapshotMapData,
  snapshotMapSchema,
  snapshotSchema,
});
