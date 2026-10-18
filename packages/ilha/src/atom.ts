import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import * as Stream from "effect/Stream";

import { ilhaError, ilhaWarn } from "./diagnostics.ts";
import type { FiberLocal } from "./runtime.ts";
import { getActiveFiber, getFiber, withFiber } from "./runtime.ts";
import { hasBrand, toError } from "./shared.ts";
import type {
  AtomHandle,
  AtomLazyOptions,
  AtomOptions,
  Instruction,
} from "./types.ts";

/** Wrap an effect as a `yield*`-able, awaitable instruction bound to the active fiber. */
export const instr = <A, E = never>(
  effect: Effect.Effect<A, E, AtomRegistry>
): Instruction<A, E> => {
  const fiber = getFiber();
  const out = {
    $$ilhaOp: 1,
    effect,
    *[Symbol.iterator](): Iterator<Instruction<A, E>, A, A> {
      // SAFETY: `out` is the finished Instruction; interpret resumes the
      // generator with the effect's success value.
      return yield out as Instruction<A, E>;
    },
  };
  // oxlint-disable-next-line unicorn/no-thenable -- Instruction implements PromiseLike for await
  Object.defineProperty(out, "then", {
    value: async <R1 = A, R2 = never>(
      onOk?: (value: A) => R1 | PromiseLike<R1>,
      onErr?: <F>(failure: F) => R2 | PromiseLike<R2>
    ): Promise<R1 | R2> => {
      const { promise, resolve, reject } = Promise.withResolvers<A>();
      fiber.run(effect, resolve, reject);
      let value: A;
      try {
        value = await promise;
      } catch (error) {
        if (onErr) {
          return onErr(error);
        }
        throw error;
      }
      // SAFETY: without `onOk`, R1 defaults to A and resolves to the value.
      return onOk ? onOk(value) : (value as never);
    },
  });
  // SAFETY: the iterator and `then` complete the Instruction surface.
  return out as Instruction<A, E>;
};

export const isInstruction = <T>(x: T): x is T & Instruction<unknown> =>
  hasBrand(x, "$$ilhaOp");

export const isAtomHandle = <T>(x: T): x is T & AtomHandle<unknown> =>
  hasBrand(x, "$$atom");

interface TrackFrame {
  fiber: FiberLocal;
  get: <A>(atom: Atom.Atom<A>) => A;
}

// Render frames whose atom reads subscribe their fiber. `tracking` is false
// inside `untrack`.
const frames: TrackFrame[] = [];
let tracking = false;

/** Test seam: drop render frames a failed test left open. */
export const resetRenderTracking = (): void => {
  frames.length = 0;
  tracking = false;
};

/** Read atoms inside `fn` without subscribing the active render. Sync only. */
export const untrack = <A>(fn: () => A): A => {
  const prev = tracking;
  tracking = false;
  try {
    return fn();
  } finally {
    tracking = prev;
  }
};

const readTracked = <A>(atom: Atom.Atom<A>, registry: AtomRegistry): A => {
  if (!tracking) {
    return registry.get(atom);
  }
  // Another root (a nested `renderToString`, a sibling async render) may have
  // pushed its own frame above this fiber's, so match the frame by fiber.
  // After an `await`, the fiber stack is empty: the pending frame (kept open
  // by withTrackGetRun) is then the render context, so post-await reads stay
  // reactive.
  const active = getActiveFiber();
  const frame = active
    ? frames.findLast((f) => f.fiber === active)
    : frames.at(-1);
  return frame ? frame.get(atom) : registry.get(atom);
};

/** Reset per-render slot cursors; warn when the primitive count drifts. */
export const beginPrimitiveFrame = (fiber: FiberLocal): void => {
  const used = fiber.primitiveI ?? 0;
  const slots = fiber.primitives?.length ?? 0;
  if (used > 0 && used !== slots) {
    ilhaWarn("ILHA002", `${slots} → ${used}`);
  }
  fiber.primitiveI = 0;
  fiber.watchI = 0;
};

/**
 * Run a render with atom reads tracked into `deps`. An async render keeps its
 * frame open until it settles, so reads after `await` still subscribe.
 */
export const withTrackGetRun = <A>(
  fiber: FiberLocal,
  fn: () => A | Promise<A>,
  onOk: (result: { value: A; deps: Set<Atom.Atom<unknown>> }) => void,
  onErr: (failure: Error) => void
): void => {
  const deps = new Set<Atom.Atom<unknown>>();
  const frame: TrackFrame = {
    fiber,
    get: (a) => {
      deps.add(a);
      return fiber.registry.get(a);
    },
  };
  const restore = (): void => {
    if (fiber.trackRestore !== restore) {
      return;
    }
    frames.splice(frames.lastIndexOf(frame), 1);
    tracking = frames.length > 0;
    fiber.trackRestore = undefined;
  };
  frames.push(frame);
  tracking = true;
  fiber.trackRestore = restore;
  const done = (value: A): void => {
    restore();
    onOk({ deps, value });
  };
  const failed = <F>(failure: F): void => {
    restore();
    onErr(toError(failure));
  };
  try {
    const result = withFiber(fiber, fn);
    if (result instanceof Promise) {
      // Reads in post-await continuations still land in `deps`: the frame
      // stays open until the render settles.
      const settle = async (): Promise<void> => {
        try {
          const value = await result;
          if (!fiber.closed) {
            done(value);
          }
        } catch (error) {
          if (!fiber.closed) {
            failed(error);
          }
        }
      };
      void settle();
      return;
    }
    done(result);
  } catch (error) {
    failed(error);
  }
};

