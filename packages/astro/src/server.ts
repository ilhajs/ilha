import type { AstroComponentMetadata, NamedSSRLoadedRendererValue } from "astro";

// `Symbol.for` resolves to the same symbol across duplicate ilha copies in a
// realm, so these checks work without importing ilha's internals directly.
const ISLAND = Symbol.for("ilha.island");
const RAW = Symbol.for("ilha.raw");

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
  return { [RAW]: true, value: String(value) } as unknown as { value: string };
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

// Non-island ilha function components (e.g. Areia's `Button`) are plain
// functions that synchronously return `RawHtml` — or a plain string — via
// ilha's `html`/JSX runtime. Rendering one is just calling it: there's no
// lifecycle, no hydration, and no `data-ilha` wrapper to emit.
async function renderPlainComponent(
  Component: PlainComponent,
  props: Record<string, unknown>,
  slots: Record<string, string>,
): Promise<string | undefined> {
  const merged = await resolveProps(props);
  for (const [name, value] of Object.entries(slots)) {
    merged[name === "default" ? "children" : name] = toRawHtml(value);
  }

  const result = Component(merged);
  if (typeof result === "string") return result;
  if (isRawHtml(result)) return result.value;
  return undefined;
}

async function check(
  Component: unknown,
  props: Record<string, unknown>,
  slots: Record<string, string>,
): Promise<boolean> {
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
    // mismatch or re-running `.onMount()` work the SSR pass already did.
    const html = await Component.hydratable(await resolveProps(props), {
      name: metadata?.displayName ?? "IlhaIsland",
      snapshot: true,
      skipOnMount: true,
    });
    return { html };
  }

  const html = await renderPlainComponent(Component as PlainComponent, props, slots);
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
