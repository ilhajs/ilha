import type { JSX } from "./jsx-types.ts";
import { hasBrand } from "./shared.ts";
import type {
  ComponentFn,
  ComponentRequires,
  Fragment,
  JsxComponent,
  PropBag,
  Requires,
  VNode,
  View,
} from "./types.ts";

export { Fragment } from "./types.ts";

/**
 * Untyped factory behind `h`; the JSX runtime forwards through here.
 *
 * @internal
 */
export const createVNode = (
  type: string | Fragment | ComponentFn | JsxComponent,
  props: PropBag | null | undefined,
  ...rest: View[]
): VNode => {
  const { key, children, ...own } = props ?? {};
  // SAFETY: JSX children props are View material; nested arrays flatten.
  const all: unknown[] = children === undefined ? rest : [children, ...rest];
  return {
    $$ilha: 1,
    // SAFETY: flat(Infinity) leaves no nested arrays, only child views.
    children: all.flat(Number.POSITIVE_INFINITY) as View[],
    // SAFETY: a JSX key is a string or number when present.
    key: key as string | number | undefined,
    props: own,
    type,
  };
};

/**
 * Build a vnode. Intrinsic tags take exactly the props JSX accepts, so an
 * unknown tag, a misspelt attribute or a wrongly typed handler is a compile
 * error here exactly as in JSX. Custom elements (`my-widget`) stay a plain
 * prop bag, and components keep their own prop types. The returned vnode
 * carries the tag's requirements plus the union of its children's, so plain
 * children give `VNode<never>`.
 */
export interface HFn {
  <K extends keyof JSX.IntrinsicElements, const C extends readonly View[]>(
    type: K,
    props: JSX.IntrinsicElements[K] | null,
    ...rest: C
  ): VNode<ComponentRequires<K> | Requires<C[number]>>;
  <const C extends readonly View[]>(
    type: `${string}-${string}`,
    props: PropBag | null,
    ...rest: C
  ): VNode<Requires<C[number]>>;
  <
    P,
    T extends (props: P) => ReturnType<JsxComponent>,
    const C extends readonly View[],
  >(
    type: T,
    props: P | null | undefined,
    ...rest: C
  ): VNode<ComponentRequires<T> | Requires<C[number]>>;
  <
    T extends Fragment | ComponentFn | JsxComponent,
    const C extends readonly View[],
  >(
    type: T,
    props: PropBag | null | undefined,
    ...rest: C
  ): VNode<ComponentRequires<T> | Requires<C[number]>>;
}

// SAFETY: createVNode returns `VNode<never>` and takes supertypes of every
// overload's parameters, so it satisfies `HFn`. It goes through `unknown`
// because the checker's depth limiter can't prove it: the deferred
// `ComponentRequires` / `Requires` conditionals in the returns exceed it,
// even though every concrete call resolves eagerly and exactly.
// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- HFn overloads are unprovable through direct assertion; the unknown hop is the only sound cast.
export const h = createVNode as unknown as HFn;

export const isVNode = <T>(x: T): x is T & VNode => hasBrand(x, "$$ilha");
