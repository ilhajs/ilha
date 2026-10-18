import { createPageRenderer } from "@ilha/void/server";

const components = {
  index: () => import("./pages/index.tsx"),
  "layout:root": () => import("./pages/layout.tsx"),
};

const layoutTree = { index: ["layout:root"] };

const render = createPageRenderer({ components, layoutTree });

const assets = { body: "", css: "", preloads: "" };

/** Render the fixture home page to an HTML document string. */
export const renderFixture = (): Promise<string> =>
  render(
    {
      component: "index",
      errors: null,
      params: {},
      props: {},
      shared: {},
      url: "/",
    },
    assets
  );
