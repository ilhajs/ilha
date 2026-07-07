// =============================================================================
// @ilha/store — shared reactive store for Ilha islands (alien-signals)
//
// Fluent builder API: store(initial).derived(...).action(...).build()
// =============================================================================

import { signal, computed, effect, setActiveSub } from "alien-signals";
import type { SignalAccessor } from "ilha";

import {
  createStoreBindAccessor,
  createStoreKeyAccessor,
  stampSignalAccessor,
} from "./bind-accessor";
import type { StandardSchemaV1 } from "./form";
import {
  assertStoreStateObject,
  isStandardSchema,
  parseInitialStateFromSchema,
  primaryIssuePath,
  StoreValidationError,
  shapeSnapshotForSchemaValidation,
  validateStateSnapshot,
  type StoreErrorSource,
} from "./schema";

export type { StandardSchemaV1 } from "./form";
export { isStandardSchema, StoreValidationError, type StoreErrorSource } from "./schema";

export type SchemaState<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S> & object;

/** Read-write accessor for a state key — compatible with ilha `bind:*` (`SignalAccessor`). */
export type StateAccessor<T> = SignalAccessor<T>;

/** Read-write field accessor from `.bind()` — compatible with ilha `bind:*`. */
export type StoreBindable<S> = SignalAccessor<S>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Listener<T> = (state: T, prevState: T) => void;
export type SliceListener<_T, S> = (slice: S, prevSlice: S) => void;
export type Unsub = () => void;

/** Options for the selector form of `subscribe`. */
export interface SubscribeOptions<S> {
  /**
   * Slice equality — the listener fires only when this returns `false`.
   * Default: `Object.is`. Pass `shallowEqual` for object-building selectors.
   */
  equal?: (a: S, b: S) => boolean;
}

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

/** Context passed to `.onError()` when a schema-backed commit is rejected. */
export type StoreErrorContext<TState extends object> = {
  error: Error;
  source: StoreErrorSource;
  /** Partial patch that was merged before validation (if any). */
  patch?: Partial<TState>;
  /** Dot path of the first issue, when available. */
  path?: string;
  issues?: ReadonlyArray<StandardSchemaV1.Issue>;
  get(): TState;
};

type StoreErrorHandler<TState extends object> = (ctx: StoreErrorContext<TState>) => void;

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

type MaybePromise<T> = T | Promise<T>;

/** An action entry: sync or async; return a patch, or void when using `ctx.set` / side effects only. */
type ActionFn<TState, P = any> = (
  props: P,
  ctx: ActionCtx<TState>,
) => MaybePromise<Partial<TState> | void>;

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
      ? ActionInvoker
      : unknown extends P
        ? ActionInvoker
        : ActionInvoker<P>
    : never;
};

/**
 * A callable action on the built store. `.pending` is reactive — `true` while
 * any async invocation of this action is in flight (sync actions never set it).
 */
export type ActionInvoker<P = never> = ([P] extends [never] ? () => void : (props: P) => void) & {
  readonly pending: boolean;
};

