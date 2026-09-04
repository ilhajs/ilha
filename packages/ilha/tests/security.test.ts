import { expect, test } from "bun:test";

import { atom, h, mount, renderToString } from "../src/index.ts";

// SAFETY: builds a javascript: URL for sanitizer coverage without a literal.
const jsAlertHref = ["java", "script:", "alert(1)"].join("");
const jsAlertSrcset = ["a.png 1x, ", "java", "script:", "alert(1) 2x"].join("");
const jsStyleUrl = [
  "color:red;background:url(",
  "java",
  "script:",
  "alert(1))",
].join("");

const paint = (view: ReturnType<typeof h>): HTMLElement => {
  const el = document.createElement("div");
  mount(el, function* appGen() {
    yield view;
  });
  return el;
};

test("rejects javascript: href", () => {
  const el = paint(h("a", { href: jsAlertHref }, "x"));
  expect(el.querySelector("a")?.getAttribute("href")).toBeNull();
});

test("rejects control-char padded javascript href", () => {
  const el = paint(h("a", { href: `\n${jsAlertHref}` }, "x"));
  expect(el.querySelector("a")?.getAttribute("href")).toBeNull();
});

test("rejects nbsp-padded javascript href", () => {
  const el = paint(h("a", { href: `\u00A0${jsAlertHref}` }, "x"));
  expect(el.querySelector("a")?.getAttribute("href")).toBeNull();
});

test("rejects zero-width padded javascript href", () => {
  const el = paint(h("a", { href: `\u200B${jsAlertHref}` }, "x"));
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
  const el = paint(h("img", { alt: "i", src: "data:image/png;base64,abc" }));
  expect(el.querySelector("img")?.getAttribute("src")).toContain(
    "data:image/png"
  );
});

test("rejects data: image on iframe src", () => {
  const el = paint(h("iframe", { src: "data:image/png;base64,abc" }));
  expect(el.querySelector("iframe")?.getAttribute("src")).toBeNull();
});

test("rejects javascript in srcset candidate", () => {
  const el = paint(h("img", { src: "a.png", srcset: jsAlertSrcset }));
  expect(el.querySelector("img")?.getAttribute("srcset")).toBeNull();
});

test("drops style expression()", () => {
  const el = paint(
    h("div", { style: { color: "red", x: "expression(alert(1))" } })
  );
  expect(el.querySelector("div")?.getAttribute("style") ?? "").not.toContain(
    "expression"
  );
});

test("filters string style values through the allowlist", () => {
  const div = paint(h("div", { style: jsStyleUrl })).querySelector("div");
  if (!(div instanceof HTMLDivElement)) {
    throw new Error("div missing");
  }
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
  const div = el.querySelector("div");
  if (!div) {
    throw new Error("div missing");
  }
  expect(div.getAttribute("onGo")).toBeNull();
  expect(div.getAttribute("onOK")).toBeNull();
});

test("keeps non-event once attribute", () => {
  const el = paint(h("div", { once: "yes" }, "x"));
  expect(el.querySelector("div")?.getAttribute("once")).toBe("yes");
});

test("rejects css url escapes and data urls in string styles", () => {
  const escaped = paint(
    h("div", { style: "background:url(\\6a avascript:alert(1))" })
  ).querySelector("div");
  if (!(escaped instanceof HTMLDivElement)) {
    throw new Error("escaped div missing");
  }
  expect(escaped.style.background).toBe("");

  const dataUrl = paint(
    h("div", { style: "background:url(data:image/svg+xml,<svg></svg>)" })
  ).querySelector("div");
  if (!(dataUrl instanceof HTMLDivElement)) {
    throw new Error("dataUrl div missing");
  }
  expect(dataUrl.style.background).toBe("");
});

test("rejects javascript: href during renderToString", async () => {
  const html = await renderToString(() => h("a", { href: jsAlertHref }, "x"));
  expect(html).not.toContain(jsAlertHref);
});

test("script and style SSR keep raw text and reject closing-tag breakouts", async () => {
  const ok = await renderToString(
    () => h("script", null, "const x = 1 < 2 && true;"),
    {
      markers: false,
      snapshot: false,
    }
  );
  expect(ok).toContain("<script>const x = 1 < 2 && true;</script>");

  const style = await renderToString(
    () => h("style", null, "a > b { color: red; }"),
    {
      markers: false,
      snapshot: false,
    }
  );
  expect(style).toContain("<style>a > b { color: red; }</style>");

  expect(
    renderToString(
      () => h("script", null, "alert(1)</script><img src=x onerror=alert(1)>"),
      {
        markers: false,
        snapshot: false,
      }
    )
  ).rejects.toThrow(/unsafe raw text in <script>/u);
});

test("never serializes function handlers as attributes", async () => {
  const html = await renderToString(() =>
    h("button", { onClick: () => {}, onMouseOver: () => {} }, "x")
  );
  expect(html).not.toContain("onMouseOver");
  expect(html).not.toContain("onClick");
  expect(html).not.toContain("function");
});

test("markers off snapshot escapes comment breakout payloads", async () => {
  const html = await renderToString(
    () => {
      const evil = atom("--> <img src=x onerror=1>");
      return h("p", null, evil);
    },
    { markers: false }
  );
  expect(html.startsWith('<template data-ilha-state="')).toBe(true);
  expect(html).not.toContain("--> <img");
});

test("false null undefined drop attributes", () => {
  const el = paint(
    h("input", { disabled: false, hidden: null, title: undefined })
  );
  const input = el.querySelector("input");
  if (!input) {
    throw new Error("input missing");
  }
  expect(input.hasAttribute("disabled")).toBe(false);
  expect(input.hasAttribute("hidden")).toBe(false);
  expect(input.hasAttribute("title")).toBe(false);
});
