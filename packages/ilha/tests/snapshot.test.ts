import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";
import { decodeSnapshot } from "../src/snapshot.ts";

test("renderToString embeds data-ilha-state", async () => {
  const App = async () => {
    const n = atom(3);
    return { $$ilha: 1 as const, type: "p", props: {}, children: [n] };
  };
  const html = await renderToString(App);
  expect(html).toContain("data-ilha");
  expect(html).toContain("data-ilha-state");
  expect(html).toContain("3");
});

test("hydrate restores atom snapshot from host attr", async () => {
  const App = async () => {
    const n = atom(0);
    return { $$ilha: 1 as const, type: "p", props: {}, children: [n] };
  };
  const html = await renderToString(App);
  const el = document.createElement("div");
  el.append(...new DOMParser().parseFromString(html, "text/html").body.childNodes);
  document.body.append(el);
  const host = el.querySelector("[data-ilha]")!;
  host.setAttribute("data-ilha-state", JSON.stringify({ v: [9] }));
  mount(host, App, { hydrate: true });
  await Bun.sleep(15);
  expect(host.textContent).toContain("9");
  el.remove();
});

test("oversized snapshots are rejected", () => {
  expect(decodeSnapshot(`{"v":["${"x".repeat(300 * 1024)}"]}`)).toBeUndefined();
});

test("non-object snapshots are rejected", () => {
  expect(decodeSnapshot("[1,2]")).toBeUndefined();
  expect(decodeSnapshot('"nope"')).toBeUndefined();
});

test("prototype keys are stripped", () => {
  const v = decodeSnapshot('{"v":[{"__proto__":{"x":1},"n":2}]}');
  expect(v?.[0] && typeof v[0] === "object" ? "n" in (v[0] as object) : false).toBe(true);
  expect(Object.hasOwn(v?.[0] ?? {}, "__proto__")).toBe(false);
});
