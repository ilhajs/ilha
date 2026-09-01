import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";

import { instr } from "./atom.ts";
import { interpret } from "./interpret.ts";
import { paint } from "./paint.ts";
import { closeFiber, getFiber, makeFiber, type FiberLocal } from "./runtime.ts";
import type { GeneratorFn, Instruction, View, Yielded } from "./types.ts";

export function when<A, E = never, R = never>(
  stream: Stream.Stream<A, E, R>,
  body: (value: A) => Generator<Yielded, View | void, unknown>,
): Instruction<void, E> {
  return instr(
    Effect.gen(function* () {
      const parent = getFiber();
      let child: FiberLocal | undefined;
      parent.holes.push({
        dispose() {
          if (child) closeFiber(child);
          child = undefined;
        },
      });
      const base = stream as Stream.Stream<A, E, AtomRegistry>;
      const src = parent.runtime.ssr ? base.pipe(Stream.take(1)) : base;
      yield* Stream.runForEach(src, (value) =>
        Effect.sync(() => {
          if (child) closeFiber(child);
          child = makeFiber(parent.runtime, parent.root, paint, {
            onFail: parent.fail,
          });
          interpret((() => body(value)) as GeneratorFn, child);
        }),
      );
    }),
  );
}
