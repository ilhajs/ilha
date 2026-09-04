import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";
import { isObject } from "../src/shared.ts";
import { decodeSnapshot } from "../src/snapshot.ts";

const SnapshotApp = () => {
  const n = atom(3);
  return { $$ilha: 1 as const, children: [n], props: {}, type: "p" };
};

test("renderToString embeds data-ilha-state", async () => {
  const html = await renderToString(SnapshotApp);
  expect(html).toContain("data-ilha");
  expect(html).toContain("data-ilha-state");
  expect(html).toContain("3");
});

const HydrateApp = () => {
  const n = atom(0);
  return { $$ilha: 1 as const, children: [n], props: {}, type: "p" };
};

test("hydrate restores atom snapshot from host attr", async () => {
  const html = await renderToString(HydrateApp);
  const el = document.createElement("div");
  el.append(
    ...new DOMParser().parseFromString(html, "text/html").body.childNodes
  );
  document.body.append(el);
  const host = el.querySelector("[data-ilha]");
  if (!host) {
    throw new Error("host missing");
  }
  host.dataset.ilhaState = JSON.stringify({ v: [9] });
  mount(host, HydrateApp, { hydrate: true });
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
  const first = v?.[0];
  expect(first !== undefined && isObject(first) && "n" in first).toBe(true);
  expect(Object.hasOwn(first ?? {}, "__proto__")).toBe(false);
});
