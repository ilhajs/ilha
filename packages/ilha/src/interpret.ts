import * as Effect from "effect/Effect";

import { asFailure, failureMessage } from "./errors.ts";
import type { FiberLocal } from "./runtime.ts";
import { withFiber } from "./runtime.ts";
import type { GeneratorFn, Instruction, View } from "./types.ts";

export function isInstruction(x: unknown): x is Instruction<unknown> {
  return typeof x === "object" && x !== null && (x as Instruction<unknown>).$$ilhaOp === 1;
}

export function interpret(gen: GeneratorFn, fiber: FiberLocal): void {
  const iter = gen();
  const resume = (send?: unknown, thrown?: unknown) => {
    if (fiber.closed) return;
    withFiber(fiber, () => {
      if (fiber.inFlight) throw new Error("ilha: re-enter while Instruction in flight");
      let step: IteratorResult<unknown, View | void>;
      try {
        step = thrown === undefined ? iter.next(send) : iter.throw!(thrown);
      } catch (err) {
        fiber.fail(asFailure(err));
        return;
      }
      if (step.done) {
        if (step.value !== undefined) fiber.paint(step.value as View);
        fiber.park();
        return;
      }
      const effect = isInstruction(step.value)
        ? step.value.effect
        : Effect.isEffect(step.value)
          ? step.value
          : undefined;
      if (effect) {
        fiber.inFlight = true;
        fiber.run(
          effect as Effect.Effect<
            unknown,
            unknown,
            import("effect/unstable/reactivity/AtomRegistry").AtomRegistry
          >,
          (a) => {
            fiber.inFlight = false;
            resume(a);
          },
          (e) => {
            fiber.inFlight = false;
            resume(undefined, new Error(failureMessage(e)));
          },
        );
        return;
      }
      fiber.paint(step.value as View);
      resume(undefined);
    });
  };
  resume(undefined);
}
