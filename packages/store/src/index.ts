// =============================================================================
// @ilha/store — shared reactive store for Ilha islands (alien-signals)
// =============================================================================

import { computed, effect, signal } from "alien-signals";

import { capturePropertyPath, patchStateAtPath } from "./bind-path";

const SIGNAL_ACCESSOR = Symbol.for("ilha.signalAccessor");

export type StoreBindable<S> = {
  (): S;
  (value: S): void;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SetState<T> {
  (update: Partial<T>): void;
  (updater: (state: T) => Partial<T>): void;
}

export type GetState<T> = () => T;
export type Listener<T> = (state: T, prevState: T) => void;
export type SliceListener<_T, S> = (slice: S, prevSlice: S) => void;
export type Unsub = () => void;

export interface StoreApi<T extends object> {
  setState(update: Partial<T> | ((state: T) => Partial<T>)): void;
  getState(): T;
  getInitialState(): T;
  subscribe(listener: Listener<T>): Unsub;
  subscribe<S>(selector: (state: T) => S, listener: SliceListener<T, S>): Unsub;
  /**
   * Two-way field accessor for Ilha `bind:*` (e.g. `bind:value`, `bind:checked`).
   * Property-path selectors only — `s => s.search.query`, not derived expressions.
   */
  bind<S>(selector: (state: T) => S): StoreBindable<S>;
  /**
   * Project a reactive slice of state into a signal-shaped accessor.
   *
   * The returned function reads the current value when called. When called
   * inside an ilha tracking scope (`.render()`, `.derived()`, `.effect()`)
   * or any other alien-signals reactive context, that scope subscribes to
   * the slice and re-runs whenever the selector's output changes.
   *
   * Hoist the call out of render functions — each `.select()` allocates
   * a fresh `computed`, so calling it inside a render that re-runs leaks
   * one per render until the scope is collected. Define selectors at
   * module scope or in `.onMount()`/closure setup.
   *
   * @example
   * const cartStore = createStore({ items: [] as Item[], total: 0 });
   * const itemCount = cartStore.select(s => s.items.length);
   *
   * const Badge = ilha.render(() => html`<span>${itemCount()}</span>`);
   *
   * @example
   * // Stable identity for downstream comparisons:
   * const items = cartStore.select(s => s.items);
   * cartStore.setState({ total: 99 }); // items() returns the same array
   */
  select<S>(selector: (state: T) => S): () => S;
}

// ---------------------------------------------------------------------------
// ActionsCreator
// ---------------------------------------------------------------------------

type ActionsCreator<TState extends object, TActions extends object> = (
  set: SetState<TState>,
  get: GetState<TState>,
  getInitialState: () => TState,
) => TActions;

// ---------------------------------------------------------------------------
// createStore
// ---------------------------------------------------------------------------

export function createStore<
  TState extends object,
  TActions extends object = Record<never, never>,
>(
  initialState: TState,
  actionsCreator?: ActionsCreator<TState, TActions>,
): StoreApi<TState & TActions> {
  type T = TState & TActions;

  const stateSignal = signal<T>({} as T);

  function setState(update: Partial<T> | ((state: T) => Partial<T>)): void {
    const current = stateSignal();
    const patch = typeof update === "function" ? update(current) : update;
    stateSignal({ ...current, ...patch });
  }

  function getState(): T {
    return stateSignal();
  }

  function subscribe(listener: Listener<T>): Unsub;
  function subscribe<S>(selector: (state: T) => S, listener: SliceListener<T, S>): Unsub;
  function subscribe<S>(
    listenerOrSelector: Listener<T> | ((state: T) => S),
    maybeListener?: SliceListener<T, S>,
  ): Unsub {
    if (maybeListener === undefined) {
      const listener = listenerOrSelector as Listener<T>;
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

    const selector = listenerOrSelector as (state: T) => S;
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

  function select<S>(selector: (state: T) => S): () => S {
    const sliceComputed = computed(() => selector(stateSignal()));
    return () => sliceComputed();
  }

  function createBindableAccessor<S>(selector: (state: T) => S): StoreBindable<S> {
    const path = capturePropertyPath(getState, selector);
    const read = select(selector);
    const accessor = ((...args: unknown[]): unknown => {
      if (args.length === 0) return read();
      setState((state) => patchStateAtPath(state, path, args[0]));
    }) as StoreBindable<S>;
    (accessor as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
    return accessor;
  }

  function bind<S>(selector: (state: T) => S): StoreBindable<S> {
    return createBindableAccessor(selector);
  }

  let resolvedInitialState: T;

  const api: StoreApi<T> = {
    setState,
    getState,
    getInitialState: () => resolvedInitialState,
    subscribe,
    bind,
    select,
  };

  const resolvedActions = actionsCreator
    ? actionsCreator(
        setState as unknown as SetState<TState>,
        getState as GetState<TState>,
        () => resolvedInitialState as unknown as TState,
      )
    : ({} as TActions);

  resolvedInitialState = { ...initialState, ...resolvedActions };
  stateSignal(resolvedInitialState);

  return api;
}

export { effectScope } from "alien-signals";
