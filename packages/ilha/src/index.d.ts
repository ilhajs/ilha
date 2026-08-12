interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}
declare namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: Types<Input, Output> | undefined;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
  }
  type Result<Output> = SuccessResult<Output> | FailureResult;
  interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  interface PathSegment {
    readonly key: PropertyKey;
  }
  interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
  type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}
declare const RAW: unique symbol;
declare const SIGNAL_ACCESSOR: unique symbol;
declare const ISLAND: unique symbol;
declare const ISLAND_CALL: unique symbol;
/** @internal Internal hook used by a parent's mountSlots to mount a child island and
 * retain a handle to push updated props into it on subsequent parent
 * re-renders. Not part of the public surface. */
export declare const ISLAND_MOUNT_INTERNAL: unique symbol;
/** @internal Live mount handles keyed by host element. Lets @ilha/router adopt
 * islands hydrated by `ilha.mount()` (whose handles it never saw) and push new
 * loader props into them in place instead of remounting. Entries are removed
 * on unmount. Not part of the public surface. */
export declare const ISLAND_MOUNT_HANDLES: WeakMap<
  Element,
  {
    unmount: () => void | Promise<void>;
    updateProps: (props?: Record<string, unknown>) => void;
  }
>;
export interface RawHtml {
  [RAW]: true;
  value: string;
}
interface IslandCall {
  [ISLAND_CALL]: true;
  island: AnyIsland;
  props: Record<string, unknown> | undefined;
  key: string | undefined;
}
export type NativeEventModifier = "abortable" | "once" | "capture" | "passive";
export interface NativeEventContext {
  readonly signal: AbortSignal;
}
export type NativeEventHandler<E extends Event = Event> = (
  event: E,
  context: NativeEventContext,
) => unknown;
type NonFunctionValue<T> = T extends (...args: any[]) => any ? never : T;
export type SignalSetter<T> = NonFunctionValue<T> | ((previous: T) => T);
declare const SIGNAL_WRITER_TYPE: unique symbol;
/** @internal Type-level write target carried by signal accessors. */
export interface SignalWriter<T> {
  readonly [SIGNAL_WRITER_TYPE]?: (value: T) => void;
}
interface MarkedSignalAccessor<T> extends SignalWriter<T> {
  (): T;
  (...args: [value: SignalSetter<T>]): void;
  select<S>(selector: (state: T) => S): MarkedSignalAccessor<S>;
  [SIGNAL_ACCESSOR]: true;
}
declare function ilhaRaw(value: string): RawHtml;
declare function ilhaCss(
  strings: TemplateStringsArray | string,
  ...values: (string | number)[]
): string;
declare function ilhaHtml(strings: TemplateStringsArray, ...values: unknown[]): RawHtml;
type ContextSignal<T> = {
  (): T;
  (value: SignalSetter<T>): void;
};
declare function ilhaContextFn<T>(key: string, initial: T): ContextSignal<T>;
/**
 * Create a free-standing reactive signal that lives outside any island.
 * Useful for sharing state across islands without prop drilling, or for
 * binding form inputs to module-level state via the `bind:value=${signal}`
 * template syntax.
 *
 * The returned accessor is a getter when called with no arguments and a
 * setter when called with one. Reading it inside a `.derived()`, `.effect()`,
 * or `.render()` automatically subscribes the surrounding reactive scope —
 * so when the signal changes, dependents re-run as if it were local state.
 */
export declare function ilhaSignal<T>(initial: T): SignalAccessor<T>;
/**
 * Create a free-standing read-only reactive value derived from other signals.
 * The computation is lazy and cached: `fn` re-runs only when a signal it read
 * changed and the computed is read again. Reading it inside a `.derived()`,
 * `.effect()`, `.render()`, or top-level `effect()` subscribes that scope —
 * dependents re-run when the computed's value changes.
 *
 * ```ts
 * const items = ilha.signal([1, 2, 3]);
 * const total = ilha.computed(() => items().reduce((a, b) => a + b, 0));
 * ```
 */
