import type { AstroComponentMetadata, NamedSSRLoadedRendererValue } from "astro";
import { ilha, raw } from "ilha";

// `Symbol.for` resolves to the same symbol across duplicate ilha copies in a
// realm, so these checks work without importing ilha's internals directly.
const ISLAND = Symbol.for("ilha.island");
const RAW = Symbol.for("ilha.raw");

let componentFilter: Promise<(id: string) => boolean> | undefined;

function getComponentFilter() {
  return (componentFilter ??= import("virtual:@ilha/astro/options")
    .then(({ default: filter }) => filter)
    .catch(() => () => true));
}

interface HydratableIsland {
  name?: string;
  hydratable(
    props: Record<string, unknown>,
    options: { name: string; snapshot?: boolean; skipOnMount?: boolean },
  ): Promise<string>;
}

type PlainComponent = (props: Record<string, unknown>) => unknown;

function isIsland(Component: unknown): Component is HydratableIsland {
  return typeof Component === "function" && ISLAND in (Component as object);
}

function isRawHtml(value: unknown): value is { value: string } {
  return !!(value && typeof value === "object" && RAW in (value as object));
}

function resultToHtml(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (isRawHtml(result)) return result.value;
  return undefined;
}

/** True when plain SSR emitted nested island slot hosts that need a parent mount ctx. */
function hasNestedIslandSlots(html: string): boolean {
  return html.includes("data-ilha-slot");
}

/**
 * Wrap a plain function so its render runs under an island render ctx.
 * Nested islands then get unique `data-ilha-slot` ids and can be mounted
 * when the shell hydrates on the client.
 */
function wrapPlainAsIsland(Component: PlainComponent, merged: Record<string, unknown>) {
  return ilha(() => {
    const result = Component(merged);
    if (result == null) return raw("");
    if (typeof result === "string") return raw(result);
    if (isRawHtml(result)) return raw(result.value);
    return raw("");
  });
}

// Wraps an already-rendered Astro slot string so ilha's `html` tag and
// helpers like Areia's `render()` interpolate it unescaped instead of
// re-encoding markup that was already serialized to HTML.
//
// Astro's slot values are typed as `string` but at runtime are often an
// `HTMLString` instance (a boxed `String` subclass) instead of a primitive
// string. Wrapping the box directly produces `{ value: HTMLString }`, and
// `typeof value.value === "string"` checks downstream (e.g. Areia's
// `rawValue()`) then fail, falling through to `[object Object]`. Coerce to a
// primitive string first so the RawHtml payload is always plain.
function toRawHtml(value: unknown): { value: string } {
  return raw(String(value));
}

// A rendered Astro template expression (e.g. `trigger={<div>…</div>}` in an
// `.astro` file's JSX-like prop) compiles to a `RenderTemplateResult` —
// duck-typed here by its `.render(destination)` method, the same interface
// Astro's own SSR runtime writes chunks through. It is not HTML yet: handing
// it directly to ilha's `html` tag stringifies the object, producing
// `[object Object]`. Detect and resolve it before it reaches an island's
// props or a plain component's call.
interface AstroRenderable {
  render(destination: { write(chunk: unknown): void }): void | Promise<void>;
}

function isAstroRenderable(value: unknown): value is AstroRenderable {
  return (
    !!value &&
    typeof value === "object" &&
    !isRawHtml(value) &&
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

// Resolves any `RenderTemplateResult` values nested in props (including
// inside arrays) into ilha `RawHtml`, so islands and plain components
// interpolate the already-rendered markup instead of stringifying an object.
async function resolvePropValue(value: unknown): Promise<unknown> {
  if (isAstroRenderable(value)) return toRawHtml(await resolveAstroRenderable(value));
  if (Array.isArray(value)) return Promise.all(value.map(resolvePropValue));
  return value;
}

async function resolveProps(props: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    resolved[key] = await resolvePropValue(value);
  }
  return resolved;
}

async function mergePlainProps(
  props: Record<string, unknown>,
  slots: Record<string, string>,
): Promise<Record<string, unknown>> {
  const merged = await resolveProps(props);
  for (const [name, value] of Object.entries(slots)) {
    merged[name === "default" ? "children" : name] = toRawHtml(value);
  }
  return merged;
}

// Non-island ilha function components (e.g. Areia's `Button`) are plain
// functions that synchronously return `RawHtml` — or a plain string — via
// ilha's `html`/JSX runtime. Rendering one is just calling it: there's no
// lifecycle, no hydration, and no `data-ilha` wrapper to emit.
//
// Exception: when the plain tree nests islands (JSX → `data-ilha-slot`), those
// children need a parent island render ctx for unique slot ids + client mount.
// Re-render through a thin ilha() shell and emit hydratable markup.
async function renderPlainComponent(
  Component: PlainComponent,
  props: Record<string, unknown>,
  slots: Record<string, string>,
  metadata?: AstroComponentMetadata,
): Promise<string | undefined> {
  const merged = await mergePlainProps(props, slots);

  const result = Component(merged);
  const html = resultToHtml(result);
  if (html === undefined) return undefined;

  if (!hasNestedIslandSlots(html)) return html;

  const Shell = wrapPlainAsIsland(Component, merged);
  return Shell.hydratable(
    {},
    {
      name: metadata?.displayName ?? "IlhaPlain",
      snapshot: true,
      skipOnMount: true,
    },
  );
}

async function check(
  Component: unknown,
  props: Record<string, unknown>,
  slots: Record<string, string>,
  metadata?: AstroComponentMetadata,
): Promise<boolean> {
  if (metadata?.componentUrl && !(await getComponentFilter())(metadata.componentUrl)) return false;
  if (isIsland(Component)) return true;
  if (typeof Component !== "function") return false;
  try {
    return (await renderPlainComponent(Component as PlainComponent, props, slots)) !== undefined;
  } catch {
    return false;
  }
}

async function renderToStaticMarkup(
  Component: unknown,
  props: Record<string, unknown>,
  slots: Record<string, string>,
  metadata?: AstroComponentMetadata,
): Promise<{ html: string }> {
  if (isIsland(Component)) {
    // `.hydratable()` embeds serialized props and a state snapshot in
    // `data-ilha-*` attributes, so the client entrypoint hydrates without a
    // mismatch or re-running setup for snapshotted islands
    // (`skipOnMount`). Setup is client-only — SSR never invokes it.
    const html = await Component.hydratable(await resolveProps(props), {
      name: metadata?.displayName ?? "IlhaIsland",
      snapshot: true,
      skipOnMount: true,
    });
    return { html };
  }

  const html = await renderPlainComponent(Component as PlainComponent, props, slots, metadata);
  if (html === undefined) {
    throw new Error(
      `[@ilha/astro] Unable to render "${metadata?.displayName ?? "component"}" — expected an ` +
        `ilha island or a function returning ilha RawHtml/string.`,
    );
  }
  return { html };
}

const renderer: NamedSSRLoadedRendererValue = {
  name: "@ilha/astro",
  check,
  renderToStaticMarkup,
};

export default renderer;
