import { expect, test } from "bun:test";

import { atom, h, mount, renderToString } from "../src/index.ts";

function paint(view: ReturnType<typeof h>): HTMLElement {
  const el = document.createElement("div");
  mount(el, function* () {
    yield view;
  });
  return el;
}

test("rejects javascript: href", () => {
  const el = paint(h("a", { href: "javascript:alert(1)" }, "x"));
  expect(el.querySelector("a")?.getAttribute("href")).toBeNull();
});

test("rejects control-char padded javascript href", () => {
  const el = paint(h("a", { href: "\njavascript:alert(1)" }, "x"));
  expect(el.querySelector("a")?.getAttribute("href")).toBeNull();
});

test("rejects nbsp-padded javascript href", () => {
  const el = paint(h("a", { href: "\u00a0javascript:alert(1)" }, "x"));
  expect(el.querySelector("a")?.getAttribute("href")).toBeNull();
});

test("rejects zero-width padded javascript href", () => {
  const el = paint(h("a", { href: "\u200bjavascript:alert(1)" }, "x"));
  expect(el.querySelector("a")?.getAttribute("href")).toBeNull();
});

test("keeps https href", () => {
  const el = paint(h("a", { href: "https://ex.test" }, "x"));
  expect(el.querySelector("a")?.getAttribute("href")).toBe("https://ex.test");
});

test("drops srcdoc", () => {
  const el = paint(h("iframe", { srcdoc: "<script>alert(1)</script>" }));
  expect(el.querySelector("iframe")?.hasAttribute("srcdoc")).toBe(false);
});

test("drops data: javascript src", () => {
  const el = paint(h("script", { src: "data:text/javascript,alert(1)" }));
  expect(el.querySelector("script")?.getAttribute("src")).toBeNull();
});

test("allows raster data: image on img src", () => {
  const el = paint(h("img", { src: "data:image/png;base64,abc", alt: "i" }));
  expect(el.querySelector("img")?.getAttribute("src")).toContain("data:image/png");
});

test("rejects data: image on iframe src", () => {
  const el = paint(h("iframe", { src: "data:image/png;base64,abc" }));
  expect(el.querySelector("iframe")?.getAttribute("src")).toBeNull();
});

test("rejects javascript in srcset candidate", () => {
  const el = paint(h("img", { src: "a.png", srcset: "a.png 1x, javascript:alert(1) 2x" }));
  expect(el.querySelector("img")?.getAttribute("srcset")).toBeNull();
});

test("drops style expression()", () => {
  const el = paint(h("div", { style: { color: "red", x: "expression(alert(1))" } }));
  expect(el.querySelector("div")?.getAttribute("style") ?? "").not.toContain("expression");
});

test("filters string style values through the allowlist", () => {
  const div = paint(
    h("div", { style: "color:red;background:url(javascript:alert(1))" }),
  ).querySelector("div") as HTMLDivElement;
  expect(div.style.color).toBe("red");
  expect(div.style.background).toBe("");
});

test("drops mixed-case onClick string handlers", () => {
  const el = paint(h("button", { onClick: "alert(1)" }, "x"));
  expect(el.querySelector("button")?.getAttribute("onClick")).toBeNull();
  expect(el.querySelector("button")?.getAttribute("onclick")).toBeNull();
});

test("drops invalid camelCase on-prefixed props", () => {
  const el = paint(h("div", { onGo: "x", onOK: "y" }, "z"));
  const div = el.querySelector("div")!;
  expect(div.getAttribute("onGo")).toBeNull();
  expect(div.getAttribute("onOK")).toBeNull();
});

test("keeps non-event once attribute", () => {
  const el = paint(h("div", { once: "yes" }, "x"));
  expect(el.querySelector("div")?.getAttribute("once")).toBe("yes");
});

test("rejects css url escapes and data urls in string styles", () => {
  const escaped = paint(
    h("div", { style: "background:url(\\6a avascript:alert(1))" }),
  ).querySelector("div") as HTMLDivElement;
  expect(escaped.style.background).toBe("");

  const dataUrl = paint(
    h("div", { style: "background:url(data:image/svg+xml,<svg></svg>)" }),
  ).querySelector("div") as HTMLDivElement;
  expect(dataUrl.style.background).toBe("");
});

test("rejects javascript: href during renderToString", async () => {
  const html = await renderToString(() => h("a", { href: "javascript:alert(1)" }, "x"));
  expect(html).not.toContain("javascript:");
});

test("never serializes function handlers as attributes", async () => {
  const html = await renderToString(() =>
    h("button", { onMouseOver: () => undefined, onClick: () => undefined }, "x"),
  );
  expect(html).not.toContain("onMouseOver");
  expect(html).not.toContain("onClick");
  expect(html).not.toContain("function");
});

test("markers off snapshot escapes comment breakout payloads", async () => {
  const html = await renderToString(
    async () => {
      const evil = atom("--> <img src=x onerror=1>");
      return h("p", null, evil);
    },
    { markers: false },
  );
  expect(html.startsWith('<template data-ilha-state="')).toBe(true);
  expect(html).not.toContain("--> <img");
});

test("false null undefined drop attributes", () => {
  const el = paint(h("input", { disabled: false, hidden: null, title: undefined }));
  const input = el.querySelector("input")!;
  expect(input.hasAttribute("disabled")).toBe(false);
  expect(input.hasAttribute("hidden")).toBe(false);
  expect(input.hasAttribute("title")).toBe(false);
});
