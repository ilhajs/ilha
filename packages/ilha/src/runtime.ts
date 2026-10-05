import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import type * as Atom from "effect/reactivity/Atom";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import * as Registry from "effect/reactivity/AtomRegistry";
import * as Scope from "effect/Scope";

import { toError } from "./errors.ts";
import { errorView } from "./shared.ts";
import type { SnapshotValue } from "./snapshot.ts";
import type {
  ComponentFn,
  Fragment,
  PropBag,
  View,
  IlhaRuntime,
} from "./types.ts";
import type { WatchSlot } from "./watch.ts";

export interface Hole {
  dispose: () => void;
  keepOnMorph?: boolean;
  atom?: Atom.Atom<unknown>;
  host?: Element;
  holeFiber?: FiberLocal;
  islandSlot?: IslandSlot;
}

export interface IslandSlot {
  type: string | Fragment | ComponentFn;
  host: Element;
  updateProps?: (props?: PropBag) => void;
  unmount?: () => void;
}

export interface IslandFrame {
  i: number;
  slots: (IslandSlot | undefined)[];
}

export interface ComponentSlot {
  type: unknown;
  hole: FiberLocal;
}

export interface ComponentFrame {
  i: number;
  slots: ComponentSlot[];
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
  /** Counts this fiber's paints; a keyed hole records the last one it was in. */
  keyedGen?: number;
  /** On a keyed hole: the parent's `keyedGen` of the last paint that reached it. */
  keyedSeen?: number;
  liveEl?: Element;
  primitiveI?: number;
  primitives?: Atom.Atom<unknown>[];
  /** Releases for the state atoms this fiber keeps in the registry. */
  primitiveHolds?: (() => void)[];
  watchI?: number;
  watchSlots?: WatchSlot[];
  islandFrame?: IslandFrame;
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
  run: <A, E>(
    effect: Effect.Effect<A, E, AtomRegistry>,
    onOk?: (a: A) => void,
    onErr?: (e: E) => void
  ) => void;
  fail: <E>(e: E) => void;
}

const stack: FiberLocal[] = [];
// Active render context for primitives. Callers must run island setup and
// Effect continuations inside `withFiber`; async callbacks that call `atom()`
// without it may bind to the wrong island when another mount is on the stack.
export const getFiber = (): FiberLocal => {
  const f = stack.findLast((x) => !x.closed);
  if (!f) {
    throw new Error("ilha: no fiber");
  }
  return f;
};
export const getActiveFiber = (): FiberLocal | undefined =>
  stack.findLast((x) => !x.closed);
export const withFiber = <A>(fiber: FiberLocal, fn: () => A): A => {
  stack.push(fiber);
  try {
    return fn();
  } finally {
    stack.pop();
  }
};

const provide = <A, E>(
  effect: Effect.Effect<A, E, AtomRegistry>,
  registry: AtomRegistry
): Effect.Effect<A, E> =>
  // SAFETY: provideService removes AtomRegistry from the environment.
  effect.pipe(
    Effect.provideService(Registry.AtomRegistry, registry)
  ) as Effect.Effect<A, E>;

const runInScope = <A, E>(
  effect: Effect.Effect<A, E, AtomRegistry>,
  registry: AtomRegistry,
  scope: Scope.Scope,
  onOk?: (a: A) => void,
  onErr?: (e: E) => void,
  onDone?: () => void
): void => {
  const provided = provide(effect, registry);
  const f = Effect.runFork(
    onOk || onDone
      ? provided.pipe(
          Effect.onExit((ex) =>
            Effect.sync(() => {
              onDone?.();
              if (Exit.isSuccess(ex)) {
                onOk?.(ex.value);
              } else if (!Cause.hasInterruptsOnly(ex.cause)) {
                // SAFETY: Cause.squash yields the failure channel value E.
                onErr?.(Cause.squash(ex.cause) as E);
              }
            })
          )
        )
      : provided
  );
  Effect.runSync(Scope.addFinalizer(scope, Fiber.interrupt(f)));
};