/** Rerun `run` once per microtask when any of `deps` changes. */
export const subscribeRenderDeps = (
  fiber: FiberLocal,
  deps: Set<Atom.Atom<unknown>>,
  run: () => void
): (() => void) => {
  let scheduled = false;
  const schedule = (): void => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    const seen = fiber.renderGen;
    fiber.runtime.later(() => {
      scheduled = false;
      // A render that started after the change already read the new value,
      // for example the parent rerunning this component with new props.
      if (fiber.renderGen === seen) {
        run();
      }
    });
  };
  const unsubs = [...deps].map((dep) =>
    fiber.registry.subscribe(dep, schedule)
  );
  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
};

/** Callable handle over `atom` that reads through the active render's tracking. */
export const wrapHandle = <A>(
  atom: Atom.Atom<A>,
  fiber: FiberLocal
): AtomHandle<A> => {
  const { registry } = fiber;
  const guard = (): void => {
    const active = getActiveFiber();
    if (active && active.registry !== registry) {
      throw ilhaError("ILHA003");
    }
  };
  return Object.assign(
    () => {
      guard();
      return readTracked(atom, registry);
    },
    {
      $$atom: 1 as const,
      atom,
      set: (next: A) => {
        guard();
        if (Atom.isWritable(atom)) {
          registry.set(atom, next);
        }
      },
      update: (f: (current: A) => A) => {
        guard();
        if (Atom.isWritable(atom)) {
          registry.update(atom, f);
        }
      },
    }
  );
};

/**
 * Claim the fiber's next primitive slot. A fresh slot is built by `make`,
 * seeded from the hydration snapshot when `snapshotted`; SSR records its
 * value so hydration can restore it in the same order.
 */
const useSlot = <A>(
  snapshotted: boolean,
  make: (fiber: FiberLocal, hydrated: A | undefined) => Atom.Atom<A>
): AtomHandle<A> => {
  const fiber = getFiber();
  const { runtime } = fiber;
  const i = fiber.primitiveI ?? 0;
  fiber.primitiveI = i + 1;
  fiber.primitives ??= [];
  // SAFETY: slots are per-fiber and ordered, so the stored atom was created
  // by the same primitive call site with the same A.
  let a = fiber.primitives[i] as Atom.Atom<A> | undefined;
  if (!a) {
    let hydrated: A | undefined;
    if (snapshotted && runtime.hydrateValues) {
      // SAFETY: snapshots are recorded in primitive declaration order by SSR.
      hydrated = runtime.hydrateValues[runtime.hydrateI] as A | undefined;
      runtime.hydrateI += 1;
    }
    a = make(fiber, hydrated);
    fiber.primitives[i] = a;
    if (snapshotted && runtime.ssr) {
      runtime.ssrValues.push(fiber.registry.get(a));
    }
  }
  return wrapHandle(a, fiber);
};

/**
 * Keep a component's own state atom in the registry while its fiber lives.
 * The registry drops an atom nothing subscribes to, so state a handler
 * writes and the view never reads would otherwise reset between events.
 */
const holdState = <A>(fiber: FiberLocal, atom: Atom.Atom<A>): Atom.Atom<A> => {
  if (!fiber.runtime.ssr) {
    fiber.primitiveHolds ??= [];
    fiber.primitiveHolds.push(fiber.registry.mount(atom));
  }
  return atom;
};

type AtomInit<A> =
  | A
  | Atom.Atom<A>
  | Effect.Effect<A, unknown, AtomRegistry>
  | Stream.Stream<A, unknown, AtomRegistry>;

export interface AtomFn {
  /** An effect or stream runs once; the handle holds its `AsyncResult`. */
  <A, E>(
    init: Effect.Effect<A, E, AtomRegistry> | Stream.Stream<A, E, AtomRegistry>,
    options?: AtomOptions<AsyncResult.AsyncResult<A, E>>
  ): AtomHandle<AsyncResult.AsyncResult<A, E>>;
  /**
   * An existing Effect atom, or a plain value. Store a function with
   * `atom.lazy(() => fn)`; the `ilha/oxlint` rule `function-in-atom` flags
   * `atom(fn)`.
   */
  <A>(init: Atom.Atom<A> | A, options?: AtomOptions<A>): AtomHandle<A>;
  lazy: <A>(init: () => A, options?: AtomLazyOptions) => AtomHandle<A>;
}

// SAFETY: the overloads in AtomFn describe the runtime shapes below; an
// effect/stream slot holds the AsyncResult that Atom.make produces.
export const atom = Object.assign(
  <A>(init: AtomInit<A>, options?: AtomOptions<A>): AtomHandle<A> => {
    // Only plain-value slots occupy a snapshot entry, on SSR and hydration alike.
    const plain =
      !Atom.isAtom(init) && !Effect.isEffect(init) && !Stream.isStream(init);
    return useSlot<A>(plain && options?.snapshot !== false, (fiber, seed) => {
      if (Atom.isAtom(init)) {
        return init;
      }
      if (!plain) {
        // SAFETY: an effect/stream atom holds AsyncResult<A>; AtomFn types
        // the handle accordingly, and the painter unwraps it.
        return Atom.make(init as Effect.Effect<A>) as Atom.Atom<A>;
      }
      // SAFETY: the remaining union member is the plain seed value A.
      const made = Atom.make(seed === undefined ? (init as A) : seed);
      const eq = options?.equals;
      return holdState(
        fiber,
        eq
          ? Atom.withEquality(made, eq === "structural" ? Equal.equals : eq)
          : made
      );
    });
  },
  {
    lazy: <A>(init: () => A, options?: AtomLazyOptions): AtomHandle<A> =>
      useSlot<A>(options?.snapshot !== false, (fiber, seed) =>
        holdState(fiber, Atom.make(seed === undefined ? init() : seed))
      ),
  }
) as AtomFn;

export const { batch } = Atom;
