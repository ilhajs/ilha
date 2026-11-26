import type { JSX } from "./jsx-types.ts";
import { hasBrand } from "./shared.ts";
import type {
  ComponentFn,
  Fragment,
  JsxComponent,
  PropBag,
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
 * prop bag, and components keep their own prop types.
 */
export interface HFn {
  <K extends keyof JSX.IntrinsicElements>(
    type: K,
    props: JSX.IntrinsicElements[K] | null | undefined,
    ...rest: View[]
  ): VNode;
  <P>(
    type: (props: P) => ReturnType<JsxComponent>,
    props: P | null | undefined,
    ...rest: View[]
  ): VNode;
  (
    type: `${string}-${string}` | Fragment | ComponentFn | JsxComponent,
    props: PropBag | null | undefined,
    ...rest: View[]
  ): VNode;
}

// SAFETY: createVNode accepts a supertype of every overload's parameters and
// returns VNode; intrinsic and typed-props bags are plain prop bags at runtime.
export const h = createVNode as HFn;

export const isVNode = <T>(x: T): x is T & VNode => hasBrand(x, "$$ilha");