/** Clear render subscriptions and child holes without closing the fiber scope. */
export const clearFiberView = (fiber: FiberLocal): void => {
  fiber.renderSub?.();
  fiber.renderSub = undefined;
  for (const slot of fiber.watchSlots ?? []) {
    slot?.dispose();
  }
  fiber.watchSlots = [];
  fiber.watchI = 0;
  fiber.primitives = undefined;
  fiber.primitiveI = 0;
  for (const release of fiber.primitiveHolds ?? []) {
    release();
  }
  fiber.primitiveHolds = undefined;
  fiber.islandFrame = undefined;
  fiber.keyedHoles = undefined;
  for (const h of fiber.holes) {
    h.dispose();
  }
  fiber.holes = [];
};

export const closeFiber = (fiber: FiberLocal): void => {
  if (fiber.closed) {
    return;
  }
  fiber.closed = true;
  fiber.trackRestore?.();
  fiber.trackRestore = undefined;
  fiber.handleError = undefined;
  clearFiberView(fiber);
  Effect.runFork(Scope.close(fiber.scope, Exit.void));
};

export const makeRuntime = (opts?: {
  ssr?: boolean;
  hydrate?: SnapshotValue[];
  ssrCapture?: boolean;
  onError?: (error: Error) => void;
}): IlhaRuntime => {
  const registry = Registry.make();
  const scope = Scope.makeUnsafe();
  let holeSeq = 0;
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
    nextHole: () => {
      holeSeq += 1;
      return holeSeq;
    },
    onError: opts?.onError,
    registry,
    scope,
    setIdle: (onReady) => {
      onIdle = onReady;
      if (pending === 0) {
        return onReady();
      }
    },
    ssr: opts?.ssr === true,
    ssrActions: {},
    ssrCapture: opts?.ssrCapture === true,
    ssrEventI: 0,
    ssrValues: [],
  };
  return runtime;
};

export const makeFiber = <E>(
  runtime: IlhaRuntime,
  root: ParentNode,
  paint: (fiber: FiberLocal, view: View) => void,
  opts?: { onFail?: (e: E) => void; parent?: FiberLocal }
): FiberLocal => {
  const scope = Scope.forkUnsafe(runtime.scope);
  const fiber: FiberLocal = {
    closed: false,
    fail: (e) => {
      // SAFETY: onFail is typed to the caller's E; fail is invoked with that same failure.
      opts?.onFail?.(e as E);
    },
    holes: [],
    inFlight: false,
    paint: (view) => paint(fiber, view),
    paintFn: paint,
    parent: opts?.parent,
    registry: runtime.registry,
    root,
    run: (effect, onOk, onErr) => {
      if (fiber.closed) {
        return;
      }
      if (onOk) {
        fiber.runtime.begin();
      }
      runInScope(
        effect,
        fiber.registry,
        fiber.scope,
        onOk &&
          ((a) => {
            if (!fiber.closed) {
              withFiber(fiber, () => onOk(a));
            }
          }),
        onErr &&
          ((e) => {
            if (!fiber.closed) {
              withFiber(fiber, () => onErr(e));
            }
          }),
        onOk && (() => fiber.runtime.end())
      );
    },
    runtime,
    scope,
  };
  return fiber;
};

/** Walk this fiber and ancestors for an error boundary handler. */
export const reportFiberError = (fiber: FiberLocal, error: Error): boolean => {
  let current: FiberLocal | undefined = fiber;
  while (current) {
    const { handleError } = current;
    if (handleError) {
      handleError(error);
      return true;
    }
    current = current.parent;
  }
  return false;
};

/**
 * Open a mount's root fiber. A failing root component reports to
 * `runtime.onError`, paints the error view, and settles the mount.
 */
export const makeRootFiber = ({
  runtime,
  root,
  paint,
  settle,
}: {
  runtime: IlhaRuntime;
  root: ParentNode;
  paint: (fiber: FiberLocal, view: View) => void;
  settle: () => void;
}): FiberLocal => {
  const fiber = makeFiber(runtime, root, paint, {
    onFail: (e) => {
      const error = toError(e);
      runtime.onError?.(error);
      console.error(error);
      fiber.paint(errorView(error));
      settle();
    },
  });
  return fiber;
};
