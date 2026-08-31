import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { atom, h, recordServerAction, renderToString } from "../src/index.ts";

test("renderToString paints text without handlers", async () => {
  const App = async () => {
    const count = atom(0);
    return h("button", { onclick: () => count.update((n: number) => n + 1) }, "Count: ", count);
  };
  const html = await renderToString(App);
  expect(html).toContain("data-ilha");
  expect(html).toContain("Count:");
  expect(html).toContain(">0<");
  expect(html).not.toContain("onclick");
});

test("renderToString captures server actions as sentinels", async () => {
  const del = (id: string) => {
    if (recordServerAction("x:del", [id])) return;
  };
  const html = await renderToString(() => h("button", { onclick: () => del("1") }, "Delete"), {
    captureActions: true,
  });
  expect(html).toContain("data-ilha-on");
  expect(html).toContain("x:del");
  expect(html).toContain("data-ilha-actions");
});

test("renderToString can disable markers and snapshot", async () => {
  const App = async () => {
    const n = atom(1);
    return h("p", null, n);
  };
  const html = await renderToString(App, { markers: false, snapshot: false });
  expect(html).not.toContain("<div data-ilha");
  expect(html).not.toContain("ilha-state");
  expect(html).toContain("1");
});

test("renderToString waits for async child", async () => {
  const Child = function* () {
    yield Effect.sleep(20);
    yield "hello";
  };
  const App = async () => h("div", null, Child);
  const html = await renderToString(App);
  expect(html).toContain("hello");
});

test("renderToString timeout serializes early", async () => {
  const App = function* () {
    yield Effect.sleep(400);
    yield "late";
  };
  const t0 = Date.now();
  const html = await renderToString(App, {
    timeout: 20,
    markers: false,
    snapshot: false,
  });
  expect(Date.now() - t0).toBeLessThan(200);
  expect(html).not.toContain("late");
});
