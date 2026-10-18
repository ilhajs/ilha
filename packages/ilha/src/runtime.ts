import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Atom from "effect/reactivity/Atom";
import * as Registry from "effect/reactivity/AtomRegistry";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import * as Scope from "effect/Scope";

import { errorView, noop, toError } from "./shared.ts";
import type { SnapshotValue } from "./snapshot.ts";
import type { IlhaRuntime, PropBag, View } from "./types.ts";
import type { WatchSlot } from "./watch.ts";

/** A disposable a paint leaves behind: a child fiber, subscription, or ref. */
export interface Hole {
  dispose: () => void;
  /** Survives repaints that reach it again (components, atom holes). */
  keep?: boolean;
  atom?: Atom.Atom<unknown>;
  fiber?: FiberLocal;
}

export interface ComponentFrame {
  i: number;
  slots: { type: unknown; hole: FiberLocal }[];
}

export interface FiberLocal {
  root: ParentNode;
  registry: AtomRegistry;
  scope: Scope.Closeable;
  runtime: IlhaRuntime;
  holes: Hole[];
  inFlight: boolean;
  closed: boolean;
  hydrate?: boolean;
  keyedHoles?: Map<string, FiberLocal>;
  /** Counts this fiber's paints. */
  gen?: number;
  /** On a hole: the parent's `gen` of the last paint that reached it. */
  seen?: number;
  primitiveI?: number;
  primitives?: Atom.Atom<unknown>[];
  /** Releases for the state atoms this fiber keeps in the registry. */
  primitiveHolds?: (() => void)[];
  watchI?: number;
  watchSlots?: WatchSlot[];
  componentFrame?: ComponentFrame;
  componentType?: unknown;
  renderSub?: () => void;
  /** Counts the renders this fiber started; see `subscribeRenderDeps`. */
  renderGen?: number;
  trackRestore?: () => void;
  propsBox?: { current: PropBag };
  parent?: FiberLocal;
  contexts?: Map<symbol, Atom.Atom<unknown>>;
  handleError?: (error: Error) => void;
  paintFn: (fiber: FiberLocal, view: View) => void;
  paint: (view: View) => void;
  /** Fork `effect` in this fiber's scope; returns an interruptor. */
  run: <A, E>(
    effect: Effect.Effect<A, E, AtomRegistry>,
    onOk?: (a: A) => void,
    onErr?: (e: E) => void
  ) => () => void;
  fail: <E>(e: E) => void;
}

const stack: FiberLocal[] = [];

export const getActiveFiber = (): FiberLocal | undefined =>
  stack.findLast((x) => !x.closed);

// Active render context for primitives. Callers must run island setup and
// Effect continuations inside `withFiber`; async callbacks that call `atom()`
// without it may bind to the wrong island when another mount is on the stack.
export const getFiber = (): FiberLocal => {
  const f = getActiveFiber();
  if (!f) {
    throw new Error("ilha: no fiber");
  }
  return f;
};

export const withFiber = <A>(fiber: FiberLocal, fn: () => A): A => {
  stack.push(fiber);
  try {
    return fn();
  } finally {
    stack.pop();
  }
};

/** Clear render subscriptions and child holes without closing the fiber scope. */
export const clearFiberView = (fiber: FiberLocal): void => {
  fiber.renderSub?.();
  fiber.renderSub = undefined;
  for (const slot of fiber.watchSlots ?? []) {
    slot?.dispose();
  }
  for (const release of fiber.primitiveHolds ?? []) {
    release();
  }
  for (const h of fiber.holes) {
    h.dispose();
  }
  fiber.watchSlots = [];
  fiber.watchI = 0;
  fiber.primitives = undefined;
  fiber.primitiveI = 0;
  fiber.primitiveHolds = undefined;
  fiber.keyedHoles = undefined;
  fiber.holes = [];
};

