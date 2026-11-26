import type * as Duration from "effect/Duration";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
/**
 * Components: `defineComponent` with Schemas, `$` steps, update forms,
 * `noop`, and the view helper. The runtime lives in `internal/kernel.ts`;
 * this module holds the surface types, the step builders and `make`.
 *
 * A component's `R` is the union of its `init`, `update`, Commands,
 * Subscriptions, mounts, queries and reads requirements. Views are
 * synchronous VNode builders, so they carry no static requirements: a
 * missing service (notably `Client`) is a runtime failure, not a type
 * error. Model components expose `R` as the core `"~requires"` phantom, so
 * `h(Child, opts)` checks it.
 */
import * as Schema from "effect/Schema";
import type { Client, PropBag, Requires, VNode, View } from "ilha";
import { getFiber } from "ilha/internal";
import type { HFn } from "ilha/internal";

import type * as Command from "./command.ts";
import type * as Dom from "./dom.ts";
import { evolve } from "./evolve.ts";
import type { EvolveFields } from "./evolve.ts";
import type * as Kernel from "./internal/kernel.ts";
import { ProvideSpecs, specsOf } from "./internal/layer-run.ts";
import type { ProvideSpec } from "./internal/layer-run.ts";
import { makeLazy } from "./internal/lazy.ts";
import { isNoop, noop } from "./internal/noop.ts";
import { definitionNameOf } from "./internal/paths.ts";
import { bind } from "./internal/queries.ts";
import { checkReads } from "./internal/shared-run.ts";
import type * as MessageLog from "./message-log.ts";
import type * as Mount from "./mount.ts";
import type * as Query from "./query.ts";
import type * as Subscription from "./subscription.ts";

// Set once by the kernel module, which owns model-component rendering.
let renderModelComponent: typeof Kernel.renderModelComponent = () => {
  throw new Error(
    "component used before the kernel bound renderModelComponent"
  );
};

/**
 * Give components the kernel's model-component renderer. Called once by
 * the kernel module.
 *
 * @internal
 */
export const bindModelRenderer = (
  render: typeof Kernel.renderModelComponent
): void => {
  renderModelComponent = render;
};

/**
 * Marks a non-headless component function.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const TypeId = "~@effect/ui/Component" as const;

/**
 * Marks a non-headless component function.
 */
export type TypeId = typeof TypeId;

/**
 * Marks the `Noop` message.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const NoopTypeId = "~@effect/ui/Component/Noop" as const;

/**
 * Marks the `Noop` message.
 */
export type NoopTypeId = typeof NoopTypeId;
/**
 * A run's result when it has nothing to report. The runtime sends nothing
 * and logs no `Update`.
 */
export interface Noop {
  readonly "~@effect/ui/Component/Noop": "~@effect/ui/Component/Noop";
}

/**
 * Whether `u` is a model component function built by
 * `defineComponent().make()`.
 */
export const isComponent = (
  u: unknown
): u is ModelComponent<unknown, never, never> =>
  typeof u === "function" && definitionNameOf(u) !== undefined;

/** Brand for the tag a `Def.update(tag, f)` slice handles. */
const SliceTag = "~@ilha/model/SliceTag" as const;

/** Brand telling a step from a bare Model. */
const StepBrand = "~@ilha/model/Step" as const;

/**
 * Whether `update` or `init` returned a step (`$.set(...)` and friends)
 * rather than a bare Model. The guard is generic so it narrows every
 * `Step | Model` union: the type arguments infer from the value, and the
 * true branch keeps the step member while the false branch keeps the
 * Model. A `Step<any, ...>` guard would not narrow, because the checker's
 * fast path stays conservative on recursive types.
 */
// SAFETY: StepBrand is a module-private const string; the cast only reads an own marker the runtime sets via Object.assign.
export const isStep = <Model, Msg, R, Events, L extends QuerySpec>(
  u: Step<Model, Msg, R, Events, L> | Model
): u is Step<Model, Msg, R, Events, L> =>
  typeof u === "object" &&
  u !== null &&
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- StepBrand marker read; value compared to the brand constant.
  (u as Record<string, unknown>)[StepBrand] === StepBrand;

/**
 * What `init` and `update` accumulate: the next Model, Commands to issue and
 * events to emit to the author's `onEmit`. `R` is the requirements of the
 * accumulated Commands; `run` unions more in.
 */
export interface Step<
  Model,
  Msg,
  R = never,
  Events = Msg,
  L extends QuerySpec = QuerySpec,
