import type {
  AstroComponentMetadata,
  NamedSSRLoadedRendererValue,
} from "astro";
import { renderToString } from "ilha";
import type { View } from "ilha";

let componentFilter: Promise<(id: string) => boolean> | undefined;

const objectTag = <T>(value: T): string =>
  Object.prototype.toString.call(value);

type AnyFn = (...args: never[]) => void;

const isFunction = <T>(value: T): value is Extract<T, AnyFn> => {
  const tag = objectTag(value);
  return (
    tag === "[object Function]" ||
    tag === "[object AsyncFunction]" ||
    tag === "[object GeneratorFunction]"
  );
};

const getComponentFilter = async (): Promise<(id: string) => boolean> => {
  componentFilter ??= (async () => {
    try {
      const { default: filter } = await import("virtual:@ilha/astro/options");
      return filter;
    } catch {
      return () => true;
    }
  })();
  return await componentFilter;
};

interface AstroRenderable {
  render: (destination: {
    write: (chunk: string) => void;
  }) => void | Promise<void>;
}

/** Prop values arriving from Astro: JSON data or nested component chunks. */
type AstroPropValue =
  | string
  | number
  | boolean
  | null
  | AstroPropValue[]
  | AstroPropBag
  | AstroRenderable;

interface AstroPropBag {
  readonly [key: string]: AstroPropValue | undefined;
}

type MergedPropValue = string | AstroPropValue | AstroPropValue[];

type MergedProps = Record<string, MergedPropValue | undefined>;

/** An ilha component accepted by this renderer after `check()` succeeds. */
type IslandComponent = (
  props: MergedProps
) => View | undefined | Promise<View | undefined>;

const isAstroRenderable = (value: AstroPropValue): value is AstroRenderable =>
  // SAFETY: Astro renderables are objects exposing render(destination); the
  // value arrives from Astro's component pipeline, not untrusted input.
  // Object(value) boxe safely so primitives answer `in` without throwing.
  value !== null && "render" in new Object(value);

const resolveAstroRenderable = async (
  value: AstroRenderable
): Promise<string> => {
  let out = "";
  await value.render({
    write(chunk) {
      out += chunk;
    },
  });
  return out;
};

const resolvePropValue = async (
  value: AstroPropValue
): Promise<MergedPropValue> => {
  if (isAstroRenderable(value)) {
    return await resolveAstroRenderable(value);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(resolvePropValue));
  }
  return value;
};

const mergeProps = async (
  props: AstroPropBag,
  slots: Record<string, string>
): Promise<MergedProps> => {
  const entries = Object.entries(props).filter(
    (entry): entry is [string, AstroPropValue] => entry[1] !== undefined
  );
  const resolvedValues = await Promise.all(
    entries.map(([, value]) => resolvePropValue(value))
  );
  const resolved: MergedProps = Object.fromEntries(
    entries.map(([key], index) => [key, resolvedValues[index]])
  );
  for (const [name, value] of Object.entries(slots)) {
    resolved[name === "default" ? "children" : name] = value;
  }
  return resolved;
};

const check = async (
  Component: IslandComponent | AstroPropValue,
  _props: AstroPropBag,
  _slots: Record<string, string>,
  metadata?: AstroComponentMetadata
): Promise<boolean> => {
  if (
    metadata?.componentUrl &&
    !(await getComponentFilter())(metadata.componentUrl)
  ) {
    return false;
  }
  return isFunction(Component);
};

const renderToStaticMarkup = async (
  Component: IslandComponent | AstroPropValue,
  props: AstroPropBag,
  slots: Record<string, string>,
  metadata?: AstroComponentMetadata
): Promise<{ html: string }> => {
  if (!isFunction(Component)) {
    throw new TypeError(
      `[@ilha/astro] Unable to render "${metadata?.displayName ?? "component"}" — expected a function.`
    );
  }
  const merged = await mergeProps(props, slots);
  // SAFETY: isFunction gated Component to a callable; ilha components are
  // functions of props producing a view.
  const render = Component as IslandComponent;
  const html = await renderToString(() => render(merged));
  return { html };
};

const renderer: NamedSSRLoadedRendererValue = {
  check,
  name: "@ilha/astro",
  renderToStaticMarkup,
};

export default renderer;
