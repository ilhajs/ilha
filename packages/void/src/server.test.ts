import { describe, expect, it } from "bun:test";

import { atom, h } from "ilha";
import type { View } from "ilha";
import type { PageObject } from "void/pages-protocol";

import { useParams, useShared } from "./hooks";
import {
  createIsland,
  createIslandPageRenderer,
  createPageRenderer,
} from "./server";
import { pageModule, parseDocument } from "./test-helpers";

const assets = {
  body: '<script type="module" src="/client.js"></script>',
  css: '<link rel="stylesheet" href="/app.css">',
  preloads: '<link rel="modulepreload" href="/chunk.js">',
};

const pageObject = (overrides: Partial<PageObject> = {}): PageObject => ({
  component: "users/[id]",
  errors: null,
  params: { id: "7" },
  props: { name: "Ada" },
  shared: { appName: "Demo" },
  url: "/users/7",
  ...overrides,
});

const Layout = ({ children }: { children?: View }): View => {
  const { appName } = useShared<{ appName: string }>();
  return h("div", { class: "layout" }, h("header", null, appName), children);
};

const UserPage = ({ name }: { name: string }): View => {
  const { id } = useParams<{ id: string }>();
  const visits = atom(3);
  return h("p", { class: "user" }, `${name} #${id} `, visits);
};

const Counter = ({ start }: { start: number }): View => {
  const count = atom(start);
  return h("button", { type: "button" }, count);
};

const components = {
  "layout:root": pageModule(Layout),
  "users/[id]": pageModule(UserPage),
};

const layoutTree = { "users/[id]": ["layout:root"] };

describe("createPageRenderer", () => {
  it("renders the page inside its layouts with route context", async () => {
    const render = createPageRenderer({ components, layoutTree });
    const doc = parseDocument(await render(pageObject(), assets));

    expect(doc.querySelector(".layout header")?.textContent).toBe("Demo");
    expect(doc.querySelector(".layout .user")?.textContent).toBe("Ada #7 3");
  });

  it("embeds page data and a hydration snapshot for the client", async () => {
    const render = createPageRenderer({ components, layoutTree });
    const html = await render(pageObject(), assets);
    const doc = parseDocument(html);

    const data = doc.querySelector("#__VOID_PAGE_DATA__")?.textContent ?? "";
    expect(JSON.parse(data)).toMatchObject({
      component: "users/[id]",
      params: { id: "7" },
    });
    const host = doc.querySelector<HTMLElement>("#app > [data-ilha]");
    expect(host?.dataset.ilhaState).toContain("3");
    // Route state stays out of the snapshot; page data already carries it.
    expect(host?.dataset.ilhaState).not.toContain("Demo");
    expect(html).toContain(assets.css);
    expect(html).toContain(assets.preloads);
    expect(html).toContain(assets.body);
  });

  it("applies the head descriptor", async () => {
    const render = createPageRenderer({ components, layoutTree });
    const doc = parseDocument(
      await render(pageObject({ head: { title: "Ada · Users" } }), assets)
    );
    expect(doc.title).toBe("Ada · Users");
  });

  it("names the missing component instead of rendering nothing", async () => {
    const render = createPageRenderer({ components: {}, layoutTree: {} });
    await expect(render(pageObject(), assets)).rejects.toThrow("users/[id]");
  });
});

describe("createIslandPageRenderer", () => {
  it("renders static HTML without page data or a root snapshot", async () => {
    const render = createIslandPageRenderer({
      components,
      layoutTree,
      markdownScriptIds: new Set(),
      pagesNeedingClientJS: new Set(),
    });
    const html = await render(pageObject(), assets);
    const doc = parseDocument(html);

    expect(doc.querySelector(".user")?.textContent).toBe("Ada #7 3");
    expect(doc.querySelector("#__VOID_PAGE_DATA__")).toBeNull();
    expect(doc.querySelector("#app > [data-ilha]")).toBeNull();
    expect(html).toContain(assets.css);
    expect(html).not.toContain(assets.body);
    expect(html).not.toContain(assets.preloads);
  });

  it("ships scripts only to pages with islands", async () => {
    const render = createIslandPageRenderer({
      components,
      layoutTree,
      markdownScriptIds: new Set(["users/[id]"]),
      pagesNeedingClientJS: new Set(["users/[id]"]),
    });
    const html = await render(pageObject(), assets);

    expect(html).toContain(assets.body);
    expect(html).toContain(assets.preloads);
    expect(html).toContain('data-md-script="users/[id]"');
  });
});

describe("createIsland", () => {
  it("renders an island root with its own snapshot and props", async () => {
    const Island = createIsland(Counter, {
      hydrate: "visible",
      id: "pages/_Counter",
    });
    const Page = (): View => h("main", null, h(Island, { start: 5 }));
    const render = createIslandPageRenderer({
      components: { page: pageModule(Page) },
      layoutTree: {},
      markdownScriptIds: new Set(),
      pagesNeedingClientJS: new Set(["page"]),
    });
    const doc = parseDocument(
      await render(pageObject({ component: "page" }), assets)
    );
    const marker = doc.querySelector<HTMLElement>("[data-island]");

    expect(marker?.dataset.island).toBe("pages/_Counter");
    expect(marker?.dataset.hydrate).toBe("visible");
    expect(JSON.parse(marker?.dataset.props ?? "")).toEqual({
      start: 5,
    });
    const root = marker?.querySelector<HTMLElement>(":scope > [data-ilha]");
    expect(root?.dataset.ilhaState).toContain("5");
    expect(root?.textContent).toBe("5");
  });
});
