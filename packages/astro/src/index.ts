import type { AstroIntegration, AstroRenderer } from "astro";

export interface IlhaIntegrationOptions {
  include?: string | string[];
  exclude?: string | string[];
}

const OPTIONS_MODULE = "virtual:@ilha/astro/options";

function globToRegExp(pattern: string) {
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          source += "(?:.*/)?";
        } else source += ".*";
      } else source += "[^/]*";
    } else if (char === "?") source += "[^/]";
    else source += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${source}$`);
}

function patternList(patterns?: string | string[]) {
  return (typeof patterns === "string" ? [patterns] : (patterns ?? [])).map(globToRegExp).join(",");
}

function optionsPlugin(options: IlhaIntegrationOptions) {
  return {
    name: "@ilha/astro:options",
    resolveId(id: string) {
      return id === OPTIONS_MODULE ? `\0${OPTIONS_MODULE}` : undefined;
    },
    load(id: string) {
      if (id !== `\0${OPTIONS_MODULE}`) return;
      return `const include=[${patternList(options.include)}],exclude=[${patternList(options.exclude)}];export default id=>(!include.length||include.some(pattern=>pattern.test(id)))&&!exclude.some(pattern=>pattern.test(id));`;
    },
  };
}

export function getRenderer(): AstroRenderer {
  return {
    name: "@ilha/astro",
    clientEntrypoint: "@ilha/astro/client",
    serverEntrypoint: "@ilha/astro/server",
  };
}

/**
 * Vite's dependency optimizer otherwise inlines peer `ilha` into prebundled
 * consumers (Areia, etc.) while the app loads workspace/linked `ilha` via
 * `/@fs/...`. Nested island mount and `bind:*` then run on two runtimes.
 *
 * `resolve.dedupe` + `optimizeDeps.exclude` keep a single module instance.
 */
export function getViteConfig(options: IlhaIntegrationOptions = {}) {
  return {
    plugins: [optionsPlugin(options)],
    resolve: {
      dedupe: ["ilha"],
    },
    optimizeDeps: {
      exclude: ["ilha"],
    },
  };
}

export default function ilhaIntegration(options: IlhaIntegrationOptions = {}): AstroIntegration {
  return {
    name: "@ilha/astro",
    hooks: {
      "astro:config:setup": ({ addRenderer, updateConfig }) => {
        addRenderer(getRenderer());
        updateConfig({ vite: getViteConfig(options) });
      },
    },
  };
}
