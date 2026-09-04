import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";

import type { FiberLocal } from "./runtime.ts";
import { getActiveFiber, getFiber, withFiber } from "./runtime.ts";
import { isFunction } from "./shared.ts";
import type { AtomHandle, Instruction } from "./types.ts";

export const handleOwner = new WeakMap<object, FiberLocal>();

const guardHandleFiber = (handle: AtomHandle<unknown>): void => {
  const owner = handleOwner.get(handle);
  if (!owner) {
    return;
  }
  const active = getActiveFiber();
  if (!active || active.registry === owner.registry) {
    return;
  }
  throw new Error("ilha: atom handle used from a different island");
};

export const instr = <A, E = never>(
  effect: Effect.Effect<A, E, AtomRegistry>
): Instruction<A, E> => {
  const fiber = getFiber();
  const out = {
    $$ilhaOp: 1,
    effect,
    *[Symbol.iterator](): Iterator<Instruction<A, E>, A, A> {
      // SAFETY: `out` is the finished Instruction — `then` is attached via
      // defineProperty immediately after this literal; interpret resumes the
      // generator with the effect result (A).
      return yield out as Instruction<A, E>;
    },
  };
  const awaitInstruction = async <E2>(
    onFulfilled?: (value: A) => void,
    onRejected?: (error: E2) => void
  ): Promise<void> => {
    const { promise, resolve, reject } = Promise.withResolvers<A>();
    fiber.run(
      out.effect,
      (a) => {
        // SAFETY: fiber.run yields this effect's success value, which is exactly A.
        withFiber(fiber, () => resolve(a as A));
      },
      reject
    );
    try {
      const value = await promise;
      onFulfilled?.(value);
    } catch (error) {
      // SAFETY: catch binding is the rejection reason forwarded to onRejected.
      onRejected?.(error as E2);
    }
  };
  // SAFETY: Instruction is deliberately a thenable — `yield*` and await consume
  // it; the awaitInstruction bridge is attached before the typed return.
  // oxlint-disable-next-line unicorn/no-thenable -- Instruction implements PromiseLike for yield*/await
  Object.defineProperty(out, "then", { value: awaitInstruction });
  // SAFETY: `out` is the finished Instruction — the thenable bridge and the
  // iterator above complete the full Instruction surface.
  return out as Instruction<A, E>;
};

export const isAtomHandle = <T>(x: T): x is T & AtomHandle<unknown> =>
  // SAFETY: the `$$atom` brand is the runtime marker installed by wrapHandle
  // on every atom handle; x has passed the callable check above.
  isFunction(x) && (x as AtomHandle<unknown>).$$atom === 1;

type TrackGet = <A>(atom: Atom.Atom<A>) => A;
let trackGet: TrackGet | undefined;
const trackStack: {
  fiber: FiberLocal;
  deps: Set<Atom.Atom<unknown>>;
  get: TrackGet;
}[] = [];

export const resetRenderTracking = (): void => {
  trackStack.length = 0;
  trackGet = undefined;
};

export const beginPrimitiveFrame = (fiber: FiberLocal): void => {
  const used = fiber.primitiveI ?? 0;
  const slots = fiber.primitives?.length ?? 0;
  if (used > 0 && used !== slots) {
    console.warn(
      `ilha: atom/watch slot count changed between renders (${slots} → ${used}); keep primitive order stable`
    );
  }
  fiber.primitiveI = 0;
  fiber.watchI = 0;
  if (!fiber.islandFrame) {
    fiber.islandFrame = { i: 0, slots: [] };
  }
  const { islandFrame } = fiber;
  const usedIslands = islandFrame.i;
  if (usedIslands < islandFrame.slots.length) {
    for (let j = usedIslands; j < islandFrame.slots.length; j += 1) {
      const slot = islandFrame.slots[j];
      if (slot) {
        slot.unmount?.();
        islandFrame.slots[j] = undefined;
      }
    }
    islandFrame.slots.length = usedIslands;
  }
  islandFrame.i = 0;
};

interface PrimitiveSlot<A> {
  atom: Atom.Atom<A>;
  fresh: boolean;
}

const readTracked = <A>(atom: Atom.Atom<A>, registry: AtomRegistry): A => {
  const frame = trackStack.at(-1);
  const active = getActiveFiber();
  // Async setup: after an `await`, the component's continuation resumes with an
  // empty fiber stack. The pending frame (kept open by withTrackGetRun for the
  // in-flight promise) is then the only render context — trust it when nothing
  // else is on the stack, so post-await atom reads stay reactive.
  if (trackGet && frame && (active === frame.fiber || active === undefined)) {
    // SAFETY: the tracked getter returns the same atom's current value that
    // registry.get would; the A parameter is the caller's atom type.
    return trackGet(atom) as A;
  }
  // SAFETY: registry.get returns the current value of exactly this atom.
  return registry.get(atom) as A;
};

const usePrimitiveSlot = <A>(
  fiber: FiberLocal,
  make: () => Atom.Atom<A>
): PrimitiveSlot<A> => {
  const i = fiber.primitiveI ?? 0;
  fiber.primitiveI = i + 1;
  fiber.primitives ??= [];
  const existing = fiber.primitives[i];
  if (existing) {
    // SAFETY: slots are per-fiber and ordered, so the stored atom was created
    // by the same primitive call site with the same A.
    return { atom: existing as Atom.Atom<A>, fresh: false };
  }
  const a = make();
  fiber.primitives[i] = a;
  return { atom: a, fresh: true };
};

