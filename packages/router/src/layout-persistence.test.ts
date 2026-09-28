import { afterEach, expect, it } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { h } from "ilha";

import { generate, resolveGeneratedPaths } from "./codegen";
import {
  head,
  navigate,
  routePath,
  routeSearch,
  router,
  searchParam,
} from "./index";
import type { Page } from "./index";
import { makeDir, removeDir, writePage } from "./test-helpers";

const makeEl = (): HTMLElement => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

afterEach(() => {
  history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

const Layout = ({ children }: { children?: unknown }) =>
  // SAFETY: wrapLayout passes View children; h accepts never for mixed child slots.
  h(
    "div",
    { id: "layout" },
    h("span", { id: "layout-mark" }, "shell"),
    children as never
  );

const PageA: Page = () => h("p", { id: "page" }, "aaa");
const PageB: Page = () => h("p", { id: "page" }, "bbb");
const PageC: Page = () => h("p", { id: "page" }, "ccc");

const mountTwo = () => {
  const host = makeEl();
  const r = router()
    .route("/a", PageA, { layouts: [Layout] })
    .route("/b", PageB, { layouts: [Layout] })
    .route("/c", PageC);
  return { host, unmount: r.mount(host) };
};

it("keeps a shared layout mounted across navigations", async () => {
  window.location.href = "http://localhost/a";
  const { host, unmount } = mountTwo();
  await Bun.sleep(20);
  expect(host.textContent).toContain("aaa");

  const layoutBefore = host.querySelector("#layout");
  if (!layoutBefore) {
    throw new Error("layout missing");
  }
  navigate("/b");
  await Bun.sleep(20);

  expect(routePath()).toBe("/b");
  expect(host.textContent).toContain("bbb");
  expect(host.textContent).toContain("shell");
  expect(host.querySelector("#layout")).toBe(layoutBefore);
  unmount();
});

it("updates search without remounting the page", async () => {
  window.location.href = "http://localhost/a";
  const { host, unmount } = mountTwo();
  await Bun.sleep(20);

  const pageBefore = host.querySelector("#page");
  navigate("/a?x=1");
  await Bun.sleep(20);

  expect(routeSearch()).toBe("?x=1");
  expect(host.textContent).toContain("aaa");
  expect(host.querySelector("#page")).toBe(pageBefore);
  unmount();
});

it("remounts when the layout chain changes", async () => {
  window.location.href = "http://localhost/a";
  const { host, unmount } = mountTwo();
  await Bun.sleep(20);

  const layoutBefore = host.querySelector("#layout");
  navigate("/c");
  await Bun.sleep(20);

  expect(host.textContent).toContain("ccc");
  expect(host.querySelector("#layout")).not.toBe(layoutBefore);
  unmount();
});

const WithMeta: Page = () => {
  head({
    meta: [{ content: "only on a", name: "description" }],
    title: "A",
  });
  return h("p", { id: "page" }, "aaa");
};

const WithTitle: Page = () => {
  head({ title: "B" });
  return h("p", { id: "page" }, "bbb");
};

it("drops the previous page's head entries on navigation", async () => {
  window.location.href = "http://localhost/a";
  const host = makeEl();
  const unmount = router()
    .route("/a", WithMeta, { layouts: [Layout] })
    .route("/b", WithTitle, { layouts: [Layout] })
    .mount(host);
  await Bun.sleep(20);
  expect(document.title).toBe("A");
  expect(document.head.querySelector('meta[name="description"]')).not.toBe(
    null
  );

  navigate("/b");
  await Bun.sleep(20);

  expect(document.title).toBe("B");
  expect(document.head.querySelector('meta[name="description"]')).toBe(null);
  unmount();
});

it("searchParam reads and writes the URL without remounting", async () => {
  window.location.href = "http://localhost/tabs";
  let renders = 0;
  let tab: ReturnType<typeof searchParam<string>> | undefined;
  const Tabs: Page = () => {
    renders += 1;
    tab = searchParam("t", { default: "overview" });
    return h("p", { id: "page" }, tab());
  };
  const host = makeEl();
  const unmount = router()
    .route("/tabs", Tabs, { layouts: [Layout] })
    .mount(host);
  await Bun.sleep(20);
  expect(host.querySelector("#page")?.textContent).toBe("overview");
  const pageBefore = host.querySelector("#page");

  tab?.set("logs");
  await Bun.sleep(20);
  expect(routeSearch()).toBe("?t=logs");
  expect(host.querySelector("#page")?.textContent).toBe("logs");
  expect(host.querySelector("#page")).toBe(pageBefore);
  expect(renders).toBeGreaterThan(1);

  tab?.set("overview");
  await Bun.sleep(20);
  expect(routeSearch()).toBe("");
  expect(host.querySelector("#page")?.textContent).toBe("overview");
  unmount();
});

it("renders decomposed layouts on the server", async () => {
  const r = router().route("/a", PageA, { layouts: [Layout] });
  const html = await r.render("http://localhost/a");
  expect(html).toContain("shell");
  expect(html).toContain("aaa");
});

it("emits decomposed layout routes for the client", async () => {
  const root = await makeDir("layout-codegen");
  const pagesDir = path.join(root, "src/pages");
  const outDir = path.join(root, "src/generated");
  await mkdir(pagesDir, { recursive: true });
  try {
    await writePage(pagesDir, "+layout.tsx", `export default null;`);
    await writePage(pagesDir, "index.tsx", `export default null;`);
    await generate(pagesDir, outDir);
    const client = await readFile(
      resolveGeneratedPaths(outDir).clientFile,
      "utf-8"
    );
    expect(client).toContain(`{ layouts: [_layout0_0] }`);
  } finally {
    await removeDir(root);
  }
});
