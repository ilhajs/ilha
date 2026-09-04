import type { Effect, Stream } from "effect";
import type { Closeable } from "effect/Scope";
import type { Atom } from "effect/unstable/reactivity";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";

export type JsonText = string | number | bigint | boolean | null | undefined;

/** Runtime prop bag values painted onto elements / passed to components. */
export type PropValue =
  | JsonText
  | PropBag
  | StyleObject
  | EventHandler
  | AtomHandle<JsonText>
  | readonly PropValue[];

export type StyleObject = Readonly<
  Record<string, string | number | null | undefined>
>;

export type EventHandler = (event: Event) => void;

export type PropBag = Readonly<Record<string, PropValue | undefined>>;

export type ActionArg = JsonText | PropBag | readonly ActionArg[];

export interface SsrAction {
  readonly k: string;
  readonly a: readonly ActionArg[];
}

export type View =
  | VNode
  | JsonText
  | AtomHandle<unknown>
  | Stream.Stream<View, unknown, unknown>
  | GeneratorFn
  | Component
  | View[]
  | Iterable<View>;

// SAFETY: Fragment is a unique brand symbol compared by identity in paint/h.
const FragmentSymbol = Symbol("ilha.Fragment") as unique symbol;
export { FragmentSymbol as Fragment };
export type Fragment = typeof FragmentSymbol;

export type ComponentFn = (
  props: PropBag
) => View | Promise<View | undefined> | undefined;

export interface VNode {
  readonly $$ilha: 1;
  readonly type: string | Fragment | ComponentFn;
  readonly props: PropBag;
  readonly children: View[];
  readonly key?: string | number;
}

export type GeneratorFn = () => Generator<Yielded, View | undefined, View>;

export type Yielded =
  | View
  | Instruction<unknown>
  | Effect.Effect<unknown, unknown, unknown>;

export interface Instruction<A, E = Error>
  extends Iterable<Instruction<A, E>, A>, PromiseLike<A> {
  readonly $$ilhaOp: 1;
  readonly effect: Effect.Effect<A, E, AtomRegistry>;
}

export type Component =
  | (() => View | undefined | Promise<View | undefined>)
  | GeneratorFn;

export interface IlhaRuntime {
  readonly registry: AtomRegistry;
  readonly scope: Closeable;
  readonly ssr: boolean;
  readonly ssrValues: unknown[];
  ssrActions: Record<string, SsrAction>;
  ssrEventI: number;
  ssrCapture: boolean;
  hydrateValues?: unknown[];
  hydrateI: number;
  nextHole: () => number;
  begin: () => void;
  end: () => void;
  later: (fn: () => void) => void;
  setIdle: (cb: () => void) => void;
  close: () => void;
}

export interface AtomHandle<A> {
  readonly $$atom: 1;
  readonly atom: Atom.Atom<A>;
  (): A;
  set: (next: A) => void;
  update: (f: (current: A) => A) => void;
}
