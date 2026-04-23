import * as path from "node:path";

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
      entryPoints: [path.join(__dirname, "node_modules", "ilha", "src", "index.ts")],
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
});