export const closeFiber = (fiber: FiberLocal): void => {
  if (fiber.closed) {
    return;
  }
  fiber.closed = true;
  fiber.trackRestore?.();
  fiber.handleError = undefined;
  clearFiberView(fiber);
  Effect.runFork(Scope.close(fiber.scope, Exit.void));
};

export const makeRuntime = (opts?: {
  ssr?: boolean;
  hydrate?: SnapshotValue[];
  onError?: (error: Error) => void;
}): IlhaRuntime => {
  const registry = Registry.make();
  const scope = Scope.makeUnsafe();
  let pending = 0;
  let onIdle: (() => void) | undefined;
  const runtime: IlhaRuntime = {
    begin: () => {
      pending += 1;
    },
    close: () => {
      onIdle = undefined;
      Effect.runFork(Scope.close(scope, Exit.void));
      registry.dispose();
    },
    end: () => {
      pending -= 1;
      if (pending === 0) {
        onIdle?.();
      }
    },
    fork: Effect.runSyncWith(Context.make(Registry.AtomRegistry, registry)),
    holeSeq: 0,
    hydrateI: 0,
    hydrateValues: opts?.hydrate,
    later: (fn) => {
      runtime.begin();
      queueMicrotask(() => {
        try {
          fn();
        } finally {
          runtime.end();
        }
      });
    },
    onError: opts?.onError,
    registry,
    scope,
    setIdle: (onReady) => {
      onIdle = onReady;
      if (pending === 0) {
        onReady();
      }
    },
    ssr: opts?.ssr === true,
    ssrValues: [],
  };
  return runtime;
};

/** Walk this fiber and ancestors for an error boundary handler. */
const reportFiberError = (fiber: FiberLocal, error: Error): boolean => {
  for (let f: FiberLocal | undefined = fiber; f; f = f.parent) {
    if (f.handleError) {
      f.handleError(error);
      return true;
    }
  }
  return false;
};

/**
 * Open a fiber. A failure reports to the nearest `ErrorBoundary`; uncaught,
 * it calls `runtime.onError`, paints the error view, then `onFail`.
 */
export const makeFiber = (
  runtime: IlhaRuntime,
  root: ParentNode,
  paint: (fiber: FiberLocal, view: View) => void,
  opts?: { onFail?: () => void; parent?: FiberLocal }
): FiberLocal => {
  const fiber: FiberLocal = {
    closed: false,
    fail: (e) => {
      const error = toError(e);
      if (reportFiberError(fiber, error)) {
        return;
      }
      runtime.onError?.(error);
      console.error(error);
      fiber.paint(errorView(error));
      opts?.onFail?.();
    },
    holes: [],
    inFlight: false,
    paint: (view) => paint(fiber, view),
    paintFn: paint,
    parent: opts?.parent,
    registry: runtime.registry,
    root,
    run: <A, E>(
      effect: Effect.Effect<A, E, AtomRegistry>,
      onOk?: (a: A) => void,
      onErr?: (e: E) => void
    ) => {
      if (fiber.closed) {
        return noop;
      }
      if (onOk) {
        runtime.begin();
      }
      const child = runtime.fork(
        Effect.forkIn(
          effect.pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (onOk) {
                  runtime.end();
                }
                if (fiber.closed) {
                  return;
                }
                if (Exit.isSuccess(exit)) {
                  if (onOk) {
                    withFiber(fiber, () => onOk(exit.value));
                  }
                } else if (onErr && !Cause.hasInterruptsOnly(exit.cause)) {
                  // SAFETY: Cause.squash yields the failure channel value E.
                  withFiber(fiber, () => onErr(Cause.squash(exit.cause) as E));
                }
              })
            )
          ),
          fiber.scope,
          { startImmediately: true }
        )
      );
      return () => child.interruptUnsafe();
    },
    runtime,
    scope: Scope.forkUnsafe(runtime.scope),
  };
  return fiber;
};