declare function ilhaComputed<T>(fn: () => T): SignalAccessor<T>;
/**
 * Run a free-standing reactive effect outside any island. `fn` runs once
 * immediately and again whenever a signal it read changes. It may return a
 * cleanup function, invoked before each re-run and on stop. Signal writes
 * inside the effect are batched. Returns a stop function that disposes the
 * effect and runs the final cleanup.
 *
 * ```ts
 * const stop = effect(() => {
 *   document.title = `${cart.count()} items`;
 * });
 * ```
 */
declare function ilhaEffect(fn: () => void | (() => void)): () => void;
/**
 * Run `fn` with reactive tracking suspended. Reading signals inside `fn`
 * returns their current value without subscribing the surrounding scope.
 * Use this in effects/deriveds when you want to peek at state without
 * causing a re-run on its changes.
 */
export declare function untrack<T>(fn: () => T): T;
/**
 * Run `fn` as an atomic batch — multiple signal writes inside the callback
 * produce a single propagation pass, so dependents (effects, deriveds,
 * island re-renders) see the final state and run once instead of once per
 * write. Returns whatever `fn` returns.
 *
 * Note: `.on()` handlers and `.effect()` runs are batched implicitly, so
 * you only need this when triggering multiple writes from outside an
 * island (e.g. from a top-level event listener or async callback).
 */
export declare function batch<T>(fn: () => T): T;
export interface DerivedValue<T> {
  loading: boolean;
  value: T | undefined;
  error: Error | undefined;
}
export type DerivedAccessor<T> = {
  readonly loading: boolean;
  readonly value: T | undefined;
  readonly error: Error | undefined;
  (): T | undefined;
  (value: T): void;
};
type DerivedFnContext<TInput, TStateMap extends Record<string, unknown>> = {
  state: IslandState<TStateMap>;
  input: TInput;
  signal: AbortSignal;
};
type DerivedFn<TInput, TStateMap extends Record<string, unknown>, V> = (
  ctx: DerivedFnContext<TInput, TStateMap>,
) => V | Promise<V>;
interface DerivedEntry<TInput, TStateMap extends Record<string, unknown>> {
  key: string;
  fn: DerivedFn<TInput, TStateMap, unknown>;
}
export type IslandDerived<TDerivedMap extends Record<string, unknown>> = {
  readonly [K in keyof TDerivedMap]: DerivedAccessor<TDerivedMap[K]>;
};
export type ExternalSignal<T = unknown> = SignalAccessor<T>;
export type SignalAccessor<T> = MarkedSignalAccessor<T>;
type MergeState<TStateMap extends Record<string, unknown>, K extends string, V> = Omit<
  TStateMap,
  K
> &
  Record<K, V>;
export type IslandState<TStateMap extends Record<string, unknown>> = {
  readonly [K in keyof TStateMap]-?: SignalAccessor<TStateMap[K]>;
};
export interface HydratableOptions {
  name: string;
  as?: string;
  snapshot?:
    | boolean
    | {
        state?: boolean;
        derived?: boolean;
      };
  skipOnMount?: boolean;
}
export interface Island<
  TInput = Record<string, unknown>,
  _TStateMap extends Record<string, unknown> = Record<string, unknown>,
> {
  (props?: Partial<TInput>): string | Promise<string>;
  toString(props?: Partial<TInput>): string;
  mount(host: Element, props?: Partial<TInput>): () => void;
  hydratable(props: Partial<TInput>, options: HydratableOptions): Promise<string>;
  key(key: string): KeyedIsland<TInput>;
  /**
   * Register this island as a custom element, usable from plain HTML or any
   * framework: `Counter.define("x-counter", { observe: ["label"] })` then
   * `<x-counter label="hi"></x-counter>`. Observed attributes become string
   * input props and re-resolve input on change; richer props can be assigned
   * via the element's `props` property. Mounts on connect, unmounts on
   * disconnect. No-op (with a dev warning) where customElements is missing.
   */
  define(
    tagName: string,
    options?: {
      observe?: string[];
    },
  ): void;
  [ISLAND]: true;
}
export interface KeyedIsland<TInput> {
  (props?: Partial<TInput>): IslandCall;
  [ISLAND_CALL]: true;
}
type AnyIsland = Island<any, any>;
type AnyActionFn = (props: any, ctx: any) => unknown;
type ActionMap = Record<string, AnyActionFn>;
type ActionCall<P> = [P] extends [undefined]
  ? () => void
  : unknown extends P
    ? () => void
    : (props: P) => void;
