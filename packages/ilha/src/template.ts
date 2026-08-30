import type { TemplateNode } from "./index";

export function elementTemplate(
  tag: string,
  props: Record<string, unknown> | null | undefined,
  children: unknown[],
): TemplateNode {
  const attrs = { ...props };
  delete attrs.children;
  return {
    kind: "element",
    tag,
    props: attrs,
    children: children.flat(Infinity).map((value) => ({ kind: "dynamic", value })),
  };
}

export function fragmentTemplate(children: unknown[]): TemplateNode {
  return {
    kind: "fragment",
    children: children.flat(Infinity).map((value) => ({ kind: "dynamic", value })),
  };
}
