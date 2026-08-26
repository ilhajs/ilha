import { defineComponents } from "blume";

export default defineComponents({
  mdx: { Preview: "./src/components/Preview.astro" },
  layout: {
    Layout: "./src/components/layout/Layout.astro",
    PageFooter: "./src/components/layout/PageFooter.astro",
  },
});
