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

export type EventHandler = (event: Event) => void;

/** Indexed bag — interface so PropValue can recurse without a circular type alias. */
export interface PropBag {
  readonly [key: string]: PropValue | undefined;
}

export type ActionArg = JsonText | PropBag | readonly ActionArg[];

export interface SsrAction {
  readonly k: string;
  readonly a: readonly ActionArg[];
}

export type View =
  | VNode
  | UnsafeHtml
  | JsonText
  | AtomHandle<unknown>
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
  readonly ssr: boolean;
  readonly ssrValues: unknown[];
  ssrActions: Record<string, SsrAction>;
  ssrEventI: number;
  ssrCapture: boolean;
  hydrateValues?: unknown[];
  hydrateI: number;
  nextHole: () => number;
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

/** Options for `resource()`. */
export interface ResourceOptions {
  /** Serve cached data while revalidating in the background. Default `true`. */
  readonly staleWhileRevalidate?: boolean;
}

/** Async fetch scoped to a resource key. Receives an abort signal. */
export type ResourceFetcher<T> = (
  key: string,
  ctx: { signal: AbortSignal }
) => Promise<T>;

/** Handles returned by `resource()`. */
export interface Resource<T> {
  readonly data: AtomHandle<T | undefined>;
  readonly error: AtomHandle<unknown>;
  readonly loading: AtomHandle<boolean>;
  refetch: () => Promise<T | undefined>;
}

/** Connection state of a `fromEventSource` feed. */
export type EventSourceStatus = "connecting" | "open" | "retrying" | "closed";

/** Options for `fromEventSource()`. */
export interface EventSourceOptions<T = string> {
  /** Named event to listen for. Default: the `message` event. */
  readonly event?: string;
  /** Decode (and validate) `data` into `T`. Throwing skips the message. */
  readonly schema?: (data: string) => T;
  /** Base backoff between reconnects. Default `1000`. Capped at 30s. */
  readonly retryBaseMs?: number;
}

/** Live server-sent-events feed. */
export interface EventSourceFeed<T = string> {
  /** Paint with `yield Stream.map(feed.stream, ...)`; watch `latest` instead in sync components. */
  readonly stream: Stream.Stream<T, never, never>;
  readonly status: AtomHandle<EventSourceStatus>;
  readonly latest: AtomHandle<T | undefined>;
}
