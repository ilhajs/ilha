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
import { setActiveSub, signal as alienSignal } from "alien-signals";

import type { SignalAccessor } from "./index";

const SIGNAL_ACCESSOR = Symbol.for("ilha.signalAccessor");

export function signal<T>(init: T): SignalAccessor<T> {
  const s = alienSignal(init);
  const accessor = (() => s()) as SignalAccessor<T>;
  accessor.set = (next) => {
    s(next);
  };
  accessor.update = (fn) => {
    const prevSub = setActiveSub(undefined);
    try {
      s(fn(s()));
    } finally {
      setActiveSub(prevSub);
    }
  };
  // SAFETY: SIGNAL_ACCESSOR is a private brand; Record<symbol, boolean> is the stamp shape.
  (accessor as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
  return accessor;
}
