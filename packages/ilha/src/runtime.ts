import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import type * as Atom from "effect/unstable/reactivity/Atom";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import * as Registry from "effect/unstable/reactivity/AtomRegistry";

import type { View, IlhaRuntime } from "./types.ts";

export type Hole = {
  dispose: () => void;
  keepOnMorph?: boolean;
  atom?: Atom.Atom<unknown>;
  host?: Element;
  holeFiber?: FiberLocal;
};

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
  liveEl?: Element;
  primitiveI?: number;
  primitives?: import("effect/unstable/reactivity/Atom").Atom<unknown>[];
  watchI?: number;
  watchSlots?: import("./watch.ts").WatchSlot[];
  renderSub?: () => void;
  trackRestore?: () => void;
  propsBox?: { current: Record<string, unknown> };
  paint: (view: View) => void;
  run: (
    effect: Effect.Effect<unknown, unknown, AtomRegistry>,
    onOk?: (a: unknown) => void,
    onErr?: (e: unknown) => void,
  ) => void;
  fail: (e: unknown) => void;
  park: () => void;
}

const stack: FiberLocal[] = [];
// Active render context for primitives. Callers must run island setup and
// Effect continuations inside `withFiber`; async callbacks that call `atom()`
// without it may bind to the wrong island when another mount is on the stack.
export const getFiber = (): FiberLocal => {
  const f = stack.findLast((x) => !x.closed);
  if (!f) throw new Error("ilha: no fiber");
  return f;
};
export const getActiveFiber = (): FiberLocal | undefined => stack.findLast((x) => !x.closed);
export const withFiber = <A>(fiber: FiberLocal, fn: () => A): A => {
  stack.push(fiber);
  try {
    return fn();
  } finally {
    stack.pop();
  }
};

const provide = (
  effect: Effect.Effect<unknown, unknown, AtomRegistry>,
  registry: AtomRegistry,
): Effect.Effect<unknown, unknown> =>
  effect.pipe(Effect.provideService(Registry.AtomRegistry, registry)) as Effect.Effect<
    unknown,
    unknown
  >;

const runInScope = (
  effect: Effect.Effect<unknown, unknown, AtomRegistry>,
  registry: AtomRegistry,
  scope: Scope.Scope,
  onOk?: (a: unknown) => void,
  onErr?: (e: unknown) => void,
  onDone?: () => void,
): void => {
  const provided = provide(effect, registry);
  const f = Effect.runFork(
    onOk || onDone
      ? provided.pipe(
          Effect.onExit((ex) =>
            Effect.sync(() => {
              onDone?.();
              if (Exit.isSuccess(ex)) onOk?.(ex.value);
              else if (!Cause.hasInterruptsOnly(ex.cause)) onErr?.(Cause.squash(ex.cause));
            }),
          ),
        )
      : provided,
  );
  Effect.runSync(Scope.addFinalizer(scope, Fiber.interrupt(f)));
};

export function closeFiber(fiber: FiberLocal): void {
  if (fiber.closed) return;
  fiber.closed = true;
  fiber.trackRestore?.();
  fiber.trackRestore = undefined;
  fiber.renderSub?.();
  fiber.renderSub = undefined;
  for (const slot of fiber.watchSlots ?? []) slot?.dispose();
  fiber.watchSlots = [];
  for (const h of fiber.holes) h.dispose();
  fiber.holes = [];
  Effect.runFork(Scope.close(fiber.scope, Exit.void));
}

export function makeRuntime(opts?: {
  ssr?: boolean;
  hydrate?: unknown[];
  ssrCapture?: boolean;
}): IlhaRuntime {
  const registry = Registry.make();
  const scope = Scope.makeUnsafe();
  let holeSeq = 0;
  let pending = 0;
  let onIdle: (() => void) | undefined;
  const runtime: IlhaRuntime = {
    registry,
    scope,
    ssr: opts?.ssr === true,
    ssrValues: [],
    ssrActions: {},
    ssrEventI: 0,
    ssrCapture: opts?.ssrCapture === true,
    hydrateValues: opts?.hydrate,
    hydrateI: 0,
    nextHole: () => ++holeSeq,
    begin() {
      pending++;
    },
    end() {
      pending--;
      if (pending === 0) onIdle?.();
    },
    later(fn) {
      runtime.begin();
      queueMicrotask(() => {
        try {
          fn();
        } finally {
          runtime.end();
        }
      });
    },
    setIdle(cb) {
      onIdle = cb;
      if (pending === 0) cb();
    },
    close() {
      onIdle = undefined;
      Effect.runFork(Scope.close(scope, Exit.void));
      registry.dispose();
    },
  };
  return runtime;
}

export function makeFiber(
  runtime: IlhaRuntime,
  root: ParentNode,
  paint: (fiber: FiberLocal, view: View) => void,
  opts?: { onFail?: (e: unknown) => void },
): FiberLocal {
  const scope = Scope.forkUnsafe(runtime.scope);
  const fiber: FiberLocal = {
    root,
    registry: runtime.registry,
    scope,
    runtime,
    holes: [],
    inFlight: false,
    closed: false,
    paint: (view) => paint(fiber, view),
    run(effect, onOk, onErr) {
      if (fiber.closed) return;
      if (onOk) fiber.runtime.begin();
      runInScope(
        effect,
        fiber.registry,
        fiber.scope,
        onOk &&
          ((a) => {
            if (!fiber.closed) withFiber(fiber, () => onOk(a));
          }),
        onErr &&
          ((e) => {
            if (!fiber.closed) withFiber(fiber, () => onErr(e));
          }),
        onOk && (() => fiber.runtime.end()),
      );
    },
    fail(e) {
      opts?.onFail?.(e);
    },
    park() {},
  };
  return fiber;
}
