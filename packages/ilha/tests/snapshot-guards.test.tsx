import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";
import { isObject } from "../src/shared.ts";
import { decodeSnapshot, encodeSnapshot } from "../src/snapshot.ts";

type NestedNode = string | { readonly nested: NestedNode };

interface SafeEntry {
  readonly safe: number;
  readonly constructor?: string;
  readonly prototype?: string;
}

test("decodeSnapshot rejects oversized payloads", () => {
  const big = JSON.stringify({ v: ["x".repeat(256 * 1024)] });
  expect(big.length).toBeGreaterThan(256 * 1024);
  expect(decodeSnapshot(big)).toBeUndefined();
});

test("decodeSnapshot rejects payloads deeper than 32", () => {
  let node: NestedNode = "leaf";
  for (let i = 0; i < 40; i += 1) {
    node = { nested: node };
  }
  expect(decodeSnapshot(JSON.stringify({ v: [node] }))).toBeUndefined();
});

test("decodeSnapshot accepts payloads at depth 32", () => {
  let node: NestedNode = "leaf";
  for (let i = 0; i < 29; i += 1) {
    node = { nested: node };
  }
  const decoded = decodeSnapshot(JSON.stringify({ v: [node] }));
  expect(decoded).toBeDefined();
});

test("decodeSnapshot strips prototype-polluting keys", () => {
  const raw =
    '{"v":[{"constructor":"bad","prototype":"bad","__proto__":{"x":1},"safe":1}]}';
  const decoded = decodeSnapshot(raw);
  expect(decoded).toBeDefined();
  const first = decoded?.[0];
  if (!isObject(first)) {
    throw new Error("expected object entry");
  }
  // SAFETY: decodeSnapshot returns a plain JSON object entry for this fixture.
  const entry = first as SafeEntry;
  expect(entry.safe).toBe(1);
  expect(entry).not.toHaveProperty("constructor", "bad");
  expect(entry).not.toHaveProperty("prototype", "bad");
  expect(Object.hasOwn(entry, "__proto__")).toBe(false);
});

test("encode/decode round-trips atom snapshots", () => {
  const encoded = encodeSnapshot([0, "two", { three: 3 }]);
  // SAFETY: encodeSnapshot emits {"v":...} JSON for the snapshot wire format.
  const snap = JSON.parse(encoded) as { v: unknown[] };
  expect(decodeSnapshot(encodeSnapshot([0, "two", { three: 3 }]))).toEqual(
    snap.v
  );
});

const Inner = () => {
  const inner = atom("inner-value");
  return <span>{inner}</span>;
};

const NestedApp = () => {
  const outer = atom("outer-value");
  return (
    <div>
      {outer}
      <Inner />
    </div>
  );
};

test("hydration restores nested component atoms in declaration order", async () => {
  const html = await renderToString(NestedApp);
  expect(html).toContain("outer-value");
  expect(html).toContain("inner-value");

  const warns: unknown[] = [];
  const prevWarn = console.warn;
  console.warn = (...args: unknown[]) => warns.push(args);
  try {
    const el = document.createElement("div");
    // test host only; html is renderer output, not user input.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
    el.innerHTML = html;
    document.body.append(el);
    const unmount = mount(el, NestedApp, { hydrate: true });
    await Bun.sleep(10);
    expect(warns.join(" ")).not.toContain("hydrate mismatch");
    expect(el.textContent).toContain("outer-value");
    expect(el.textContent).toContain("inner-value");
    unmount();
    el.remove();
  } finally {
    console.warn = prevWarn;
  }
});
