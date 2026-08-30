import { ilha, raw, type Island } from "ilha";

const ISLAND = Symbol.for("ilha.island");
const RAW = Symbol.for("ilha.raw");

export type PlainComponent = (props: Record<string, unknown>) => unknown;

export function isIsland(Component: unknown): Component is Island {
  return typeof Component === "function" && ISLAND in (Component as object);
}

export function isRawHtml(value: unknown): value is { value: string } {
  return !!(value && typeof value === "object" && RAW in (value as object));
}

export function resultToHtml(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (isRawHtml(result)) return result.value;
  return undefined;
}

export function wrapPlainAsIsland(Component: PlainComponent, merged: Record<string, unknown>) {
  return ilha(() => {
    const html = resultToHtml(Component(merged));
    return html === undefined ? raw("") : raw(html);
  });
}