export const withTrackGetRun = <A, E = never>(
  fiber: FiberLocal,
  fn: () => A | Promise<A>,
  onOk: (result: { value: A; deps: Set<Atom.Atom<unknown>> }) => void,
  onErr: (e: E) => void
): void => {
  const deps = new Set<Atom.Atom<unknown>>();
  const get: TrackGet = (a) => {
    deps.add(a);
    return fiber.registry.get(a);
  };
  const restore = () => {
    if (fiber.trackRestore !== restore) {
      return;
    }
    const top = trackStack.pop();
    if (top?.get !== get) {
      if (top) {
        trackStack.push(top);
      }
      const i = trackStack.findIndex((frame) => frame.get === get);
      if (i !== -1) {
        trackStack.splice(i, 1);
      }
    }
    trackGet = trackStack.at(-1)?.get;
    fiber.trackRestore = undefined;
  };
  trackStack.push({ deps, fiber, get });
  trackGet = get;
  fiber.trackRestore = restore;
  try {
    const result = withFiber(fiber, () => fn());
    if (result instanceof Promise) {
      // Keep the tracking frame open until the promise settles: reads performed
      // in the component's post-await continuations (JSX built after `await`)
      // must land in `deps`, or the painted view never re-renders.
      const settle = async (): Promise<void> => {
        try {
          const value = await result;
          restore();
          if (fiber.closed) {
            return;
          }
          onOk({ deps, value });
        } catch (error) {
          restore();
          if (fiber.closed) {
            return;
          }
          onErr(error);
        }
      };
      void settle();
      return;
    }
    restore();
    onOk({ deps, value: result });
  } catch (error) {
    restore();
    onErr(error);
  }
};

export const subscribeRenderDeps = (
  fiber: FiberLocal,
  deps: Set<Atom.Atom<unknown>>,
  run: () => void
): (() => void) => {
  let scheduled = false;
  const schedule = () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    fiber.runtime.later(() => {
      scheduled = false;
      run();
    });
  };
  const unsubs: (() => void)[] = [];
  for (const dep of deps) {
    unsubs.push(fiber.registry.subscribe(dep, schedule));
  }
  // With no deps this iterates an empty list — a deliberate no-op unsubscribe.
  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
};

export const wrapHandle = <A>(
  atom: Atom.Atom<A>,
  fiber: FiberLocal
): AtomHandle<A> => {
  const { registry } = fiber;
  // SAFETY: the handle is the callable read function below; the handle
  // members are attached immediately via defineProperties.
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
        if (Atom.isWritable(atom)) {
          registry.set(atom, n);
        }
      },
    },
    update: {
      value: (f: (c: A) => A) => {
        guardHandleFiber(read);
        if (Atom.isWritable(atom)) {
          registry.update(atom, f);
        }
      },
    },
  });
  return read;
};

const makeAtom = <A>(
  init:
    | A
    | Atom.Atom<A>
    | Effect.Effect<A, unknown, AtomRegistry>
    | Stream.Stream<A, unknown, AtomRegistry>
): AtomHandle<A> => {
  const fiber = getFiber();
  const snap = fiber.runtime.hydrateValues;
  const { atom: a, fresh } = usePrimitiveSlot(fiber, () => {
    let seed = init;
    if (
      snap &&
      !Atom.isAtom(init) &&
      !Effect.isEffect(init) &&
      !Stream.isStream(init)
    ) {
      const v = snap[fiber.runtime.hydrateI];
      fiber.runtime.hydrateI += 1;
      if (v !== undefined) {
        // SAFETY: hydration snapshots are recorded in primitive declaration
        // order by the SSR pass; this slot's snapshot has type A.
        seed = v as A;
      }
    }
    if (Atom.isAtom(seed)) {
      // SAFETY: the seed was narrowed to an existing Atom by isAtom above.
      return seed as Atom.Atom<A>;
    }
    if (Effect.isEffect(seed) || Stream.isStream(seed)) {
      // SAFETY: Atom.make of an effect yields Atom<AsyncResult<A>>; the handle
      // and paint pipeline unwrap AsyncResult, so the slot is typed Atom<A>.
      return Atom.make(seed as Effect.Effect<A, unknown>) as Atom.Atom<A>;
    }
    // SAFETY: every other union member is the plain seed value A itself.
    return Atom.make(seed as A);
  });
  const handle = wrapHandle(a, fiber);
  if (fresh && fiber.runtime.ssr) {
    fiber.runtime.ssrValues.push(fiber.registry.get(a));
  }
  return handle;
};

const atomLazy = <A>(init: () => A): AtomHandle<A> => {
  const fiber = getFiber();
  const snap = fiber.runtime.hydrateValues;
  const { atom: a, fresh } = usePrimitiveSlot(fiber, () => {
    let seed = init();
    if (snap) {
      const v = snap[fiber.runtime.hydrateI];
      fiber.runtime.hydrateI += 1;
      if (v !== undefined) {
        // SAFETY: hydration snapshots are recorded in primitive declaration
        // order by the SSR pass; this slot's snapshot has type A.
        seed = v as A;
      }
    }
    return Atom.make(seed);
  });
  const handle = wrapHandle(a, fiber);
  if (fresh && fiber.runtime.ssr) {
    fiber.runtime.ssrValues.push(fiber.registry.get(a));
  }
  return handle;
};

export interface AtomFn {
  <A>(
    init:
      | A
      | Atom.Atom<A>
      | Effect.Effect<A, unknown, AtomRegistry>
      | Stream.Stream<A, unknown, AtomRegistry>
  ): AtomHandle<A>;
  lazy: <A>(init: () => A) => AtomHandle<A>;
}

export const atom: AtomFn = Object.assign(makeAtom, { lazy: atomLazy });

export const { batch } = Atom;
