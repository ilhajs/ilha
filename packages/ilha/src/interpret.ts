import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";

import { isInstruction } from "./atom.ts";
import type { FiberLocal } from "./runtime.ts";
import { withFiber } from "./runtime.ts";
import { toError } from "./shared.ts";
import type { GeneratorFn, View, Yielded } from "./types.ts";

/** Drive a generator component: paint yielded views, run yielded effects. */
export const interpret = (gen: GeneratorFn, fiber: FiberLocal): void => {
  const iter = gen();
  const resume = <S>(send?: S, thrown?: Error): void => {
    if (fiber.closed) {
      return;
    }
    withFiber(fiber, () => {
      if (fiber.inFlight) {
        throw new Error("ilha: re-enter while Instruction in flight");
      }
      let step: IteratorResult<Yielded, View | undefined>;
      try {
        // SAFETY: the generator resumes with the yielded effect's success value.
        step = thrown ? iter.throw(thrown) : iter.next(send as View);
      } catch (error) {
        fiber.fail(error);
        return;
      }
      const { value } = step;
      if (step.done) {
        if (value !== undefined) {
          fiber.paint(value);
        }
        return;
      }
      const effect = isInstruction(value) ? value.effect : value;
      if (Effect.isEffect(effect)) {
        fiber.inFlight = true;
        fiber.run(
          // SAFETY: yielded effects may only require the AtomRegistry run provides.
          effect as Effect.Effect<unknown, unknown, AtomRegistry>,
          (a) => {
            fiber.inFlight = false;
            resume(a);
          },
          (e) => {
            fiber.inFlight = false;
            resume(undefined, toError(e));
          }
        );
        return;
      }
      // SAFETY: a non-effect step value is the view to paint.
      fiber.paint(value as View);
      resume();
    });
  };
  resume();
};
