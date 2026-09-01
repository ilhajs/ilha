import type { View } from "./types.ts";
import { h, Fragment } from "./vnode.ts";
export type { JSX } from "./jsx-types.ts";

export { Fragment, h };
export const jsx = (
  type: string | typeof Fragment | ((p: Record<string, unknown>) => unknown),
  props: Record<string, unknown> | null,
  key?: string | number,
): ReturnType<typeof h> => h(type, key === undefined ? props : { ...props, key });
export const jsxs = jsx;
export const jsxDEV = jsx;

export type { View };
