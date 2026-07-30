// =============================================================================
// Signal-shaped accessors for ilha bind:* (Symbol + .select parity with ilha)
// =============================================================================

import { setActiveSub } from "alien-signals";
import type { SignalAccessor, SignalSetter } from "ilha";

import { capturePropertyPath, patchStateAtPath } from "./bind-path";

const SIGNAL_ACCESSOR = Symbol.for("ilha.signalAccessor");

function resolveSetter<T>(read: () => T, value: SignalSetter<T>): T {
  if (typeof value !== "function") return value as T;
  const prevSub = setActiveSub(undefined);
  try {
    return (value as (previous: T) => T)(read());
  } finally {
    setActiveSub(prevSub);
  }
}

export function markStoreSignalAccessor<T>(fn: {
  (): T;
  (value: SignalSetter<T>): void;
}): SignalAccessor<T> {
  (fn as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
  return fn as SignalAccessor<T>;
}

/** Stamp `[SIGNAL_ACCESSOR]` on read-only callables (e.g. derived accessors). */
export function stampSignalAccessor(fn: () => unknown): void {
  (fn as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
}

/**
 * Top-level state key accessor with `.select()` for nested `bind:*` (same ergonomics as ilha `state.user.select(...)`).
 */
export function createStoreKeyAccessor<TState extends object, K extends keyof TState>(
  key: K,
  read: () => TState[K],
  writeKey: (value: TState[K]) => void,
  bind: <S>(selector: (state: TState) => S) => SignalAccessor<S>,
): SignalAccessor<TState[K]> {
  const fn = ((...args: [value: SignalSetter<TState[K]>] | []): TState[K] => {
    if (args.length === 0) return read();
    writeKey(resolveSetter(read, args[0]));
    return read();
  }) as { (): TState[K]; (value: SignalSetter<TState[K]>): void };
  const accessor = markStoreSignalAccessor(fn);
  accessor.select = <S>(selector: (slice: TState[K]) => S) => bind((st) => selector(st[key]));
  return accessor;
}

/**
 * `store.bind(selector)` — read/write field with ilha-compatible surface.
 */
export function createStoreBindAccessor<TState extends object, S>(
  getState: () => TState,
  _setState: (patch: Partial<TState>) => void,
  setStateField: (patch: Partial<TState>) => void,
  selector: (state: TState) => S,
  read: () => S,
): SignalAccessor<S> {
  const path = capturePropertyPath(getState, selector);
  const fn = ((...args: [value: SignalSetter<S>] | []): S => {
    if (args.length === 0) return read();
    const patch = patchStateAtPath(
      getState(),
      path,
      resolveSetter(read, args[0]),
    ) as Partial<TState>;
    setStateField(patch);
    return read();
  }) as { (): S; (value: SignalSetter<S>): void };
  return markStoreSignalAccessor(fn);
}
