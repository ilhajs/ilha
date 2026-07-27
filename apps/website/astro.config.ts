import nimbus, { defineConfig as defineNimbusConfig } from "@cloudflare/nimbus-docs";
import { tableScroll } from "@cloudflare/nimbus-docs/markdown";
import ilha from "@ilha/astro";
import tailwindcss from "@tailwindcss/vite";
import type { AstroIntegration } from "astro";
import icon from "astro-icon";
import { defineConfig } from "astro/config";

import { twoslashTransformer } from "./src/lib/code-transformers";

const nimbusConfig = defineNimbusConfig({
  site: "https://ilha.build",
  title: "Ilha",
  description:
    "Ilha is a lightweight UI framework under 2,500 lines of code. Simple enough to fit in a single AI context window, powerful enough to build modern interfaces your way.",
  locale: "en",
  github: "https://github.com/ilhajs/ilha",
  socialImageAlt: "Ilha documentation preview",
  // Guide vs Tutorial: header tabs switch sections; rail shows only the
  // active top-level section's children.
  sidebar: {
    scope: "section",
    items: [
      { label: "Guide", autogenerate: { directory: "guide" } },
      { label: "Tutorial", autogenerate: { directory: "tutorial" } },
    ],
  },
});

/**
 * Nimbus hardcodes its Shiki transformer chain. Astro `updateConfig` merges
 * arrays by concatenation — so we must append *only* Twoslash here. Re-applying
 * the full Nimbus chain double-wraps every fence in `.nb-code-figure`.
 */
function twoslash(): AstroIntegration {
  return {
    name: "ilha-twoslash",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({
          markdown: {
            shikiConfig: {
              transformers: [twoslashTransformer],
            },
          },
        });
      },
    },
  };
}

export default defineConfig({
  output: "static",
  // Tailwind v4 via its Vite plugin (the integration Astro recommends for
  // Tailwind v4 — replaces the PostCSS plugin, which doesn't build under
  // Astro 7's Vite 8 bundler).
  vite: {
    plugins: [tailwindcss()],
  },
  // Hover-prefetch link targets so full-page navigations feel instant without
  // a client-side router.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  integrations: [
    icon(),
    ilha(),
    nimbus(nimbusConfig, {
      // Authoring rules are opt-in by design — your repo, your taste. The
      // two below are the load-bearing pair: frontmatter has to validate
      // against the content schema for the page to render properly, and
      // broken internal links are 404s for your readers. Add the others
      // (heading hierarchy, code-block language, style, etc.) when you're
      // ready to enforce them — see `nimbus-docs lint --help`.
      rules: {
        "nimbus/frontmatter-shape": "error",
        "nimbus/internal-link": "error",
      },
      // Wrap wide tables so they scroll instead of overflowing the page
      // (styled by `.nb-table-scroll` in src/styles/prose.css).
      markdown: {
        hastPlugins: [tableScroll()],
      },
    }),
    twoslash(),
  ],
});
