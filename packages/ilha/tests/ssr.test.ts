import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { atom, h, renderToString } from "../src/index.ts";
import type { ActionArg } from "../src/types.ts";

const ACTION_CALL = Symbol.for("ilha.actionCall");

const branded = (key: string, args: readonly ActionArg[]) =>
  Object.assign(() => {}, { [ACTION_CALL]: { a: args, k: key } });

test("renderToString works without document", async () => {
  const doc = globalThis.document;
  // SAFETY: test temporarily deletes document; globalThis is the runtime host.
  const g = globalThis as { document?: Document };
  delete g.document;
  try {
    const html = await renderToString(() => h("p", null, "edge"));
    expect(html).toContain(">edge<");
  } finally {
    g.document = doc;
  }
});

const CounterApp = () => {
  const count = atom(0);
  return h(
    "button",
    { onclick: () => count.update((n: number) => n + 1) },
    "Count: ",
    count
  );
};

test("renderToString paints text without handlers", async () => {
  const html = await renderToString(CounterApp);
  expect(html).toContain("data-ilha");
  expect(html).toContain("Count:");
  expect(html).toContain(">0<");
  expect(html).not.toContain("onclick");
});

test("renderToString captures branded server actions as sentinels", async () => {
  const html = await renderToString(
    () => h("button", { onclick: branded("x:del", ["1"]) }, "Delete"),
    { captureActions: true }
  );
  expect(html).toContain("data-ilha-on");
  expect(html).toContain("x:del");
  expect(html).toContain("data-ilha-actions");
});

const SnapshotApp = () => {
  const n = atom(1);
  return h("p", null, n);
};

test("renderToString can disable markers and snapshot", async () => {
  const html = await renderToString(SnapshotApp, {
    markers: false,
    snapshot: false,
  });
  expect(html).not.toContain("<div data-ilha");
  expect(html).not.toContain("ilha-state");
  expect(html).toContain("1");
});

const Child = function* Child() {
  yield Effect.sleep(20);
  yield "hello";
};

const AsyncChildApp = () => h("div", null, Child);

test("renderToString waits for async child", async () => {
  const html = await renderToString(AsyncChildApp);
  expect(html).toContain("hello");
});

const TimeoutApp = function* TimeoutApp() {
  yield Effect.sleep(400);
  yield "late";
};

test("renderToString timeout serializes early", async () => {
  const t0 = Date.now();
  const html = await renderToString(TimeoutApp, {
    markers: false,
    snapshot: false,
    timeout: 20,
  });
  expect(Date.now() - t0).toBeLessThan(200);
  expect(html).not.toContain("late");
});
