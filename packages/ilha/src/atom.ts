import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";

import { getActiveFiber, getFiber, withFiber, type FiberLocal } from "./runtime.ts";
import type { AtomHandle, Instruction } from "./types.ts";

export const handleOwner = new WeakMap<object, FiberLocal>();

function guardHandleFiber(handle: object): void {
  const owner = handleOwner.get(handle);
  if (!owner) return;
  const active = getActiveFiber();
  if (!active || active.registry === owner.registry) return;
  throw new Error("ilha: atom handle used from a different island");
}

export function instr<A, E = never>(effect: Effect.Effect<A, E, AtomRegistry>): Instruction<A, E> {
  const fiber = getFiber();
  const out: Instruction<A, E> = {
    $$ilhaOp: 1,
    effect,
    *[Symbol.iterator](): Iterator<Instruction<A, E>, A> {
      return (yield out) as A;
    },
    // SAFETY: thenable is the point — `yield*` and await consume Instructions.
    // oxlint-disable-next-line unicorn/no-thenable
    then(onFulfilled, onRejected) {
      return new Promise<A>((res, rej) => {
        fiber.run(
          out.effect,
          (a) => {
            withFiber(fiber, () => res(a as A));
          },
          rej,
        );
      }).then(onFulfilled, onRejected);
    },
  };
  return out;
}

export function isAtomHandle(x: unknown): x is AtomHandle<unknown> {
  return typeof x === "function" && (x as AtomHandle<unknown>).$$atom === 1;
}

let trackGet: ((atom: Atom.Atom<any>) => unknown) | undefined;
const trackStack: Array<{
  fiber: FiberLocal;
  deps: Set<Atom.Atom<unknown>>;
  get: (atom: Atom.Atom<any>) => unknown;
}> = [];

export function resetRenderTracking(): void {
  trackStack.length = 0;
  trackGet = undefined;
}

export function beginPrimitiveFrame(fiber: FiberLocal): void {
  const used = fiber.primitiveI ?? 0;
  const slots = fiber.primitives?.length ?? 0;
  if (used > 0 && used !== slots) {
    console.warn(
      `ilha: atom/watch slot count changed between renders (${slots} → ${used}); keep primitive order stable`,
    );
  }
  fiber.primitiveI = 0;
  fiber.watchI = 0;
  const islandFrame = (fiber.islandFrame ??= { i: 0, slots: [] });
  const usedIslands = islandFrame.i;
  if (usedIslands < islandFrame.slots.length) {
    for (let j = usedIslands; j < islandFrame.slots.length; j++) {
      const slot = islandFrame.slots[j];
      if (slot) {
        slot.unmount?.();
        islandFrame.slots[j] = undefined;
      }
    }
    islandFrame.slots.length = usedIslands;
  }
  islandFrame.i = 0;
}

function readTracked(atom: Atom.Atom<unknown>, registry: AtomRegistry): unknown {
  const frame = trackStack.at(-1);
  const active = getActiveFiber();
  if (trackGet && frame && active === frame.fiber) return trackGet(atom);
  return registry.get(atom);
}

function usePrimitiveSlot<A>(
  fiber: FiberLocal,
  make: () => Atom.Atom<A>,
): { atom: Atom.Atom<A>; fresh: boolean } {
  const i = fiber.primitiveI ?? 0;
  fiber.primitiveI = i + 1;
  fiber.primitives ??= [];
  const existing = fiber.primitives[i];
  if (existing) return { atom: existing as Atom.Atom<A>, fresh: false };
  const a = make();
  fiber.primitives[i] = a;
  return { atom: a, fresh: true };
}

