import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import type * as Atom from "effect/reactivity/Atom";
import * as Registry from "effect/reactivity/AtomRegistry";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { handleOwner, instr, isAtomHandle } from "./atom.ts";
import { getFiber } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import { isFunction } from "./shared.ts";
import type {
  AtomHandle,
  Instruction,
  WatchCallback,
  WatchContext,
  WatchOnceCleanup,
} from "./types.ts";

/** Values delivered to watch callbacks. */
export type WatchValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | readonly WatchValue[]
  | WatchRecord;

export interface WatchRecord {
  readonly [key: string]: WatchValue | undefined;
}

const WATCH_ONCE = Symbol("ilha.watch.once");

/** Discriminator for watch slot identity (atom/stream instance). */
export type WatchKey =
  | Atom.Atom<WatchValue>
  | Stream.Stream<WatchValue, unknown, unknown>
  | AtomHandle<WatchValue>
  | typeof WATCH_ONCE;

export interface WatchSlot {
  key: WatchKey;
  fnRef?: { current: (value: WatchValue) => void };
  dispose: () => void;
}

interface RunCell {
  ctrl: AbortController | null;
  cleanup: WatchOnceCleanup | undefined;
  extra: (() => void)[];
  gen: number;
}

const newRunCell = (): RunCell => ({
  cleanup: undefined,
  ctrl: null,
  extra: [],
  gen: 0,
});

const cancelRun = (cell: RunCell): void => {
  cell.gen += 1;
  cell.ctrl?.abort();
  cell.ctrl = null;
  const run = cell.cleanup;
  cell.cleanup = undefined;
  run?.();
  for (const extra of cell.extra.splice(0)) {
    extra();
  }
};

// Only functions run as cleanups; stray values are ignored.
const asCleanup = (
  value: WatchOnceCleanup | undefined
): WatchOnceCleanup | undefined => (isFunction(value) ? value : undefined);

const settleAsync = async (
  cell: RunCell,
  gen: number,
  out: Promise<WatchOnceCleanup | undefined>
): Promise<void> => {
  try {
    const c = await out;
    if (cell.gen === gen) {
      cell.cleanup = asCleanup(c);
    } else {
      asCleanup(c)?.();
    }
  } catch (error) {
    console.error(error);
  }
};

const settleRun = (
  cell: RunCell,
  gen: number,
  out: WatchOnceCleanup | undefined | Promise<WatchOnceCleanup | undefined>
): void => {
  if (out instanceof Promise) {
    void settleAsync(cell, gen, out);
    return;
  }
  if (cell.gen === gen) {
    cell.cleanup = asCleanup(out);
  } else {
    asCleanup(out)?.();
  }
};

const runWithSignal = (
  cell: RunCell,
  fn: (
    ctx: WatchContext
  ) => WatchOnceCleanup | undefined | Promise<WatchOnceCleanup | undefined>
): void => {
  cancelRun(cell);
  const { gen } = cell;
  const ctrl = new AbortController();
  cell.ctrl = ctrl;
  const ctx: WatchContext = {
    onCleanup: (extra) => {
      // This run is stale once cancelled, even if a newer run owns the cell.
      if (ctrl.signal.aborted || cell.gen !== gen) {
        extra();
        return;
      }
      cell.extra.push(extra);
    },
    signal: ctrl.signal,
  };
  settleRun(cell, gen, fn(ctx));
};
const runStreamWatch = (
  fiber: FiberLocal,
  effect: Effect.Effect<void, unknown, Registry.AtomRegistry>
): (() => void) => {
  const scope = Scope.forkUnsafe(fiber.scope);
  const provided = effect.pipe(
    Effect.provideService(Registry.AtomRegistry, fiber.registry)
  );
  const fork = Effect.runFork(provided);
  Effect.runSync(Scope.addFinalizer(scope, Fiber.interrupt(fork)));
  return () => {
    Effect.runFork(Scope.close(scope, Exit.void));
  };
};

const useWatchSlot = <A extends WatchValue>(
  fiber: FiberLocal,
  key: WatchKey,
  mount: (fn: (value: A) => void) => () => void,
  fn: (value: A) => void
): void => {
  const i = fiber.watchI ?? 0;
  fiber.watchI = i + 1;
  fiber.watchSlots ??= [];
  const existing = fiber.watchSlots[i];
  if (existing) {
    if (existing.key === key) {
      if (existing.fnRef) {
        // SAFETY: same key means the slot was created for the same A callback shape.
        existing.fnRef.current = fn as (value: WatchValue) => void;
      }
      return;
    }
    existing.dispose();
    // SAFETY: cleared slot index is filled on the next mount path below.
    fiber.watchSlots[i] = undefined as never;
  }
  // SAFETY: fnRef stores the latest A callback; mount invokes it with A values.
  const fnRef: NonNullable<WatchSlot["fnRef"]> = {
    current: fn as (value: WatchValue) => void,
  };
  const unsub = mount((value) => {
    // SAFETY: mount delivers values of A that this slot was opened with.
    (fnRef.current as (value: A) => void)(value);
  });
  const dispose = () => unsub();
  fiber.watchSlots[i] = { dispose, fnRef, key };
};

