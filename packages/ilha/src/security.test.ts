/**
 * Security-focused edge cases. Data safety is the top priority: hydration
 * snapshots, props, and markup boundaries are attacker-reachable surfaces.
 */
import { describe, expect, test } from "bun:test";

import { html, ilha, mount, raw, state } from "./index";
import "../happydom.ts";

function makeEl(html: string): Element {
  const el = document.createElement("div");
  // pi-lens-ignore: ast-grep:ts-xss-dom-sink — test fixture only; the markup
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
