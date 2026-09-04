import { defineComponents } from "blume";

export default defineComponents({
  layout: {
    Layout: "./src/components/layout/layout.astro",
    PageFooter: "./src/components/layout/page-footer.astro",
  },
  mdx: { Preview: "./src/components/preview.astro" },
});
