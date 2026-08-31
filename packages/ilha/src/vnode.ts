import { Fragment, type VNode, type View } from "./types.ts";

export { Fragment };

export function h(
  type: string | Fragment | ((props: Record<string, unknown>) => unknown),
  props: Record<string, unknown> | null | undefined,
  ...rest: View[]
): VNode {
  const p = { ...(props ?? {}) };
  const fromProps = p.children;
  delete p.children;
  const children = flatten([...(fromProps === undefined ? [] : [fromProps as View]), ...rest]);
  const key = p.key as string | number | undefined;
  delete p.key;
  return {
    $$ilha: 1,
    type,
    props: p,
    children,
    key,
  };
}

function flatten(xs: View[]): View[] {
  const out: View[] = [];
  for (const x of xs) {
    if (Array.isArray(x)) out.push(...flatten(x));
    else out.push(x);
  }
  return out;
}

export function isVNode(x: unknown): x is VNode {
  return typeof x === "object" && x !== null && (x as VNode).$$ilha === 1;
}

export function isSetupFn(x: unknown): boolean {
  if (typeof x !== "function") return false;
  const n = x.constructor?.name;
  return n === "GeneratorFunction" || n === "AsyncFunction";
}
