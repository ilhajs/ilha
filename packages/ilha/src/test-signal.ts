/**
 * Test-only helper: free-standing reactive accessor backed directly by
 * alien-signals. Ilha no longer exports `signal()`/`computed()` — context()
 * is the public constructor for shared state — but tests still exercise
 * free-standing reactivity against the underlying engine.
 *
 * Stamps ilha's `Symbol.for("ilha.signalAccessor")` brand so the accessor
 * participates in render subscription, bind:* syntax, and persist(), exactly
 * like accessors created inside ilha.
 */
import { signal as alienSignal } from "alien-signals";

import type { SignalAccessor } from "./index";

const SIGNAL_ACCESSOR = Symbol.for("ilha.signalAccessor");

export function signal<T>(init: T): SignalAccessor<T> {
  const s = alienSignal(init);
  const accessor = (...args: unknown[]): unknown => {
    if (args.length === 0) return s();
    const value = args[0];
    s(typeof value === "function" ? (value as (previous: T) => T)(s()) : (value as T));
  };
  (accessor as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
  // SAFETY: the closure carries ilha's SIGNAL_ACCESSOR brand, so it satisfies
  // every runtime check a marked accessor must pass. .select() is not used by
  // these tests; use context() accessors for that.
  return accessor as unknown as SignalAccessor<T>;
}
