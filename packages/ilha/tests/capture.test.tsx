/** @jsxImportSource ../src */
import { expect, test } from "bun:test";

import { renderToString } from "../src/index.ts";

const ACTION_CALL = Symbol.for("ilha.actionCall");

function branded(key: string, args: unknown[]) {
  const handler = () => undefined;
  (handler as unknown as Record<symbol, unknown>)[ACTION_CALL] = { k: key, a: args };
  return handler;
}

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

test("plain handlers are not probed during SSR capture", async () => {
  const html = await renderToString(
    () => (
      <button type="button" onclick={() => undefined}>
        Delete
      </button>
    ),
    { captureActions: true },
  );
  expect(html).not.toContain("data-ilha-on");
  expect(html).not.toContain("data-ilha-actions");
});

test("two branded events on one element accumulate in data-ilha-on", async () => {
  const html = await renderToString(
    () => (
      <input
        type="checkbox"
        class="checkbox"
        onchange={branded("x:toggle", [])}
        onclick={branded("x:toggle", [])}
      />
    ),
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
