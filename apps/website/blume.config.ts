import { fileURLToPath } from "node:url";

import ilha from "@ilha/astro";
import icon from "astro-icon";
import { defineConfig } from "blume";

export default defineConfig({
  title: "Ilha",
  description:
    "Ilha is a lightweight UI framework under 2,500 lines of code. Simple enough to fit in a single AI context window, powerful enough to build modern interfaces your way.",
  logo: "/logo.svg",
  github: { owner: "ilhajs", repo: "ilha", dir: "apps/website" },
  navigation: {
    sidebar: [
      {
        label: "Guide",
        root: "/guide",
        items: [
          {
            label: "Start",
            items: [
              "/guide/getting-started/introduction",
              "/guide/getting-started/installation",
              "/guide/getting-started/core-concepts",
            ],
          },
          {
            label: "Build islands",
            items: [
              "/guide/island/create",
              "/guide/island/state",
              "/guide/island/derived",
              "/guide/island/action",
              "/guide/island/effect",
              "/guide/island/errors",
              "/guide/island/render",
              "/guide/island/compose",
              "/guide/island/bindings",
              "/guide/island/signals",
              "/guide/island/define",
            ],
          },
          {
            label: "Routing",
            items: [
              "/guide/routing/overview",
              "/guide/routing/routes-and-navigation",
              "/guide/routing/loaders",
              "/guide/routing/file-system-routing",
              "/guide/routing/server-islands",
              "/guide/routing/middleware-and-security",
              "/guide/routing/deployment",
            ],
          },
          {
            label: "Integrations",
            items: ["/guide/astro"],
          },
          {
            label: "Recipes",
            items: [
              "/guide/recipes/helpers",
              "/guide/recipes/jsx-less",
              "/guide/recipes/view-transitions",
            ],
          },
          {
            label: "Resources",
            items: [
              "/guide/resources/showcase",
              {
                label: "Awesome Ilha",
                href: "https://github.com/ilhajs/awesome-ilha",
              },
            ],
          },
        ],
      },
      {
        label: "Reference",
        root: "/reference",
        items: ["/reference/ilha", "/reference/router", "/reference/astro"],
      },
      {
        label: "Tutorial",
        root: "/tutorial",
        items: [
          {
            label: "Build a counter",
            items: [
              "/tutorial/counter/state",
              "/tutorial/counter/action",
              "/tutorial/counter/derived",
              "/tutorial/counter/bind",
              "/tutorial/counter/effect",
              "/tutorial/counter/onmount",
            ],
          },
        ],
      },
    ],
    tabs: [
      { label: "Guide", path: "/guide", href: "/guide/getting-started/introduction" },
      { label: "Reference", path: "/reference", href: "/reference/ilha" },
      { label: "Tutorial", path: "/tutorial", href: "/tutorial/counter/state" },
    ],
  },
  ai: { llmsTxt: true },
  deployment: { site: "https://ilha.build" },
  seo: {
    og: {
      enabled: true,
      logo: "/logo.svg",
      titles: { "/": "Ilha - Build fast websites with islands" },
    },
    robots: true,
    sitemap: true,
    structuredData: true,
    x: { handle: "@ilha_js", creator: "@ilha_js" },
  },
  markdown: {
    codeBlocks: {
      theme: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
    },
  },
  integrations: [
    icon({ iconDir: fileURLToPath(new URL("./icons", import.meta.url)) }),
    ilha(),
    {
      name: "header-override",
      hooks: {
        "astro:config:setup": ({ updateConfig }) => {
          const headerPath = fileURLToPath(
            new URL("./components/blume/Header.astro", import.meta.url),
          );
          updateConfig({
            vite: {
              resolve: {
                alias: [{ find: /^\.\/Header\.astro$/u, replacement: headerPath }],
              },
            },
          });
        },
      },
    },
  ],
  analytics: {
    scripts: [
      {
        src: "https://umami.guarana.studio/script.js",
        strategy: "defer",
        attributes: { "data-website-id": "410cd0a6-1ee7-4d3a-b1ae-52dd9379e9c7" },
      },
    ],
  },
});
