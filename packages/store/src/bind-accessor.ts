// =============================================================================
// Signal-shaped accessors for ilha bind:* (Symbol + .select parity with ilha)
// =============================================================================

import type { SignalAccessor } from "ilha";

import { capturePropertyPath, patchStateAtPath } from "./bind-path";

const SIGNAL_ACCESSOR = Symbol.for("ilha.signalAccessor");

export function markStoreSignalAccessor<T>(fn: { (): T; (value: T): void }): SignalAccessor<T> {
  (fn as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
  return fn as SignalAccessor<T>;
}

/** Stamp `[SIGNAL_ACCESSOR]` on read-only callables (e.g. derived accessors). */
export function stampSignalAccessor(fn: { (): unknown }): void {
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
  const fn = ((...args: [value: TState[K]] | []): TState[K] => {
    if (args.length === 0) return read();
    writeKey(args[0]);
    return read();
  }) as { (): TState[K]; (value: TState[K]): void };
  const accessor = markStoreSignalAccessor(fn);
  accessor.select = <S>(selector: (slice: TState[K]) => S) => bind((st) => selector(st[key]));
  return accessor;
}

/**
 * `store.bind(selector)` — read/write field with ilha-compatible surface.
 */
export function createStoreBindAccessor<TState extends object, S>(
  getState: () => TState,
  setState: (patch: Partial<TState>) => void,
  selector: (state: TState) => S,
  read: () => S,
): SignalAccessor<S> {
  const path = capturePropertyPath(getState, selector);
  const fn = ((...args: [value: S] | []): S => {
    if (args.length === 0) return read();
    setState(patchStateAtPath(getState(), path, args[0]) as Partial<TState>);
    return read();
  }) as { (): S; (value: S): void };
  return markStoreSignalAccessor(fn);
}
