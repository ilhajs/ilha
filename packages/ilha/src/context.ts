import * as Atom from "effect/reactivity/Atom";

import { atom, untrack, wrapHandle } from "./atom.ts";
import { getFiber } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import type { AtomHandle, View } from "./types.ts";

export interface ContextProviderProps<A> {
  value: A;
  children?: View;
}

export interface IlhaContext<A> {
  readonly id: symbol;
  readonly defaultValue: A;
  readonly Provider: (props: ContextProviderProps<A>) => View;
}

const fallbacks = new WeakMap<object, Atom.Atom<unknown>>();

export const createContext = <A>(defaultValue: A): IlhaContext<A> => {
  const id = Symbol("ilha.context");
  const ctx: IlhaContext<A> = {
    Provider: ({ value, children }) => {
      const fiber = getFiber();
      const handle = atom(value, { snapshot: false });
      if (!Object.is(untrack(handle), value)) {
        handle.set(value);
      }
      fiber.contexts ??= new Map();
      fiber.contexts.set(id, handle.atom);
      return children;
    },
    defaultValue,
    id,
  };
  fallbacks.set(ctx, Atom.make(defaultValue));
  return ctx;
};

/** Read a context value as an atom handle. Subscribes the active fiber on read. */
export const context = <A>(ctx: IlhaContext<A>): AtomHandle<A> => {
  const fiber = getFiber();
  let found = fallbacks.get(ctx);
  for (let f: FiberLocal | undefined = fiber; f; f = f.parent) {
    const provided = f.contexts?.get(ctx.id);
    if (provided) {
      found = provided;
      break;
    }
  }
  // SAFETY: the Provider and the fallback store this context's Atom<A>.
  return wrapHandle(
    (found ?? Atom.make(ctx.defaultValue)) as Atom.Atom<A>,
    fiber
  );
};
