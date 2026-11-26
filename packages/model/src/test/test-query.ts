/**
 * A test harness for `Query` with controllable host
 * signals, fetch records, read-only entry views, and problem collection.
 * Uses the public cache Layer.
 *
 * Stale times, idle times and intervals use the `Clock`, so
 * `TestClock.adjust` drives them.
 *
 * **Example** (Asserting on what the cache fetched)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer, Schema } from "effect"
 * import { Query } from "@ilha/model"
 * import { TestQuery } from "@ilha/model/test"
 * class GetUser extends Query.Service<GetUser>()("users/GetUser", {
 *   args: { id: Schema.String },
 *   success: Schema.String,
 *   error: Schema.Never,
 *   staleTime: "30 seconds"
 * }) {
 *   static readonly layer = this.toLayer(({ id }) => Effect.succeed(`user-${id}`))
 * }
 *
 * const program = Effect.gen(function*() {
 *   yield* GetUser.get({ id: "1" })
 *   yield* GetUser.get({ id: "1" })
 *   return yield* TestQuery.fetches
 * }).pipe(Effect.provide(Layer.merge(GetUser.layer, TestQuery.layer())))
 *
 * await Effect.runPromise(program) // => [{ query: "users/GetUser", logKey: `{"id":"1"}`, trigger: "get", restart: false, stored: true }]
 * ```
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as AsyncResult from "effect/reactivity/AsyncResult";

import * as Query from "../query.ts";

/**
 * A fetch the cache started: the query's name, the entry's log key, the
 * trigger, whether it replaced an interrupted fetch, and whether its result
 * is stored.
 *
 * **Details**
 *
 * The log key is the entry's key with every `Schema.Redacted` argument
 * redacted. A caller that joins a fetch in flight records nothing.
 *
 * `stored` is false for a fetcher call made for `get` callers alone: a
 * run reading back an entry it invalidates, or a `get` on a stale entry
 * under a live patch. Its trigger is `get`.
 *
 * An infinite query records each page it requests: `page` is its index, from 0,
 * and `cursor` the encoded cursor, absent for the first page.
 *
 * @since 0.1.0
 */
export interface Fetch {
  readonly query: string;
  readonly logKey: string;
  readonly trigger: Query.Trigger;
  readonly restart: boolean;
  readonly stored: boolean;
  readonly page?: number | undefined;
  readonly cursor?: unknown;
}

/**
 * A query-only view of one cache entry.
 *
 * **Details**
 *
 * `stored` is the entry's server state, `Initial` during a first fetch.
 * `view` is that state with every patch applied, and `patched` whether it
 * includes one. `stale` is whether the next trigger would refetch it,
 * `watchers` how many watch it. `fetch` is `held` while a refetch waits for
 * a live patch's run to exit, and `trigger` is what started the fetch in
 * flight, or what the held one will start with. `patches` counts the live
 * patches and those held after their run succeeded. `more`, on a list
 * read only, is whether it holds more pages to load.
 *
 * @since 0.1.0
 */
export interface Entry<A, E> {
  readonly stored: AsyncResult.AsyncResult<A, E>;
  readonly view: AsyncResult.AsyncResult<A, E>;
  readonly patched: boolean;
  readonly stale: boolean;
  readonly watchers: number;
  readonly fetch: "none" | "running" | "held";
  readonly trigger: Query.Trigger | undefined;
  readonly patches: { readonly live: number; readonly held: number };
  readonly more?: Query.More<E> | undefined;
}

/**
 * The defect a `TestQuery` Scope closes with when the cache reported problems
 * the test didn't take with `expectProblem`.
 *
 * @since 0.1.0
 */
export class ProblemsError extends Data.TaggedError("ProblemsError")<{
  readonly problems: readonly Query.Problem.Any[];
}> {
  override get message(): string {
    return `The cache reported ${
      this.problems.length
    } problem(s) the test didn't expect:\n${this.problems
      .map((problem) => `  ${problem._tag}: ${problem.message}`)
      .join("\n")}`;
  }
}

/**
 * The `TestQuery` service: the controls and the records of one test cache.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- the interface is the service type and the const is its Effect Service tag; both spellings are public API.
export interface TestQuery {
  /** Sets `Query.Visibility`. It starts true. */
  readonly setVisible: (visible: boolean) => void;
  /** Sets `Query.Connectivity`. It starts true. */
  readonly setOnline: (online: boolean) => void;
  /** Every fetch started so far, in order. */
  readonly fetches: () => readonly Fetch[];
  /** The entry of a query and arguments, or `undefined` when the cache has none. */
  readonly entry: <R extends Query.Query.Any>(
    read: R,
    args: Query.Query.Args<R>
  ) => Entry<Query.Query.Success<R>, Query.Query.Error<R>> | undefined;
  /** The problems reported and not yet taken. */
  readonly problems: () => readonly Query.Problem.Any[];
  /** Takes every reported problem with this tag. Throws when there is none. */
  readonly expectProblem: <Tag extends string>(
    tag: Tag
  ) => readonly ([Extract<Query.Problem, { readonly _tag: Tag }>] extends [
    never,
  ]
    ? Query.Problem.Any
    : Extract<Query.Problem, { readonly _tag: Tag }>)[];
}

/**
 * The `TestQuery` service.
 *
 * @since 0.1.0
 */
export const TestQuery: Context.Service<TestQuery, TestQuery> =
  Context.Service<TestQuery>("@effect/ui/testing/TestQuery");

