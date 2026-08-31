/** @jsxImportSource ../src */
import { expect, test } from "bun:test";

import { recordServerAction, renderToString } from "../src/index.ts";

const ACTION_CALL = Symbol.for("ilha.actionCall");

function branded(key: string, args: unknown[]) {
  const handler = () => undefined;
  (handler as unknown as Record<symbol, unknown>)[ACTION_CALL] = { k: key, a: args };
  return handler;
}

test("recordServerAction is inert outside SSR capture", () => {
  expect(recordServerAction("x:del", ["1"])).toBe(false);
});

test("branded handler emits a sentinel without captureActions", async () => {
  const html = await renderToString(() => (
    <button type="button" onclick={branded("x:del", ["1"])}>
      Delete
    </button>
  ));
  expect(html).toContain("data-ilha-on");
  expect(html).toContain("click:0");
  expect(html).toContain("x:del");
  expect(html).toContain("data-ilha-actions");
  expect(html).not.toContain("onclick");
});

test("captureActions probes plain handlers that call server actions", async () => {
  const del = (id: string) => {
    recordServerAction("x:del", [id]);
  };
  const html = await renderToString(
    () => (
      <button type="button" onclick={() => del("7")}>
        Delete
      </button>
    ),
    { captureActions: true },
  );
  const decoded = html
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  expect(decoded).toContain('"k":"x:del"');
  expect(decoded).toContain('"a":["7"]');
});

test("two events on one element accumulate in data-ilha-on", async () => {
  const toggle = () => {
    recordServerAction("x:toggle", []);
  };
  const html = await renderToString(
    () => <input type="checkbox" class="checkbox" onchange={toggle} onclick={toggle} />,
    { captureActions: true },
  );
  const match = /data-ilha-on="([^"]+)"/.exec(html);
  expect(match).not.toBeNull();
  const spec = match![1]!;
  expect(spec).toContain("change:");
  expect(spec).toContain("click:");
  expect(spec.split(",")).toHaveLength(2);
});

test("plain handler without capture emits no sentinel", async () => {
  const html = await renderToString(() => (
    <button type="button" onclick={() => undefined}>
      Go
    </button>
  ));
  expect(html).not.toContain("data-ilha-on");
  expect(html).not.toContain("data-ilha-actions");
});

test("handler that throws during capture emits no sentinel", async () => {
  const html = await renderToString(
    () => (
      <button
        type="button"
        onclick={() => {
          throw new Error("probe failure");
        }}
      >
        Go
      </button>
    ),
    { captureActions: true },
  );
  expect(html).not.toContain("data-ilha-on");
});

test("manifest args survive attribute escaping", async () => {
  const html = await renderToString(() => (
    <button type="button" onclick={branded("x:say", ['he said "hi"'])}>
      Go
    </button>
  ));
  expect(html).toContain("data-ilha-actions");
  expect(html).toContain("x:say");
  expect(html).toContain("&quot;");
});
