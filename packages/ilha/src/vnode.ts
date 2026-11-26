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

const createVNode = (
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
 * Build a vnode. A component with typed props gets its props checked against
 * that type; elements and untyped components take a plain prop bag.
 */
export interface HFn {
  <P>(
    type: (props: P) => ReturnType<JsxComponent>,
    props: P | null | undefined,
    ...rest: View[]
  ): VNode;
  (
    type: string | Fragment | ComponentFn | JsxComponent,
    props: PropBag | null | undefined,
    ...rest: View[]
  ): VNode;
}

// SAFETY: createVNode is the shared implementation behind both overloads;
// typed-props components are plain prop bags at runtime.
export const h = createVNode as HFn;

export const isVNode = <T>(x: T): x is T & VNode => hasBrand(x, "$$ilha");