/**
 * Layer that provides `Query.Cache` for a test, together with `TestQuery`.
 *
 * **Details**
 *
 * The cache is the one `Query.layer` builds, with the same options. Its
 * `Query.Visibility` and `Query.Connectivity` are settable and start true,
 * and its problems go to the collector instead of the console.
 *
 * **Gotchas**
 *
 * A reported problem fails the test: the Layer's Scope closes with a
 * `ProblemsError` defect unless `expectProblem` took every problem first.
 *
 * @since 0.1.0
 */
export const layer = (options?: {
  readonly idleTimeToLive?: Duration.Input | undefined;
}): Layer.Layer<TestQuery | Query.Cache> => {
  const cacheLayer = Query.layer(options);
  return Layer.unwrap(
    Effect.sync(() => {
      const visibility = Query.makeSignal(true);
      const connectivity = Query.makeSignal(true);
      let problems: Query.Problem.Any[] = [];
      const fetches: Fetch[] = [];
      const harness = Layer.effect(
        TestQuery,
        Effect.gen(function* harness() {
          const cache = Query.internals(yield* Query.Cache);
          const off = cache.onFetch((event) => {
            const record: Fetch = {
              logKey: event.logKey,
              query: event.query,
              restart: event.restart,
              stored: event.stored,
              trigger: event.trigger,
            };
            if (event.page === undefined) {
              fetches.push(record);
            } else if (event.cursor === undefined) {
              fetches.push({ ...record, page: event.page });
            } else {
              fetches.push({
                ...record,
                cursor: event.cursor,
                page: event.page,
              });
            }
          });
          yield* Effect.addFinalizer(() =>
            Effect.suspend(() => {
              off();
              return problems.length === 0
                ? Effect.void
                : Effect.die(new ProblemsError({ problems }));
            })
          );
          // SAFETY: the literal implements every TestQuery member; entry and expectProblem erase their generics and narrow at their own boundaries, so one checked cast covers the literal.
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the literal's entry returns the cache EntryInfo where the testing Entry is declared; the fields coincide at runtime and the tests assert the mapping.
          return {
            // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the harness erases the generic args; cache.inspect takes unknown and the query Schema parses them at its boundary.
            entry: (read: Query.Query.Any, args: unknown) =>
              cache.inspect(Query.defOf(read), args),
            expectProblem: (tag: string) => {
              const matched = problems.filter(
                (problem) => problem._tag === tag
              );
              if (matched.length === 0) {
                throw new Error(
                  `[TestQuery] expected a ${
                    tag
                  } problem, and the cache reported ${
                    problems.length === 0
                      ? "none"
                      : problems.map((problem) => problem._tag).join(", ")
                  }`
                );
              }
              problems = problems.filter((problem) => problem._tag !== tag);
              return matched;
            },
            fetches: () => [...fetches],
            problems: () => [...problems],
            setOnline: connectivity.set,
            setVisible: visibility.set,
          } as unknown as TestQuery;
        })
      );
      return Layer.provideMerge(harness, cacheLayer).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Query.Visibility, visibility),
            Layer.succeed(Query.Connectivity, connectivity),
            Layer.succeed(Query.Problems, (problem: Query.Problem.Any) => {
              problems.push(problem);
            })
          )
        )
      );
    })
  );
};

/**
 * Sets `Query.Visibility` for the test cache.
 *
 * **Details**
 *
 * Going from false to true, with the cache online, refetches every watched
 * entry that is stale or whose interval elapsed while it was hidden.
 *
 * @since 0.1.0
 */
export const setVisible = (
  visible: boolean
): Effect.Effect<void, never, TestQuery> =>
  TestQuery.useSync((query) => query.setVisible(visible));

/**
 * Sets `Query.Connectivity` for the test cache.
 *
 * **Details**
 *
 * Going from false to true, with the cache visible, refetches every watched
 * entry that is stale or whose interval elapsed while it was offline.
 *
 * @since 0.1.0
 */
export const setOnline = (
  online: boolean
): Effect.Effect<void, never, TestQuery> =>
  TestQuery.useSync((query) => query.setOnline(online));

/**
 * Returns every fetch the test cache started so far, in order.
 *
 * @since 0.1.0
 */
export const fetches: Effect.Effect<readonly Fetch[], never, TestQuery> =
  TestQuery.useSync((query) => query.fetches());

/**
 * Returns a query-only view of one entry, or `undefined` when the cache has no
 * entry for the query and arguments. It doesn't create the entry or keep it
 * alive.
 *
 * @since 0.1.0
 */
export const entry = <R extends Query.Query.Any>(
  read: R,
  args: Query.Query.Args<R>
): Effect.Effect<
  Entry<Query.Query.Success<R>, Query.Query.Error<R>> | undefined,
  never,
  TestQuery
> => TestQuery.useSync((query) => query.entry(read, args));

/**
 * Returns reported problems not yet consumed by `expectProblem`.
 * @since 0.1.0
 */
export const problems: Effect.Effect<
  readonly Query.Problem.Any[],
  never,
  TestQuery
> = TestQuery.useSync((query) => query.problems());

/**
 * Removes and returns every reported problem with the given tag, preventing
 * those problems from failing the test.
 *
 * **Gotchas**
 *
 * Dies when the cache reported no problem with that tag.
 * @since 0.1.0
 */
export const expectProblem = <Tag extends string>(
  tag: Tag
): Effect.Effect<
  readonly ([Extract<Query.Problem, { readonly _tag: Tag }>] extends [never]
    ? Query.Problem.Any
    : Extract<Query.Problem, { readonly _tag: Tag }>)[],
  never,
  TestQuery
> => TestQuery.useSync((query) => query.expectProblem(tag));
