import { isFunction, isObject } from "./shared.ts";
import type { ComponentFn, Fragment, PropBag, VNode, View } from "./types.ts";

export { Fragment } from "./types.ts";

const flatten = (xs: View[]): View[] => {
  const out: View[] = [];
  for (const x of xs) {
    if (Array.isArray(x)) {
      out.push(...flatten(x));
    } else {
      out.push(x);
    }
  }
  return out;
};

export const h = (
  type: string | Fragment | ComponentFn,
  props: PropBag | null | undefined,
  ...rest: View[]
): VNode => {
  // SAFETY: props may be null/undefined; spreading either yields {}.
  const p: PropBag = { ...props };
  const fromProps = p.children;
  const { key: rawKey, ...restProps } = p;
  const children = flatten([
    ...(fromProps === undefined
      ? []
      : [
          // SAFETY: JSX children props are View material; h only builds vnodes.
          fromProps as View,
        ]),
    ...rest,
  ]);
  // SAFETY: JSX key is string | number when present; strip it from element props.
  const key = rawKey as string | number | undefined;
  return {
    $$ilha: 1,
    children,
    key,
    props: restProps,
    type,
  };
};

export const isVNode = <T>(x: T): x is T & VNode => {
  if (!isObject(x)) {
    return false;
  }
  // SAFETY: $$ilha brand is installed by h() on every vnode.
  return (x as { readonly $$ilha?: unknown }).$$ilha === 1;
};

export const isSetupFn = <T>(x: T): boolean => {
  if (!isFunction(x)) {
    return false;
  }
  // SAFETY: isFunction narrowed x to a callable; constructor.name discriminates generators/async.
  const n = (x as { constructor?: { name?: string } }).constructor?.name;
  return n === "GeneratorFunction" || n === "AsyncFunction";
};
