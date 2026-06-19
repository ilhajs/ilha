// =============================================================================
// @ilha/store — shared reactive store for Ilha islands (alien-signals)
//
// Fluent builder API: store(initial).derived(...).action(...).build()
// =============================================================================

import { signal, computed, effect, setActiveSub } from "alien-signals";

import { capturePropertyPath, patchStateAtPath } from "./bind-path";

const SIGNAL_ACCESSOR = Symbol.for("ilha.signalAccessor");

export type StoreBindable<S> = {
  (): S;
  (value: S): void;
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Listener<T> = (state: T, prevState: T) => void;
export type SliceListener<_T, S> = (slice: S, prevSlice: S) => void;
export type Unsub = () => void;

/** Read-write signal-shaped accessor for a state key. */
export type StateAccessor<T> = {
  (): T;
  (value: T): void;
};

/** The reactive envelope for a derived value. Mirrors ilha core's `DerivedValue`. */
export interface DerivedValue<T> {
  loading: boolean;
  value: T | undefined;
  error: Error | undefined;
}

/**
 * Read-only signal-shaped accessor for a derived value.
 *
 * Calling it returns the current value (`undefined` while an async derived is
 * pending). `.loading`/`.value`/`.error` expose the full envelope. For a sync
 * derived, `.loading` is always `false` and `.error` always `undefined`.
 */
export type DerivedAccessor<T> = {
  (): T | undefined;
  readonly loading: boolean;
  readonly value: T | undefined;
  readonly error: Error | undefined;
};

export type StoreEvent = "change" | "init";

/** Context passed to `.derived()` callbacks. Read-only — derived must stay pure. */
export interface DerivedCtx<TState> {
  get(): TState;
  /**
   * Aborts when an async derived re-runs (its state dependencies changed) so
   * in-flight work can cancel. Stale resolutions are dropped regardless.
   */
  signal: AbortSignal;
}

/** Context passed to `.action()` callbacks. */
export interface ActionCtx<TState> {
  /** Read the current state snapshot. */
  get(): TState;
  /** Read the initial state captured at `.build()` time. */
  getInitial(): TState;
  /** Imperative write escape hatch for async/multi-step actions. Routed through middleware. */
  set(patch: Partial<TState>): void;
}

/** Context passed to `.middleware()` callbacks. */
export interface MiddlewareCtx<TState> {
  /** Read the current (pre-commit) state snapshot. */
  get(): TState;
  /** Read the initial state captured at `.build()` time. */
  getInitial(): TState;
}

/** A derived entry: `(ctx) => V`. */
type DerivedFn<TState, V = unknown> = (ctx: DerivedCtx<TState>) => V;

/** An action entry: `(props, ctx) => Partial<TState>`. */
type ActionFn<TState, P = any> = (props: P, ctx: ActionCtx<TState>) => Partial<TState>;

type Middleware<TState> = (
  patch: Partial<TState>,
  ctx: MiddlewareCtx<TState>,
  next: (patch: Partial<TState>) => void,
) => void;

/**
 * Maps the accumulated action record into the store's public call signatures.
 * Zero-argument actions become `() => void`; everything else becomes
 * `(props: P) => void`.
 *
 * A zero-arg action is authored as `(_, get) => ...` with no annotation on the
 * first parameter, which TypeScript infers as `unknown` (the `P = undefined`
 * default only applies when P is otherwise un-inferrable). We therefore treat
 * both `undefined` and `unknown` props as zero-arg. The rare action that
 * genuinely accepts `unknown` props is callable with no argument too, which is
 * an acceptable trade-off.
 */
export type ActionsMap<A> = {
  [K in keyof A]: A[K] extends (props: infer P, get: any) => any
    ? [P] extends [undefined]
      ? () => void
      : unknown extends P
        ? () => void
        : (props: P) => void
    : never;
};

/** Built-in methods present on every built store. */
export interface StoreBuiltins<TState extends object> {
  /** Atomic multi-key write — one commit, one "change", routed through middleware. */
  setState(patch: Partial<TState>): void;
  /** Reset to the initial state captured at `.build()` time. Routed through middleware. */
  reset(): void;
  subscribe(listener: Listener<TState>): Unsub;
  subscribe<S>(selector: (state: TState) => S, listener: SliceListener<TState, S>): Unsub;
  select<S>(selector: (state: TState) => S): () => S;
  /**
   * Two-way field accessor for ilha `bind:*`. Property-path selectors only —
   * `s => s.user.name`, not derived expressions.
   */
  bind<S>(selector: (state: TState) => S): StoreBindable<S>;
  getState(): TState;
  getInitialState(): TState;
}

/** The fully built, flat reactive store surface. */
export type BuiltStore<
  TState extends object,
  D extends Record<string, DerivedFn<TState>>,
  A extends Record<string, ActionFn<TState>>,
> = { [K in keyof TState]: StateAccessor<TState[K]> } & {
  [K in keyof D]: DerivedAccessor<Awaited<ReturnType<D[K]>>>;
} & ActionsMap<A> &
  StoreBuiltins<TState>;

const BUILTIN_KEYS = [
  "setState",
  "reset",
  "subscribe",
  "select",
  "bind",
  "getState",
  "getInitialState",
] as const;
const BUILTIN_KEY_SET = new Set<string>(BUILTIN_KEYS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Untrack a thunk: run it with no active subscriber so internal signal reads
// performed during a write don't subscribe an enclosing reactive scope.
function untrackRun<T>(fn: () => T): T {
  const prev = setActiveSub(undefined);
  try {
    return fn();
  } finally {
    setActiveSub(prev);
  }
}

// Build a derived accessor: callable returns the current value; `.loading`,
// `.value`, `.error` expose the envelope. Mirrors ilha core's accessor shape.
function createDerivedAccessor<T>(read: () => DerivedValue<T>): DerivedAccessor<T> {
  const accessor = (() => read().value) as DerivedAccessor<T>;
  (accessor as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
  return new Proxy(accessor, {
    get(target, prop, receiver) {
      if (prop === "loading" || prop === "value" || prop === "error") {
        return read()[prop as keyof DerivedValue<T>];
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as DerivedAccessor<T>;
}

// True when every own key in `patch` is Object.is-equal to the same key in
// `prev` — i.e. committing this patch would be a no-op.
function isNoopPatch<T extends object>(prev: T, patch: Partial<T>): boolean {
  for (const key in patch) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    if (!Object.is((prev as Record<string, unknown>)[key], patch[key])) return false;
  }
  return true;
}

function collisionError(key: string, kind: "state" | "derived" | "action" | "built-in"): Error {
  return new Error(`@ilha/store: key collision — "${key}" is already defined as a ${kind} key.`);
}

// ---------------------------------------------------------------------------
// Builder config (immutable)
// ---------------------------------------------------------------------------

interface BuilderConfig<
  TState extends object,
  D extends Record<string, DerivedFn<TState>>,
  A extends Record<string, ActionFn<TState>>,
> {
  initialState: TState;
  deriveds: ReadonlyArray<{ key: string; fn: DerivedFn<TState> }>;
  actions: ReadonlyArray<{ key: string; fn: ActionFn<TState> }>;
  middlewares: ReadonlyArray<Middleware<TState>>;
  listeners: ReadonlyArray<{ event: StoreEvent; handler: Listener<TState> }>;
  // Phantom carriers so D/A flow through the chained return types.
  readonly _d?: D;
  readonly _a?: A;
}

// ---------------------------------------------------------------------------
// StoreBuilder
// ---------------------------------------------------------------------------

export class StoreBuilder<
  TState extends object,
  D extends Record<string, DerivedFn<TState>> = Record<never, never>,
  A extends Record<string, ActionFn<TState>> = Record<never, never>,
> {
  private readonly _cfg: BuilderConfig<TState, D, A>;

  private constructor(cfg: BuilderConfig<TState, D, A>) {
    this._cfg = cfg;
  }

  static create<TState extends object>(initialState: TState): StoreBuilder<TState> {
    return new StoreBuilder<TState>({
      initialState,
      deriveds: [],
      actions: [],
      middlewares: [],
      listeners: [],
    });
  }

  derived<K extends string, V>(
    key: K,
    fn: (ctx: DerivedCtx<TState>) => V,
  ): StoreBuilder<TState, D & Record<K, typeof fn>, A> {
    return new StoreBuilder({
      ...this._cfg,
      deriveds: [...this._cfg.deriveds, { key, fn: fn as DerivedFn<TState> }],
    }) as StoreBuilder<TState, D & Record<K, typeof fn>, A>;
  }

  action<K extends string, P = undefined>(
    key: K,
    fn: (props: P, ctx: ActionCtx<TState>) => Partial<TState>,
  ): StoreBuilder<TState, D, A & Record<K, typeof fn>> {
    return new StoreBuilder({
      ...this._cfg,
      actions: [...this._cfg.actions, { key, fn: fn as ActionFn<TState> }],
    }) as StoreBuilder<TState, D, A & Record<K, typeof fn>>;
  }

  middleware(fn: Middleware<TState>): StoreBuilder<TState, D, A> {
    return new StoreBuilder({
      ...this._cfg,
      middlewares: [...this._cfg.middlewares, fn],
    });
  }

  on(event: StoreEvent, handler: Listener<TState>): StoreBuilder<TState, D, A> {
    return new StoreBuilder({
      ...this._cfg,
      listeners: [...this._cfg.listeners, { event, handler }],
    });
  }

  build(): BuiltStore<TState, D, A> {
    return buildStore<TState, D, A>(this._cfg);
  }
}

// ---------------------------------------------------------------------------
// build()
// ---------------------------------------------------------------------------

function buildStore<
  TState extends object,
  D extends Record<string, DerivedFn<TState>>,
  A extends Record<string, ActionFn<TState>>,
>(cfg: BuilderConfig<TState, D, A>): BuiltStore<TState, D, A> {
  const stateKeys = new Set(Object.keys(cfg.initialState));
  const derivedKeys = new Set<string>();
  const actionKeys = new Set<string>();

  // --- collision detection -------------------------------------------------
  for (const { key } of cfg.deriveds) {
    if (BUILTIN_KEY_SET.has(key)) throw collisionError(key, "built-in");
    if (stateKeys.has(key)) throw collisionError(key, "state");
    if (derivedKeys.has(key)) throw collisionError(key, "derived");
    derivedKeys.add(key);
  }
  for (const { key } of cfg.actions) {
    if (BUILTIN_KEY_SET.has(key)) throw collisionError(key, "built-in");
    if (stateKeys.has(key)) throw collisionError(key, "state");
    if (derivedKeys.has(key)) throw collisionError(key, "derived");
    if (actionKeys.has(key)) throw collisionError(key, "action");
    actionKeys.add(key);
  }
  // A built-in colliding with a state key would shadow the built-in in the
  // get trap; reject it so the surface is unambiguous.
  for (const key of stateKeys) {
    if (BUILTIN_KEY_SET.has(key)) throw collisionError(key, "built-in");
  }

  // --- single source of truth ----------------------------------------------
  const stateSignal = signal<TState>(cfg.initialState);
  const initialSnapshot: TState = { ...cfg.initialState };

  const changeListeners = cfg.listeners.filter((l) => l.event === "change").map((l) => l.handler);
  const initListeners = cfg.listeners.filter((l) => l.event === "init").map((l) => l.handler);

  // --- mutation pipeline ----------------------------------------------------
  const committed = (patch: Partial<TState>): void => {
    const prev = stateSignal();
    if (isNoopPatch(prev, patch)) return; // skip spurious commits
    const next = { ...prev, ...patch };
    stateSignal(next);
    for (const fn of changeListeners) fn(next, prev);
  };

  // Shared context for middleware callbacks. `get()` reads the current
  // (pre-commit) state each time it's called.
  const middlewareCtx: MiddlewareCtx<TState> = {
    get: () => stateSignal(),
    getInitial: () => initialSnapshot,
  };

  // reduceRight folds right-to-left so the resulting chain invokes middlewares
  // in registration order: [m0, m1] => m0 -> m1 -> committed.
  const chain = cfg.middlewares.reduceRight<(patch: Partial<TState>) => void>(
    (next, mw) => (patch) => mw(patch, middlewareCtx, next),
    committed,
  );

  // Single internal mutation entry point. Empty patches are skipped before the
  // chain so an action that writes via `ctx.set` and returns `{}` doesn't push
  // a spurious no-op through middleware. Untracked so a write performed inside a
  // tracking scope can't subscribe that scope to stateSignal.
  const setState = (patch: Partial<TState>): void => {
    if (Object.keys(patch).length === 0) return;
    untrackRun(() => chain(patch));
  };

  function getState(): TState {
    return stateSignal();
  }

  // --- built-ins ------------------------------------------------------------
  function select<S>(selector: (state: TState) => S): () => S {
    const c = computed(() => selector(stateSignal()));
    return () => c();
  }

  function subscribe(listener: Listener<TState>): Unsub;
  function subscribe<S>(selector: (state: TState) => S, listener: SliceListener<TState, S>): Unsub;
  function subscribe<S>(
    listenerOrSelector: Listener<TState> | ((state: TState) => S),
    maybeListener?: SliceListener<TState, S>,
  ): Unsub {
    if (maybeListener === undefined) {
      const listener = listenerOrSelector as Listener<TState>;
      let prev = stateSignal();
      let first = true;
      return effect(() => {
        const current = stateSignal();
        if (first) {
          first = false;
          return;
        }
        listener(current, prev);
        prev = current;
      });
    }

    const selector = listenerOrSelector as (state: TState) => S;
    const sliceComputed = computed(() => selector(stateSignal()));
    let prevSlice = sliceComputed();
    let first = true;
    return effect(() => {
      const currentSlice = sliceComputed();
      if (first) {
        first = false;
        return;
      }
      if (!Object.is(currentSlice, prevSlice)) {
        maybeListener(currentSlice, prevSlice);
        prevSlice = currentSlice;
      }
    });
  }

  function bind<S>(selector: (state: TState) => S): StoreBindable<S> {
    const path = capturePropertyPath(getState, selector);
    const read = select(selector);
    const accessor = ((...args: unknown[]): unknown => {
      if (args.length === 0) return read();
      setState(patchStateAtPath(stateSignal(), path, args[0]));
    }) as StoreBindable<S>;
    (accessor as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
    return accessor;
  }

  const builtins: StoreBuiltins<TState> = {
    setState,
    reset: () => setState(initialSnapshot),
    subscribe,
    select,
    bind,
    getState,
    getInitialState: () => initialSnapshot,
  };

  // --- cached accessors -----------------------------------------------------
  const stateAccessors = new Map<string, StateAccessor<unknown>>();
  for (const key of stateKeys) {
    const accessor = ((...args: unknown[]): unknown => {
      if (args.length === 0) return (stateSignal() as Record<string, unknown>)[key];
      setState({ [key]: args[0] } as Partial<TState>);
      return undefined;
    }) as StateAccessor<unknown>;
    (accessor as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
    stateAccessors.set(key, accessor);
  }

  // --- derived (sync computed, or async envelope) ---------------------------
  const NO_SIGNAL = { aborted: false } as AbortSignal;
  const derivedAccessors = new Map<string, DerivedAccessor<unknown>>();
  for (const { key, fn } of cfg.deriveds) {
    // Heuristic: native async functions are known up front. Sync functions that
    // happen to return a Promise are detected at first run and upgraded.
    const looksAsync =
      fn.constructor.name === "AsyncFunction" || fn.constructor.name === "AsyncGeneratorFunction";

    if (!looksAsync) {
      // Try the fast sync path: a plain computed. If the first evaluation
      // returns a Promise, fall through to the async path instead.
      const probe = computed(() => fn({ get: () => stateSignal(), signal: NO_SIGNAL }));
      let firstVal: unknown;
      let isPromise = false;
      try {
        firstVal = probe();
        isPromise = firstVal instanceof Promise;
      } catch {
        // Throwing sync derived — surface the error via the async path so it
        // lands in `.error` rather than crashing build().
        isPromise = true;
      }
      if (!isPromise) {
        derivedAccessors.set(
          key,
          createDerivedAccessor(() => ({ loading: false, value: probe(), error: undefined })),
        );
        continue;
      }
    }

    // Async path: envelope signal updated by an effect that re-runs when the
    // derived's state dependencies change. Re-runs abort the previous run and
    // stale resolutions are dropped.
    const env = signal<DerivedValue<unknown>>({
      loading: true,
      value: undefined,
      error: undefined,
    });
    derivedAccessors.set(
      key,
      createDerivedAccessor(() => env()),
    );

    let ac = new AbortController();
    const stop = effect(() => {
      ac.abort();
      ac = new AbortController();
      const currentAc = ac;

      let result: unknown;
      try {
        result = fn({ get: () => stateSignal(), signal: currentAc.signal });
      } catch (err) {
        untrackRun(() =>
          env({
            loading: false,
            value: undefined,
            error: err instanceof Error ? err : new Error(String(err)),
          }),
        );
        return;
      }

      if (!(result instanceof Promise)) {
        untrackRun(() => env({ loading: false, value: result, error: undefined }));
        return;
      }

      const prevVal = untrackRun(() => env().value);
      untrackRun(() => env({ loading: true, value: prevVal, error: undefined }));
      result
        .then((value) => {
          if (currentAc.signal.aborted) return;
          env({ loading: false, value, error: undefined });
        })
        .catch((err: unknown) => {
          if (currentAc.signal.aborted) return;
          env({
            loading: false,
            value: undefined,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        });
    });
    // The derived effect lives for the store's lifetime (same as subscribe
    // effects); there is no per-derived disposal because the store has no
    // unmount. `void stop` keeps the handle intentionally unreferenced.
    void stop;
  }

  // Shared context for action callbacks. `set` is the imperative escape hatch
  // for async/multi-step actions; the returned patch remains the primary path.
  const actionCtx: ActionCtx<TState> = {
    get: getState,
    getInitial: () => initialSnapshot,
    set: setState,
  };
  const actionHandlers = new Map<string, (props?: unknown) => void>();
  for (const { key, fn } of cfg.actions) {
    actionHandlers.set(key, (props?: unknown) => {
      setState(fn(props as never, actionCtx));
    });
  }

  // --- proxy ----------------------------------------------------------------
  const allKeys = [...BUILTIN_KEYS, ...actionKeys, ...derivedKeys, ...stateKeys];

  const lookup = (key: string): unknown => {
    if (BUILTIN_KEY_SET.has(key)) return (builtins as unknown as Record<string, unknown>)[key];
    const action = actionHandlers.get(key);
    if (action) return action;
    const derivedAcc = derivedAccessors.get(key);
    if (derivedAcc) return derivedAcc;
    const stateAcc = stateAccessors.get(key);
    if (stateAcc) return stateAcc;
    return undefined;
  };

  const store = new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      return lookup(prop);
    },
    set() {
      // Writes must go through accessor call form / setState / actions so
      // middleware always runs. Returning false throws a TypeError in strict
      // (module) mode, surfacing the misuse.
      return false;
    },
    has(_target, prop) {
      if (typeof prop === "symbol") return false;
      return (
        BUILTIN_KEY_SET.has(prop) ||
        actionKeys.has(prop) ||
        derivedKeys.has(prop) ||
        stateKeys.has(prop)
      );
    },
    ownKeys() {
      return [...allKeys];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (
        BUILTIN_KEY_SET.has(prop) ||
        actionKeys.has(prop) ||
        derivedKeys.has(prop) ||
        stateKeys.has(prop)
      ) {
        return { configurable: true, enumerable: true, value: lookup(prop), writable: false };
      }
      return undefined;
    },
  }) as BuiltStore<TState, D, A>;

  // --- init lifecycle (synchronous, post-init) ------------------------------
  for (const handler of initListeners) handler(initialSnapshot, initialSnapshot);

  return store;
}

// ---------------------------------------------------------------------------
// store() factory
// ---------------------------------------------------------------------------

export function store<TState extends object>(initialState: TState): StoreBuilder<TState> {
  return StoreBuilder.create(initialState);
}

export { effectScope } from "alien-signals";
