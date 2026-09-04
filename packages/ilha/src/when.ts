import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";

import { instr } from "./atom.ts";
import { interpret } from "./interpret.ts";
import { closeFiber, getFiber, makeFiber } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import type { GeneratorFn, Instruction, View, Yielded } from "./types.ts";

export const when = <A, E = never, R = never>(
  stream: Stream.Stream<A, E, R>,
  body: (value: A) => Generator<Yielded, View | undefined, View>
): Instruction<undefined, E> =>
  instr(
    Effect.gen(function* whenBody() {
      const parent = getFiber();
      let child: FiberLocal | undefined;
      parent.holes.push({
        dispose() {
          if (child) {
            closeFiber(child);
          }
          child = undefined;
        },
      });
      // SAFETY: when() runs under an island fiber whose registry satisfies AtomRegistry.
      const base = stream as Stream.Stream<A, E, AtomRegistry>;
      const src = parent.runtime.ssr ? base.pipe(Stream.take(1)) : base;
      yield* Stream.runForEach(src, (value) =>
        Effect.sync(() => {
          if (child) {
            closeFiber(child);
          }
          // Child fibers paint with their parent's paint fn so `when` works
          // under both DOM mount and SSR (ssr-paint).
          child = makeFiber(parent.runtime, parent.root, parent.paintFn, {
            onFail: parent.fail,
          });
          // SAFETY: body(value) is a generator of Yielded; interpret expects GeneratorFn.
          interpret((() => body(value)) as GeneratorFn, child);
        })
      );
    })
  );