> {
  readonly model: Model;
  readonly commands: readonly Command.Command<Msg, R>[];
  readonly events: readonly Events[];
  /** The `$.send` calls, in order. Applied as the update applies, before emits. */
  readonly sends: readonly StepSend[];
  /** The `$.loadMore`/`$.reset` calls, in order. Applied after the update applies. */
  readonly lists: readonly ListIssue[];
  /** `undefined` means no transition was asked for; `[]` means one without types. */
  readonly viewTransitionTypes: readonly string[] | undefined;
  /** Replace the Model, no merge. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  set(model: Model): Step<Model, Msg, R, Events, L>;
  /** Change some fields, with the `evolve` field rules. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  evolve(fields: NoInfer<EvolveFields<Model>>): Step<Model, Msg, R, Events, L>;
  /** Issue Commands, owned by the instance. Results come back as messages. `Noop` results send nothing and run anywhere. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  run<R2>(
    ...commands: readonly Command.Command<Msg | Noop, R2>[]
  ): Step<Model, Msg, R | R2, Events, L>;
  /** Report events to the author's `onEmit`. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  emit(...events: Events[]): Step<Model, Msg, R, Events, L>;
  /**
   * Send a message to the nearest instance of an owner above this one. It
   * is applied as this update applies, before this update's emits are
   * delivered. No `reads` entry is needed.
   */
  // oxlint-disable-next-line typescript/method-signature-style, anti-slop/no-unknown-parameters -- public Step API; message is validated by the receiving owner's update at run time.
  send(owner: OwnerRef, message: unknown): Step<Model, Msg, R, Events, L>;
  /**
   * Queue a page load for an infinite query, using the args computed from
   * the post-update Model. Nothing is issued for a disabled query.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  loadMore(name: InfiniteNames<L>): Step<Model, Msg, R, Events, L>;
  /**
   * Drop every page after the first of an infinite query, then refetch.
   * All held pages are saved in history state, so this is how a long list
   * keeps that small.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  reset(name: InfiniteNames<L>): Step<Model, Msg, R, Events, L>;
  /** Ask the host to render this update inside `document.startViewTransition`. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  viewTransition(...types: string[]): Step<Model, Msg, R, Events, L>;
}

/**
 * A `$.loadMore` or `$.reset` call an `update` issued, in order.
 */
export interface ListIssue {
  /** The query's name in `queries`. */
  readonly name: string;
  readonly op: "loadMore" | "reset";
}

/**
 * A `$.send` call: the owner component whose nearest live instance above
 * the sender gets the message, or `"self"` for the nearest instance of
 * the sender's own kind above it.
 */
export interface StepSend {
  readonly owner: OwnerRef | "self";
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- send payload is validated by the receiving owner's update at run time.
  readonly message: unknown;
}

/**
 * A component that can own shared state: headless, with `shares`. The
 * structural definition check accepts any headless component.
 */
export type OwnerRef = Headless.Any;

/**
 * `$` in `update`: a {@link Step} plus the current props and `combine`.
 */
export interface Update<
  Model,
  Msg,
  Props,
  R = never,
  Events = Msg,
  L extends QuerySpec = QuerySpec,
> extends Step<Model, Msg, R, Events, L> {
  /** The current props, even if an ancestor's flush hasn't rendered yet. */
  readonly props: Props;
  /** Owner values from the owners' Models as this update runs. */
  readonly reads: MessageLog.SharedRecord;
  /** The queries' results, as `h.queries` shows them for the pre-update Model. */
  readonly queries: QueryResults<L>;
  /**
   * Send a message to the nearest instance of an owner above this one.
   * Applied as this update applies, before emits.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  send(
    owner: OwnerRef,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- public Step API; message is validated by the receiving owner's update at run time.
    message: unknown
  ): Update<Model, Msg, Props, R, Events, L>;
  /**
   * Send a message to the nearest instance of the sender's own kind above
   * it. Only when `reads` has an `owner: "self"` entry; the outermost
   * instance has none above it, so the send is dropped and logged as
   * `SendDropped`. Only `$` has it (not the steps its methods return), so
   * call it first: `$.send("self", m).set(x)`.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  send(
    // oxlint-disable-next-line typescript/unified-signatures -- OwnerRef and "self" sends have different docs and call shapes; combining would change the public overloads.
    target: "self",
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- public Step API; message is validated by the receiving owner's update at run time.
    message: unknown
  ): Update<Model, Msg, Props, R, Events, L>;
  /**
   * A left fold of update functions: each gets a fresh `$` holding the
   * previous function's Model. Commands, emits, `loadMore`/`reset` and
   * view-transition types concatenate in call order; `props` and `queries`
   * stay frozen at the update's start. Inside a tag slice it takes slices
   * of that tag or whole-message functions; inside a whole-message update
   * a tag slice is rejected.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  combine<R2>(
    ...fns: readonly UpdateFn<Model, Msg, Props, R2, Events, L>[]
  ): Update<Model, Msg, Props, R | R2, Events, L>;
}

/**
 * `$` in `init`: only `props` and `set`, because there is no Model yet.
 */
export interface Init<Model, Props, Msg, Events = Msg> {
  /** The props the instance mounted with. */
  readonly props: Props;
  /** Build the first Model. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  set(model: Model): InitStep<Model, Msg, never, Events>;
}

/**
 * The `init` return: the first Model plus optional start-up Commands and
 * parent events. The Commands run once per client mount, never during
 * server rendering; emits are dropped on hydration.
 */
// oxlint-disable-next-line typescript/no-empty-interface -- InitStep deliberately narrows Step by omitting list keys; the empty body is the contract.
export interface InitStep<Model, Msg, R = never, Events = Msg> extends Omit<
  Step<Model, Msg, R, Events>,
  "loadMore" | "reset" | "lists"
  // oxlint-disable-next-line typescript/no-empty-object-type -- the empty body is the narrowing contract; InitStep carries no members of its own.
> {}

/**
 * An update function over the whole message type.
 */
export type UpdateFn<
  Model,
  Msg,
  Props,
  R = never,
  Events = Msg,
  L extends QuerySpec = QuerySpec,
> = (
  $: Update<Model, Msg, Props, R, Events, L>,
  message: Msg
) => Step<Model, Msg, R, Events, L> | Model;

/**
 * A `Def.update(tag, f)` slice: an update function narrowed to one tag that
 * `combine` and other updates may call by hand with any `$`.
 */
export interface SliceFn<
  Model,
  Msg,
  Props,
  Tag extends string,
  R = never,
  Events = Msg,
  L extends QuerySpec = QuerySpec,
> {
  (
    $: Update<Model, Msg, Props, R, Events, L>,
    message: Extract<Msg, { readonly _tag: Tag }>
  ): Step<Model, Msg, R, Events, L> | Model;
  readonly [SliceTag]?: Tag | undefined;
}
/**
 * A `query` entry of `queries`, as the types see it: one query, or a list
 * of pages when the query is an infinite query.
 */
export interface QueryOne<out R extends Query.Query.Any> {
  readonly _tag: "QueryOne";
  readonly query: R;
}

/**
 * A `queryMany` entry of `queries`, as the types see it: one query at many
 * args.
 */
export interface QueryMany<out R extends Query.Query.Any> {
  readonly _tag: "QueryMany";
  readonly query: R;
}

/**
 * A component's queries, as the types see them: per name in `queries`, a
 * `QueryOne` or a `QueryMany`.
 */
export interface QuerySpec {
  // oxlint-disable-next-line typescript/consistent-indexed-object-style, typescript/no-explicit-any, anti-slop/no-unsafe-dictionary-type -- open query map by name; values are the QueryOne/QueryMany unions, checked when bound.
  readonly [name: string]: QueryOne<any> | QueryMany<any>;
}

/**
 * The `queries` input of `defineComponent`, as written: per name, a
 * `{ query, args }` or `{ queryMany, args }` entry. `args` receives the
 * Model, the props and the other queries' results, and returns the args,
 * `undefined` to disable the query, or an array of args for `queryMany`.
 */
export interface QueryEntryInput<
  Model = unknown,
  Props = unknown,
  Results = unknown,
> {
  readonly query?: Query.Query.Any | undefined;
  readonly queryMany?: Query.Query.Any | undefined;
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- args result is the query's args; disabled queries return undefined, keyed queries an array.
  readonly args: (context: QueryArgsContext<Model, Props, Results>) => unknown;
  readonly debounce?: Duration.Input | undefined;
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- onChange maps a query result to a message; validated by the component update at run time.
  readonly onChange?: ((...args: readonly never[]) => unknown) | undefined;
}

/**
 * What `defineComponent` infers a `queries` option as: per name, a
 * `QueryOne` or a `QueryMany`.
 */
export type SpecOf<Q> = {
  readonly [K in keyof Q]: Q[K] extends { readonly queryMany: infer R }
    ? R extends Query.Query.Any
      ? QueryMany<R>
      : never
    : Q[K] extends { readonly query: infer R }
      ? R extends Query.Query.Any
        ? QueryOne<R>
        : never
      : never;
};

/**
 * The Model, props and opened query results a query's `args` runs with.
 */
export interface QueryArgsContext<Model, Props, Results> {
  readonly model: Model;
  readonly props: Props;
  readonly queries: Results;
}

/**
 * The queries of a component.
 */
export type Queries<C> = C extends { readonly "~L"?: infer L }
  ? [L] extends [QuerySpec]
    ? L
    : // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- no queries: the empty object is the absence contract.
      {}
  : // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- no queries: the empty object is the absence contract.
    {};

/**
 * The names of the single and infinite queries: those `h.previous` and
 * `h.patched` have.
 */
export type SingleNames<L> = {
  // oxlint-disable-next-line typescript/no-explicit-any -- QueryOne carries an erased query; names only, never values.
  readonly [K in keyof L]: L[K] extends QueryOne<any> ? K : never;
}[keyof L] &
  string;

/**
 * The names of the infinite queries: `$.loadMore` and `$.reset` take one.
 */
export type InfiniteNames<L> = {
  readonly [K in keyof L]: L[K] extends QueryOne<infer R>
    ? R extends Query.InfiniteQuery.Any
      ? K
      : never
    : never;
}[keyof L] &
  string;

/**
 * The names of the `queryMany` queries.
 */
export type KeyedNames<L> = {
  // oxlint-disable-next-line typescript/no-explicit-any -- QueryMany carries an erased query; names only, never values.
  readonly [K in keyof L]: L[K] extends QueryMany<any> ? K : never;
}[keyof L] &
  string;

/**
 * The services a component's queries add to its requirements: the queries
 * themselves, never what their fetchers use.
 */
export type QueryServices<L> = ServiceOf<L[keyof L]>;

type ServiceOf<D> = D extends { readonly query: infer R } ? R : never;

/**
 * One query as `h.queries`, `$.queries`, and `queries` in `head`,
 * `subscriptions` and a query's `args` open it: an `AsyncResult` of its
 * success and error, of `InfiniteData` for an infinite query, or the keyed
 * entries for a `queryMany` query.
 */
export type QueryResultOf<D> =
  D extends QueryMany<infer R>
    ? KeyedResults<R>
    : D extends QueryOne<infer R>
      ? R extends Query.InfiniteQuery.Any
        ? AsyncResult.AsyncResult<InfiniteData<R>, Query.Query.Error<R>>
        : AsyncResult.AsyncResult<Query.Query.Success<R>, Query.Query.Error<R>>
      : never;

/**
 * Every query of a component as `h.queries` and `$.queries` open it, by
 * name.
 */
export type QueryResults<L> = {
  readonly [K in keyof L]: QueryResultOf<L[K]>;
};

/**
 * An infinite query as `h.queries` opens it, inside its `AsyncResult`:
 * `items` flattens the held pages, keeping the first item for each
 * definition `key`; `pages` is the page array; `more` tells whether more
 * pages load.
 */
export interface InfiniteData<R extends Query.InfiniteQuery.Any> {
  readonly items: readonly Query.InfiniteQuery.Item<R>[];
  readonly pages: readonly Query.InfiniteQuery.Page<R>[];
  readonly more: Query.More<Query.Query.Error<R>>;
}

/**
 * One entry of a `queryMany` query as `h.queries` opens it: the args from
 * the query, the opened result and whether the value includes an
 * unconfirmed patch.
 */
export interface KeyedEntry<R extends Query.Query.Any> {
  readonly args: Query.Query.Args<R>;
  readonly result: AsyncResult.AsyncResult<
    Query.Query.Success<R>,
    Query.Query.Error<R>
  >;
  readonly patched: boolean;
}

/**
 * A `queryMany` query as `h.queries` opens it: an entry per unique args the
 * query returns, in its order, and `get` to find one entry by its args.
 */
export interface KeyedResults<R extends Query.Query.Any> extends ReadonlyArray<
  KeyedEntry<R>
> {
  readonly get: (args: Query.Query.Args<R>) => Option.Option<KeyedEntry<R>>;
}

/**
 * One key of a `queryMany` query whose result changed, as its `onChange`
 * gets it.
 */
export interface KeyedChange<R extends Query.Query.Any> {
  readonly args: Query.Query.Args<R>;
  readonly result: AsyncResult.AsyncResult<
    Query.Query.Success<R>,
    Query.Query.Error<R>
  >;
}

/**
 * What a query's `args` returns: the args of a `query` entry's Query, or
 * `undefined` to disable it, and an array of args for a `queryMany`, empty
 * to watch nothing.
 */
export type ArgsFor<S, M> = M extends Query.Query.Any
  ? readonly Query.Query.Args<M>[]
  : S extends Query.Query.Any
    ? Query.Query.Args<S> | undefined
    : never;

/**
 * A query's `onChange`: a `query` entry's gets its result as `h.queries`
 * opens it, and a `queryMany`'s gets its entries and the keys whose result
 * changed.
 */
export type OnChange<S, M, Msg> = M extends Query.Query.Any
  ? (results: KeyedResults<M>, changes: readonly KeyedChange<M>[]) => Msg
  : S extends Query.Query.Any
    ? (result: QueryResultOf<QueryOne<S>>) => Msg
    : never;

/**
 * What `h` gains in `view` for a component with queries: `queries` holds
 * each query's result as `$.queries` does in `update`; `previous` holds,
 * per single or infinite query, the Success value its result holds for
 * args other than the query's current ones; `patched` tells, per single or
 * infinite query, whether the value includes an optimistic patch the
 * server hasn't confirmed. `previous` and `patched` have no `queryMany`
 * query.
 */
export type QueryHelpers<L> = [keyof L] extends [never]
  ? // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- no queries: the empty object is the absence contract.
    {}
  : {
      readonly queries: QueryResults<L>;
      readonly previous: {
        readonly [K in SingleNames<L>]: L[K] extends QueryOne<infer R>
          ? R extends Query.InfiniteQuery.Any
            ? Option.Option<Omit<InfiniteData<R>, "more">>
            : Option.Option<Query.Query.Success<R>>
          : never;
      };
      readonly patched: Readonly<Record<SingleNames<L>, boolean>>;
    };

const mergeTransition = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): readonly string[] | undefined => {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return [...left, ...right];
};

const stepBase = <Model, Msg, R, Events, L extends QuerySpec = QuerySpec>(
  model: Model,
  commands: readonly Command.Command<Msg, R>[],
  events: readonly Events[],
  viewTransitionTypes: readonly string[] | undefined,
  sends: readonly StepSend[] = [],
  lists: readonly ListIssue[] = []
): Step<Model, Msg, R, Events, L> => {
  const step: Step<Model, Msg, R, Events, L> = {
    commands,
    emit: (...emitted: Events[]) =>
      stepBase(
        model,
        commands,
        [...events, ...emitted],
        viewTransitionTypes,
        sends,
        lists
      ),
    events,
    evolve: (fields: NoInfer<EvolveFields<Model>>) =>
      stepBase(
        evolve(model, fields),
        commands,
        events,
        viewTransitionTypes,
        sends,
        lists
      ),
    lists,
    loadMore: (name: string) =>
      stepBase(model, commands, events, viewTransitionTypes, sends, [
        ...lists,
        { name, op: "loadMore" },
      ]),
    model,
    reset: (name: string) =>
      stepBase(model, commands, events, viewTransitionTypes, sends, [
        ...lists,
        { name, op: "reset" },
      ]),
    run: <R2>(...issued: readonly Command.Command<Msg, R2>[]) =>
      stepBase(
        model,
        // SAFETY: issued commands carry Msg | Noop; Noop results send nothing and run anywhere, so widening to Msg is sound.
        [...commands, ...issued] as readonly Command.Command<Msg, R | R2>[],
        events,
        viewTransitionTypes,
        sends,
        lists
      ),
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- send payload validated by the receiving owner's update at run time.
    send: (owner: OwnerRef, message: unknown) =>
      stepBase(
        model,
        commands,
        events,
        viewTransitionTypes,
        [...sends, { message, owner }],
        lists
      ),
    sends,
    set: (next: Model) =>
      stepBase(next, commands, events, viewTransitionTypes, sends, lists),
    viewTransition: (...types: string[]) =>
      stepBase(
        model,
        commands,
        events,
        [...(viewTransitionTypes ?? []), ...types],
        sends,
        lists
      ),
    viewTransitionTypes,
  };
  return Object.assign(step, { [StepBrand]: StepBrand });
};

class UpdateApi<
  Model,
  Msg,
  Props,
  R = never,
  Events = Msg,
  L extends QuerySpec = QuerySpec,
> implements Update<Model, Msg, Props, R, Events, L> {
  readonly model: Model;
  readonly props: Props;
  readonly reads: MessageLog.SharedRecord;
  readonly queries: QueryResults<L>;
  readonly commands: readonly Command.Command<Msg, R>[];
  readonly events: readonly Events[];
  readonly sends: readonly StepSend[];
  readonly lists: readonly ListIssue[];
  readonly viewTransitionTypes: readonly string[] | undefined;
  readonly activeTag: string | undefined;
  /** The message being dispatched, so `combine` hands it to every function. */
  readonly message: Msg | undefined;
  constructor(
    model: Model,
    props: Props,
    // oxlint-disable-next-line eslint/default-param-last -- internal constructor; defaults precede the required trailing message by design, all call sites pass positionally.
    commands: readonly Command.Command<Msg, R>[] = [],
    // oxlint-disable-next-line eslint/default-param-last -- internal constructor; defaults precede the required trailing message by design, all call sites pass positionally.
    events: readonly Events[] = [],
    viewTransitionTypes: readonly string[] | undefined,
    activeTag: string | undefined,
    // oxlint-disable-next-line eslint/default-param-last -- internal constructor; defaults precede the required trailing message by design, all call sites pass positionally.
    sends: readonly StepSend[] = [],
    // oxlint-disable-next-line eslint/default-param-last -- internal constructor; defaults precede the required trailing message by design, all call sites pass positionally.
    reads: MessageLog.SharedRecord = {},
    // oxlint-disable-next-line eslint/default-param-last, anti-slop/require-safety-comment-for-type-assertion -- internal constructor default; {} is the empty shared record, queries bind by name at render.
    queries: QueryResults<L> = {} as QueryResults<L>,
    // oxlint-disable-next-line eslint/default-param-last -- internal constructor; defaults precede the required trailing message by design, all call sites pass positionally.
    lists: readonly ListIssue[] = [],
    message: Msg | undefined
  ) {
    this.model = model;
    this.props = props;
    this.commands = commands;
    this.events = events;
    this.sends = sends;
    this.reads = reads;
    this.queries = queries;
    this.lists = lists;
    this.viewTransitionTypes = viewTransitionTypes;
    this.activeTag = activeTag;
    this.message = message;
    // SAFETY: UpdateApi instances are Steps; the brand marks $.set results so isStep accepts them.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- this-to-Record narrows only to set the module-private StepBrand marker, compared against the brand constant.
    (this as unknown as Record<string, unknown>)[StepBrand] = StepBrand;
  }
  set(next: Model): Update<Model, Msg, Props, R, Events, L> {
    return new UpdateApi(
      next,
      this.props,
      this.commands,
      this.events,
      this.viewTransitionTypes,
      this.activeTag,
      this.sends,
      this.reads,
      this.queries,
      this.lists,
      this.message
    );
  }
  evolve(
    fields: NoInfer<EvolveFields<Model>>
  ): Update<Model, Msg, Props, R, Events, L> {
    return this.set(evolve(this.model, fields));
  }
  run<R2>(
    ...issued: readonly Command.Command<Msg | Noop, R2>[]
  ): Update<Model, Msg, Props, R | R2, Events, L> {
    return new UpdateApi(
      this.model,
      this.props,
      // SAFETY: issued commands carry Msg | Noop; Noop results send nothing and run anywhere, so widening to Msg is sound.
      [...this.commands, ...issued] as readonly Command.Command<Msg, R | R2>[],
      this.events,
      this.viewTransitionTypes,
      this.activeTag,
      this.sends,
      this.reads,
      this.queries,
      this.lists,
      this.message
    );
  }
  emit(...emitted: Events[]): Update<Model, Msg, Props, R, Events, L> {
    return new UpdateApi(
      this.model,
      this.props,
      this.commands,
      [...this.events, ...emitted],
      this.viewTransitionTypes,
      this.activeTag,
      this.sends,
      this.reads,
      this.queries,
      this.lists,
      this.message
    );
  }
  // oxlint-disable-next-line typescript/method-signature-style -- public overloads; message validated by the receiving owner at run time.
  send(
    owner: OwnerRef,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- public overloads; message validated by the receiving owner at run time.
    message: unknown
  ): Update<Model, Msg, Props, R, Events, L>;
  // oxlint-disable-next-line typescript/method-signature-style -- public overloads; message validated by the receiving owner at run time.
  send(
    // oxlint-disable-next-line typescript/unified-signatures -- OwnerRef and "self" sends have different docs and call shapes; combining would change the public overloads.
    target: "self",
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- public overloads; message validated by the receiving owner at run time.
    message: unknown
  ): Update<Model, Msg, Props, R, Events, L>;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- send payload validated by the receiving owner's update at run time.
  send(
    owner: OwnerRef | "self",
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- send payload validated by the receiving owner's update at run time.
    message: unknown
  ): Update<Model, Msg, Props, R, Events, L> {
    return new UpdateApi(
      this.model,
      this.props,
      this.commands,
      this.events,
      this.viewTransitionTypes,
      this.activeTag,
      [...this.sends, { message, owner }],
      this.reads,
      this.queries,
      this.lists,
      this.message
    );
  }
  loadMore(name: InfiniteNames<L>): Update<Model, Msg, Props, R, Events, L> {
    return new UpdateApi(
      this.model,
      this.props,
      this.commands,
      this.events,
      this.viewTransitionTypes,
      this.activeTag,
      this.sends,
      this.reads,
      this.queries,
      [...this.lists, { name, op: "loadMore" }],
      this.message
    );
  }
  reset(name: InfiniteNames<L>): Update<Model, Msg, Props, R, Events, L> {
    return new UpdateApi(
      this.model,
      this.props,
      this.commands,
      this.events,
      this.viewTransitionTypes,
      this.activeTag,
      this.sends,
      this.reads,
      this.queries,
      [...this.lists, { name, op: "reset" }],
      this.message
    );
  }
  viewTransition(...types: string[]): Update<Model, Msg, Props, R, Events, L> {
    return new UpdateApi(
      this.model,
      this.props,
      this.commands,
      this.events,
      [...(this.viewTransitionTypes ?? []), ...types],
      this.activeTag,
      this.sends,
      this.reads,
      this.queries,
      this.lists,
      this.message
    );
  }
  combine<R2>(
    ...fns: readonly UpdateFn<Model, Msg, Props, R2, Events, L>[]
  ): Update<Model, Msg, Props, R | R2, Events, L> {
    let { model } = this;
    const commands: Command.Command<Msg, R | R2>[] = [...this.commands];
    const events: Events[] = [...this.events];
    const sends: StepSend[] = [...this.sends];
    const lists: ListIssue[] = [...this.lists];
    let { viewTransitionTypes: transition } = this;
    for (const fn of fns) {
      // SAFETY: SliceFn carries the SliceTag brand; reading it only routes combine validation, never resurrects a message.
      const tag = (fn as SliceFn<Model, Msg, Props, string, R2, Events, L>)[
        SliceTag
      ];
      if (tag !== undefined && tag !== this.activeTag) {
        if (this.activeTag === undefined) {
          throw new Error(
            `combine takes whole-message functions here, not the slice for "${tag}"`
          );
        }
        throw new Error(
          `combine takes slices of "${this.activeTag}" here, not the slice for "${tag}"`
        );
      }
      const fresh: Update<Model, Msg, Props, R2, Events, L> = new UpdateApi<
        Model,
        Msg,
        Props,
        R2,
        Events,
        L
      >(
        model,
        this.props,
        [],
        [],
        undefined,
        this.activeTag,
        [],
        this.reads,
        this.queries,
        [],
        this.message
      );
      // SAFETY: fresh carries this.message, so dispatching fn with it preserves the in-flight message.
      const out = (fn as UpdateFn<Model, Msg, Props, R2, Events, L>)(
        fresh,
        this.message as Msg
      );
      // SAFETY: out is Step | Model by the UpdateFn contract; the branches narrow via isStep and fresh.set respectively.
      const step: Step<Model, Msg, R | R2, Events, L> = isStep(out)
        ? (out as Step<Model, Msg, R | R2, Events, L>)
        : fresh.set(out as Model);
      ({ model } = step);
      commands.push(...step.commands);
      events.push(...step.events);
      sends.push(...step.sends);
      lists.push(...step.lists);
      transition = mergeTransition(transition, step.viewTransitionTypes);
    }
    return new UpdateApi(
      model,
      this.props,
      commands,
      events,
      transition,
      this.activeTag,
      sends,
      this.reads,
      this.queries,
      lists,
      this.message
    );
  }
}

/**
 * The options a parent writes at a child call site. Component props stay
 * nested under `props`, so they never collide with the call options.
 * `ParentMsg` is what `onEmit`/`onFailure`/`on<Event>` handlers return: the
 * parent's `Msg` through the typed `h()` overload, `unknown` (unchecked; the
 * author's `update` validates at run time) everywhere else.
 */
export type CallOptions<Props, Events = never, ParentMsg = unknown> = {
  /** The parent messages `onEmit`/`onFailure`/`on<Event>` handlers produce. Never assigned. */
  readonly "~parent"?: ParentMsg | undefined;
  /** Per-tag `onEmit` dispatches on `event._tag`; a function takes the whole event. */
  readonly onEmit?:
    | ((event: Events) => ParentMsg | undefined)
    | Readonly<Record<string, (event: never) => ParentMsg | undefined>>
    | undefined;
  /** Hear the child's failure; the failure stays in the child either way. */
  readonly onFailure?:
    | ((failure: FallbackFailure) => ParentMsg | undefined)
    | undefined;
  /** Shown while the child is failed, until its key changes. */
  readonly fallback?: ((result: FallbackFailure) => View) | undefined;
  /** Slot content by declared name, for components declaring `slots`. */
  readonly slots?: Readonly<Record<string, View>> | undefined;
  // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- Props defaults to unknown; {} extends Props detects a missing props declaration.
} & ({} extends Props
  ? { readonly props?: Props | undefined }
  : { readonly props: Props }) &
  OnHandlers<Events, ParentMsg>;
/**
 * The `on<Event>` handler names for an event union: `Changed` hears
 * `onChanged`.
 */
type EmitKeys<Events> = Events extends {
  readonly _tag: infer Tag extends string;
}
  ? `on${Tag}`
  : never;
/** The event a handler name hears. */
type EmitEvent<Events, Key> = Key extends `on${infer Tag}`
  ? Extract<Events, { readonly _tag: Tag }>
  : never;
/**
 * One `on<Event>` handler per event tag: `onChanged` hears `Changed`. The
 * runtime folds these into `onEmit` (explicit `onEmit` wins per tag when it
 * is a record; an `on<Event>` wins over a function `onEmit` for its tag).
 */
export type OnHandlers<Events, ParentMsg = unknown> = {
  readonly [Key in EmitKeys<Events>]?: (
    event: EmitEvent<Events, Key>
  ) => ParentMsg | undefined;
};
/**
 * The failure value `onFailure` hears and `fallback` renders.
 */
export type FallbackFailure = AsyncResult.Failure<never, unknown>;

/**
 * Options for `h.send`.
 */
export interface SendOptions {
  /** `true` prevents default only when a message was produced; `"always"` prevents regardless. */
  readonly preventDefault?: boolean | "always" | undefined;
}

/**
 * The model extras on `h` in `view`: `props`, `children`, `send`,
 * `isRunning`, `id`, `mount`, `ref`, `reads`, `slots`, `keepAlive`, plus
 * `queries`, `previous` and `patched` for components with queries.
 */
export interface ViewExtras<Props, Msg> {
  /** The current props from the Models above. */
  readonly props: Props;
  /** The children the parent wrote at this call site. */
  readonly children: View;
  /**
   * Build an Ilha event handler from a message or a function of the event.
   * Its `preventDefault` rules are those of the view handler model: `true`
   * prevents only when a message was produced, `"always"` prevents
   * regardless. Nothing stops propagation: the host gives an event only to
   * the innermost element with a handler for it.
   */
  readonly send: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- view event is the host DOM event, typed at the element that produced it.
    message: Msg | ((event: unknown) => Msg | undefined),
    options?: SendOptions | undefined
    // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- view send returns the host's event listener; the message contract is checked by update.
  ) => (event: unknown) => void;
  /**
   * Whether any run of the Command (of the group, if given) is queued,
   * running, awaiting or stopping until its fiber exits.
   */
  readonly isRunning: (
    definition: Command.Definition.Any,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run group is an opaque caller key, compared by identity only.
    group?: unknown
  ) => boolean;
  /** An id derived from the instance path, so server and client agree. */
  readonly id: (name: string, key?: string | number | undefined) => string;
  /**
   * Attach an issued mount to an element: returns an Ilha `ref` prop for
   * it. The body starts after commit; same-name new args publish to
   * `changes`, a different name restarts, and a render without the mount
   * stops it. An element takes one mount.
   */
  readonly mount: (issued: Mount.Any) => (node: Element | null) => void;
  /**
   * Name an element for `DomCommand`: returns an Ilha `ref` prop that
   * resolves within this instance after the commit of the update that
   * rendered it.
   */
  readonly ref: <Node extends Element>(
    ref: Dom.Ref<Node>
  ) => (node: Element | null) => void;
  /**
   * The nearest live owners' values above, by the local name each `reads`
   * entry lists its owner under (`undefined` for an absent optional
   * owner). Re-renders when an owner reports a new value.
   */
  readonly reads: MessageLog.SharedRecord;
  /**
   * Placed slot content by declared name: an outlet rendering what the
   * parent passed for the slot. Renders nothing when the parent passed
   * nothing for it. A slot is placed at most once per render.
   */
  readonly slots: SlotHelpers;
  /**
   * Keep children alive across renders: `h.keepAlive((s) => ...)` keeps
   * children called with `s` as long as the author, with or without a
   * predicate `alive({model, props, queries, key})` asked on every author
   * render for each kept child. Keys must be literals. The DOM is rebuilt
   * when a kept child is drawn again.
   */
  readonly keepAlive: KeepAlive;
}
/**
 * `h` in `view`: Ilha's `HFn` (so JSX and `h()` both work) plus the model
 * extras, plus a model-child overload whose handlers return this
 * component's `Msg`. An intersection (not `extends`) keeps the checker's
 * depth limiter out of the core overloads' deferred conditionals; the child
 * signature comes first so `h(Child, options)` checks the call options
 * instead of falling through to the untyped component overload.
 */
export type Helper<
  Props,
  Msg,
  L extends QuerySpec = QuerySpec,
> = ChildCall<Msg> & HFn & ViewExtras<Props, Msg> & QueryHelpers<L>;

/**
 * The model-child call a view makes through `h`: `props` nest under
 * `props`, and `onEmit`, `onFailure` and `on<Event>` handlers must return
 * the calling component's `Msg` (or `undefined` to ignore). A typo in a
 * parent message is a compile error here; JSX keeps the run-time check
 * instead (see `spec/kernel.md`). The constraint reads the child's
 * definition structurally (never `ModelComponent`, which would tie
 * `Helper` into a depth-limiter cycle through the view signature).
 */
export type ChildCall<Msg> = <
  C extends {
    readonly definition: {
      readonly props: Schema.Schema<unknown>;
      readonly events: Schema.Schema<unknown>;
    };
    readonly "~requires"?: unknown;
  },
>(
  type: C,
  options: CallOptions<ChildPropsOf<C>, ChildEventsOf<C>, Msg>
) => VNode<ChildRequiresOf<C>>;

/** The props of a child component, read off its definition. */
export type ChildPropsOf<C> = C extends {
  readonly definition: { readonly props: Schema.Schema<infer P> };
}
  ? P
  : never;
/** The events of a child component, read off its definition. */
export type ChildEventsOf<C> = C extends {
  readonly definition: { readonly events: Schema.Schema<infer E> };
}
  ? E
  : never;
/** The requirements of a child component, read off its phantom. */
export type ChildRequiresOf<C> = "~requires" extends keyof C
  ? Exclude<C["~requires"], undefined>
  : never;

/**
 * A component's implementation: pure `init`/`update`/`view` plus keyed
 * `subscriptions`. `R` is the union of the Commands and Subscriptions the
 * implementation issues. Every entry must be pure: calling an Ilha primitive
 * (`atom`, `watch`, `when`) inside them is a dev-mode error once core
 * exposes the hook (see `kernel.md`).
 */
export interface MakeImpl<
  Props,
  Model,
  Msg,
  R = never,
  Events = Msg,
  L extends QuerySpec = QuerySpec,
> {
  /** Build the first Model, plus optional start-up Commands and events. May return a bare Model. */
  readonly init: (
    $: Init<Model, Props, Msg, Events>,
    props: Props
  ) => Step<Model, Msg, R, Events, L> | InitStep<Model, Msg, R, Events> | Model;
  /**
   * The only place state changes: a whole-message function, a record with
   * one handler per `_tag` (no default key), or `Def.update` slices. A
   * handler may return a bare Model.
   */
  readonly update:
    | UpdateFn<Model, Msg, Props, R, Events, L>
    | UpdateRecord<Model, Msg, Props, R, Events, L>;
  /** Render the Model. Must be pure. */
  readonly view: (h: Helper<Props, Msg, L>, model: Model) => View;
  /**
   * Ongoing work gated by slices of the Model and the opened query
   * results. Falsy entries are filtered out. Two entries with one key fail
   * the instance.
   */
  readonly subscriptions?:
    | ((current: {
        readonly model: Model;
        readonly props: Props;
        readonly queries: QueryResults<L>;
      }) => readonly (
        | Subscription.Subscription<Msg, R>
        | false
        | null
        | undefined
      )[])
    | undefined;
}

/**
 * A per-tag `update` handler: the full `$` (so the handler may issue
 * Commands delivering any of the component's messages), with `message`
 * narrowed to the tag.
 */
export type TagHandler<
  Model,
  Msg,
  Props,
  Tag extends string,
  R = never,
  Events = Msg,
  L extends QuerySpec = QuerySpec,
> = (
  $: Update<Model, Msg, Props, R, Events, L>,
  message: Extract<Msg, { readonly _tag: Tag }>
) => Step<Model, Msg, R, Events, L> | Model;

/**
 * A per-tag `update` record: one handler for every `_tag`, with no default
 * key. An unknown key is a type error.
 */
export type UpdateRecord<
  Model,
  Msg,
  Props,
  R = never,
  Events = Msg,
  L extends QuerySpec = QuerySpec,
> = [Msg] extends [{ readonly _tag: string }]
  ? {
      readonly [Tag in Msg["_tag"]]:
        | TagHandler<Model, Msg, Props, Tag, R, Events, L>
        | SliceFn<Model, Msg, Props, Tag, R, Events, L>;
    }
  : never;

/**
 * A model component: an Ilha typed-props component usable via JSX and `h()`.
 * Call options nest the component props under `props`. `R` rides the core
 * `"~requires"` phantom, so parents pick it up through `h()`. `L` is the
 * component's query spec, read as `Queries<typeof Component>`.
 */
export interface ModelComponent<
  Props,
  Msg,
  R = never,
  Events = Msg,
  L extends QuerySpec = QuerySpec,
  Model = unknown,
> {
  (options: CallOptions<Props, Events, unknown>): View;
  /** The definition name: the path segment this component renders under. */
  readonly definitionName: string;
  readonly definition: Definition<string, Props, Model, Msg, Events, R, L>;
}
/**
 * Marks a headless component function.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const HeadlessTypeId = "~@effect/ui/Component/Headless" as const;

/**
 * Marks a headless component function.
 */
export type HeadlessTypeId = typeof HeadlessTypeId;

/**
 * Whether `u` is a headless model component function built by
 * `defineComponent().make()` with `parts` (or neither `view` nor `parts`).
 */
export const isHeadless = (u: unknown): u is Headless.Any =>
  typeof u === "function" && HeadlessTypeId in u;

/**
 * A headless component: an Ilha typed-props component usable via JSX and
 * `h()`, finished with `parts` (or neither `parts` nor `view`) instead of
 * `view`. The consumer's `view` closure receives the parts and owns
 * everything it declares.
 */
export interface HeadlessComponent<
  Props = unknown,
  Msg = never,
  R = never,
  Events = never,
  Parts = unknown,
> {
  (options: HeadlessCallOptions<Props, Msg, Parts, Events>): View;
  /** The definition name: the path segment this component renders under. */
  readonly definitionName: string;
  readonly definition: Definition<string, Props, unknown, Msg, Events, R>;
  /** The implementation the runtime calls. */
  readonly implementation:
    | HeadlessMakeImpl<Props, unknown, Msg, R, Events, Parts>
    | OwnerMakeImpl<Props, unknown, Msg, R, Events>;
  readonly [HeadlessTypeId]: HeadlessTypeId;
  /** The core requirements phantom. Never assigned; read by `h()` and `mount`. */
  readonly "~requires"?: R | undefined;
}

/** Headless-component types: `Any`, `Parts` and the call options. */
// oxlint-disable-next-line typescript/no-namespace -- Headless groups the headless constraint, parts projection and call options; a module split would break the public import shape.
export declare namespace Headless {
  /**
   * Any headless component: the call shape every `make` result with
   * `parts` satisfies. A `HeadlessComponent<...>` instantiation cannot
   * serve here: `Update`'s `events` and `commands` arrays plus `evolve`'s
   * weak-type check reject concrete params in both directions, and even
   * `CallOptions`' `onEmit` union rejects both `never` and `any` events.
   * So the constraint reads only the `view` closure, the name and the
   * brand.
   */
  export interface Any {
    // SAFETY: `any` params erase every concrete instantiation on purpose: the
    // constraint must accept all headless components, and `onEmit` stays
    // `any` so every events union fits (see the doc comment above).
    // oxlint-disable-next-line typescript/no-explicit-any -- intentional erasure, documented above.
    (
      // oxlint-disable-next-line typescript/no-explicit-any -- intentional erasure: the constraint must accept every headless instantiation.
      options: Omit<HeadlessCallOptions<any, any, any, never>, "onEmit"> & {
        // oxlint-disable-next-line typescript/no-explicit-any -- onEmit stays any so every events union fits.
        readonly onEmit?: any;
      }
    ): View;
    readonly definitionName: string;
    readonly definition: { readonly name: string };
    readonly [HeadlessTypeId]: HeadlessTypeId;
  }
  /**
   * The parts a headless component shares with its consumer, read off the
   * consumer `view` closure in its call options. Matching the whole
   * `HeadlessComponent<...>` fails for the same reason as `Any`.
   */
  export type Parts<C> = C extends {
    (options: { readonly view: (parts: infer P) => View }): View;
  }
    ? P
    : never;
}

/**
 * The `view` closure options of a headless child call. Everything the
 * closure declares belongs to the consumer: `onEmit`, `onFailure` and
 * fallbacks resolve against the consumer's messages and update.
 */
export type HeadlessCallOptions<
  Props,
  Msg,
  Parts,
  Events = never,
> = CallOptions<Props, Events, Msg> & {
  /** The whole view, receiving this component's parts. */
  readonly view: (parts: Parts) => View;
  /** Headless children take no slots. */
  readonly slots?: never | undefined;
};

/**
 * A headless implementation: pure `init`/`update` plus `parts(p, model)`.
 * `R` is the union of the Commands and Subscriptions the implementation
 * issues. `parts` must be pure.
 */
export interface HeadlessMakeImpl<
  Props,
  Model,
  Msg,
  R = never,
  Events = never,
  Parts = unknown,
> {
  /** Build the first Model, plus optional start-up Commands and events. May return a bare Model. */
  readonly init: (
    $: Init<Model, Props, Msg, Events>,
    props: Props
  ) => Step<Model, Msg, R, Events> | InitStep<Model, Msg, R, Events> | Model;
  /**
   * The only place state changes: a whole-message function, a record with
   * one handler per `_tag` (no default key), or `Def.update` slices. A
   * handler may return a bare Model.
   */
  readonly update:
    | UpdateFn<Model, Msg, Props, R, Events>
    | UpdateRecord<Model, Msg, Props, R, Events>;
  /** Build the parts the consumer's `view` closure receives. Must be pure. */
  readonly parts: (p: PartsHelper<Props, Msg>, model: Model) => Parts;
  /**
   * Ongoing work gated by slices of the Model. Falsy entries are filtered
   * out. Two entries with one key fail the instance.
   */
  readonly subscriptions?:
    | ((current: {
        readonly model: Model;
        readonly props: Props;
      }) => readonly (
        | Subscription.Subscription<Msg, R>
        | false
        | null
        | undefined
      )[])
    | undefined;
}

/**
 * A headless owner with no parts: `make({init, update})`. The consumer's
 * `view` closure receives `{}`.
 */
export interface OwnerMakeImpl<Props, Model, Msg, R = never, Events = never> {
  /** Build the first Model, plus optional start-up Commands and events. May return a bare Model. */
  readonly init: (
    $: Init<Model, Props, Msg, Events>,
    props: Props
  ) => Step<Model, Msg, R, Events> | InitStep<Model, Msg, R, Events> | Model;
  /**
   * The only place state changes: a whole-message function, a record with
   * one handler per `_tag` (no default key), or `Def.update` slices. A
   * handler may return a bare Model.
   */
  readonly update:
    | UpdateFn<Model, Msg, Props, R, Events>
    | UpdateRecord<Model, Msg, Props, R, Events>;
  /**
   * Ongoing work gated by slices of the Model. Falsy entries are filtered
   * out. Two entries with one key fail the instance.
   */
  readonly subscriptions?:
    | ((current: {
        readonly model: Model;
        readonly props: Props;
      }) => readonly (
        | Subscription.Subscription<Msg, R>
        | false
        | null
        | undefined
      )[])
    | undefined;
}

/**
 * The `p` helper `parts(p, model)` runs with: the owner's props and shared
 * reads, `isRunning`, `id`, `send`, `part` and `child`.
 */
export interface PartsHelper<Props = unknown, Msg = never> {
  /** The props the instance mounted with. */
  readonly props: Props;
  /** The nearest live owners' values above, by local `reads` name. */
  readonly reads: MessageLog.SharedRecord;
  /**
   * Whether any run of the Command (of the group, if given) is queued,
   * running, awaiting or stopping until its fiber exits.
   */
  readonly isRunning: (
    definition: Command.Definition.Any,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run group is an opaque caller key, compared by identity only.
    group?: unknown
  ) => boolean;
  /** An id derived from the instance path, so server and client agree. */
  readonly id: (name: string, key?: string | number | undefined) => string;
  /**
   * Build an Ilha event handler from a message or a function of the event,
   * dispatching to the headless owner. Inside a part's props it becomes
   * the part's layer for its event.
   */
  readonly send: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- view event is the host DOM event, typed at the element that produced it.
    message: Msg | ((event: unknown) => Msg | undefined),
    options?: SendOptions | undefined
    // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- view send returns the host's event listener; the message contract is checked by update.
  ) => (event: unknown) => void;
  /** Make a part for one tag, several tags, or any element. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  part(tags: string | readonly string[], decorate: PartDecorate): PartApplier;
  /** Make a part for any element. */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  part(decorate: PartDecorate): PartApplier;
  /**
   * Compose another headless component, owned by this one: `onEmit` and
   * `onFailure` return this component's messages. Takes no `view`,
   * `slots` or `fallback`.
   */
  readonly child: <C extends Headless.Any, Out>(
    component: C,
    options: ComposedChildOptions<Headless.Parts<C>, Out>
  ) => Out;
}

