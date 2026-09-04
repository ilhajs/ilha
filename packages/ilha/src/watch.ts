import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as Atom from "effect/unstable/reactivity/Atom";
import * as Registry from "effect/unstable/reactivity/AtomRegistry";

import { handleOwner, instr, isAtomHandle } from "./atom.ts";
import { getFiber } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import type { AtomHandle, Instruction } from "./types.ts";

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

/** Discriminator for watch slot identity (atom/stream instance). */
export type WatchKey =
  | Atom.Atom<WatchValue>
  | Stream.Stream<WatchValue, unknown, unknown>
  | AtomHandle<WatchValue>;

export interface WatchSlot {
  key: WatchKey;
  fnRef: { current: (value: WatchValue) => void };
  dispose: () => void;
}

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
      // SAFETY: same key means the slot was created for the same A callback shape.
      existing.fnRef.current = fn as (value: WatchValue) => void;
      return;
    }
    existing.dispose();
    // SAFETY: cleared slot index is filled on the next mount path below.
    fiber.watchSlots[i] = undefined as never;
  }
  // SAFETY: fnRef stores the latest A callback; mount invokes it with A values.
  const fnRef: WatchSlot["fnRef"] = {
    current: fn as (value: WatchValue) => void,
  };
  const unsub = mount((value) => {
    // SAFETY: mount delivers values of A that this slot was opened with.
    (fnRef.current as (value: A) => void)(value);
  });
  const dispose = () => unsub();
  fiber.watchSlots[i] = { dispose, fnRef, key };
};

const registerWatch = <A extends WatchValue>(
  fiber: FiberLocal,
  source: AtomHandle<A> | Atom.Atom<A> | Stream.Stream<A, unknown, unknown>,
  fn: (value: A) => void
): void => {
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
          stop();
        };
      },
      fn
    );
    return;
  }
  const atom = isAtomHandle(source) ? source.atom : source;
  useWatchSlot(
    fiber,
    atom,
    (run) => fiber.registry.subscribe(atom, run, { immediate: true }),
    fn
  );
};

/** Run `fn` when `source` changes — and once on mount. Sync, async, and generator components. */
export const watch = <A extends WatchValue>(
  source: AtomHandle<A> | Atom.Atom<A> | Stream.Stream<A, unknown, unknown>,
  fn: (value: A) => void
): Instruction<undefined> => {
  const fiber =
    (isAtomHandle(source) ? handleOwner.get(source) : undefined) ?? getFiber();
  registerWatch(fiber, source, fn);
  return instr(Effect.void);
};
