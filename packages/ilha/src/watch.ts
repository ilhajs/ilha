import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as Atom from "effect/unstable/reactivity/Atom";
import * as Registry from "effect/unstable/reactivity/AtomRegistry";

import { handleOwner, instr, isAtomHandle } from "./atom.ts";
import { getFiber, type FiberLocal } from "./runtime.ts";
import type { AtomHandle, Instruction } from "./types.ts";

export type WatchSlot = {
  key: unknown;
  fnRef: { current: (value: unknown) => void };
  dispose: () => void;
};

function runStreamWatch(
  fiber: FiberLocal,
  effect: Effect.Effect<unknown, unknown, Registry.AtomRegistry>,
): () => void {
  const scope = Scope.forkUnsafe(fiber.scope);
  const provided = effect.pipe(Effect.provideService(Registry.AtomRegistry, fiber.registry));
  const fork = Effect.runFork(provided);
  Effect.runSync(Scope.addFinalizer(scope, Fiber.interrupt(fork)));
  return () => {
    Effect.runFork(Scope.close(scope, Exit.void));
  };
}

function useWatchSlot(
  fiber: FiberLocal,
  key: unknown,
  mount: (fn: (value: unknown) => void) => () => void,
  fn: (value: unknown) => void,
): void {
  const i = fiber.watchI ?? 0;
  fiber.watchI = i + 1;
  fiber.watchSlots ??= [];
  const existing = fiber.watchSlots[i];
  if (existing) {
    if (existing.key !== key) {
      existing.dispose();
      fiber.watchSlots[i] = undefined as never;
    } else {
      existing.fnRef.current = fn;
      return;
    }
  }
  const fnRef = { current: fn };
  const unsub = mount((value) => fnRef.current(value));
  const dispose = () => unsub();
  fiber.watchSlots[i] = { key, fnRef, dispose };
}

function registerWatch<A>(
  fiber: FiberLocal,
  source: AtomHandle<A> | Atom.Atom<A> | Stream.Stream<A, any, any>,
  fn: (value: A) => void,
): void {
  if (Stream.isStream(source)) {
    const key = source;
    useWatchSlot(
      fiber,
      key,
      (run) => {
        let active = true;
        const stop = runStreamWatch(
          fiber,
          Stream.runForEach(source, (v) =>
            Effect.sync(() => {
              if (active) run(v);
            }),
          ) as Effect.Effect<unknown, unknown, Registry.AtomRegistry>,
        );
        return () => {
          active = false;
          stop();
        };
      },
      fn as (value: unknown) => void,
    );
    return;
  }
  const atom = isAtomHandle(source) ? source.atom : source;
  useWatchSlot(
    fiber,
    atom,
    (run) => fiber.registry.subscribe(atom, run as (v: A) => void, { immediate: true }),
    fn as (value: unknown) => void,
  );
}

/** Run `fn` when `source` changes — and once on mount. Sync, async, and generator components. */
export function watch<A>(
  source: AtomHandle<A> | Atom.Atom<A> | Stream.Stream<A, any, any>,
  fn: (value: A) => void,
): Instruction<void> {
  const fiber = (isAtomHandle(source) ? handleOwner.get(source) : undefined) ?? getFiber();
  registerWatch(fiber, source, fn);
  return instr(Effect.void);
}
