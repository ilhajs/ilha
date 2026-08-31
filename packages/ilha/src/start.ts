import { asFailure } from "./errors.ts";
import { interpret } from "./interpret.ts";
import { setIsland, withFiber, type FiberLocal } from "./runtime.ts";
import type { GeneratorFn, Setup, View } from "./types.ts";

function isGen(x: unknown): x is Generator<unknown, View | void, unknown> {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Generator<unknown>).next === "function" &&
    typeof (x as Generator<unknown>).throw === "function"
  );
}

function finish(fiber: FiberLocal, view: View | void): void {
  if (fiber.closed) return;
  if (view !== undefined) fiber.paint(view);
  fiber.park();
}

export function runSetup(fiber: FiberLocal, fn: Setup): void {
  try {
    setIsland(fiber);
    const out = withFiber(fiber, () => fn());
    if (isGen(out)) interpret((() => out) as GeneratorFn, fiber);
    else {
      fiber.runtime.begin();
      Promise.resolve(out).then(
        (view) => {
          finish(fiber, view);
          fiber.runtime.end();
        },
        (e) => {
          fiber.fail(asFailure(e));
          fiber.runtime.end();
        },
      );
    }
  } catch (e) {
    fiber.fail(asFailure(e));
  }
}
