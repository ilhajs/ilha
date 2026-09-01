import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as Atom from "effect/unstable/reactivity/Atom";

import { handleOwner, instr, isAtomHandle } from "./atom.ts";
import { getFiber } from "./runtime.ts";
import type { AtomHandle, Instruction } from "./types.ts";

export function watch<A>(
  source: AtomHandle<A> | Atom.Atom<A> | Stream.Stream<A, any, any>,
  fn: (value: A) => void,
): Instruction<void> {
  return instr(
    Effect.sync(() => {
      const fiber = (isAtomHandle(source) ? handleOwner.get(source) : undefined) ?? getFiber();
      if (Stream.isStream(source)) {
        fiber.run(
          Stream.runForEach(source, (v) => Effect.sync(() => fn(v))) as Effect.Effect<
            unknown,
            unknown,
            never
          >,
        );
        return;
      }
      const a = isAtomHandle(source) ? source.atom : source;
      const unsub = fiber.registry.subscribe(a, fn, { immediate: true });
      Effect.runSync(Scope.addFinalizer(fiber.scope, Effect.sync(unsub)));
    }),
  );
}
