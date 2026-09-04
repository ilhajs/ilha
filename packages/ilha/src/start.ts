import type { Atom } from "effect/unstable/reactivity";

import {
  beginPrimitiveFrame,
  subscribeRenderDeps,
  withTrackGetRun,
} from "./atom.ts";
import { asFailure } from "./errors.ts";
import { interpret } from "./interpret.ts";
import { withFiber } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import { isFunction } from "./shared.ts";
import type { Component, GeneratorFn, View } from "./types.ts";

type SetupResult =
  | View
  | Generator<YieldStep, View | undefined, View>
  | undefined;
type YieldStep = View;

interface SetupApi {
  commit: (out: SetupResult, deps: Set<Atom.Atom<unknown>>) => void;
  render: () => void;
}

const isGen = <T>(
  x: T
): x is T & Generator<YieldStep, View | undefined, View> => {
  if (x === null || x === undefined) {
    return false;
  }
  // SAFETY: generators expose next/throw callables (not plain objects — skip isObject).
  const g = x as { next?: unknown; throw?: unknown };
  return isFunction(g.next) && isFunction(g.throw);
};

const finish = (fiber: FiberLocal, view: View | undefined): void => {
  if (fiber.closed) {
    return;
  }
  if (view !== undefined) {
    fiber.paint(view);
  }
};

export const runSetup = (fiber: FiberLocal, fn: Component): void => {
  const disposeRenderSub = () => {
    fiber.renderSub?.();
    fiber.renderSub = undefined;
  };

  const api = {
    commit: (out, deps) => {
      if (isGen(out)) {
        disposeRenderSub();
        // SAFETY: isGen narrowed out to a generator; interpret wraps it as GeneratorFn.
        interpret((() => out) as GeneratorFn, fiber);
        return;
      }
      disposeRenderSub();
      if (!fiber.runtime.ssr) {
        fiber.renderSub = subscribeRenderDeps(fiber, deps, () => api.render());
      }
      withFiber(fiber, () => {
        // SAFETY: non-generator setup results are Views (or undefined) for finish().
        finish(fiber, out as View | undefined);
      });
    },
    render: () => {
      if (fiber.closed) {
        return;
      }
      fiber.runtime.begin();
      beginPrimitiveFrame(fiber);
      withTrackGetRun(
        fiber,
        () => fn(),
        ({ value: out, deps }) => {
          try {
            api.commit(out, deps);
          } catch (error) {
            withFiber(fiber, () => fiber.fail(asFailure(error)));
          } finally {
            fiber.runtime.end();
          }
        },
        (e) => {
          withFiber(fiber, () => fiber.fail(asFailure(e)));
          fiber.runtime.end();
        }
      );
    },
  } satisfies SetupApi;

  try {
    api.render();
  } catch (error) {
    fiber.fail(asFailure(error));
  }
};
