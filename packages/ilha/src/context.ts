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

const defaults = new WeakMap<object, Atom.Atom<unknown>>();

const getDefaultAtom = <A>(ctx: IlhaContext<A>): Atom.Atom<A> => {
  const existing = defaults.get(ctx);
  if (existing) {
    // SAFETY: stored under this context object with Atom.Atom<A>.
    return existing as Atom.Atom<A>;
  }
  const made = Atom.make(ctx.defaultValue);
  defaults.set(ctx, made);
  return made;
};

export const createContext = <A>(defaultValue: A): IlhaContext<A> => {
  const id = Symbol("ilha.context");

  const Provider = (props: ContextProviderProps<A>): View => {
    const fiber = getFiber();
    const { value: next, children } = props;
    const handle = atom(next);
    if (
      !Object.is(
        untrack(() => handle()),
        next
      )
    ) {
      handle.set(next);
    }
    fiber.contexts ??= new Map();
    fiber.contexts.set(id, handle.atom);
    return children;
  };

  return { Provider, defaultValue, id };
};

/** Read a context value as an atom handle. Subscribes the active fiber on read. */
export const context = <A>(ctx: IlhaContext<A>): AtomHandle<A> => {
  const fiber = getFiber();
  let current: FiberLocal | undefined = fiber;
  while (current) {
    const found = current.contexts?.get(ctx.id);
    if (found) {
      // SAFETY: Provider stored Atom.Atom<A> under this context id.
      return wrapHandle(found as Atom.Atom<A>, fiber);
    }
    current = current.parent;
  }
  return wrapHandle(getDefaultAtom(ctx), fiber);
};