export function withTrackGetRun<A>(
  fiber: FiberLocal,
  fn: () => A | Promise<A>,
  onOk: (result: { value: A; deps: Set<Atom.Atom<unknown>> }) => void,
  onErr: (e: unknown) => void,
): void {
  const deps = new Set<Atom.Atom<unknown>>();
  const get = (a: Atom.Atom<any>) => {
    deps.add(a);
    return fiber.registry.get(a);
  };
  const restore = () => {
    if (fiber.trackRestore !== restore) return;
    const top = trackStack.pop();
    if (top?.get !== get) {
      if (top) trackStack.push(top);
      const i = trackStack.findIndex((frame) => frame.get === get);
      if (i >= 0) trackStack.splice(i, 1);
    }
    trackGet = trackStack.at(-1)?.get;
    fiber.trackRestore = undefined;
  };
  trackStack.push({ fiber, deps, get });
  trackGet = get;
  fiber.trackRestore = restore;
  try {
    const result = withFiber(fiber, () => fn());
    if (result instanceof Promise) {
      restore();
      void result
        .then((value) => {
          if (fiber.closed) return;
          onOk({ value, deps });
        })
        .catch((e) => {
          if (fiber.closed) return;
          onErr(e);
        });
      return;
    }
    restore();
    onOk({ value: result, deps });
  } catch (e) {
    restore();
    onErr(e);
  }
}

export function subscribeRenderDeps(
  fiber: FiberLocal,
  deps: Set<Atom.Atom<unknown>>,
  run: () => void,
): () => void {
  if (deps.size === 0) return () => {};
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    fiber.runtime.later(() => {
      scheduled = false;
      run();
    });
  };
  const unsubs: (() => void)[] = [];
  for (const dep of deps) unsubs.push(fiber.registry.subscribe(dep, schedule));
  return () => {
    for (const unsub of unsubs) unsub();
  };
}

export function wrapHandle<A>(atom: Atom.Atom<A>, fiber: FiberLocal): AtomHandle<A> {
  const registry = fiber.registry;
  const read = (() => {
    guardHandleFiber(read);
    return readTracked(atom, registry);
  }) as AtomHandle<A>;
  handleOwner.set(read, fiber);
  Object.defineProperties(read, {
    $$atom: { value: 1 },
    atom: { value: atom },
    set: {
      value: (n: A) => {
        guardHandleFiber(read);
        if (Atom.isWritable(atom)) registry.set(atom, n);
      },
    },
    update: {
      value: (f: (c: A) => A) => {
        guardHandleFiber(read);
        if (Atom.isWritable(atom)) registry.update(atom, f);
      },
    },
  });
  return read;
}

function makeAtom<A>(
  init: A | Atom.Atom<A> | Effect.Effect<A, any, any> | Stream.Stream<A, any, any>,
): AtomHandle<A> {
  const fiber = getFiber();
  const snap = fiber.runtime.hydrateValues;
  const { atom: a, fresh } = usePrimitiveSlot(fiber, () => {
    let seed = init;
    if (snap && !Atom.isAtom(init) && !Effect.isEffect(init) && !Stream.isStream(init)) {
      const v = snap[fiber.runtime.hydrateI++];
      if (v !== undefined) seed = v as A;
    }
    if (Atom.isAtom(seed)) return seed as Atom.Atom<A>;
    if (Effect.isEffect(seed) || Stream.isStream(seed))
      return Atom.make(seed as Effect.Effect<A, unknown>) as Atom.Atom<A>;
    return Atom.make(seed as A);
  });
  const handle = wrapHandle(a, fiber);
  if (fresh && fiber.runtime.ssr) fiber.runtime.ssrValues.push(fiber.registry.get(a));
  return handle;
}

function atomLazy<A>(init: () => A): AtomHandle<A> {
  const fiber = getFiber();
  const snap = fiber.runtime.hydrateValues;
  const { atom: a, fresh } = usePrimitiveSlot(fiber, () => {
    let seed = init();
    if (snap) {
      const v = snap[fiber.runtime.hydrateI++];
      if (v !== undefined) seed = v as A;
    }
    return Atom.make(seed);
  });
  const handle = wrapHandle(a, fiber);
  if (fresh && fiber.runtime.ssr) fiber.runtime.ssrValues.push(fiber.registry.get(a));
  return handle;
}

export interface AtomFn {
  <A>(
    init: A | Atom.Atom<A> | Effect.Effect<A, any, any> | Stream.Stream<A, any, any>,
  ): AtomHandle<A>;
  lazy<A>(init: () => A): AtomHandle<A>;
}

export const atom = Object.assign(makeAtom, { lazy: atomLazy }) as AtomFn;

export const batch = Atom.batch;
