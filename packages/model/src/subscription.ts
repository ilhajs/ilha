/**
 * Subscriptions: keyed Streams an instance runs while it asks for them. A
 * component's `subscriptions` is re-run on mount, after each `update` and on
 * a props change; the result is diffed by key. Rule of thumb: if the
 * lifetime is an event, use a Command; if you can say "while …", use a
 * Subscription. Ported from Effect UI's `subscription.ts`.
 */
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";

import { keyOf } from "./internal/subscriptions.ts";

/**
 * Identifies a Subscription.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair: the const is the brand value, the type its brand type.
export const TypeId = "~@effect/ui/Subscription" as const;

/**
 * Identifies a Subscription.
 */
export type TypeId = typeof TypeId;

/**
 * A keyed Stream declaration. `key` identifies the Subscription across
 * renders: the runtime diffs by it, and two entries of one `subscriptions`
 * result that share a key fail the instance. `name` and `deps` are what
 * `make` built the key from. `deps` is always an array, or `undefined` for
 * a Subscription with no deps. `stream` has `E = never`: a defect fails the
 * instance, and a Stream that ends stays stopped until its key leaves and
 * comes back.
 */
export interface Subscription<Msg, R = never> {
  readonly [TypeId]: TypeId;
  readonly key: string;
  readonly name: string;
  readonly deps?: readonly Dep[] | undefined;
  readonly stream: Stream.Stream<Msg, never, R>;
}

/**
 * The primitives a Subscription may depend on. They're joined into the key.
 */
export type Dep = string | number | boolean | null;

/**
 * One dependency or a tuple of them.
 */
export type Deps = Dep | readonly Dep[];

/**
 * The requirements of a Subscription, or of a union of them.
 */
export type Requirements<S> =
  S extends Subscription<unknown, infer R> ? R : never;

/**
 * Whether `u` is a Subscription declaration.
 */
export const isSubscription = (
  u: unknown
): u is Subscription<unknown, unknown> => Predicate.hasProperty(u, TypeId);
/**
 * The key a Subscription with `name` (and optional `deps`) runs under:
 * `name` alone, or `name` joined to the JSON of its deps. The runtime diffs
 * these keys to start and stop Subscriptions.
 */
export { keyOf } from "./internal/subscriptions.ts";

/**
 * Names a Subscription: a keyed Stream the instance runs while its key is
 * listed. With deps, the builder sees only its deps, never the Model, and
 * the Stream is built lazily when it starts, so it never builds on the
 * server. Different deps give different keys, so the old key closes before
 * the new one starts.
 */
const makeImpl = <Msg>(
  name: string,
  depsOrStream: Deps | Stream.Stream<Msg, never, never>,
  build?: (deps: never) => Stream.Stream<Msg, never, never>
): Subscription<Msg, never> => {
  if (build === undefined) {
    return {
      [TypeId]: TypeId,
      deps: undefined,
      key: keyOf(name),
      name,
      // SAFETY: the stream branch carries depsOrStream as the stream; the deps branch below proves the other case.
      stream: depsOrStream as Stream.Stream<Msg, never, never>,
    };
  }
  // SAFETY: the stream branch returned above, so depsOrStream is the deps here; Deps is its static type.
  const deps = depsOrStream as Deps;
  return {
    [TypeId]: TypeId,
    // SAFETY: Array.isArray narrows the union; wrapping a single dep keeps the key-diffable tuple shape.
    deps: (Array.isArray(deps) ? deps : [deps]) as readonly Dep[],
    key: keyOf(name, deps),
    name,
    // SAFETY: build takes the normalized deps; never matches the runtime D in either arity.
    stream: Stream.suspend(() => build(deps as never)),
  };
};
/**
 * Names a Subscription: a keyed Stream the instance runs while its key is
 * listed (see above for the lifetime rules).
 */
// SAFETY: makeImpl handles both arities at runtime; the overloads below are the contract and the export pins it.
export const make: {
  <Msg, R = never>(
    name: string,
    stream: Stream.Stream<Msg, never, R>
  ): Subscription<Msg, R>;
  <Msg, R, D extends Deps>(
    name: string,
    deps: D,
    build: (
      deps: D extends readonly Dep[] ? D : D
    ) => Stream.Stream<Msg, never, R>
  ): Subscription<Msg, R>;
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- the impl's narrow signature has no single-step assertion to the overloaded export type, and the overloads are the public contract.
} = makeImpl as unknown as typeof make;

/**
 * The controls a `direct` Subscription's attach function gets: synchronous
 * dispatch for host packages.
 */
export interface DirectControls<State, Msg> {
  /** Dispatch a message synchronously, then call `accepted` if given. */
  readonly emit: (message: Msg, accepted?: () => void) => void;
  /** Fail the instance in `"subscription"`. */
  readonly fail: (cause: unknown) => void;
  /** Read the latest state: updated on every `subscriptions` run. */
  readonly enter: (f: (latest: State) => void) => void;
}

/**
 * A Subscription that attaches synchronously to a host event source instead
 * of running a Stream. `attach` returns a detach function. `state` is
 * updated on every `subscriptions` run for the key; read it inside `enter`.
 * `deps` may be `undefined` for a Subscription keyed by name alone.
 */
export const direct = <Msg, R, State, D extends Deps | undefined>(
  name: string,
  deps: D,
  state: State,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- host-provided attach context, untyped at the seam.
  attach: (context: unknown, controls: DirectControls<State, Msg>) => () => void
): Subscription<Msg, R> & {
  readonly directState: State;
  readonly directAttach: typeof attach;
} => {
  const depsList = Array.isArray(deps) ? deps : [deps];
  // SAFETY: Array.isArray narrows the union above; wrapping a single dep keeps the key-diffable tuple shape.
  const normalized =
    deps === undefined ? undefined : (depsList as readonly Dep[]);
  // SAFETY: normalized mirrors makeImpl's key-diffable deps shape; the record only pins the overloaded export type.
  return {
    [TypeId]: TypeId,
    deps: normalized,
    directAttach: attach,
    directState: state,
    key: keyOf(name, deps),
    name,
    stream: Stream.empty,
  } as Subscription<Msg, R> & {
    readonly directState: State;
    readonly directAttach: typeof attach;
  };
};

/**
 * Whether a Subscription was built with `direct`.
 *
 * @internal
 */
export const isDirect = (
  subscription: Subscription<unknown, unknown>
): subscription is Subscription<unknown, unknown> & {
  readonly directState: unknown;
  readonly directAttach: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- host-provided attach context, untyped at the seam.
    context: unknown,
    controls: DirectControls<unknown, unknown>
  ) => () => void;
} => "directAttach" in subscription;