export type ActionAccessor<P = undefined, R = void> = ActionCall<P> & {
  readonly pending: boolean;
  readonly data: Awaited<R> | undefined;
  readonly error: Error | undefined;
};
export type IslandActions<TActionMap extends ActionMap> = {
  readonly [K in keyof TActionMap]: TActionMap[K] extends (props: infer P, ctx: any) => infer R
    ? ActionAccessor<P, R>
    : never;
};
export type ActionContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
  host: Element;
  signal: AbortSignal;
};
type RenderContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
  TActionMap extends ActionMap = Record<never, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  action: IslandActions<TActionMap>;
  input: TInput;
};
export type EffectContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
  TActionMap extends ActionMap = Record<never, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  action: IslandActions<TActionMap>;
  input: TInput;
  host: Element;
  /**
   * AbortSignal that aborts when the effect re-runs (because a dependency
   * changed) or when the island unmounts. Pass to `fetch` or check
   * `signal.aborted` after `await` boundaries to bail out of stale work
   * without needing a manual cleanup function.
   */
  signal: AbortSignal;
};
export type OnMountContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
  TActionMap extends ActionMap = Record<never, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  action: IslandActions<TActionMap>;
  input: TInput;
  host: Element;
  hydrated: boolean;
};
export type HandlerContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
  TActionMap extends ActionMap = Record<never, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  action: IslandActions<TActionMap>;
  input: TInput;
  host: Element;
  target: Element;
  event: Event;
  /**
   * AbortSignal that fires when the island unmounts. If the handler's selector
   * was registered with the `:abortable` modifier, the signal is also aborted
   * when the same listener fires again on the same target (giving you free
   * race-cancellation for things like search-as-you-type fetches). Pass this
   * to `fetch`, `AbortController`-aware APIs, or check `signal.aborted`
   * after `await` boundaries to bail out of stale work.
   */
  signal: AbortSignal;
};
type HTMLEventFor<E extends string> = E extends keyof HTMLElementEventMap
  ? HTMLElementEventMap[E]
  : Event;
type HTMLTargetFor<E extends string> = E extends keyof HTMLElementEventMap
  ? NonNullable<HTMLElementEventMap[E]["target"]> extends Element
    ? NonNullable<HTMLElementEventMap[E]["target"]>
    : Element
  : Element;
export type HandlerContextFor<
  TInput,
  TStateMap extends Record<string, unknown>,
  TEventName extends string,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
  TActionMap extends ActionMap = Record<never, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  action: IslandActions<TActionMap>;
  input: TInput;
  host: Element;
  target: HTMLTargetFor<TEventName>;
  event: HTMLEventFor<TEventName>;
  /**
   * AbortSignal that fires when the island unmounts. If the handler's selector
   * was registered with the `:abortable` modifier, the signal is also aborted
   * when the same listener fires again on the same target.
   */
  signal: AbortSignal;
};
type StateInit<TInput, V> = V | ((input: TInput) => V);
interface StateEntry<TInput> {
  key: string;
  init: StateInit<TInput, unknown>;
}
interface ActionEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
> {
  key: string;
  fn: (props: unknown, ctx: ActionContext<TInput, TStateMap, TDerivedMap>) => unknown;
}
interface OnEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
  TActionMap extends ActionMap = Record<never, never>,
> {
  selector: string;
  event: string;
  options: AddEventListenerOptions;
  abortable: boolean;
  handler: (
    ctx: HandlerContext<TInput, TStateMap, TDerivedMap, TActionMap>,
  ) => void | Promise<void>;
}
interface EffectEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
  TActionMap extends ActionMap = Record<never, never>,
> {
  fn: (ctx: EffectContext<TInput, TStateMap, TDerivedMap, TActionMap>) => (() => void) | void;
}
/** Where the error originated. `"on"` covers sync throws and async rejections
 *  from `.on()` handlers; `"effect"` covers sync throws from `.effect()` runs
 *  (async work spawned inside an effect is not awaited by the runtime). */
