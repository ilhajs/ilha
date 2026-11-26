import { afterEach, describe, expect, it } from "bun:test";

import { parseTree } from "../src/protocol.ts";
import {
  Counter,
  connectPair,
  mountHost,
  selectorOf,
  settle,
} from "./helpers.tsx";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  document.body.innerHTML = "";
});

const setup = async () => {
  const mounted = await mountHost(Counter);
  const pair = connectPair();
  cleanups.push(pair.panel.close, pair.handle.dispose, mounted.unmount);
  await pair.panel.whenConnected(1000);
  return { ...mounted, ...pair };
};

describe("page script", () => {
  it("answers inspect with the live tree", async () => {
    const { panel, host } = await setup();
    const nodes = await panel.call("inspect");
    const root = nodes.find((node) => node.host === selectorOf(host));
    expect(root?.component).toBe("Counter");
    expect(root?.atoms.map((a) => a.value)).toEqual([1, "hello"]);
    expect(root?.children[0]?.component).toBe("Badge");
  });

  it("sets an atom by id and index", async () => {
    const { panel, host } = await setup();
    const nodes = await panel.call("inspect");
    const root = nodes.find((node) => node.host === selectorOf(host));
    const result = await panel.call("setAtom", root?.id ?? "", 1, "via panel");
    expect(result.ok).toBe(true);
    await settle();
    expect(host.querySelector("p")?.textContent).toContain("via panel");
  });

  it("refuses setAtom on known model islands and points at dispatch", async () => {
    const { handle, host, panel } = await setup();
    handle.backend.noteComponent("Counter", { _tag: "CounterMessage" });
    const nodes = await panel.call("inspect");
    const root = nodes.find((node) => node.host === selectorOf(host));
    const refused = await panel.call("setAtom", root?.id ?? "", 1, "blocked");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toContain("modelDispatch");
    }
    await settle();
    expect(host.querySelector("p")?.textContent).toContain("hello");
    const badge = root?.children[0];
    const allowed = await panel.call("setAtom", badge?.id ?? "", 0, 6);
    expect(allowed).toEqual({ ok: true });
  });

  it("outlines a component and clears it", async () => {
    const { panel, host } = await setup();
    const nodes = await panel.call("inspect");
    const id = nodes.find((node) => node.host === selectorOf(host))?.id ?? "";
    // Happy-dom reports zero-size boxes, so give the host a real box: the
    // overlay path then runs instead of the missing-box fallback.
    // SAFETY: the mock only needs the numeric box fields boxOf reads; the real DOMRect methods are never called.
    const rect = {
      bottom: 50,
      height: 50,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    } as DOMRect;
    host.getBoundingClientRect = () => rect;
    expect(await panel.call("highlight", id)).toBe(true);
    expect(
      document.querySelector("[data-ilha-devtools-highlight]")
    ).not.toBeNull();
    expect(await panel.call("highlight", null)).toBe(true);
    expect(document.querySelector("[data-ilha-devtools-highlight]")).toBeNull();
    expect(await panel.call("highlight", "missing")).toBe(false);
  });
  it("mirrors the tree into shared state", async () => {
    const { host, panel } = await setup();
    const state = await panel.sharedState.get("tree");
    const tree = parseTree(state.value());
    expect(tree.some((node) => node.host === selectorOf(host))).toBe(true);
    const second = await mountHost(Counter);
    cleanups.push(second.unmount);
    await settle();
    const updated = parseTree(state.value());
    expect(updated.some((node) => node.host === selectorOf(host))).toBe(true);
    expect(updated.some((node) => node.host === selectorOf(second.host))).toBe(
      true
    );
  });

  it("reports no model sessions until a model island logs", async () => {
    const { panel } = await setup();
    await settle(100);
    expect(await panel.call("modelSessions")).toEqual([]);
    const missing = await panel.call("modelFrames", "nope", 0);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toContain("No session nope");
    }
    const schema = await panel.call("modelMessageSchema", "Counter");
    expect(schema.ok).toBe(false);
  });

  it("replaces an earlier install", async () => {
    const first = await setup();
    const second = connectPair();
    cleanups.push(second.panel.close, second.handle.dispose);
    await second.panel.whenConnected(1000);
    const nodes = await second.panel.call("inspect");
    expect(nodes.length).toBeGreaterThan(0);
    first.panel.close();
    first.handle.dispose();
    const after = await second.panel.call("inspect");
    expect(after.length).toBeGreaterThan(0);
  });
});
