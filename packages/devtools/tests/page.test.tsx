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
    expect(await panel.call("setAtom", root?.id ?? "", 1, "changed")).toEqual({
      ok: true,
    });
    await settle();
    expect(host.querySelector("p")?.textContent).toContain("changed");
    expect(await panel.call("setAtom", "missing", 0, 1)).toMatchObject({
      ok: false,
    });
  });

  it("outlines a component and clears it", async () => {
    const { panel, host } = await setup();
    host.getBoundingClientRect = () => new DOMRect(10, 20, 100, 50);
    const nodes = await panel.call("inspect");
    const root = nodes.find((node) => node.host === selectorOf(host));
    expect(await panel.call("highlight", root?.id ?? "")).toBe(true);
    const overlay = document.querySelector("[data-ilha-devtools-highlight]");
    expect(overlay).not.toBeNull();
    expect(await panel.call("highlight", null)).toBe(true);
    expect(document.querySelector("[data-ilha-devtools-highlight]")).toBeNull();
    expect(await panel.call("highlight", "missing")).toBe(false);
  });

  it("mirrors the tree into shared state as islands change", async () => {
    const { panel, host } = await setup();
    const tree = await panel.sharedState.get("tree");
    const badge = () =>
      parseTree(tree.value()).find((node) => node.host === selectorOf(host))
        ?.children[0]?.atoms[0]?.value;
    expect(badge()).toBe(5);
    host.querySelector("button")?.click();
    await settle();
    expect(badge()).toBe(6);
  });

  it("replaces an earlier install", async () => {
    const first = await setup();
    first.panel.close();
    const second = connectPair();
    cleanups.push(second.panel.close, second.handle.dispose);
    await second.panel.whenConnected(1000);
    expect(first.handle.channel).not.toBe(second.handle.channel);
    const nodes = await second.panel.call("inspect");
    expect(nodes.length).toBeGreaterThan(0);
  });
});
