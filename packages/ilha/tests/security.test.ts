import { expect, test } from "bun:test";

import { h, mount } from "../src/index.ts";

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

test("false null undefined drop attributes", () => {
  const el = paint(h("input", { disabled: false, hidden: null, title: undefined }));
  const input = el.querySelector("input")!;
  expect(input.hasAttribute("disabled")).toBe(false);
  expect(input.hasAttribute("hidden")).toBe(false);
  expect(input.hasAttribute("title")).toBe(false);
});