export type ErrorSource = "on" | "effect" | "mount" | "transition" | "action";
/**
 * Register a global error handler invoked when any island reports an error
 * (from .on, .effect, .onMount, or transitions) and has no local .onError()
 * handler. Returns an unsubscribe function. Islands with their own .onError()
 * are handled locally and do not reach the global sink.
 */
export declare function onUncaughtError(
  fn: (error: Error, source: ErrorSource) => void,
): () => void;
export type ErrorContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
  TActionMap extends ActionMap = Record<never, never>,
> = {
  error: Error;
  source: ErrorSource;
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  action: IslandActions<TActionMap>;
  input: TInput;
  host: Element;
};
interface OnErrorEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
  TActionMap extends ActionMap = Record<never, never>,
> {
  fn: (ctx: ErrorContext<TInput, TStateMap, TDerivedMap, TActionMap>) => void;
}
interface OnMountEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
  TActionMap extends ActionMap = Record<never, never>,
> {
  fn: (ctx: OnMountContext<TInput, TStateMap, TDerivedMap, TActionMap>) => (() => void) | void;
}
interface TransitionOptions {
  enter?: (host: Element) => Promise<void> | void;
  leave?: (host: Element) => Promise<void> | void;
}
export interface MountOptions {
  root?: Element;
  lazy?: boolean;
}
export interface MountResult {
  unmount: () => void | Promise<void>;
}
interface BuilderConfig<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
  TActionMap extends ActionMap = Record<never, never>,
> {
  schema: StandardSchemaV1 | null;
  /** Shallow defaults merged before props (POJO `.input({ ... })` only). */
  defaultInput: Record<string, unknown> | null;
  states: StateEntry<TInput>[];
  deriveds: DerivedEntry<TInput, TStateMap>[];
  actions: ActionEntry<TInput, TStateMap, TDerivedMap>[];
  ons: OnEntry<TInput, TStateMap, TDerivedMap, TActionMap>[];
  effects: EffectEntry<TInput, TStateMap, TDerivedMap, TActionMap>[];
  onMounts: OnMountEntry<TInput, TStateMap, TDerivedMap, TActionMap>[];
  onErrors: OnErrorEntry<TInput, TStateMap, TDerivedMap, TActionMap>[];
  transition: TransitionOptions | null;
  css: string | null;
  /** Slot wrapper tag when this island is embedded in a parent (default div). */
  as: string | null;
}
declare class IlhaBuilder<
  TInput extends Record<string, unknown>,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
  TActionMap extends ActionMap = Record<never, never>,
