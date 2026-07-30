import type { AstroIntegration, AstroRenderer } from "astro";

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
export function getViteConfig() {
  return {
    resolve: {
      dedupe: ["ilha"],
    },
    optimizeDeps: {
      exclude: ["ilha"],
    },
  };
}

export default function ilhaIntegration(): AstroIntegration {
  return {
    name: "@ilha/astro",
    hooks: {
      "astro:config:setup": ({ addRenderer, updateConfig }) => {
        addRenderer(getRenderer());
        updateConfig({ vite: getViteConfig() });
      },
    },
  };
}
