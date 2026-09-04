import path from "node:path";

import ilha from "@ilha/astro";
import icon from "astro-icon";
import { defineConfig } from "blume";

const HERE = import.meta.dirname;

export default defineConfig({
  ai: { llmsTxt: true },
  analytics: {
    scripts: [
      {
        attributes: {
          "data-website-id": "410cd0a6-1ee7-4d3a-b1ae-52dd9379e9c7",
        },
        src: "https://umami.guarana.studio/script.js",
        strategy: "defer",
      },
    ],
  },
  deployment: { site: "https://ilha.build" },
  description:
    "Ilha is a lightweight UI framework under 2,500 lines of code. Simple enough to fit in a single AI context window, powerful enough to build modern interfaces your way.",
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
    codeBlocks: {
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
            ],
            label: "Start",
          },
          {
            items: [
              "/guide/ui/create",
              "/guide/ui/state",
              "/guide/ui/templating",
              "/guide/ui/streams",
              "/guide/ui/render",
              "/guide/ui/custom-elements",
            ],
            label: "Build UI",
          },
          {
            items: [
              "/guide/routing/overview",
              "/guide/routing/routes-and-navigation",
              "/guide/routing/error-boundaries",
              "/guide/routing/file-system-routing",
              "/guide/routing/server-islands",
              "/guide/routing/middleware-and-security",
              "/guide/routing/deployment",
            ],
            label: "Routing",
          },
          {
            items: ["/guide/astro"],
            label: "Integrations",
          },
          {
            items: [
              "/guide/recipes/h",
              "/guide/recipes/pubsub-state",
              "/guide/recipes/testing",
              "/guide/recipes/view-transitions",
              "/guide/recipes/oxlint",
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
        items: ["/reference/ilha", "/reference/router", "/reference/astro"],
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
