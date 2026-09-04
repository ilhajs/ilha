import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";

import { asFailure, failureMessage } from "./errors.ts";
import type { FiberLocal } from "./runtime.ts";
import { withFiber } from "./runtime.ts";
import { isObject } from "./shared.ts";
import type { GeneratorFn, Instruction, View, Yielded } from "./types.ts";

export const isInstruction = (x: Yielded): x is Instruction<unknown> =>
  // SAFETY: the `$$ilhaOp` brand is the runtime marker installed by instr() on every Instruction.
  isObject(x) && (x as Instruction<unknown>).$$ilhaOp === 1;

const interpret = (gen: GeneratorFn, fiber: FiberLocal): void => {
  const iter = gen();
  const resume = <S, T>(send?: S, thrown?: T) => {
    if (fiber.closed) {
      return;
    }
    withFiber(fiber, () => {
      if (fiber.inFlight) {
        throw new Error("ilha: re-enter while Instruction in flight");
      }
      let step: IteratorResult<Yielded, unknown>;
      try {
        step = thrown === undefined ? iter.next(send) : iter.throw(thrown);
      } catch (error) {
        fiber.fail(asFailure(error));
        return;
      }
      if (step.done) {
        if (step.value !== undefined) {
          // SAFETY: a completed generator's return value is the view it yielded.
          fiber.paint(step.value as View);
        }
        return;
      }
      let effect: Effect.Effect<unknown, unknown, AtomRegistry> | undefined;
      if (isInstruction(step.value)) {
        ({ effect } = step.value);
      } else if (Effect.isEffect(step.value)) {
        effect = step.value;
      }
      if (effect) {
        fiber.inFlight = true;
        fiber.run(
          effect,
          (a) => {
            fiber.inFlight = false;
            resume(a);
          },
          (e) => {
            fiber.inFlight = false;
            resume(undefined, new Error(failureMessage(e)));
          }
        );
        return;
      }
      // SAFETY: a non-done, non-effect step value is exactly the view to paint.
      fiber.paint(step.value as View);
      resume();
    });
  };
  resume();
};

export { interpret };
