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

export function wrapHandle<A>(atom: Atom.Atom<A>, fiber: FiberLocal): AtomHandle<A> {
  const registry = fiber.registry;
  const read = (() => {
    guardHandleFiber(read);
    return trackGet ? trackGet(atom) : registry.get(atom);
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

export function atom<A>(init: () => A): AtomHandle<A>;
export function atom<A>(
  init: A | Atom.Atom<A> | Effect.Effect<A, any, any> | Stream.Stream<A, any, any>,
): AtomHandle<A>;
export function atom<A>(
  init: A | (() => A) | Atom.Atom<A> | Effect.Effect<A, any, any> | Stream.Stream<A, any, any>,
): AtomHandle<A> {
  const fiber = getFiber();
  const computed =
    typeof init === "function" &&
    !Atom.isAtom(init) &&
    !Effect.isEffect(init) &&
    !Stream.isStream(init);
  let seed = init;
  const snap = fiber.runtime.hydrateValues;
  if (snap && !Atom.isAtom(init) && !Effect.isEffect(init) && !Stream.isStream(init)) {
    const v = snap[fiber.runtime.hydrateI++];
    if (!computed && v !== undefined) seed = v as A;
  }
  let a: Atom.Atom<A>;
  if (Atom.isAtom(seed)) a = seed as Atom.Atom<A>;
  else if (Effect.isEffect(seed) || Stream.isStream(seed))
    a = Atom.make(seed as Effect.Effect<A, unknown>) as Atom.Atom<A>;
  else if (computed) {
    const fn = init as () => A;
    a = Atom.make((get) => {
      const prev = trackGet;
      trackGet = (other) => get(other);
      try {
        return fn();
      } finally {
        trackGet = prev;
      }
    });
  } else a = Atom.make(seed as A);
  const handle = wrapHandle(a, fiber);
  if (fiber.runtime.ssr) fiber.runtime.ssrValues.push(fiber.registry.get(a));
  return handle;
}