interface SourceSlot {
  cell: RunCell;
  fn: unknown;
}

const sourceCells = new WeakMap<object, SourceSlot[]>();

const registerWatch = <A extends WatchValue>(
  fiber: FiberLocal,
  source: AtomHandle<A> | Atom.Atom<A> | Stream.Stream<A, unknown, unknown>,
  fn: WatchCallback<A>
): void => {
  // The slot index is stable per call site across renders (order-based), so
  // one cell survives rerenders: new values cancel the previous run instead
  // of orphaning it, and unmount always cancels the current run.
  const slot = fiber.watchI ?? 0;
  let cells = sourceCells.get(fiber);
  if (!cells) {
    cells = [];
    sourceCells.set(fiber, cells);
  }
  const entry = cells[slot] ?? { cell: newRunCell(), fn: undefined };
  cells[slot] = entry;
  entry.fn = fn;
  const { cell } = entry;
  const wrapped = (value: A): void => {
    // SAFETY: entry.fn is always the latest callback registered for this
    // (fiber, slot); A matches because the watched source is slot-stable.
    const latest = (entry.fn ?? fn) as WatchCallback<A>;
    runWithSignal(cell, (ctx) => latest(value, ctx));
  };
  const disposeCell = (): void => {
    cancelRun(cell);
  };
  if (Stream.isStream(source)) {
    useWatchSlot(
      fiber,
      source,
      (run) => {
        let active = true;
        const stop = runStreamWatch(
          fiber,
          // SAFETY: runForEach yields Effect<void,...>; registry is provided by runStreamWatch.
          Stream.runForEach(source, (v) =>
            Effect.sync(() => {
              if (active) {
                run(v);
              }
            })
          ) as Effect.Effect<void, unknown, Registry.AtomRegistry>
        );
        return () => {
          active = false;
          disposeCell();
          stop();
        };
      },
      wrapped
    );
    return;
  }
  const atom = isAtomHandle(source) ? source.atom : source;
  useWatchSlot(
    fiber,
    atom,
    (run) => {
      const unsub = fiber.registry.subscribe(atom, run, { immediate: true });
      return () => {
        disposeCell();
        unsub();
      };
    },
    wrapped
  );
};

/** Run `fn` once on mount. Return a function (or a promise of one) to clean up on unmount. */
const watchOnce = (
  fn: (
    ctx: WatchContext
  ) => WatchOnceCleanup | undefined | Promise<WatchOnceCleanup | undefined>
): Instruction<undefined> => {
  const fiber = getFiber();
  const i = fiber.watchI ?? 0;
  fiber.watchI = i + 1;
  fiber.watchSlots ??= [];
  const existing = fiber.watchSlots[i];
  if (existing) {
    if (existing.key === WATCH_ONCE) {
      return instr(Effect.void);
    }
    existing.dispose();
    // SAFETY: cleared slot index is filled on the mount path below.
    fiber.watchSlots[i] = undefined as never;
  }
  const cell = newRunCell();
  runWithSignal(cell, fn);
  fiber.watchSlots[i] = {
    dispose: () => {
      cancelRun(cell);
    },
    key: WATCH_ONCE,
  };
  return instr(Effect.void);
};

/** Run `fn` when `source` changes — and once on mount. Sync, async, and generator components. */
const watchSource = <A extends WatchValue>(
  source: AtomHandle<A> | Atom.Atom<A> | Stream.Stream<A, unknown, unknown>,
  fn: WatchCallback<A>
): Instruction<undefined> => {
  const fiber =
    (isAtomHandle(source) ? handleOwner.get(source) : undefined) ?? getFiber();
  registerWatch(fiber, source, fn);
  return instr(Effect.void);
};

export interface WatchFn {
  <A extends WatchValue>(
    source: AtomHandle<A> | Atom.Atom<A> | Stream.Stream<A, unknown, unknown>,
    fn: WatchCallback<A>
  ): Instruction<undefined>;
  once: (
    fn: (
      ctx: WatchContext
    ) => WatchOnceCleanup | undefined | Promise<WatchOnceCleanup | undefined>
  ) => Instruction<undefined>;
}

export const watch: WatchFn = Object.assign(watchSource, { once: watchOnce });
