import type { AstroIntegration, AstroRenderer } from "astro";

export interface IlhaIntegrationOptions {
  include?: string | string[];
  exclude?: string | string[];
}

const OPTIONS_MODULE = "virtual:@ilha/astro/options";

const objectTag = <T>(value: T): string =>
  Object.prototype.toString.call(value);

const isString = <T>(value: T): value is Extract<T, string> =>
  objectTag(value) === "[object String]";

const globToRegExp = (pattern: string) => {
  let source = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replaceAll(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
    }
  }
  return new RegExp(`${source}$`, "u");
};

const patternList = (patterns?: string | string[]) =>
  (isString(patterns) ? [patterns] : (patterns ?? []))
    .map(globToRegExp)
    .join(",");

const optionsPlugin = (options: IlhaIntegrationOptions) => ({
  load(id: string) {
    if (id !== `\0${OPTIONS_MODULE}`) {
      return;
    }
    return `const include=[${patternList(options.include)}],exclude=[${patternList(options.exclude)}];export default id=>(!include.length||include.some(pattern=>pattern.test(id)))&&!exclude.some(pattern=>pattern.test(id));`;
  },
  name: "@ilha/astro:options",
  resolveId(id: string) {
    return id === OPTIONS_MODULE ? `\0${OPTIONS_MODULE}` : undefined;
  },
});

export const getRenderer = (): AstroRenderer => ({
  clientEntrypoint: "@ilha/astro/client",
  name: "@ilha/astro",
  serverEntrypoint: "@ilha/astro/server",
});

/**
 * Vite's dependency optimizer otherwise inlines peer `ilha` into prebundled
 * consumers (Areia, etc.) while the app loads workspace/linked `ilha` via
 * `/@fs/...`. Nested island mount and `bind:*` then run on two runtimes.
 *
 * `resolve.dedupe` + `optimizeDeps.exclude` keep a single module instance.
 */
export const getViteConfig = (options: IlhaIntegrationOptions = {}) => ({
  optimizeDeps: {
    exclude: ["ilha"],
  },
  plugins: [optionsPlugin(options)],
  resolve: {
    dedupe: ["ilha"],
  },
});

export default function ilhaIntegration(
  options: IlhaIntegrationOptions = {}
): AstroIntegration {
  return {
    hooks: {
      "astro:config:setup": ({ addRenderer, updateConfig }) => {
        addRenderer(getRenderer());
        updateConfig({ vite: getViteConfig(options) });
      },
    },
    name: "@ilha/astro",
  };
}
