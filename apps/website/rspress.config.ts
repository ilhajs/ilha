import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);

import { defineConfig } from "@rspress/core";
import { pluginLlms } from "@rspress/plugin-llms";
import { pluginSitemap } from "@rspress/plugin-sitemap";
import { pluginTwoslash } from "@rspress/plugin-twoslash";
import { pluginTypeDoc } from "@rspress/plugin-typedoc";
import {
  transformerNotationHighlight,
  transformerMetaHighlight,
  transformerNotationDiff,
} from "@shikijs/transformers";

export default defineConfig({
  plugins: [
    pluginTwoslash(),
    pluginLlms(),
    pluginSitemap({ siteUrl: "https://ilha.build" }),
    pluginTypeDoc({
      entryPoints: [require.resolve("../../packages/ilha/src/index.ts")],
    }),
  ],
  root: path.join(__dirname, "docs"),
  globalStyles: path.join(__dirname, "src", "app.css"),
  title: "Ilha",
  icon: "/logo.svg",
  logo: "/logo.svg",
  logoText: "Ilha",
  themeConfig: {
    llmsUI: true,
    socialLinks: [
      {
        icon: "github",
        mode: "link",
        content: "https://github.com/ilhajs/ilha",
      },
      {
        icon: "discord",
        mode: "link",
        content: "https://discord.gg/WnVTMCTz74",
      },
      {
        icon: "x",
        mode: "link",
        content: "https://x.com/ilha_js",
      },
    ],
    editLink: {
      docRepoBaseUrl: "https://github.com/ilhajs/ilha/tree/main/apps/website/docs",
    },
  },
  markdown: {
    shiki: {
      transformers: [
        transformerNotationHighlight(),
        transformerMetaHighlight(),
        transformerNotationDiff(),
      ],
    },
  },
  builderConfig: {
    html: {
      tags: [
        {
          tag: "script",
          attrs: {
            src: "https://umami.guarana.studio/script.js",
            "data-website-id": "410cd0a6-1ee7-4d3a-b1ae-52dd9379e9c7",
            defer: true,
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "og:image",
            content: "https://ilha.build/og.jpg",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image",
            content: "https://ilha.build/og.jpg",
          },
        },
      ],
    },
  },
});
