/**
 * Router snapshot-attribute parser guards — mirror the core ilha guards
 * (size cap, plain-object check, depth cap, prototype-key stripping). Used by
 * the wrapLayout `data-ilha-state` blocks and the server-island client proxy.
 */
import { describe, it, expect } from "bun:test";

import { parseSnapshotAttr } from "./snapshot";

interface Nested {
  nested: Nested | null;
}

interface PollutionProbe {
  polluted?: number;
}

describe("parseSnapshotAttr", () => {
  it("parses a plain-object snapshot", () => {
    expect(parseSnapshotAttr('{"a":1,"s":[1,2]}')).toEqual({ a: 1, s: [1, 2] });
  });

  it("rejects oversized snapshots", () => {
    const big = "x".repeat(300 * 1024);
    expect(parseSnapshotAttr(`{"x":"${big}"}`)).toBeUndefined();
  });

  it("rejects arrays, scalars and null", () => {
    expect(parseSnapshotAttr("[1,2]")).toBeUndefined();
    expect(parseSnapshotAttr('"str"')).toBeUndefined();
    expect(parseSnapshotAttr("3")).toBeUndefined();
    expect(parseSnapshotAttr("null")).toBeUndefined();
  });

  it("strips prototype-polluting keys", () => {
    const out = parseSnapshotAttr(
      '{"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}},"safe":"ok"}'
    );
    expect(out).toEqual({ safe: "ok" });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    const probe: PollutionProbe = {};
    expect(probe.polluted).toBeUndefined();
  });

  it("rejects deeply nested snapshots", () => {
    let deep: Nested | null = null;
    for (let i = 0; i < 64; i += 1) {
      deep = { nested: deep };
    }
    expect(parseSnapshotAttr(JSON.stringify({ a: deep }))).toBeUndefined();
  });
});
