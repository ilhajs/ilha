import type { ComponentFn, Fragment, PropBag } from "./types.ts";
import { h as createElement } from "./vnode.ts";

export type { View } from "./types.ts";
export type { JSX } from "./jsx-types.ts";
export { Fragment, h } from "./vnode.ts";

export const jsx = (
  type: string | Fragment | ComponentFn,
  props: PropBag | null,
  key?: string | number
): ReturnType<typeof createElement> =>
  createElement(type, key === undefined ? props : { ...props, key });
export const jsxs = jsx;
export const jsxDEV = jsx;
