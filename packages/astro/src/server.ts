import type { AstroComponentMetadata, NamedSSRLoadedRendererValue } from "astro";
import { renderToString } from "ilha";

let componentFilter: Promise<(id: string) => boolean> | undefined;

function getComponentFilter() {
  return (componentFilter ??= import("virtual:@ilha/astro/options")
    .then(({ default: filter }) => filter)
    .catch(() => () => true));
}

interface AstroRenderable {
  render(destination: { write(chunk: unknown): void }): void | Promise<void>;
}

function isAstroRenderable(value: unknown): value is AstroRenderable {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { render?: unknown }).render === "function"
  );
}

async function resolveAstroRenderable(value: AstroRenderable): Promise<string> {
  let out = "";
  await value.render({
    write(chunk) {
      if (chunk != null) out += String(chunk);
    },
  });
  return out;
}

async function resolvePropValue(value: unknown): Promise<unknown> {
  if (isAstroRenderable(value)) return await resolveAstroRenderable(value);
  if (Array.isArray(value)) return Promise.all(value.map(resolvePropValue));
  return value;
}

async function mergeProps(
  props: Record<string, unknown>,
  slots: Record<string, string>,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    resolved[key] = await resolvePropValue(value);
  }
  for (const [name, value] of Object.entries(slots)) {
    resolved[name === "default" ? "children" : name] = value;
  }
  return resolved;
}

async function check(
  Component: unknown,
  _props: Record<string, unknown>,
  _slots: Record<string, string>,
  metadata?: AstroComponentMetadata,
): Promise<boolean> {
  if (metadata?.componentUrl && !(await getComponentFilter())(metadata.componentUrl)) return false;
  return typeof Component === "function";
}

async function renderToStaticMarkup(
  Component: unknown,
  props: Record<string, unknown>,
  slots: Record<string, string>,
  metadata?: AstroComponentMetadata,
): Promise<{ html: string }> {
  if (typeof Component !== "function") {
    throw new Error(
      `[@ilha/astro] Unable to render "${metadata?.displayName ?? "component"}" — expected a function.`,
    );
  }
  const merged = await mergeProps(props, slots);
  const html = await renderToString(
    () => (Component as (p: Record<string, unknown>) => unknown)(merged) as never,
  );
  return { html };
}

const renderer: NamedSSRLoadedRendererValue = {
  name: "@ilha/astro",
  check,
  renderToStaticMarkup,
};

export default renderer;
