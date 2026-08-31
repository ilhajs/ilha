import type { Effect, Stream } from "effect";
import type { Closeable } from "effect/Scope";
import type { Atom } from "effect/unstable/reactivity";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";

export type JsonText = string | number | bigint | boolean | null | undefined;

export type View =
  | VNode
  | JsonText
  | AtomHandle<any>
  | Stream.Stream<View, any, any>
  | GeneratorFn
  | Component
  | View[]
  | Iterable<View>;

export const Fragment: unique symbol = Symbol("ilha.Fragment");
export type Fragment = typeof Fragment;

export interface VNode {
  readonly $$ilha: 1;
  readonly type: string | Fragment | ((props: Record<string, unknown>) => unknown);
  readonly props: Record<string, unknown>;
  readonly children: View[];
  readonly key?: string | number;
}

export type GeneratorFn = (this: void, ...args: any[]) => Generator<Yielded, View | void, unknown>;

export type Yielded = View | Instruction<any> | Effect.Effect<any, any, any>;

export interface Instruction<A, E = unknown>
  extends Iterable<Instruction<A, E>, A>, PromiseLike<A> {
  readonly $$ilhaOp: 1;
  readonly effect: Effect.Effect<A, E, AtomRegistry>;
}

export type Component = GeneratorFn | (() => View | void | Promise<View | void>);

export interface IlhaRuntime {
  readonly registry: AtomRegistry;
  readonly scope: Closeable;
  readonly ssr: boolean;
  readonly ssrValues: unknown[];
  ssrActions: Record<string, { k: string; a: unknown[] }>;
  ssrEventI: number;
  ssrCapture: boolean;
  hydrateValues?: unknown[];
  hydrateI: number;
  nextHole(): number;
  begin(): void;
  end(): void;
  later(fn: () => void): void;
  setIdle(cb: () => void): void;
  close(): void;
}

export interface AtomHandle<A> {
  readonly $$atom: 1;
  readonly atom: Atom.Atom<A>;
  (): A;
  set(next: A): void;
  update(f: (current: A) => A): void;
}

export type Done<A> = (value: A) => void;
