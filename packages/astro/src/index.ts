import type { AstroIntegration, AstroRenderer } from "astro";

// Tag ilha islands with Astro's `astro:renderer` symbol (via a global core
// reads at island construction) so Astro routes them to this renderer
// regardless of the integration's position in `astro.config`. Astro picks the
// first renderer whose `check()` accepts a component; without this tag a
// permissive renderer registered first (e.g. `@astrojs/solid-js`, whose check
// accepts any function whose output stringifies) would claim ilha components
// and render their markup as escaped raw HTML.
// Tag ilha islands with Astro's `astro:renderer` symbol (via a global core
// reads at island construction) so Astro routes them to this renderer
// regardless of the integration's position in `astro.config`. Astro picks the
// first renderer whose `check()` accepts a component; without this tag a
// permissive renderer registered first (e.g. `@astrojs/solid-js`, whose check
// accepts any function whose output stringifies) would claim ilha components
// and render their markup as escaped raw HTML.
const ASTRO_RENDERER_GLOBAL = Symbol.for("ilha.astroRenderer");
const rendererName = "@ilha/astro";

function setRendererMarker(): void {
  (globalThis as unknown as Record<symbol, unknown>)[ASTRO_RENDERER_GLOBAL] = rendererName;
}

// Set the marker immediately so a direct `import "@ilha/astro"` (e.g. from
// `astro.config` or a separate-process entrypoint) tags islands before any
// constructor can run in this realm — even if a bundler tree-shakes this bare
// side-effect statement into nothing.
setRendererMarker();

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
    clientEntrypoint: "@ilha/astro/client.js",
    serverEntrypoint: "@ilha/astro/server.js",
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
        // Re-assert at config time: this hook always runs when Astro loads the
        // integration, so the marker is set even if the module's top-level
        // side effect was tree-shaken away.
        setRendererMarker();
        addRenderer(getRenderer());
        updateConfig({ vite: getViteConfig(options) });
      },
    },
  };
}