/** What `decorate` in `p.part` receives and returns. */
export type PartDecorate = (
  blank: VNode,
  ...args: readonly unknown[]
) => PropBag | VNode;

/** A part applied to an element vnode: decorates and returns it. */
export type PartApplier = (target: VNode, ...args: readonly unknown[]) => VNode;

/** The options `p.child` takes for a composed headless child. */
export interface ComposedChildOptions<P = unknown, Out = unknown> {
  /** Default `""`, so `key: ""` and no key are the same child. */
  readonly key?: string | undefined;
  readonly props?: unknown | undefined;
  /** Per-tag `onEmit` dispatches on `event._tag`; a function takes the whole event. */
  readonly onEmit?:
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- composed child handlers produce this component's Msg, checked by update at run time.
    | ((event: never) => unknown)
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- per-tag composed handlers produce this component's Msg, checked by update at run time.
    | Readonly<Record<string, (event: never) => unknown>>
    | undefined;
  /** Hear the composed child's failure; the failure stays in the child either way. */
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- composed failure handler produces this component's Msg, checked by update at run time.
  readonly onFailure?: ((failure: FallbackFailure) => unknown) | undefined;
  /** Map the composed child's parts to this component's parts. */
  readonly parts: (childParts: P) => Out;
}

/** Placed slot content by declared slot name. */
export interface SlotHelpers {
  // oxlint-disable-next-line typescript/consistent-indexed-object-style -- slot names are dynamic; the record form would hide the per-name VNode contract.
  readonly [name: string]: View;
}

