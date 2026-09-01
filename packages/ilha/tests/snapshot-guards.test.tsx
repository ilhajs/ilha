import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";
import { decodeSnapshot, encodeSnapshot } from "../src/snapshot.ts";

test("decodeSnapshot rejects oversized payloads", () => {
  const big = JSON.stringify({ v: ["x".repeat(256 * 1024)] });
  expect(big.length).toBeGreaterThan(256 * 1024);
  expect(decodeSnapshot(big)).toBeUndefined();
});

test("decodeSnapshot rejects payloads deeper than 32", () => {
  let node: unknown = "leaf";
  for (let i = 0; i < 40; i++) node = { nested: node };
  expect(decodeSnapshot(JSON.stringify({ v: [node] }))).toBeUndefined();
});

test("decodeSnapshot accepts payloads at depth 32", () => {
  let node: unknown = "leaf";
  for (let i = 0; i < 29; i++) node = { nested: node };
  const decoded = decodeSnapshot(JSON.stringify({ v: [node] }));
  expect(decoded).toBeDefined();
});

test("decodeSnapshot strips prototype-polluting keys", () => {
  const raw = '{"v":[{"constructor":"bad","prototype":"bad","__proto__":{"x":1},"safe":1}]}';
  const decoded = decodeSnapshot(raw) as [{ safe: number; constructor?: unknown }];
  expect(decoded).toBeDefined();
  expect(decoded![0]!.safe).toBe(1);
  expect(decoded![0]).not.toHaveProperty("constructor", "bad");
  expect(decoded![0]).not.toHaveProperty("prototype", "bad");
  expect((decoded![0] as Record<string, unknown>).__proto__).not.toEqual({ x: 1 });
});

test("encode/decode round-trips atom snapshots", () => {
  const snap = JSON.parse(encodeSnapshot([0, "two", { three: 3 }])) as { v: unknown[] };
  expect(decodeSnapshot(encodeSnapshot([0, "two", { three: 3 }]))).toEqual(snap.v);
});

test("hydration restores nested component atoms in declaration order", async () => {
  const Inner = () => {
    const inner = atom("inner-value");
    return <span>{inner}</span>;
  };
  const App = () => {
    const outer = atom("outer-value");
    return (
      <div>
        {outer}
        <Inner />
      </div>
    );
  };

  const html = await renderToString(App);
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
    const unmount = mount(el, App, { hydrate: true });
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
