// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { renderToString } from "../src/index.ts";
import type { ActionArg } from "../src/types.ts";

const ACTION_CALL = Symbol.for("ilha.actionCall");

const branded = (key: string, args: readonly ActionArg[]) =>
  Object.assign(() => {}, { [ACTION_CALL]: { a: args, k: key } });

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
      <button type="button" onclick={() => {}}>
        Delete
      </button>
    ),
    { captureActions: true }
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
    { captureActions: true }
  );
  const match = /data-ilha-on="(?<spec>[^"]+)"/u.exec(html);
  const spec = match?.groups?.spec;
  if (!spec) {
    throw new Error("data-ilha-on missing");
  }
  expect(spec).toContain("change:");
  expect(spec).toContain("click:");
  expect(spec.split(",")).toHaveLength(2);
});

test("plain handler without capture emits no sentinel", async () => {
  const html = await renderToString(() => (
    <button type="button" onclick={() => {}}>
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
    { captureActions: true }
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