/**
 * `h.keepAlive`: children called with `s` live as long as the author. With
 * a predicate, `alive({model, props, queries, key})` is asked on every
 * author render for each kept child.
 */
export interface KeepAlive {
  (scope: (s: KeepAliveScope) => View): View;
  (alive: KeepAlivePredicate, scope: (s: KeepAliveScope) => View): View;
}

/** The scope helper `h.keepAlive` passes: an `h` tagging kept children. */
export type KeepAliveScope = HFn;

/** The predicate `h.keepAlive(alive, scope)` asks per kept child. */
export type KeepAlivePredicate = (input: {
  readonly key: string;
  readonly model: unknown;
  readonly props: unknown;
  readonly queries: unknown;
}) => boolean;

/** A reader's `reads` declaration: owners by local name. */
export interface ReadsDecl {
  // oxlint-disable-next-line typescript/consistent-indexed-object-style -- local names are dynamic; the record form would hide the per-name owner contract.
  readonly [local: string]: Headless.Any | ReadsEntry;
}

/** One `reads` entry: an owner plus optional report and `onChange`. */
export interface ReadsEntry {
  /** The owner, or `"self"` for the nearest instance of the reader's own kind above. */
  readonly owner: Headless.Any | "self";
  /** Without an owner the read is `undefined`, needs no requirement, and sends are dropped. */
  readonly optional?: boolean | undefined;
  /** The reader's contribution to the owner's `collects`. */
  readonly report?:
    | ((
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- report reads the owner's Model and props; the owner schema checks them at the boundary.
        model: unknown,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- report reads the owner's Model and props; the owner schema checks them at the boundary.
        props: unknown,
        id: (name: string, key?: string | number | undefined) => string
        // oxlint-disable-next-line anti-slop/no-unknown-returns -- report value is collected and parsed by the owner's collects schema.
      ) => unknown)
    | undefined;
  /** A message per owner round, delivered with the latest value before the next render. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- onChange carries the owner's latest value to a message; validated by the reader's update at run time.
  readonly onChange?: ((value: unknown) => unknown) | undefined;
}

/** An owner's `shares` declaration: a bare value function, or the full form. */
export type SharesDecl<Model = unknown, Props = unknown> =
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- shares value is encoded by the optional schema, best-effort structural without it.
  | ((model: Model, props: Props, reads: MessageLog.SharedRecord) => unknown)
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- shares value is encoded by the optional schema, best-effort structural without it.
  | SharesObject<Model, Props>;

/** The full `shares` form: value, Schema, receives and collects. */
export interface SharesObject<Model = unknown, Props = unknown> {
  /** The shared value, from the owner's Model, props and own reads. */
  readonly value: (
    model: Model,
    props: Props,
    reads: MessageLog.SharedRecord
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- shares value is encoded by the optional schema, best-effort structural without it.
  ) => unknown;
  /** Encodes the value in a reader's `Update` on the Wire. Best-effort structural without it. */
  readonly schema?: Schema.Schema<unknown> | undefined;
  /** The tags readers may `$.send`; other sends still dispatch at run time. */
  readonly receives?: readonly string[] | undefined;
  /** Collect readers' reports into one message per settled pass. */
  readonly collects?: SharesCollects | undefined;
}

/** An owner's `collects`: the collected message Schema and its `onChange`. */
export interface SharesCollects {
  readonly schema: Schema.Schema<unknown>;
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- collected reports are parsed by the collects schema into a message.
  readonly onChange: (reports: readonly unknown[]) => unknown;
}

/**
 * The requirements a view type is known to carry: `never` for text and for
 * JSX views (`View<unknown>`), the union of the children's requirements for
 * `h()` views. A component's `R` is its implementation requirements plus
 * this, so `h()` views propagate `Client` (and anything else) to `mount`
 * and `renderToString`. The first branch answers `never` for any view the
 * opaque `View` flows into without distributing `Requires` over the whole
 * `View` union; it only fires when the answer is `never` anyway (`V` then
 * carries `unknown`), so the SPEC rule is unchanged.
 */
export type ViewRequires<V> =
  View<unknown> extends V
    ? never
    : unknown extends Requires<V>
      ? never
      : Requires<V>;

/**
 * The erased definition the runtime, the log and Story read back.
 */
export interface Definition<
  Name extends string,
  Props,
  Model,
  Msg,
  Events,
  R = never,
  L extends QuerySpec = QuerySpec,
> {
  readonly name: Name;
  readonly props: Schema.Schema<Props>;
  readonly model: Schema.Schema<Model>;
  readonly message: Schema.Schema<Msg>;
  readonly events: Schema.Schema<Events>;
  /** The definition's requirements phantom. Never assigned; read by `h()` and `mount`. */
  readonly "~requires"?: R | undefined;
  /** The query spec phantom. Never assigned; read as `Queries<typeof Component>`. */
  readonly "~L"?: L | undefined;
  /** Declared query entries, bound by `make` and read by the query runtime. */
  readonly queries?: unknown;
  /** The bound queries, or `undefined` without any. Read by the query runtime. */
  readonly "~queries"?: unknown;
  /** Declared slot names. Read by the slots runtime. */
  readonly slots?: readonly string[] | undefined;
  /** Declared shared-state reads. Read by the shared runtime; `make` validates them. */
  readonly reads?: ReadsDecl | undefined;
  /** Declared shared state. Headless-only: with `view`, `make` throws. */
  readonly shares?: SharesDecl<unknown, unknown> | undefined;
  /** A slice for one tag, a whole-message function, or a per-tag record. */
  readonly update: {
    <Tag extends MsgTag<Msg>, R = never>(
      tag: Tag,
      f: (
        $: Update<Model, Msg, Props, R, Events, L>,
        message: Extract<Msg, { readonly _tag: Tag }>
      ) => Step<Model, Msg, R, Events, L> | Model
    ): SliceFn<Model, Msg, Props, Tag, R, Events, L>;
    <R = never>(
      f: UpdateFn<Model, Msg, Props, R, Events, L>
    ): UpdateFn<Model, Msg, Props, R, Events, L>;
    (
      record: [Msg] extends [{ readonly _tag: string }]
        ? UpdateRecord<Model, Msg, Props, never, Events, L>
        : never
    ): [Msg] extends [{ readonly _tag: string }]
      ? UpdateRecord<Model, Msg, Props, never, Events, L>
      : never;
  };
  /** Type an `init` function against the definition. Returns it unchanged. */
  readonly init: <
    F extends (
      $: Init<Model, Props, Msg>,
      props: Props
    ) => Step<Model, Msg, never, Events, L> | Model,
  >(
    f: F
  ) => F;
  /** Type a `view` function against the definition. Returns it unchanged. */
  readonly view: <F extends (h: Helper<Props, Msg, L>, model: Model) => View>(
    f: F
  ) => F;
  /** Build a fragment function against the definition. Returns it unchanged. */
  readonly fragment: <A extends readonly unknown[]>(
    f: (h: Helper<Props, Msg, L>, ...args: A) => View
  ) => (h: Helper<Props, Msg, L>, ...args: A) => View;
  /** Type a `subscriptions` function against the definition. Returns it unchanged. */
  readonly subscriptions: <
    F extends NonNullable<
      MakeImpl<Props, Model, Msg, never, Events, L>["subscriptions"]
    >,
  >(
    f: F
  ) => F;
  /**
   * Finish the component. Throws when `shares` is set (only a headless
   * component may share state). `R` is the implementation's
   * requirements plus the view's known ones and the queries' services.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  make<R = never, const V extends View = View>(
    impl: MakeImpl<Props, Model, Msg, R, Events, L> & {
      readonly view: (h: Helper<Props, Msg, L>, model: Model) => V;
    }
  ): ModelComponent<
    Props,
    Msg,
    R | QueryServices<L> | ViewRequires<V>,
    Events,
    L,
    Model
  >;
  /**
   * Finish a headless component: `parts(p, model)` instead of `view`. The
   * consumer's `view` closure receives the parts and owns everything it
   * declares. Throws when `slots` is declared (finish with `view` then).
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  make<R, Parts>(
    impl: HeadlessMakeImpl<Props, Model, Msg, R, Events, Parts>
  ): HeadlessComponent<Props, Msg, R, Events, Parts>;
  /**
   * Finish a headless owner with no parts. The consumer's `view` closure
   * receives `{}`.
   */
  // oxlint-disable-next-line typescript/method-signature-style -- public interface method; property form would change the public signature text.
  make<R>(
    impl: OwnerMakeImpl<Props, Model, Msg, R, Events>
    // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- headless owner with no parts: the empty object is the parts contract.
  ): HeadlessComponent<Props, Msg, R, Events, {}>;
}

/** Any erased definition. */
export type DefinitionAny = Definition<
  string,
  unknown,
  unknown,
  unknown,
  unknown,
  never
>;

type MsgTag<Msg> = Msg extends { readonly _tag: infer Tag }
  ? Tag & string
  : never;

/**
 * Options for `defineComponent`. `name` is used for paths, messages and the
 * log; the function's own name is untouched. There is no `restore`, `head`
 * or `elements`.
 */
export interface DefineOptions<
  Name extends string,
  Props,
  Model,
  Msg,
  Events,
  // oxlint-disable-next-line typescript/no-explicit-any, typescript/ban-types, typescript/no-empty-object-type -- QueryEntryInput takes any shape; the empty default means no declared queries.
  Q extends Record<string, QueryEntryInput<Model, Props, any>> = {},
> {
  readonly name: Name;
  /** Default `Schema.Struct({})`. */
  readonly props?: Schema.Schema<Props> | undefined;
  readonly model: Schema.Schema<Model>;
  /** Usually a `TaggedEnum`. */
  readonly message: Schema.Schema<Msg>;
  /** Default `Schema.Never`. */
  readonly events?: Schema.Schema<Events> | undefined;
  /** Declared query entries: per name, `{ query, args }` or `{ queryMany, args }`. */
  readonly queries?: Q | undefined;
  /** Declared slot names, read by the slots runtime. */
  readonly slots?: readonly string[] | undefined;
  /** Declared shared-state reads. `make` validates them. */
  readonly reads?: ReadsDecl | undefined;
  /** Declared shared state. Headless-only: with `view`, `make` throws. */
  readonly shares?: SharesDecl<Model, Props> | undefined;
}

/**
 * The two-step design: `define` holds everything nothing is inferred from,
 * so slices and views written outside the component can be typed against the
 * definition (typing them against `typeof Component` would be circular).
 */
export const defineComponent = <
  const Name extends string,
  // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- Props defaults to the empty object; fields are read through the props schema.
  Props = {},
  Model = never,
  Msg = never,
  Events = never,
  // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- Q defaults to no declared queries; SpecOf infers the empty spec.
  const Q extends Record<string, QueryEntryInput> = {},
>(
  options: DefineOptions<Name, Props, Model, Msg, Events, Q> & {
    readonly model: unknown;
    readonly message: unknown;
  }
): Definition<Name, Props, Model, Msg, Events, never, SpecOf<Q>> => {
  // SAFETY: options.props falls back to Schema.Struct({}); the schema is checked by decoding props at mount.
  const props = (options.props ?? Schema.Struct({})) as Schema.Schema<Props>;
  // SAFETY: options.events falls back to Schema.Never; emitting is impossible without the schema's messages.
  const events = (options.events ?? Schema.Never) as Schema.Schema<Events>;
  // SAFETY: definition is assembled from schema-checked options; the casts below only erase to the erased DefinitionAny the runtime reads.
  const definition = {
    events,
    fragment: <F>(f: F): F => f,
    init: <F>(f: F): F => f,
    make: ((impl: {
      readonly view?: unknown;
      readonly parts?: unknown;
      readonly subscriptions?: unknown;
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- make finishes the component; the returned component's calls are checked by h() against the definition.
    }): unknown => {
      const hasView = impl.view !== undefined;
      const hasParts = impl.parts !== undefined;
      if (hasView && hasParts) {
        throw new Error(`${options.name}: view and parts can't be combined`);
      }
      if (options.shares !== undefined && hasView) {
        throw new Error("only a headless component can share state");
      }
      if (hasParts && options.slots !== undefined && options.slots.length > 0) {
        throw new Error(
          `${options.name} declares slots, so it must finish with view, not parts`
        );
      }
      // SAFETY: definition is the object literal under construction; the runtime reads it back as the erased DefinitionAny.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening, anti-slop/no-unsafe-dictionary-type -- erasing the in-progress literal to the runtime's erased definition and shared record; fields are schema-checked at the boundary.
      checkReads(definition as unknown as DefinitionAny);
      // SAFETY: definition is the object literal under construction; the ~queries slot is filled by bind, which validates the declared entries.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening, anti-slop/no-unsafe-dictionary-type -- erasing the in-progress literal to set the runtime's ~queries slot; bind validates the declared entries.
      (definition as Record<string, unknown>)["~queries"] = bind(
        options.name,
        options.queries
      );
      const full = hasView || hasParts ? impl : { ...impl, parts: () => ({}) };
      // SAFETY: callProps defaults to the empty call options; props nest under props and are decoded at mount.
      const render = (
        // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- empty call options; props are decoded through the definition's props schema at mount.
        callProps: CallOptions<Props, never, Msg> = {} as CallOptions<
          Props,
          never,
          Msg
        >
      ): View =>
        renderModelComponent(
          getFiber(),
          // SAFETY: definition, full and callProps are the erased runtime triple the kernel reads back; the casts only erase static detail.
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- erasing to the kernel's erased input triple; schemas are checked at the boundary.
          definition as unknown as DefinitionAny,
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- erasing to the kernel's erased input triple; schemas are checked at the boundary.
          full as unknown as MakeImpl<unknown, unknown, never, never>,
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- erasing to the kernel's erased input triple; schemas are checked at the boundary.
          callProps as unknown as CallOptions<unknown, never>
        );
      if (hasView) {
        return Object.assign(render, {
          [TypeId]: TypeId,
          definition,
          definitionName: options.name,
          implementation: full,
        });
      }
      return Object.assign(render, {
        [HeadlessTypeId]: HeadlessTypeId,
        definition,
        definitionName: options.name,
        implementation: full,
      });
    }) as Definition<Name, Props, Model, Msg, Events, never, SpecOf<Q>>["make"],
    message: options.message as Schema.Schema<Msg>,
    model: options.model as Schema.Schema<Model>,
    name: options.name,
    props,
    queries: options.queries,
    reads: options.reads,
    shares: options.shares,
    slots: options.slots,
    subscriptions: <F>(f: F): F => f,
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- update narrows args by arity then dispatches; the slice path is validated by the tag check at run time.
    update: ((...args: readonly unknown[]) => {
      if (args.length === 2) {
        // SAFETY: the arity check guarantees [tag, f]; the tuple cast only names the two positions.
        // oxlint-disable-next-line anti-slop/no-unknown-returns -- tag slice receives the tagged message; the tag was checked by the arity gate above.
        const [tag, f] = args as [string, (...a: never[]) => unknown];
        const slice = (
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- slice closure receives the dispatch-time value and message; validated by the tag check above.
          $: unknown,
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- slice closure receives the dispatch-time value and message; validated by the tag check above.
          message: unknown
          // oxlint-disable-next-line anti-slop/no-unknown-returns -- slice result is a Step or Model, checked by isStep in the kernel dispatch.
        ): unknown =>
          // SAFETY: f is the second positional arg, checked by the arity gate; the cast only names its call shape.
          // oxlint-disable-next-line anti-slop/no-unknown-returns -- slice dispatches the checked slice function; the result is narrowed by isStep in the kernel.
          (f as (...a: unknown[]) => unknown)($, message);
        return Object.assign(slice, { [SliceTag]: tag });
      }
      return args[0];
    }) as Definition<
      Name,
      Props,
      Model,
      Msg,
      Events,
      never,
      SpecOf<Q>
    >["update"],
    view: <F>(f: F): F => f,
  };
  // SAFETY: definition was assembled from schema-checked options; the cast only erases to the public Definition the callers read.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- erasing the assembled literal to the public Definition; schemas are checked at the boundary.
  return definition as unknown as Definition<
    Name,
    Props,
    Model,
    Msg,
    Events,
    never,
    SpecOf<Q>
  >;
};

/**
 * A plain Ilha root component carrying a requirements phantom, so `mount`
 * and `renderToString` check it.
 */
export interface RootComponent<R = never> {
  (): View;
  /** The core requirements phantom. Never assigned. */
  readonly "~requires"?: R | undefined;
}

/**
 * The `Component` namespace: root, `noop`, guards, and the public types.
 */
// oxlint-disable-next-line eslint/no-redeclare, typescript/no-namespace -- Component const below holds the namespace's values; the namespace holds its public types.
export declare namespace Component {
  /**
   * Any model component: the call shape every `make` result satisfies. A
   * `ModelComponent<...>` instantiation cannot serve here (`Update`'s
   * `events` and `commands` arrays plus `evolve`'s weak-type check reject
   * concrete params in both directions), and even `CallOptions`' `onEmit`
   * union rejects both `never` and `any` events. So this reads only the
   * props, the name and the definition name.
   */
  export interface Any {
    // SAFETY: `any` props erase every concrete instantiation on purpose, like
    // the old `ModelComponent<any, ...>` constraint; `onEmit` stays `any`
    // so every events union fits.
    // oxlint-disable-next-line typescript/no-explicit-any -- intentional erasure, documented above.
    (
      // oxlint-disable-next-line typescript/no-explicit-any -- intentional erasure: the constraint must accept every model component.
      options: Omit<CallOptions<any, never, unknown>, "onEmit"> & {
        // oxlint-disable-next-line typescript/no-explicit-any -- onEmit stays any so every events union fits.
        readonly onEmit?: any;
      }
    ): View;
    readonly definitionName: string;
    readonly definition: { readonly name: string };
  }
  /** The props of a component. */
  export type Props<C> =
    C extends ModelComponent<infer P, unknown, never> ? P : never;
  /** The messages a component's `update` handles. */
  export type Message<C> =
    C extends ModelComponent<unknown, infer M, never> ? M : never;
  /** The Model of a component. */
  export type Model<C> = C extends {
    readonly definition: { readonly model: Schema.Schema<infer M> };
  }
    ? M
    : never;
  /** The events a component emits. */
  export type Events<C> = C extends {
    readonly definition: { readonly events: Schema.Schema<infer E> };
  }
    ? E
    : never;
  /** The requirements of a component. */
  export type Requirements<C> =
    C extends ModelComponent<unknown, never, infer R> ? R : never;
  /** The definition behind a component. */
  export type DefinitionOf<C> = C extends { readonly definition: infer Def }
    ? Def
    : never;
  /**
   * Shared-state requirement tokens, keyed by owner name at the type level.
   * A missing required owner is a runtime failure, not a type error.
   */
  // oxlint-disable-next-line typescript/no-namespace -- Shared groups the requirement token and its projection; a module split would break the public import shape.
  export namespace Shared {
    /** The requirement token of the owner named `Name`. */
    export interface Token<Name> {
      readonly "~shared": Name;
    }
    /** The shared-state requirement of the owner component `C`. */
    export type Of<C> = C extends {
      readonly definition: { readonly name: infer N };
    }
      ? Token<N>
      : never;
  }
}

/**
 * Services the runtime owns or reads once at mount: a `provide` Layer never
 * removes them from a component's requirements. Query and Shared services
 * join this union when those slices land.
 */
export type RuntimeService = Command.FrameworkService;

/**
 * `C` with `ROut` provided and `RIn` required instead. Name, Model and
 * message are kept, so paths and tests don't change. The params are read
 * off the definition (like `ChildPropsOf`): matching the whole
 * `ModelComponent<...>` rejects every concrete component.
 */
export type Provided<C, ROut, RIn> = ModelComponent<
  PropsOf<C>,
  MessageOf<C>,
  Exclude<RequirementsOf<C>, Exclude<ROut, RuntimeService>> | RIn,
  EventsOf<C>,
  QuerySpecOf<C>,
  ModelOf<C>
>;

/** The requirements of a component, read off its definition phantom. */
type RequirementsOf<C> = C extends {
  readonly definition: { readonly "~requires"?: infer R };
}
  ? NonNullable<R>
  : never;
/** The props of a component, read off its definition. */
type PropsOf<C> = C extends {
  readonly definition: { readonly props: Schema.Schema<infer P> };
}
  ? P
  : never;
/** The messages a component's `update` handles, read off its definition. */
type MessageOf<C> = C extends {
  readonly definition: { readonly message: Schema.Schema<infer M> };
}
  ? M
  : never;
/** The events a component emits, read off its definition. */
type EventsOf<C> = C extends {
  readonly definition: { readonly events: Schema.Schema<infer E> };
}
  ? E
  : never;
/** The Model of a component, read off its definition. */
type ModelOf<C> = C extends {
  readonly definition: { readonly model: Schema.Schema<infer M> };
}
  ? M
  : never;
/** The query spec of a component, read off its definition phantom. */
type QuerySpecOf<C> = C extends {
  readonly definition: { readonly "~L"?: infer L };
}
  ? [NonNullable<L>] extends [QuerySpec]
    ? NonNullable<L>
    : QuerySpec
  : QuerySpec;

/**
 * The keyed form of `provide`: `key` picks a selection from props and the
 * Model, and `layer` turns it into the Layer to build. The Layer rebuilds in
 * place when the key changes by `Equal`.
 */
export interface ProvideKeyed<Props, Model, Key, out L> {
  /** Pick the selection. Anything the Layer needs goes in the key. */
  readonly key: (props: Props, model: Model) => Key;
  /** Build the selection's Layer. */
  readonly layer: (key: Key) => L;
}

/**
 * What `provide` accepts: a Layer, an array of them (merged once, so the
 * elements don't see each other), a function of the mounting props, or a
 * keyed selection.
 */
export type ProvideInput =
  | Layer.Any
  | readonly Layer.Any[]
  // `any` props: a provider function takes any props shape, and callers
  // infer the concrete one at the call site.
  // oxlint-disable-next-line typescript/no-explicit-any -- provider functions take any props shape; the concrete props are inferred at the call site.
  | ((props: any) => Layer.Any)
  // oxlint-disable-next-line typescript/no-explicit-any -- ProvideKeyed carries erased key/layer types; provideGo narrows by isKeyedInput at run time.
  | ProvideKeyed<any, any, any, Layer.Any>;

/** The Layer type inside a provide input. */
// oxlint-disable-next-line typescript/no-explicit-any -- provider functions take any props shape; the concrete props are inferred at the call site.
export type ProvideLayerOf<L> = L extends (props: any) => infer R
  ? R
  : L extends readonly (infer E)[]
    ? E
    : // oxlint-disable-next-line typescript/no-explicit-any -- ProvideKeyed carries erased key/layer types; provideGo narrows by isKeyedInput at run time.
      L extends ProvideKeyed<any, any, any, infer R>
      ? R
      : L;

/** The services a provide input supplies. */
export type ProvideSuccess<L> = [ProvideLayerOf<L>] extends [
  // oxlint-disable-next-line typescript/no-explicit-any -- Layer success/error/requirement slots are projected out one by one; any marks the slots not read here.
  Layer.Layer<infer A, any, any>,
]
  ? A
  : never;
/** What a provide input's Layer can fail with. */
export type ProvideError<L> = [ProvideLayerOf<L>] extends [
  // oxlint-disable-next-line typescript/no-explicit-any -- Layer success/error/requirement slots are projected out one by one; any marks the slots not read here.
  Layer.Layer<any, infer E, any>,
]
  ? E
  : never;
/** The services a provide input's Layer still requires. */
export type ProvideServices<L> = [ProvideLayerOf<L>] extends [
  // oxlint-disable-next-line typescript/no-explicit-any -- Layer success/error/requirement slots are projected out one by one; any marks the slots not read here.
  Layer.Layer<any, any, infer R>,
]
  ? R
  : never;

/**
 * The options of `provide`. `onFailure` maps the Layer's failure to one of
 * the component's messages: the component stays mounted and Commands that
 * waited for the Layer are interrupted. Required when the Layer can fail.
 */
export interface ProvideOptions<in E, out Msg> {
  /**
   * Maps the Layer's failure to a message. Retry means re-keying.
   */
  readonly onFailure: (failure: AsyncResult.Failure<never, E>) => Msg;
  /**
   * Build a Layer value per instance, for state each instance must own. By
   * default a Layer value is shared by every instance resolving from one
   * Env.
   */
  readonly local?: boolean | undefined;
}

/**
 * The `local` option of `provide`, for Layers that can't fail.
 */
export interface LocalOption {
  readonly local?: boolean | undefined;
}

/**
 * The options argument of `provide`. Optional when the Layer can't fail with
 * a typed error, otherwise a required argument with `onFailure`.
 */
export type ProvideRest<L, Msg> = [ProvideError<L>] extends [never]
  ? [
      options?: LocalOption & {
        readonly onFailure?:
          | ((failure: AsyncResult.Failure<never, never>) => Msg)
          | undefined;
      },
    ]
  : [options: ProvideOptions<ProvideError<L>, Msg>];

/**
 * Passes unless the Layer can fail and no `onFailure` was given; then names
 * the error type in the compiler error.
 */
export type RequiresOnFailure<L, O> = [ProvideError<L>] extends [never]
  ? unknown
  : [O] extends [never]
    ? {
        readonly "This Layer can fail. Pass { onFailure } to handle": ProvideError<L>;
      }
    : unknown;

/**
 * Passes unless the Layer can fail, because the curried form has no
 * `onFailure`.
 */
export type CurriedCantFail<L> = [ProvideError<L>] extends [never]
  ? unknown
  : {
      readonly "This Layer can fail, and the curried form has no onFailure": ProvideError<L>;
    };

/**
 * The options of the keyed form of `provide`. `onFailure` is required when
 * the Layer can fail (and still hears defects when it can't). A keyed
 * provide builds per instance already, so `local` is rejected.
 */
export type KeyedRest<E, Msg> = [E] extends [never]
  ? [
      options?: {
        readonly onFailure?:
          | ((failure: AsyncResult.Failure<never, never>) => Msg)
          | undefined;
        readonly local?: never | undefined;
      },
    ]
  : [
      options: {
        readonly onFailure: (failure: AsyncResult.Failure<never, E>) => Msg;
        readonly local?: never | undefined;
      },
    ];

/**
 * Passes when the key's model parameter takes the component's Model.
 */
export type KeyTakes<C, M> = [Component.Model<C>] extends [M]
  ? unknown
  : {
      readonly "The key's model parameter doesn't take this component's Model": Component.Model<C>;
    };

/** Whether `u` is a keyed provide input. */
const isKeyedInput = (
  u: unknown
): u is ProvideKeyed<
  unknown,
  unknown,
  unknown,
  Layer.Layer<unknown, unknown, unknown>
> =>
  typeof u === "object" &&
  u !== null &&
  !Array.isArray(u) &&
  !Layer.isLayer(u) &&
  "key" in u &&
  "layer" in u;

/** The runtime options `provideGo` reads. */
interface ProvideGoOptions {
  readonly onFailure?:
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- failure handlers produce the component's Msg, checked by update at run time.
    ((failure: AsyncResult.Failure<never, unknown>) => unknown) | undefined;
  readonly local?: boolean | undefined;
}

/** Attach the spec chain for one `provide` to a component. */
const provideGo = (
  component: ModelComponent<unknown, never, never>,
  given: ProvideInput,
  options?: ProvideGoOptions | undefined
): ModelComponent<unknown, never, never> => {
  // SAFETY: component is the ModelComponent being provided to; the cast only reads its erased definition for the spec chain.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- erasing to read the definition and implementation for the spec chain.
  const inner = component as unknown as {
    readonly definition: DefinitionAny;
    readonly definitionName: string;
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the implementation record carries the provide spec chain keyed by the module-private ProvideSpecs symbol.
    readonly implementation: Record<string | symbol, unknown>;
    readonly [TypeId]: TypeId;
  };
  const specs = specsOf(inner.implementation);
  let spec: ProvideSpec;
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- given is the unvalidated provide input; isKeyedInput establishes its contract below.
  if (isKeyedInput(given)) {
    // SAFETY: given passed isKeyedInput; the cast only names its keyed shape for the spec below.
    const keyed = given as ProvideKeyed<
      unknown,
      unknown,
      unknown,
      Layer.Layer<unknown, unknown, unknown>
    >;
    // SAFETY: given is a keyed input here, checked by isKeyedInput; the casts only name its key and layer shapes.
    spec = {
      build: () => {
        throw new Error("Component.provide: unreachable keyed build");
      },
      key: keyed.key,
      layerOfKey: keyed.layer as (
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the key selection reads the component's key from the unknown keyed input; isKeyedInput validated its shape.
        key: unknown
      ) => Layer.Layer<unknown, unknown, unknown>,
      local: true,
      onFailure: options?.onFailure,
    };
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Layers are classes and provider functions are closures; the isLayer check rules out Layers first.
  } else if (typeof given === "function" && !Layer.isLayer(given)) {
    // SAFETY: given is a props function here, checked by the typeof gate; the cast only names its Layer-building shape.
    spec = {
      build: given as (
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- provider functions take any props shape; the key selection reads only what it needs.
        props: unknown
      ) => Layer.Layer<unknown, unknown, unknown>,
      key: undefined,
      layerOfKey: undefined,
      local: true,
      onFailure: options?.onFailure,
    };
  } else {
    let value: Layer.Layer<unknown, unknown, unknown>;
    if (!Array.isArray(given)) {
      // SAFETY: after the keyed and function branches, a non-array input is a Layer value; the cast only erases the union.
      value = given as Layer.Layer<unknown, unknown, unknown>;
    } else if (given.length === 0) {
      // SAFETY: an empty array provides no services; empty erases to the same Layer shape.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- empty provides no services; erasing to the same Layer shape tsc cannot relate directly.
      value = Layer.empty as unknown as Layer.Layer<unknown, unknown, unknown>;
    } else {
      // SAFETY: mergeAll of the non-empty tuple preserves the union; the cast only erases to the erased Layer shape.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- mergeAll of the non-empty tuple preserves the union; erasing to the shape tsc cannot relate directly.
      value = Layer.mergeAll(
        ...(given as [
          Layer.Layer<never, never, never>,
          ...Layer.Layer<never, never, never>[],
        ])
      ) as unknown as Layer.Layer<unknown, unknown, unknown>;
    }
    spec = {
      build: () => value,
      key: undefined,
      layerOfKey: undefined,
      local: options?.local === true,
      onFailure: options?.onFailure,
    };
  }
  const implementation = {
    ...inner.implementation,
    [ProvideSpecs]: [...specs, spec],
  };
  // SAFETY: outer renders through the kernel with the provided implementation; the casts only erase static detail.
  const outer = (callProps: CallOptions<unknown, never>): View =>
    renderModelComponent(
      getFiber(),
      inner.definition,
      implementation as never,
      callProps as never
    );
  // SAFETY: outer, inner and the implementation are the provided component; the cast only restores the public ModelComponent shape.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- erasing to restore the public component shape; schemas are checked at the boundary.
  return Object.assign(outer, inner, {
    implementation,
  }) as unknown as ModelComponent<unknown, never, never>;
};

/**
 * Provides services to a component and everything below it. Returns the same
 * component with `R` becoming the provided services removed and the Layer's
 * requirements added.
 *
 * A Layer *value* is built once per Env plus Layer identity,
 * reference-counted, and shared between instances resolving from that Env.
 * `{ local: true }` or a function of props builds once per instance, at
 * mount. An array is merged once with `Layer.mergeAll`. Nested provides let
 * the inner one win, and the inner one can use the outer one's services.
 * Builds run in the background: the component renders from `init` at once,
 * and its Commands and Subscriptions wait for the Layer. A keyed provide
 * reselects the Layer in place when `key(props, model)` changes.
 */
export const provide: {
  // oxlint-disable-next-line typescript/no-explicit-any -- Layer slots are erased at the boundary; provideGo narrows the input by shape at run time.
  <C extends Component.Any, L extends Layer.Layer<any, any, any>>(
    component: C,
    layer: (props: PropsOf<C>) => L
  ): Provided<C, ProvideSuccess<L>, ProvideServices<L>>;
  // oxlint-disable-next-line typescript/no-explicit-any -- Layer slots are erased at the boundary; provideGo narrows the input by shape at run time.
  <C extends Component.Any, L extends Layer.Layer<any, any, any>>(
    component: C,
    layer: (props: PropsOf<C>) => L,
    // oxlint-disable-next-line typescript/unified-signatures -- the options/no-options overloads have different docs and call shapes; combining would change the public contract.
    options: ProvideOptions<ProvideError<L>, MessageOf<C>>
  ): Provided<C, ProvideSuccess<L>, ProvideServices<L>>;
  // oxlint-disable-next-line typescript/no-explicit-any -- Layer slots are erased at the boundary; provideGo narrows the input by shape at run time.
  <C extends Component.Any, M, K, L extends Layer.Layer<any, any, any>>(
    component: C & KeyTakes<C, M>,
    keyed: ProvideKeyed<PropsOf<C>, M, K, L>,
    ...options: KeyedRest<ProvideError<L>, MessageOf<C>>
  ): Provided<C, ProvideSuccess<L>, ProvideServices<L>>;
  <
    C extends Component.Any,
    const L extends ProvideInput,
    const O extends ProvideRest<ProvideLayerOf<L>, MessageOf<C>>[0] = never,
  >(
    component: C,
    layer: L & RequiresOnFailure<ProvideLayerOf<L>, O>,
    options?: O & ProvideRest<ProvideLayerOf<L>, MessageOf<C>>[0]
  ): Provided<
    C,
    ProvideSuccess<ProvideLayerOf<L>>,
    ProvideServices<ProvideLayerOf<L>>
  >;
  // oxlint-disable-next-line typescript/no-explicit-any -- Layer slots are erased at the boundary; provideGo narrows the input by shape at run time.
  <L extends Layer.Layer<any, any, any>>(
    // oxlint-disable-next-line typescript/no-explicit-any -- provider functions take any props shape; the concrete props are inferred at the call site.
    layer: (props: any) => L
  ): <C extends Component.Any>(
    component: C
  ) => Provided<C, ProvideSuccess<L>, ProvideServices<L>>;
  <const L extends ProvideInput>(
    layer: L & CurriedCantFail<ProvideLayerOf<L>>,
    options?: LocalOption
  ): <C extends Component.Any>(
    component: C
  ) => Provided<
    C,
    ProvideSuccess<ProvideLayerOf<L>>,
    ProvideServices<ProvideLayerOf<L>>
  >;
  // oxlint-disable-next-line typescript/no-explicit-any -- Layer slots are erased at the boundary; provideGo narrows the input by shape at run time.
  <Props, Model, K, L extends Layer.Layer<any, any, any>>(
    keyed: ProvideKeyed<Props, Model, K, L>,
    options?: { readonly local?: never | undefined }
  ): <C extends Component.Any & KeyTakes<C, Model>>(
    component: C
  ) => Provided<C, ProvideSuccess<L>, ProvideServices<L>>;
  // oxlint-disable-next-line anti-slop/no-known-value-widening, anti-slop/require-safety-comment-for-type-assertion -- the overload object is the public provide contract; the curried implementation narrows by arity at run time.
} = ((...args: unknown[]) => {
  if (isComponent(args[0])) {
    // SAFETY: args holds the provided component and its provide input; the casts only erase to the erased runtime triple.
    return provideGo(
      args[0] as ModelComponent<unknown, never, never>,
      args[1] as ProvideInput,
      args[2] as ProvideGoOptions | undefined
    );
  }
  // SAFETY: component is the provided component and args hold its provide input; the casts only erase to the erased runtime triple.
  return (component: ModelComponent<unknown, never, never>) =>
    provideGo(
      component,
      args[0] as ProvideInput,
      args[1] as ProvideGoOptions | undefined
    );
}) as never;

/**
 * Identifies a lazy component.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const LazyTypeId = "~@ilha/model/Lazy" as const;

/**
 * Identifies a lazy component.
 */
export type LazyTypeId = typeof LazyTypeId;

/**
 * A component whose module loads on first render. The parent declares it as
 * it would the loaded component; `fallback` gets `Initial` while loading
 * and `Failure` if the load fails.
 */
export interface Lazy<Props, Events, R = never> {
  (
    options: {
      readonly key?: string | undefined;
      readonly onEmit?:
        // oxlint-disable-next-line anti-slop/no-unknown-returns -- lazy handlers produce the parent's Msg, checked by update at run time.
        | ((event: never) => unknown)
        // oxlint-disable-next-line anti-slop/no-unknown-returns -- per-tag lazy handlers produce the parent's Msg, checked by update at run time.
        | Readonly<Record<string, (event: never) => unknown>>
        | undefined;
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- composed failure handler produces the parent's Msg, checked by update at run time.
      readonly onFailure?: ((failure: FallbackFailure) => unknown) | undefined;
      readonly fallback: (
        result:
          | AsyncResult.Initial<never, unknown>
          | AsyncResult.Failure<never, unknown>
      ) => View;
      // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- Props defaults to unknown; {} extends Props detects a missing props declaration.
    } & ({} extends Props
      ? { readonly props?: Props | undefined }
      : { readonly props: Props }) &
      OnHandlers<Events>
  ): View;
  /** The lazy name: stands in for the path name before the module arrives. */
  readonly [LazyTypeId]: { readonly name: string };
  /** Start the load without rendering. Settles without rejecting. */
  readonly preload: () => Promise<void>;
  /** The core requirements phantom. Never assigned. */
  readonly "~requires"?: R | undefined;
}

/**
 * Whether `u` is a lazy component built by `Component.lazy`.
 */
export const isLazy = (u: unknown): u is Lazy<unknown, unknown, never> =>
  typeof u === "function" &&
  // SAFETY: LazyTypeId is a module-private const brand; the cast only reads it off the lazy shell.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- reading the module-private lazy brand; compared by identity.
  (u as unknown as Record<string | symbol, unknown>)[LazyTypeId] !== undefined;

/**
 * Declares a component whose module loads the first time one of its children
 * renders. `load` returns the component, usually from a dynamic `import()`.
 * The first child rendered starts the load, once per app; `preload` starts
 * it without rendering. A failed load retries on the next mount.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- lazy wraps any model component; the concrete types are projected back through PropsOf and friends.
export const lazy = <C extends ModelComponent<any, any, any, any>>(
  name: string,
  load: () => Promise<C>
): Lazy<PropsOf<C>, EventsOf<C>, RequirementsOf<C>> =>
  // SAFETY: makeLazy returns the loaded component shape; the cast only erases to the public Lazy the parent reads.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- erasing the lazy shell to the public Lazy; the module load provides the real component.
  Object.assign(makeLazy(name, load), {
    [LazyTypeId]: { name },
  }) as unknown as Lazy<PropsOf<C>, EventsOf<C>, RequirementsOf<C>>;

/**
 * Options for `Component.clientOnly`.
 */
export interface ClientOnlyOptions {
  /** Rendered on the server instead of the component. */
  readonly fallback: (result: AsyncResult.Initial<never, unknown>) => View;
}

/**
 * Renders `fallback` on the server and the component on the client (after
 * hydration in the hydrate case). Removes `Client` from `R`, so roots using
 * it pass `renderToString`.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- clientOnly wraps any model component; the concrete types are projected back through PropsOf and friends.
export const clientOnly = <C extends ModelComponent<any, any, any, any>>(
  component: C,
  options: ClientOnlyOptions
): ModelComponent<
  PropsOf<C>,
  MessageOf<C>,
  Exclude<RequirementsOf<C>, Client>,
  EventsOf<C>
> => {
  // SAFETY: component is the ModelComponent being wrapped; the cast only reads its erased runtime fields.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- reading the component's erased runtime fields; the definition schema is checked at mount.
  const inner = component as unknown as Record<string | symbol, unknown>;
  const outer = (callProps: CallOptions<unknown, never>): View => {
    let ssr = false;
    try {
      ({
        runtime: { ssr },
      } = getFiber());
    } catch {
      ssr = typeof window === "undefined";
    }
    if (ssr) {
      return options.fallback(AsyncResult.initial(false));
    }
    // SAFETY: outer renders through the kernel with this component's own definition; the cast only erases static detail.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- erasing to the kernel's call shape; the fiber and definition are the dispatch inputs.
    const renderComponent = component as unknown as (
      callProps: CallOptions<unknown, never>
    ) => View;
    return renderComponent(callProps);
  };
  // SAFETY: outer and inner are the same component with an erased implementation; the cast only restores the public ModelComponent shape.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- erasing to restore the public component shape; schemas are checked at the boundary.
  return Object.assign(outer, inner) as unknown as ModelComponent<
    PropsOf<C>,
    MessageOf<C>,
    Exclude<RequirementsOf<C>, Client>,
    EventsOf<C>
  >;
};

/**
 * Component utilities: `root`, `noop`, and guards.
 */
export const Component = {
  /** Renders `fallback` on the server and the component on the client. */
  clientOnly,

  /** Whether `u` is a model component function. */
  isComponent,

  /** Whether `u` is a lazy component built by `Component.lazy`. */
  isLazy,

  /**
   * Whether `u` is the `noop` message. Matches by type id, not identity, so
   * it works across duplicate copies of `effect` in one bundle.
   */
  isNoop,

  /** Declares a component whose module loads on first render. */
  lazy,

  /**
   * The result of a Command body, mapper or mount that has nothing to
   * report. The runtime sends nothing and logs no `Update`.
   */
  noop,

  /** Provides services to a component and everything below it. */
  provide,

  /**
   * Turn a model component into a plain Ilha component for `mount`,
   * `renderToString` and island adapters. Keeps any `Client` requirement in
   * the root's phantom, so `mount` accepts it and `renderToString` rejects
   * it. A root's failure goes to the island's `onError`.
   */
  root<Props, Msg, R, Events, L extends QuerySpec, Model>(
    component: ModelComponent<Props, Msg, R, Events, L, Model>,
    // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- root props default to the empty object when the component takes none.
    ...args: {} extends Props
      ? readonly [props?: Props]
      : readonly [props: Props]
  ): RootComponent<R> {
    // SAFETY: args[0] is the root props the caller passed; the cast only erases to the call options the component reads.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- erasing the root props to the call options the component reads; decoded by the props schema at mount.
    const options = { props: args[0] } as unknown as CallOptions<
      Props,
      Events,
      unknown
    >;
    // SAFETY: the IIFE mounts the component on the root fiber with a bridged props box; the cast only erases to the public RootComponent.
    return (() => {
      // The record mounts directly on the root fiber, which has no props
      // box. Descendants painted under plain elements render on shallow
      // fiber copies that skip the parent, so they resolve the parent only
      // through the shared box: bridge it here, or children mount as extra
      // roots and their emits never reach this component.
      const fiber = getFiber();
      // SAFETY: the root fiber has no props box yet; the empty PropBag bridges descendants to this component.
      fiber.propsBox ??= { current: {} as PropBag };
      return component(options);
    }) as RootComponent<R>;
  },
};

/** Build the update `$` for one dispatch. Used by the kernel. */
export const makeUpdateApi = <
  Model,
  Msg,
  Props,
  R = never,
  L extends QuerySpec = QuerySpec,
>(
  model: Model,
  props: Props,
  activeTag: string | undefined = undefined,
  reads: MessageLog.SharedRecord = {},
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- internal dispatch default; {} is the empty shared record, queries bind by name at render.
  queries: QueryResults<L> = {} as QueryResults<L>,
  message: Msg | undefined = undefined
): Update<Model, Msg, Props, R, never, L> =>
  new UpdateApi<Model, Msg, Props, R, never, L>(
    model,
    props,
    [],
    [],
    undefined,
    activeTag,
    [],
    reads,
    queries,
    [],
    message
  );

/** Build the init `$`. Used by the kernel. */
export const makeInitApi = <Model, Props, Msg>(
  props: Props,
  set: (model: Model) => InitStep<Model, Msg, never>
): Init<Model, Props, Msg> => ({ props, set });

/** Build an `init` step holding a Model. Used by the kernel. */
export const initStepOf = <Model, Msg>(
  model: Model
  // oxlint-disable-next-line unicorn/no-useless-undefined -- stepBase's transition parameter is required; explicit undefined means "no transition".
): InitStep<Model, Msg, never> => stepBase(model, [], [], undefined);

/** The slice brand a `combine` validates. Used by the kernel. */
// SAFETY: sliceTagOf only reads the module-private SliceTag brand off a function; the result is narrowed to string before use.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- any value may be tested for the slice brand; narrowing happens via the brand read.
export const sliceTagOf = (fn: unknown): string | undefined =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- functions are the only values carrying SliceTag; the brand read below establishes the contract.
  typeof fn === "function"
    ? // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- erasing the function to read the module-private brand; the result is narrowed to string before use.
      ((fn as unknown as Record<string | symbol, unknown>)[SliceTag] as
        | string
        | undefined)
    : undefined;
