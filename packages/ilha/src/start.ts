import {
  beginPrimitiveFrame,
  subscribeRenderDeps,
  withTrackGetRun,
} from "./atom.ts";
import { interpret } from "./interpret.ts";
import { closeFiber, makeFiber, makeRuntime, withFiber } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import { isFunction } from "./shared.ts";
import type { SnapshotValue } from "./snapshot.ts";
import type { Component, IlhaRuntime, View, Yielded } from "./types.ts";

/** Render `fn` into `fiber` and rerender when an atom it read changes. */
export const runSetup = (fiber: FiberLocal, fn: Component): void => {
  const render = (): void => {
    if (fiber.closed) {
      return;
    }
    fiber.renderGen = (fiber.renderGen ?? 0) + 1;
    fiber.runtime.begin();
    beginPrimitiveFrame(fiber);
    withTrackGetRun(
      fiber,
      fn,
      ({ value, deps }) => {
        try {
          fiber.renderSub?.();
          fiber.renderSub = undefined;
          // SAFETY: generators expose next/throw; interpret drives them.
          const gen = value as Generator<Yielded, View | undefined, View>;
          if (isFunction(gen?.next) && isFunction(gen?.throw)) {
            interpret(() => gen, fiber);
            return;
          }
          if (!fiber.runtime.ssr) {
            fiber.renderSub = subscribeRenderDeps(fiber, deps, render);
          }
          if (value !== undefined && !fiber.closed) {
            withFiber(fiber, () => fiber.paint(value));
          }
        } catch (error) {
          withFiber(fiber, () => fiber.fail(error));
        } finally {
          fiber.runtime.end();
        }
      },
      (failure) => {
        withFiber(fiber, () => fiber.fail(failure));
        fiber.runtime.end();
      }
    );
  };
  try {
    render();
  } catch (error) {
    fiber.fail(error);
  }
};

/** Live root fibers, for `ilha/debug`. Costs one set add/delete per root. */
export const liveRoots = new Set<FiberLocal>();

/** Called after a paint, a root settling, or a root closing. `ilha/debug` fills it. */
export const rootListeners = new Set<() => void>();

export const notifyRoots = (): void => {
  for (const listener of rootListeners) {
    listener();
  }
};

export interface RootHandle {
  fiber: FiberLocal;
  runtime: IlhaRuntime;
  /** Resolves once the first paint and all pending work settle. */
  ready: Promise<null>;
  close: () => void;
}

/** Open a runtime and root fiber, then run `fn` as the root component. */
export const startRoot = ({
  fn,
  root,
  paint,
  ssr,
  hydrate,
  snapshot,
  onError,
  onIdle,
  onRuntime,
}: {
  fn: Component;
  root: ParentNode;
  paint: (fiber: FiberLocal, view: View) => void;
  ssr?: boolean;
  hydrate?: boolean;
  snapshot?: SnapshotValue[];
  onError?: (error: Error) => void;
  onIdle?: () => void;
  onRuntime?: (runtime: IlhaRuntime) => void;
}): RootHandle => {
  const runtime = makeRuntime({
    hydrate: snapshot,
    onError,
    ssr,
  });
  onRuntime?.(runtime);
  const { promise: ready, resolve } = Promise.withResolvers<null>();
  const settle = () => resolve(null);
  const fiber = makeFiber(runtime, root, paint, { onFail: settle });
  fiber.hydrate = hydrate;
  fiber.componentType = fn;
  liveRoots.add(fiber);
  runtime.begin();
  runtime.setIdle(() => {
    settle();
    onIdle?.();
    notifyRoots();
  });
  runSetup(fiber, fn);
  runtime.end();
  return {
    close: () => {
      closeFiber(fiber);
      runtime.close();
      if (liveRoots.delete(fiber)) {
        notifyRoots();
      }
    },
    fiber,
    ready,
    runtime,
  };
};
