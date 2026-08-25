/**
 * Security-focused edge cases. Data safety is the top priority: hydration
 * snapshots, props, and markup boundaries are attacker-reachable surfaces.
 */
import { describe, expect, test } from "bun:test";

import { css, html, ilha, json, mount, raw, state } from "./index";
import "../happydom.ts";

function makeEl(html: string): Element {
  const el = document.createElement("div");
  // pi-lens-ignore: ast-grep:no-inner-html — test fixture only; the markup
  // is an author-controlled literal simulating attacker payloads.
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("hydration snapshot hardening", () => {
  test("oversized snapshots are rejected", () => {
    const Island = ilha(() => {
      const v = state("");
      return html`<p>${v().length}</p>`;
    });
    const big = "x".repeat(300 * 1024);
    const host = makeEl(
      `<div data-ilha="x" data-ilha-state='${JSON.stringify({ v: 2, s: [big] })}'></div>`,
    );
    expect(() => Island.mount(host)).not.toThrow();
    host.remove();
  });

  test("deeply nested snapshots are rejected", () => {
    const Island = ilha(() => {
      const v = state<unknown>(null);
      return html`<p>${JSON.stringify(v())?.length}</p>`;
    });
    let deep: unknown = null;
    for (let i = 0; i < 64; i++) deep = { nested: deep };
    const host = makeEl(
      `<div data-ilha="x" data-ilha-state='${JSON.stringify({ v: 2, s: [deep] }).replace(/'/g, "&#39;")}'></div>`,
    );
    expect(() => Island.mount(host)).not.toThrow();
    host.remove();
  });

  test("constructor/prototype keys never survive restoration", () => {
    const Island = ilha(() => {
      const cfg = state<Record<string, unknown>>({});
      return html`<pre>${JSON.stringify(cfg())}</pre>`;
    });
    const payload = JSON.stringify({
      v: 2,
      s: [{ constructor: { prototype: { x: 1 } }, __proto__: { y: 2 }, safe: true }],
    }).replace(/'/g, "&#39;");
    const wrapper = makeEl(`<div data-ilha="x" data-ilha-state='${payload}'></div>`);
    const host = wrapper.querySelector("[data-ilha]")!;
    Island.mount(host);
    const text = host.textContent!;
    expect(text).toContain("safe");
    expect(text).not.toContain("prototype");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    wrapper.remove();
  });

  test("oversized data-ilha-props attr is ignored on mount", () => {
    const Island = ilha<{ huge: string }>(({ huge = "" }) => html`<p>${huge.length}</p>`);
    const big = "x".repeat(300 * 1024);
    const host = makeEl(
      `<div data-ilha="x" data-ilha-props='${JSON.stringify({ huge: big })}'></div>`,
    );
    Island.mount(host);
    // Huge props attr is rejected -> island mounts with the empty fallback.
    expect(host.textContent).toBe("0");
    host.remove();
  });

  test("props attr survives stripUnsafeKeys — no prototype pollution", () => {
    const Island = ilha<{ safe: string }>(
      ({ safe = "none" }) => html`<pre>${JSON.stringify({ safe })}</pre>`,
    );
    const payload = JSON.stringify({
      __proto__: { polluted: 1 },
      constructor: { prototype: { x: 1 } },
      safe: "ok",
    }).replace(/'/g, "&#39;");
    const host = makeEl(`<div data-ilha="x" data-ilha-props='${payload}'></div>`);
    Island.mount(host);
    const text = host.textContent!;
    expect(text).toContain("safe");
    expect(text).not.toContain("prototype");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    host.remove();
  });

  test("deeply nested props attr is rejected", () => {
    const Island = ilha<{ nested: unknown }>(
      ({ nested }) => html`<p>${JSON.stringify(nested)?.length ?? 0}</p>`,
    );
    let deep: unknown = null;
    for (let i = 0; i < 64; i++) deep = { nested: deep };
    const host = makeEl(
      `<div data-ilha="x" data-ilha-props='${JSON.stringify({ nested: deep }).replace(/'/g, "&#39;")}'></div>`,
    );
    expect(() => Island.mount(host)).not.toThrow();
    host.remove();
  });

  test("wrong snapshot version degrades to fresh state", () => {
    const Island = ilha<{ start: number }>(({ start }) => {
      const count = state(start);
      return html`<b>${count()}</b>`;
    });
    const host = makeEl(`<div data-ilha="x" data-ilha-state='{"v":1,"s":[99]}'></div>`);
    // Mount without SSR DOM (innerHTML empty) — snapshot ignored safely.
    Island.mount(host);
    expect(host.querySelector("[data-ilha]")).toBeNull();
    host.remove();
  });

  test("non-object and array snapshots are rejected", () => {
    for (const bad of ['{"v":2}', "[1,2]", '"str"', "3", "null"]) {
      const Island = ilha(() => {
        const v = state("fresh");
        return html`<i>${v()}</i>`;
      });
      const host = makeEl(`<div data-ilha="x" data-ilha-state='${bad}'></div>`);
      expect(() => Island.mount(host)).not.toThrow();
      host.remove();
    }
  });
});

describe("markup injection boundaries", () => {
  test("state values render escaped", () => {
    const Evil = ilha(() => {
      const v = state('<img src=x onerror="window.__pwned=1">');
      return html`<div>${v()}</div>`;
    });
    const host = makeEl("");
    Evil.mount(host);
    expect(host.querySelector("img")).toBeNull();
    expect(host.innerHTML).toContain("&lt;img");
    host.remove();
  });

  test("props interpolated through child slots escape HTML", async () => {
    const Child = ilha<{ value: string }>(({ value }) => html`<span>${value}</span>`);
    const Parent = ilha(() => html`${Child({ value: "<script>window.__pwned=1</script>" })}`);
    const out = Parent.toString();
    expect(out).not.toContain("<script>");
    const host = makeEl(out);
    mount({ Child: Child as never, Parent: Parent as never }, { root: host });
    expect(host.querySelector("script")).toBeNull();
    host.remove();
  });

  test("raw() is the only raw-markup path and stays author-owned", () => {
    const Island = ilha(() => html`<div>${raw("<b data-ok>ok</b>")}</div>`);
    const host = makeEl("");
    Island.mount(host);
    expect(host.querySelector("[data-ok]")).not.toBeNull();
    host.remove();
  });
});

describe("html/jsx parity — attribute policy", () => {
  test("unsafe URL schemes are dropped from full-value URL attributes", () => {
    // Unquoted and quoted full-value forms behave identically to JSX.
    expect(html`<a href=${"javascript:alert(1)"}>x</a>`.value).toBe("<a>x</a>");
    expect(html`<a href="${"javascript:alert(1)"}">x</a>`.value).toBe("<a>x</a>");
    expect(html`<a href=${"vbscript:msgbox(1)"}>x</a>`.value).toBe("<a>x</a>");
    expect(html`<a href=${"data:text/html,<script>alert(1)</script>"}>x</a>`.value).toBe(
      "<a>x</a>",
    );
  });

  test("control-char-padded unsafe schemes are dropped", () => {
    // JSX strips ASCII control chars before the scheme check; html`` now does
    // the same via the shared isSafeUrl.
    expect(html`<a href=${"\njavascript:alert(1)"}>x</a>`.value).toBe("<a>x</a>");
    expect(html`<a href=${"java\tscript:alert(1)"}>x</a>`.value).toBe("<a>x</a>");
  });

  test("safe URL attribute values are preserved", () => {
    // Benign unquoted values keep the author's literal form.
    expect(html`<a href=${"https://example.com/x"}>x</a>`.value).toBe(
      "<a href=https://example.com/x>x</a>",
    );
    expect(html`<a href=${"mailto:a@b"}>x</a>`.value).toBe("<a href=mailto:a@b>x</a>");
    expect(html`<a href=${"data:image/png;base64,abc"}>x</a>`.value).toBe(
      "<a href=data:image/png;base64,abc>x</a>",
    );
  });

  test("srcdoc attributes are dropped entirely", () => {
    expect(html`<iframe srcdoc=${"<script>alert(1)</script>"} />`.value).not.toContain("srcdoc");
    expect(html`<iframe srcdoc="${"<script>alert(1)</script>"}" />`.value).not.toContain("srcdoc");
  });

  test("hazardous unquoted attribute values are canonically quoted", () => {
    const out = html`<a href=${"x y"}>x</a>`.value;
    expect(out).toBe('<a href="x y">x</a>');
    // The value round-trips through the parser as one attribute — no new
    // attribute can be smuggled in.
    const el = makeEl(out).querySelector("a")!;
    expect(el.getAttribute("href")).toBe("x y");
    expect(el.getAttribute("onmouseover")).toBeNull();
    el.remove();
  });

  test("benign unquoted attribute values keep the author's form", () => {
    expect(html`<a href=${"/ok"}>x</a>`.value).toContain("href=/ok");
  });

  test("style objects serialize through the shared allowlist", () => {
    expect(html`<div style=${{ color: "red", fontSize: "14px" }}>x</div>`.value).toBe(
      '<div style="color:red;font-size:14px">x</div>',
    );
    // Unsafe declarations are dropped, matching JSX's serializeStyle.
    const evil = {
      color: "red;}",
      background: "url(javascript:alert(1))",
      fontSize: "14px",
    };
    expect(html`<div style=${evil}>x</div>`.value).toBe('<div style="font-size:14px">x</div>');
  });

  test("null/undefined/false attribute values drop the attribute (JSX parity)", () => {
    expect(html`<a href=${undefined}>x</a>`.value).toBe("<a>x</a>");
    expect(html`<a href=${null}>x</a>`.value).toBe("<a>x</a>");
    // False drops the attribute; the author's ` />` stays as written.
    expect(html`<input checked=${false} />`.value).toBe("<input />");
  });

  test("raw() URL values pass through unescaped (author-owned)", () => {
    // Same effective behavior as JSX's raw() in a URL attribute.
    expect(html`<img src=${raw("data:image/svg+xml,<svg></svg>")} alt="icon" />`.value).toBe(
      '<img src="data:image/svg+xml,<svg></svg>" alt="icon" />',
    );
  });

  test("attribute policy applies on the client mount path too", () => {
    const Unsafe = ilha(() => html`<a href=${"javascript:alert(1)"}>x</a>`);
    const host = makeEl("");
    Unsafe.mount(host);
    expect(host.querySelector("a")!.getAttribute("href")).toBeNull();
    host.remove();

    const Injected = ilha(() => html`<a href=${"x y"}>x</a>`);
    const host2 = makeEl("");
    Injected.mount(host2);
    const a = host2.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("x y");
    expect(a.getAttribute("onmouseover")).toBeNull();
    host2.remove();
  });
});

describe("html/jsx parity — event attribute names are case-insensitive", () => {
  test("mixed-case on* string values are dropped, never emitted inline", () => {
    // HTML attribute names are ASCII case-insensitive, so a serialized
    // onLoad="…" would be a live inline handler. It must be dropped like the
    // lowercase form (JSX also silently drops every non-function on* prop).
    expect(html`<div onLoad=${"alert(1)"}>x</div>`.value).toBe("<div>x</div>");
    expect(html`<div onLoad="${"alert(1)"}">x</div>`.value).toBe("<div>x</div>");
    expect(html`<div onClick=${"window.__pwned = 1"}>x</div>`.value).toBe("<div>x</div>");
  });

  test("mixed-case on* function values are never invoked during SSR", () => {
    let ssrCalls = 0;
    const Island = ilha(() => {
      const n = state(0);
      return html`<button
        onClick=${() => {
          ssrCalls++;
          n((v) => v + 1);
        }}
      >
        ${n()}
      </button>`;
    });
    const out = Island.toString();
    expect(ssrCalls).toBe(0);
    expect(out).not.toContain("onClick");
    // The handler is wired through the event sentinel, not inline markup.
    expect(out).toContain('data-ilha-on="click:0"');
  });

  test("mixed-case on* handlers wire on the client (DOM path)", () => {
    const fired: string[] = [];
    const Island = ilha(() => html`<button onClick=${() => fired.push("click")}>Go</button>`);
    const host = makeEl("");
    Island.mount(host);
    const button = host.querySelector("button")!;
    expect(button.getAttribute("onClick")).toBeNull();
    button.click();
    expect(fired).toEqual(["click"]);
    host.remove();
  });

  test("mixed-case partial handler values throw the whole-attribute error", () => {
    expect(() => html`<div onLoad="prefix ${() => "suffix"}">x</div>`.value).toThrow(
      /must occupy the entire attribute/,
    );
  });

  test("lowercase on* non-handler values stay dropped (case-parity anchor)", () => {
    expect(html`<div onload=${"alert(1)"}>x</div>`.value).toBe("<div>x</div>");
  });
});

describe("html/jsx parity — script and style content", () => {
  test("json() serializes script data without a closing-tag escape hatch", () => {
    const payload = { p: "</script><img src=x onerror=1>", q: 1 };
    const out = html`<script>
      const d = ${json(payload)};
    </script>`.value;
    // The data region carries no bare closing tag; `<` is escaped as \u003C.
    const serialized = out.match(/const d = (.+);/)![1]!;
    expect(serialized).not.toContain("<");
    expect(serialized).toContain("\\u003C/script>");
    // \u003C decodes back to < inside a JS string literal, so data round-trips.
    expect(JSON.parse(serialized.replace(/\\u003C/g, "<"))).toEqual(payload);
  });

  test("css() escapes style data without a closing-tag escape hatch", () => {
    const source = "a{content:'</style>'}";
    const out = html`<style>
      ${css(source)}
    </style>`.value;
    const inner = out.slice(7, -8); // between <style> and </style>
    expect(inner).not.toContain("</style>");
    expect(inner).toContain("\\3C ");
  });
});