/** Built-in methods present on every built store. */
export interface StoreBuiltins<TState extends object> {
  /** Atomic multi-key write — one commit, one "change", routed through middleware. */
  setState(patch: Partial<TState>): void;
  /** Reset to the initial state captured at `.build()` time. Routed through middleware. */
  reset(): void;
  subscribe(listener: Listener<TState>): Unsub;
  subscribe<S>(
    selector: (state: TState) => S,
    listener: SliceListener<TState, S>,
    options?: SubscribeOptions<S>,
  ): Unsub;
  select<S>(selector: (state: TState) => S): () => S;
  /**
   * Two-way field accessor for ilha `bind:*`. Property-path selectors only —
   * `s => s.user.name`, not derived expressions.
   */
  bind<S>(selector: (state: TState) => S): StoreBindable<S>;
  getState(): TState;
  getInitialState(): TState;
  /**
   * Tear the store down: stops all `subscribe` effects and async-derived
   * effects, aborts in-flight async deriveds, and turns further writes into
   * no-ops. Reads keep working on the last committed state. Idempotent.
   * Needed for per-island (non-singleton) stores to avoid leaking effects.
   */
  dispose(): void;
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
  "dispose",
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
  stampSignalAccessor(accessor);
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

/**
 * Shallow equality for selector slices: `Object.is` on primitives, own-key
 * comparison one level deep for plain objects and arrays. Pass as the `equal`
 * option to `subscribe(selector, listener, { equal: shallowEqual })` so
 * object-building selectors (`s => ({ a: s.a, b: s.b })`) don't fire on every
 * commit.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  return shallowStateEqual(a as object, b as object);
}

function shallowStateEqual<T extends object>(a: T, b: T): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

/** Drop own keys whose value is `undefined` so schema validation (e.g. Zod unions) is not tripped by stale optional fields after a partial patch. */
function omitUndefinedOwnKeys<T extends object>(snapshot: T): T {
  const out = { ...snapshot } as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out as T;
}

// Deep-clone the initial state so later caller/state mutation can't corrupt
// `reset()`/`getInitialState()`. Falls back to a shallow copy when the state
// holds non-cloneable values (functions, class instances with methods, …).
function cloneInitialState<T extends object>(state: T): T {
  try {
    return structuredClone(state);
  } catch {
    return { ...state };
  }
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
  schema?: StandardSchemaV1;
  deriveds: ReadonlyArray<{ key: string; fn: DerivedFn<TState> }>;
  actions: ReadonlyArray<{ key: string; fn: ActionFn<TState> }>;
  middlewares: ReadonlyArray<Middleware<TState>>;
  listeners: ReadonlyArray<{ event: StoreEvent; handler: Listener<TState> }>;
  errorHandlers: ReadonlyArray<{ fn: StoreErrorHandler<TState> }>;
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
      errorHandlers: [],
    });
  }

  static createWithSchema<S extends StandardSchemaV1>(schema: S): StoreBuilder<SchemaState<S>> {
    const parsed = parseInitialStateFromSchema(schema);
    assertStoreStateObject(parsed, "initial state from schema");
    const initialState = parsed as SchemaState<S>;
    return new StoreBuilder<SchemaState<S>>({
      initialState,
      schema,
      deriveds: [],
      actions: [],
      middlewares: [],
      listeners: [],
      errorHandlers: [],
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
    fn: (props: P, ctx: ActionCtx<TState>) => MaybePromise<Partial<TState> | void>,
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

  onError(fn: StoreErrorHandler<TState>): StoreBuilder<TState, D, A> {
    return new StoreBuilder({
      ...this._cfg,
      errorHandlers: [...this._cfg.errorHandlers, { fn }],
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
  // Own the initial object: both the live signal and the reset snapshot are
  // deep-cloned so caller mutation of the original (including nested objects)
  // can't leak into getState() or corrupt reset().
  const stateSignal = signal<TState>(cloneInitialState(cfg.initialState));
  const initialSnapshot: TState = cloneInitialState(cfg.initialState);

  // --- disposal --------------------------------------------------------------
  // Every long-lived effect (subscribe, async derived) registers a disposer so
  // dispose() can tear the store down; per-island stores would otherwise leak.
  const disposers = new Set<() => void>();
  let disposed = false;

  // Track an effect handle: returns an unsub that also deregisters itself so
  // manual unsubscribe doesn't leave a stale entry behind.
  function trackEffect(stop: () => void): Unsub {
    // subscribe() on a disposed store: kill the just-created effect and hand
    // back an inert unsub so nothing outlives disposal.
    if (disposed) {
      stop();
      return () => {};
    }
    const unsub = () => {
      disposers.delete(unsub);
      stop();
    };
    disposers.add(unsub);
    return unsub;
  }

  const changeListeners = cfg.listeners.filter((l) => l.event === "change").map((l) => l.handler);
  const initListeners = cfg.listeners.filter((l) => l.event === "init").map((l) => l.handler);
  const onErrors = cfg.errorHandlers;

  function getState(): TState {
    return stateSignal();
  }

  function reportStoreError(error: Error, source: StoreErrorSource, patch?: Partial<TState>): void {
    const issues = error instanceof StoreValidationError ? error.issues : undefined;
    const ctx: StoreErrorContext<TState> = {
      error,
      source,
      patch,
      path: issues ? primaryIssuePath(issues) : undefined,
      issues,
      get: getState,
    };
    if (onErrors.length === 0) {
      console.error(error);
      return;
    }
    for (const { fn } of onErrors) {
      try {
        fn(ctx);
      } catch (handlerErr) {
        console.error(handlerErr);
      }
    }
  }

  type CommitOptions = { validateSchema?: boolean };

  // --- mutation pipeline ----------------------------------------------------
  const committed = (patch: Partial<TState>, options?: CommitOptions): void => {
    const prev = stateSignal();
    if (isNoopPatch(prev, patch)) return;
    const candidate = { ...prev, ...patch } as TState;

    let next: TState = candidate;
    const validateSchema = options?.validateSchema !== false;
    if (cfg.schema && validateSchema) {
      const shaped = shapeSnapshotForSchemaValidation(prev, patch, candidate);
      const result = validateStateSnapshot(cfg.schema, omitUndefinedOwnKeys(shaped));
      if (!result.ok) {
        reportStoreError(new StoreValidationError(result.issues, patch), "validate", patch);
        return;
      }
      assertStoreStateObject(result.data, "validated state");
      next = result.data as TState;
    }

    if (shallowStateEqual(prev, next)) return;
    stateSignal(next);
    // Each listener is isolated: one throwing listener must not prevent later
    // listeners from running or abort whatever triggered the write.
    for (const fn of changeListeners) {
      try {
        fn(next, prev);
      } catch (err) {
        reportStoreError(err instanceof Error ? err : new Error(String(err)), "listener", patch);
      }
    }
  };

  // Shared context for middleware callbacks. `get()` reads the current
  // (pre-commit) state each time it's called.
  const middlewareCtx: MiddlewareCtx<TState> = {
    get: () => stateSignal(),
    getInitial: () => initialSnapshot,
  };

  // reduceRight folds right-to-left so the resulting chain invokes middlewares
  // in registration order: [m0, m1] => m0 -> m1 -> committed.
  const chain = cfg.middlewares.reduceRight<
    (patch: Partial<TState>, options?: CommitOptions) => void
  >((next, mw) => (patch, options) => mw(patch, middlewareCtx, (p) => next(p, options)), committed);

  // Single internal mutation entry point. Empty patches are skipped before the
  // chain so an action that writes via `ctx.set` and returns `{}` doesn't push
  // a spurious no-op through middleware. Untracked so a write performed inside a
  // tracking scope can't subscribe that scope to stateSignal.
  const setState = (patch: Partial<TState>, options?: CommitOptions): void => {
    if (disposed) return;
    if (patch == null || typeof patch !== "object") return;
    if (Object.keys(patch).length === 0) return;
    untrackRun(() => chain(patch, options));
  };

  /** bind:* / per-keystroke field writes — skip full-schema validation so drafts (e.g. partial email) still commit. */
  const setStateField = (patch: Partial<TState>): void => {
    setState(patch, cfg.schema ? { validateSchema: false } : undefined);
  };

  // --- built-ins ------------------------------------------------------------
  function select<S>(selector: (state: TState) => S): () => S {
    const c = computed(() => selector(stateSignal()));
    return () => c();
  }

  function subscribe(listener: Listener<TState>): Unsub;
  function subscribe<S>(
    selector: (state: TState) => S,
    listener: SliceListener<TState, S>,
    options?: SubscribeOptions<S>,
  ): Unsub;
  function subscribe<S>(
    listenerOrSelector: Listener<TState> | ((state: TState) => S),
    maybeListener?: SliceListener<TState, S>,
    options?: SubscribeOptions<S>,
  ): Unsub {
    if (maybeListener === undefined) {
      const listener = listenerOrSelector as Listener<TState>;
      let prev = stateSignal();
      let first = true;
      return trackEffect(
        effect(() => {
          const current = stateSignal();
          if (first) {
            first = false;
            return;
          }
          listener(current, prev);
          prev = current;
        }),
      );
    }

    const selector = listenerOrSelector as (state: TState) => S;
    const equal = options?.equal ?? Object.is;
    const sliceComputed = computed(() => selector(stateSignal()));
    let prevSlice = sliceComputed();
    let first = true;
    return trackEffect(
      effect(() => {
        const currentSlice = sliceComputed();
        if (first) {
          first = false;
          return;
        }
        if (!equal(currentSlice, prevSlice)) {
          maybeListener(currentSlice, prevSlice);
          prevSlice = currentSlice;
        }
      }),
    );
  }

  function bind<S>(selector: (state: TState) => S): StoreBindable<S> {
    return createStoreBindAccessor(getState, setState, setStateField, selector, select(selector));
  }

  const builtins: StoreBuiltins<TState> = {
    setState,
    // Clone on reset so post-reset state never shares nested references with
    // the pristine snapshot.
    reset: () => setState(cloneInitialState(initialSnapshot)),
    subscribe,
    select,
    bind,
    getState,
    getInitialState: () => initialSnapshot,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // Isolate each disposer so one throwing teardown can't prevent the rest
      // from running.
      for (const d of [...disposers]) {
        try {
          d();
        } catch (err) {
          console.error(err);
        }
      }
      disposers.clear();
    },
  };

  // --- cached accessors -----------------------------------------------------
  const stateAccessors = new Map<string, StateAccessor<unknown>>();
  for (const key of stateKeys) {
    type Key = Extract<keyof TState, string>;
    const k = key as Key;
    const accessor = createStoreKeyAccessor<TState, Key>(
      k,
      () => (stateSignal() as TState)[k],
      (value) => setStateField({ [k]: value } as unknown as Partial<TState>),
      bind,
    );
    stateAccessors.set(key, accessor as StateAccessor<unknown>);
  }

  // --- derived (sync computed, or async envelope) ---------------------------
  // Real never-aborting signal so sync deriveds can call the full AbortSignal
  // API (addEventListener, throwIfAborted, …) without crashing.
  const NO_SIGNAL = new AbortController().signal;
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
    // The derived effect lives until dispose(): stop the effect and abort any
    // in-flight run so pending fetches cancel.
    disposers.add(() => {
      stop();
      ac.abort();
    });
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
    // Per-action pending counter (a count, not a boolean, so overlapping
    // invocations don't clear the flag early). Exposed as `.pending` on the
    // action — reactive, since the getter reads a signal.
    const pendingSig = signal(0);
    const handler = (props?: unknown) => {
      const ret = fn(props as never, actionCtx);
      const apply = (patch: Partial<TState> | void | undefined | null) => {
        if (patch != null) setState(patch);
      };
      if (ret != null && typeof (ret as Promise<unknown>).then === "function") {
        untrackRun(() => pendingSig(pendingSig() + 1));
        void (ret as Promise<Partial<TState> | void>)
          .then(apply)
          .catch((reason: unknown) => {
            reportStoreError(
              reason instanceof Error ? reason : new Error(String(reason)),
              "action",
            );
          })
          .finally(() => untrackRun(() => pendingSig(Math.max(0, pendingSig() - 1))));
      } else {
        apply(ret as Partial<TState> | void);
      }
    };
    Object.defineProperty(handler, "pending", {
      get: () => pendingSig() > 0,
      enumerable: false,
    });
    actionHandlers.set(key, handler);
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

export function store<S extends StandardSchemaV1>(schema: S): StoreBuilder<SchemaState<S>>;
/** Plain object initial state. Pass an explicit type argument when inference is too wide. */
export function store<TState extends object>(initialState: TState): StoreBuilder<TState>;
export function store(initialOrSchema: object): StoreBuilder<object> {
  if (isStandardSchema(initialOrSchema)) {
    return StoreBuilder.createWithSchema(initialOrSchema);
  }
  return StoreBuilder.create(initialOrSchema);
}

export { effectScope } from "alien-signals";

// ---------------------------------------------------------------------------
// persist() — storage sync helper
// ---------------------------------------------------------------------------

/** Minimal storage surface — `localStorage`, `sessionStorage`, or a custom adapter. */
export type PersistStorage = Pick<Storage, "getItem" | "setItem">;

export interface PersistOptions<TState extends object> {
  /** Storage backend. Default: `window.localStorage`. */
  storage?: PersistStorage;
  /**
   * Mirror writes from other tabs via the window `storage` event. Only active
   * for the default `localStorage` backend. Default: `true`.
   */
  crossTab?: boolean;
  /** State → string. Default: `JSON.stringify`. */
  serialize?: (state: TState) => string;
  /** String → patch merged via `setState` (schema stores validate it). Default: `JSON.parse`. */
  deserialize?: (raw: string) => Partial<TState>;
}

/**
 * Keep a store in sync with persistent storage:
 *
 * 1. On call, reads `key` and merges the stored patch into the store
 *    (through `setState`, so middleware runs and schema stores validate —
 *    corrupt or stale-shaped payloads are rejected, not applied).
 * 2. Subscribes to changes and writes the full state back on every commit.
 * 3. Optionally mirrors writes from other tabs (`storage` events).
 *
 * No-op on the server (returns an inert unsubscribe). Call the returned
 * unsubscribe to stop syncing (also do this before `store.dispose()`).
 *
 * ```ts
 * const cartStore = store({ items: [] as string[] }).build();
 * persist(cartStore, "cart");
 * ```
 */
export function persist<TState extends object>(
  store: Pick<StoreBuiltins<TState>, "getState" | "setState" | "subscribe">,
  key: string,
  options: PersistOptions<TState> = {},
): Unsub {
  if (typeof window === "undefined") return () => {};
  const storage = options.storage ?? window.localStorage;
  const serialize = options.serialize ?? (JSON.stringify as (state: TState) => string);
  const deserialize = options.deserialize ?? ((raw: string) => JSON.parse(raw) as Partial<TState>);

  const applyRaw = (raw: string | null) => {
    if (raw == null) return;
    try {
      const patch = deserialize(raw);
      if (patch !== null && typeof patch === "object" && !Array.isArray(patch)) {
        store.setState(patch);
      }
    } catch (err) {
      console.error(`[@ilha/store] persist("${key}"): failed to restore state`, err);
    }
  };

  // 1. Hydrate from storage.
  try {
    applyRaw(storage.getItem(key));
  } catch (err) {
    console.error(`[@ilha/store] persist("${key}"): failed to read storage`, err);
  }

  // 2. Write-through on every commit.
  const unsubStore = store.subscribe((state) => {
    try {
      storage.setItem(key, serialize(state));
    } catch (err) {
      console.error(`[@ilha/store] persist("${key}"): failed to write storage`, err);
    }
  });

  // 3. Cross-tab sync (localStorage only — sessionStorage/custom backends
  // don't emit cross-tab storage events).
  let onStorage: ((e: StorageEvent) => void) | null = null;
  if (options.crossTab !== false && storage === window.localStorage) {
    onStorage = (e) => {
      if (e.key !== key) return;
      applyRaw(e.newValue);
    };
    window.addEventListener("storage", onStorage);
  }

  return () => {
    unsubStore();
    if (onStorage) window.removeEventListener("storage", onStorage);
  };
}

// ---------------------------------------------------------------------------
// dehydrate() / hydrate() — SSR snapshot transfer
//
// Mirrors ilha core's island snapshot model (data-ilha-state + guarded parse):
// state travels as serialized JSON stamped into the HTML, and the client seeds
// the store from it on mount. Stores are NOT written during SSR — server data
// flows loader → props; `dehydrate` serializes a request-local state object
// (or the store itself in non-concurrent contexts like prerendering).
// The parse guards below intentionally match ilha's `safeParseSnapshot`.
// ---------------------------------------------------------------------------

// Upper bound on a snapshot payload (chars). Matches ilha core's cap.
const MAX_SNAPSHOT_CHARS = 256 * 1024;
// Upper bound on nesting depth of a parsed snapshot. Matches ilha core's cap.
const MAX_SNAPSHOT_DEPTH = 32;

const UNSAFE_SNAPSHOT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function exceedsMaxDepth(value: unknown, depth: number): boolean {
  if (depth > MAX_SNAPSHOT_DEPTH) return true;
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (const item of value) if (exceedsMaxDepth(item, depth + 1)) return true;
    return false;
  }
  for (const key in value as Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (exceedsMaxDepth((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

// JSON.parse creates __proto__ etc. as plain own properties — strip them at
// the parse boundary before the payload flows into setState/deep merges.
function stripUnsafeKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) stripUnsafeKeys(item);
    return;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (UNSAFE_SNAPSHOT_KEYS.has(key)) {
      delete (value as Record<string, unknown>)[key];
    } else {
      stripUnsafeKeys((value as Record<string, unknown>)[key]);
    }
  }
}

/**
 * Serialize state for transfer into HTML (a JSON `<script>` block or data
 * attribute — remember to escape for the embedding context). Accepts either a
 * built store or a plain state object.
 *
 * On a **concurrent SSR server, pass a request-local object** (e.g. loader
 * data), not the shared module-level store — stores must not be written
 * during SSR. Passing the store itself is fine in non-concurrent contexts
 * (prerendering, tests).
 */
export function dehydrate<TState extends object>(
  storeOrState: Pick<StoreBuiltins<TState>, "getState"> | TState,
): string {
  const state =
    typeof (storeOrState as Partial<StoreBuiltins<TState>>).getState === "function"
      ? (storeOrState as StoreBuiltins<TState>).getState()
      : (storeOrState as TState);
  return JSON.stringify(state);
}

/**
 * Seed a store from a dehydrated snapshot — call from the page island's
 * `onMount` (which runs on hydration) with the payload stamped into the HTML.
 *
 * Parsing is guarded like ilha core's island snapshots: size cap, depth cap,
 * must-be-plain-object, prototype-polluting keys stripped. The patch merges
 * via `setState`, so middleware runs and schema stores validate — corrupt or
 * stale-shaped payloads are rejected, not applied. Returns `true` when the
 * snapshot passed the parse/guard checks and was handed to `setState`,
 * `false` when it was ignored (with a console warning). A `true` return does
 * not guarantee the state changed — a schema store's validation may still
 * reject the patch inside `setState`.
 */
export function hydrate<TState extends object>(
  store: Pick<StoreBuiltins<TState>, "setState">,
  raw: string | null | undefined,
): boolean {
  if (raw == null || raw === "") return false;
  const warn = (msg: string) => console.warn(`[@ilha/store] hydrate: ${msg}`);
  if (raw.length > MAX_SNAPSHOT_CHARS) {
    warn(`snapshot exceeds ${MAX_SNAPSHOT_CHARS} chars — ignored.`);
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warn("invalid JSON — snapshot ignored.");
    return false;
  }
  if (exceedsMaxDepth(parsed, 1)) {
    warn(`snapshot nesting exceeds depth ${MAX_SNAPSHOT_DEPTH} — ignored.`);
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warn("snapshot is not an object — ignored.");
    return false;
  }
  stripUnsafeKeys(parsed);
  store.setState(parsed as Partial<TState>);
  return true;
}