> {
  readonly _cfg: BuilderConfig<TInput, TStateMap, TDerivedMap, TActionMap>;
  constructor(cfg: BuilderConfig<TInput, TStateMap, TDerivedMap, TActionMap>);
  input<T extends Record<string, unknown>>(): IlhaBuilder<
    T,
    Record<never, never>,
    Record<never, never>,
    Record<never, never>
  >;
  input<S extends StandardSchemaV1>(
    schema: S,
  ): IlhaBuilder<
    StandardSchemaV1.InferOutput<S> & Record<string, unknown>,
    Record<never, never>,
    Record<never, never>,
    Record<never, never>
  >;
  input<T extends Record<string, unknown>>(
    defaults: T,
  ): IlhaBuilder<T, Record<never, never>, Record<never, never>, Record<never, never>>;
  as<Tag extends string>(tag: Tag): IlhaBuilder<TInput, TStateMap, TDerivedMap, TActionMap>;
  state<V = undefined, K extends string = string>(
    key: K,
    init?: StateInit<TInput, V> | undefined,
  ): IlhaBuilder<TInput, MergeState<TStateMap, K, V>, TDerivedMap, TActionMap>;
  derived<K extends string, V>(
    key: K,
    fn: DerivedFn<TInput, TStateMap, V>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap & Record<K, V>, TActionMap>;
  action<K extends string, P = undefined, R = void>(
    key: K,
    fn: (props: P, ctx: ActionContext<TInput, TStateMap, TDerivedMap>) => R,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TActionMap & Record<K, typeof fn>>;
  on<S extends string>(
    selectorOrCombined: S,
    handler: (
      ctx: S extends `${string}@${infer E}:${string}`
        ? HandlerContextFor<TInput, TStateMap, E, TDerivedMap, TActionMap>
        : S extends `${string}@${infer E}`
          ? HandlerContextFor<TInput, TStateMap, E, TDerivedMap, TActionMap>
          : HandlerContext<TInput, TStateMap, TDerivedMap, TActionMap>,
    ) => void | Promise<void>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TActionMap>;
  effect(
    fn: (ctx: EffectContext<TInput, TStateMap, TDerivedMap, TActionMap>) => (() => void) | void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TActionMap>;
  onMount(
    fn: (ctx: OnMountContext<TInput, TStateMap, TDerivedMap, TActionMap>) => (() => void) | void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TActionMap>;
  onError(
    fn: (ctx: ErrorContext<TInput, TStateMap, TDerivedMap, TActionMap>) => void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TActionMap>;
  transition(opts: TransitionOptions): IlhaBuilder<TInput, TStateMap, TDerivedMap, TActionMap>;
  css(
    strings: TemplateStringsArray | string,
    ...values: (string | number)[]
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap, TActionMap>;
  render(
    fn: (ctx: RenderContext<TInput, TStateMap, TDerivedMap, TActionMap>) => string | RawHtml,
  ): Island<TInput, TStateMap>;
}
declare function ilhaFrom<TInput, TStateMap extends Record<string, unknown>>(
  selector: string | Element,
  island: Island<TInput, TStateMap>,
  props?: Partial<TInput>,
): (() => void) | null;
type IslandRegistry = Record<string, AnyIsland>;
declare function mountAll(registry: IslandRegistry, options?: MountOptions): MountResult;
type RootInput = Record<string, unknown>;
type RootState = Record<never, never>;
type RootDerived = Record<never, never>;
type RootActions = Record<never, never>;
type RootBuilder = IlhaBuilder<RootInput, RootState, RootDerived, RootActions>;
type DirectIslandFactory = <TInput extends Record<string, unknown> = RootInput>(
  fn: (ctx: RenderContext<TInput, RootState, RootDerived, RootActions>) => string | RawHtml,
) => Island<TInput, RootState>;
declare const ilha: RootBuilder &
  DirectIslandFactory & {
    html: typeof ilhaHtml;
    raw: typeof ilhaRaw;
    mount: typeof mountAll;
    from: typeof ilhaFrom;
    context: typeof ilhaContextFn & {
      /** Remove a context signal from the registry. Returns true if it existed. */
      delete(key: string): boolean;
      /** Remove all context signals from the registry (e.g. between tests). */
      clear(): void;
    };
    signal: typeof ilhaSignal;
    computed: typeof ilhaComputed;
    batch: typeof batch;
    untrack: typeof untrack;
    onUncaughtError: typeof onUncaughtError;
  };
/** @internal Used by the separate JSX runtime to register a native event handler. */
export declare function __ilhaJsxEvent({
  type,
  handler,
  modifier,
}: {
  type: string;
  handler: NativeEventHandler;
  modifier?: NativeEventModifier;
}): number | undefined;
/** @internal Used by the separate JSX runtime entry to preserve island slot composition. */
export declare function __ilhaJsxSlot({
  island,
  props,
  key,
}: {
  island: unknown;
  props: Record<string, unknown> | undefined;
  key: string | undefined;
}): RawHtml;
export declare const html: typeof ilhaHtml;
export declare const raw: typeof ilhaRaw;
export declare const css: typeof ilhaCss;
export declare const mount: typeof mountAll;
export declare const from: typeof ilhaFrom;
export declare const context: typeof ilhaContextFn & {
  /** Remove a context signal from the registry. Returns true if it existed. */
  delete(key: string): boolean;
  /** Remove all context signals from the registry (e.g. between tests). */
  clear(): void;
};
export { ilhaSignal as signal };
export { ilhaComputed as computed };
export { ilhaEffect as effect };
export default ilha;
