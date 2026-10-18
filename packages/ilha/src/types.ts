import type { Effect, Stream } from "effect";
import type { Atom } from "effect/reactivity";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import type { Closeable } from "effect/Scope";

export type JsonText = string | number | bigint | boolean | null | undefined;

/** Runtime prop bag values painted onto elements / passed to components. */
export type PropValue =
  | JsonText
  | PropBag
  | StyleObject
  | EventHandler
  | AtomHandle<JsonText>
  | readonly PropValue[];

export type StyleObject = Readonly<
  Record<string, string | number | null | undefined>
>;

/** Event and ref callbacks. `never` accepts handlers typed for a specific event. */
export type EventHandler = (event: never) => void;

/** Indexed bag — interface so PropValue can recurse without a circular type alias. */
export interface PropBag {
  readonly [key: string]: PropValue | undefined;
}

export type View =
  | VNode
  | UnsafeHtml
  | JsonText
  | AtomView
  | Stream.Stream<View, unknown, unknown>
  | GeneratorFn
  | Component
  | View[]
  | Iterable<View>;

// Fragment value and type share a name (JSX Fragment + VNode.type brand).
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
export const Fragment: unique symbol = Symbol("ilha.Fragment");
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
export type Fragment = typeof Fragment;

export type ComponentFn = (
  props: PropBag
) => View | Promise<View | undefined> | undefined;

/** JSX/tag component with its own props shape (Provider, ErrorBoundary, …). */
export type JsxComponent = (
  props: never
) =>
  | View
  | Promise<View | undefined>
  | Generator<View, View | undefined, View>
  | undefined;

/** Raw HTML view produced by `unsafe()` — painted without escaping. */
export interface UnsafeHtml {
  readonly $$ilhaUnsafe: 1;
  readonly html: string;
}

export interface VNode {
  readonly $$ilha: 1;
  readonly type: string | Fragment | ComponentFn | JsxComponent;
  readonly props: PropBag;
  readonly children: View[];
  readonly key?: string | number;
}

export type GeneratorFn = () => Generator<Yielded, View | undefined, View>;

export type Yielded =
  | View
  | Instruction<unknown>
  | Effect.Effect<unknown, unknown, unknown>;

export interface Instruction<A, E = Error>
  extends Iterable<Instruction<A, E>, A>, PromiseLike<A> {
  readonly $$ilhaOp: 1;
  readonly effect: Effect.Effect<A, E, AtomRegistry>;
}

export type Component =
  | (() => View | undefined | Promise<View | undefined>)
  | GeneratorFn;

export interface IlhaRuntime {
  readonly registry: AtomRegistry;
  readonly scope: Closeable;
  /** Run an effect synchronously with the mount's `AtomRegistry` provided. */
  readonly fork: <A, E>(effect: Effect.Effect<A, E, AtomRegistry>) => A;
  readonly ssr: boolean;
  readonly ssrValues: unknown[];
  hydrateValues?: unknown[];
  hydrateI: number;
  holeSeq: number;
  begin: () => void;
  end: () => void;
  later: (fn: () => void) => void;
  setIdle: (cb: () => void) => void;
  close: () => void;
  /**
   * The mount's failure hook. Called for a failing root component and for a
   * nested component no `ErrorBoundary` caught, before the error view paints.
   */
  onError?: (error: Error) => void;
}

/** Any atom handle as a view: the painter subscribes to `atom`, whatever it holds. */
export interface AtomView {
  readonly $$atom: 1;
  readonly atom: Atom.Atom<unknown>;
}

export interface AtomHandle<A> {
  readonly $$atom: 1;
  readonly atom: Atom.Atom<A>;
  (): A;
  set: (next: A) => void;
  update: (f: (current: A) => A) => void;
}

/** Equality for plain-value atoms. `"structural"` deep-compares JSON-shaped values. */
export type AtomEquality<A> = "structural" | ((prev: A, next: A) => boolean);

export interface AtomOptions<A = unknown> {
  /** Skip subscriber notify when `equals(prev, next)` holds. Plain values only. */
  readonly equals?: AtomEquality<A>;
  /**
   * Set `false` to keep a plain-value slot out of the SSR snapshot. The slot
   * starts from its initial value on hydration. Default `true`.
   */
  readonly snapshot?: boolean;
}

/** Options for `atom.lazy()`. */
export interface AtomLazyOptions {
  /**
   * Set `false` to keep the slot out of the SSR snapshot, for timers,
   * observers, and other mutable refs. Default `true`.
   */
  readonly snapshot?: boolean;
}

/** Optional disposer returned from `watch.once`. */
export type WatchOnceCleanup = () => void;

/**
 * Cancellation context handed to watch callbacks. `signal` aborts when the
 * run goes stale (a newer value arrives), on unmount, or on slot disposal.
 * Register extra teardowns with `onCleanup`.
 */
export interface WatchContext {
  readonly signal: AbortSignal;
  onCleanup: (fn: () => void) => void;
}

export type WatchCallback<A> = (
  value: A,
  ctx: WatchContext
) => WatchOnceCleanup | undefined | Promise<WatchOnceCleanup | undefined>;

export interface MountOptions {
  hydrate?: boolean;
  /**
   * Called with a failing root component, and with a nested component no
   * `ErrorBoundary` caught, before the error view paints.
   */
  onError?: (error: Error) => void;
  /**
   * Called each time the mount has no pending work left: after the first
   * paint and again after every rerender, async component, and watcher
   * settles. Use it to learn when the DOM reflects an atom update.
   */
  onIdle?: () => void;
}
