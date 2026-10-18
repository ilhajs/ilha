import * as Effect from "effect/Effect";
import type * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

import { instr } from "./atom.ts";
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

type WatchRun = (
  ctx: WatchContext
) => WatchOnceCleanup | undefined | Promise<WatchOnceCleanup | undefined>;

interface WatchRef {
  /** Latest callback; a rerender swaps it without resubscribing. */
  fn?: WatchCallback<never>;
}

export interface WatchSlot {
  /** Source identity: the watched atom or stream, or the `watch.once` marker. */
  key: WatchKey;
  ref: WatchRef;
  dispose: () => void;
}

const ONCE = Symbol("ilha.watch.once");

type WatchKey =
  | Atom.Atom<WatchValue>
  | Stream.Stream<WatchValue, unknown, unknown>
  | typeof ONCE;

interface Runner {
  run: (fn: WatchRun) => void;
  cancel: () => void;
}

/**
 * Serial runs of one watch slot. Each run gets a fresh signal; starting the
 * next run or cancelling aborts it, which also runs its cleanups.
 */
const makeRunner = (): Runner => {
  let ctrl: AbortController | undefined;
  const cancel = (): void => ctrl?.abort();
  return {
    cancel,
    run: (fn) => {
      cancel();
      ctrl = new AbortController();
      const { signal } = ctrl;
      const onCleanup = (c: WatchOnceCleanup | undefined): void => {
        if (!isFunction(c)) {
          return;
        }
        if (signal.aborted) {
          c();
        } else {
          signal.addEventListener("abort", () => c(), { once: true });
        }
      };
      const settle = async (
        pending: Promise<WatchOnceCleanup | undefined>
      ): Promise<void> => {
        try {
          onCleanup(await pending);
        } catch (error) {
          console.error(error);
        }
      };
      const out = fn({ onCleanup, signal });
      if (out instanceof Promise) {
        void settle(out);
      } else {
        onCleanup(out);
      }
    },
  };
};

/**
 * Claim the fiber's next watch slot. A slot whose key matches keeps its
 * subscription and takes the new callback; otherwise `open` subscribes anew.
 */
const useWatchSlot = (
  key: WatchKey,
  ref: WatchRef,
  open: (fiber: FiberLocal) => () => void
): Instruction<void> => {
  const fiber = getFiber();
  const i = fiber.watchI ?? 0;
  fiber.watchI = i + 1;
  fiber.watchSlots ??= [];
  const existing = fiber.watchSlots[i];
  if (existing && existing.key === key) {
    existing.ref.fn = ref.fn;
  } else {
    existing?.dispose();
    fiber.watchSlots[i] = { dispose: open(fiber), key, ref };
  }
  return instr(Effect.void);
};

export interface WatchFn {
  /** Run `fn` with the current value of `source` now and on every change. */
  <A extends WatchValue>(
    source: AtomHandle<A> | Atom.Atom<A> | Stream.Stream<A, unknown, unknown>,
    fn: WatchCallback<A>
  ): Instruction<void>;
  /** Run `fn` once on mount; its returned cleanup runs on unmount. */
  once: (fn: WatchRun) => Instruction<void>;
}

export const watch: WatchFn = Object.assign(
  <A extends WatchValue>(
    source: AtomHandle<A> | Atom.Atom<A> | Stream.Stream<A, unknown, unknown>,
    fn: WatchCallback<A>
  ): Instruction<void> => {
    // A rerender updates `ref.fn` on the stored ref this subscription reads.
    const ref = { fn };
    const key = isFunction(source) ? source.atom : source;
    return useWatchSlot(key, ref, (fiber) => {
      const runner = makeRunner();
      const emit = (value: A): void => runner.run((ctx) => ref.fn(value, ctx));
      const stop = Stream.isStream(source)
        ? fiber.run(
            // SAFETY: fiber.run provides AtomRegistry; watched streams need nothing else.
            Stream.runForEach(source, (v) =>
              Effect.sync(() => emit(v))
            ) as Effect.Effect<void>
          )
        : fiber.registry.subscribe(
            isFunction(source) ? source.atom : source,
            emit,
            { immediate: true }
          );
      return () => {
        runner.cancel();
        stop();
      };
    });
  },
  {
    once: (fn: WatchRun): Instruction<void> =>
      useWatchSlot(ONCE, {}, () => {
        const runner = makeRunner();
        runner.run(fn);
        return runner.cancel;
      }),
  }
);
