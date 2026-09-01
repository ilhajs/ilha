import { beginPrimitiveFrame, subscribeRenderDeps, withTrackGetRun } from "./atom.ts";
import { asFailure } from "./errors.ts";
import { interpret } from "./interpret.ts";
import { withFiber, type FiberLocal } from "./runtime.ts";
import type { Component, GeneratorFn, View } from "./types.ts";

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

export function runSetup(fiber: FiberLocal, fn: Component): void {
  const disposeRenderSub = () => {
    fiber.renderSub?.();
    fiber.renderSub = undefined;
  };

  const commit = (
    out: unknown,
    deps: Set<import("effect/unstable/reactivity/Atom").Atom<unknown>>,
  ) => {
    if (isGen(out)) {
      disposeRenderSub();
      interpret((() => out) as GeneratorFn, fiber);
      return;
    }
    disposeRenderSub();
    if (!fiber.runtime.ssr) fiber.renderSub = subscribeRenderDeps(fiber, deps, render);
    withFiber(fiber, () => finish(fiber, out as View));
  };

  const render = () => {
    if (fiber.closed) return;
    fiber.runtime.begin();
    beginPrimitiveFrame(fiber);
    withTrackGetRun(
      fiber,
      () => fn(),
      ({ value: out, deps }) => {
        try {
          commit(out, deps);
        } catch (e) {
          withFiber(fiber, () => fiber.fail(asFailure(e)));
        } finally {
          fiber.runtime.end();
        }
      },
      (e) => {
        withFiber(fiber, () => fiber.fail(asFailure(e)));
        fiber.runtime.end();
      },
    );
  };

  try {
    render();
  } catch (e) {
    fiber.fail(asFailure(e));
  }
}
