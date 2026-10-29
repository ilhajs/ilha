import path from "node:path";

import ilha from "@ilha/astro";
import icon from "astro-icon";
import { defineConfig } from "blume";
import { script } from "blume/analytics";

const HERE = import.meta.dirname;

export default defineConfig({
  agents: { llmsTxt: true },
  analytics: [
    script({
      attributes: {
        "data-website-id": "410cd0a6-1ee7-4d3a-b1ae-52dd9379e9c7",
      },
      src: "https://umami.guarana.studio/script.js",
      strategy: "defer",
    }),
  ],
  deployment: { site: "https://ilha.build" },
  description:
    "Ilha is a tiny, Effect-based UI library for the islands architecture: function components, atoms, JSX, SSR, and hydration. One way to do each task, so people and AI agents write it the same way.",
  github: { dir: "apps/website", owner: "ilhajs", repo: "ilha" },
  integrations: [
    icon({ iconDir: path.join(HERE, "icons") }),
    ilha(),
    {
      hooks: {
        "astro:config:setup": ({ updateConfig }) => {
          updateConfig({
            vite: {
              resolve: {
                alias: [
                  {
                    find: /^\.\/Header\.astro$/u,
                    replacement: path.join(
                      HERE,
                      "components/blume/header.astro"
                    ),
                  },
                ],
              },
            },
          });
        },
      },
      name: "header-override",
    },
  ],
  logo: "/logo.svg",
  markdown: {
    code: {
      theme: { dark: "catppuccin-mocha", light: "catppuccin-latte" },
    },
  },
  navigation: {
    sidebar: [
      {
        items: [
          {
            items: [
              "/guide/getting-started/introduction",
              "/guide/getting-started/installation",
              "/guide/getting-started/core-concepts",
              "/guide/getting-started/choose-an-api",
            ],
            label: "Start",
          },
          {
            items: [
              "/guide/ui/create",
              "/guide/ui/state",
              "/guide/ui/context-and-errors",
              "/guide/ui/templating",
              "/guide/ui/streams",
              "/guide/ui/render",
            ],
            label: "Build UI",
          },
          {
            items: ["/guide/astro", "/guide/void"],
            label: "Integrations",
          },
          {
            items: [
              "/guide/recipes/testing",
              "/guide/recipes/oxlint",
              "/guide/devtools",
            ],
            label: "Tooling",
          },
          {
            items: [
              "/guide/recipes/data-fetching",
              "/guide/recipes/server-sent-events",
              "/guide/recipes/custom-elements",
              "/guide/recipes/h",
              "/guide/recipes/view-transitions",
            ],
            label: "Recipes",
          },
          {
            items: [
              "/guide/resources/showcase",
              {
                href: "https://github.com/ilhajs/awesome-ilha",
                label: "Awesome Ilha",
              },
            ],
            label: "Resources",
          },
        ],
        label: "Guide",
        root: "/guide",
      },
      {
        items: [
          "/reference/ilha",
          "/reference/astro",
          "/reference/void",
          {
            items: [
              "/errors",
              "/errors/ILHA001",
              "/errors/ILHA002",
              "/errors/ILHA003",
              "/errors/ILHA004",
              "/errors/ILHA005",
              "/errors/ILHA006",
              "/errors/ILHA007",
            ],
            label: "Errors",
          },
        ],
        label: "Reference",
        root: "/reference",
      },
      {
        items: [
          {
            items: [
              "/tutorial/counter/atom",
              "/tutorial/counter/events",
              "/tutorial/counter/ssr",
            ],
            label: "Build a counter",
          },
        ],
        label: "Tutorial",
        root: "/tutorial",
      },
    ],
    tabs: [
      {
        href: "/guide/getting-started/introduction",
        label: "Guide",
        path: "/guide",
      },
      { href: "/reference/ilha", label: "Reference", path: "/reference" },
      { href: "/tutorial/counter/atom", label: "Tutorial", path: "/tutorial" },
    ],
  },
  // Blume enables @astrojs/react for any `.tsx` in the project, and its React
  // Compiler pass (`oxc-transform-react`) recompiles every `.tsx` — including
  // ilha components — with `react/jsx-runtime`, ignoring tsconfig
  // `jsxImportSource: ilha`. Hydrated islands then render `[object Object]`.
  // The site ships no React islands, so skip the compiler pass; without it the
  // transform falls through to Vite core, which honors the tsconfig.
  react: { compiler: false },
  seo: {
    og: {
      enabled: true,
      logo: "/logo.svg",
      titles: { "/": "Ilha - Build fast websites with islands" },
    },
    robots: true,
    sitemap: true,
    structuredData: true,
    x: { creator: "@ilha_js", handle: "@ilha_js" },
  },
  title: "Ilha",
});
