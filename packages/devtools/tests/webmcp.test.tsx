import { afterEach, describe, expect, it } from "bun:test";

import { installIlhaDevtools } from "../src/page.ts";
import { Counter, mountHost, settle } from "./helpers.tsx";

interface RegisteredTool {
  name: string;
  execute: (args: Record<string, string | number | null>) => {
    content: { text: string }[];
    isError?: boolean;
  };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  Reflect.deleteProperty(navigator, "modelContext");
  document.body.innerHTML = "";
});

const fakeModelContext = () => {
  const tools: RegisteredTool[] = [];
  const signals: AbortSignal[] = [];
  Object.defineProperty(navigator, "modelContext", {
    configurable: true,
    value: {
      registerTool: (
        tool: RegisteredTool,
        options: { signal: AbortSignal }
      ) => {
        tools.push(tool);
        signals.push(options.signal);
      },
    },
  });
  return { signals, tools };
};

describe("WebMCP tools", () => {
  it("registers ilha_* tools that drive the page", async () => {
    const { tools, signals } = fakeModelContext();
    const mounted = await mountHost(Counter);
    const handle = installIlhaDevtools({ window: false });
    cleanups.push(mounted.unmount, handle.dispose);
    expect(tools.map((tool) => tool.name)).toEqual([
      "ilha_inspect",
      "ilha_highlight",
      "ilha_set_atom",
    ]);

    const [inspectTool, , setAtomTool] = tools;
    const tree = JSON.parse(inspectTool?.execute({}).content[0]?.text ?? "[]");
    const root = tree.find(
      (node: { host?: string }) => node.host === `div#${mounted.host.id}`
    );
    expect(root.component).toBe("Counter");

    const ok = setAtomTool?.execute({
      id: root.id,
      index: 1,
      value: "via mcp",
    });
    expect(JSON.parse(ok?.content[0]?.text ?? "{}")).toEqual({ ok: true });
    await settle();
    expect(mounted.host.querySelector("p")?.textContent).toContain("via mcp");

    const bad = setAtomTool?.execute({ id: root.id });
    expect(bad?.isError).toBe(true);

    handle.dispose();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("does nothing when the browser has no model context", () => {
    const handle = installIlhaDevtools({ window: false });
    cleanups.push(handle.dispose);
    expect(() => handle.dispose()).not.toThrow();
  });

  it("stays off with webmcp: false", () => {
    const { tools } = fakeModelContext();
    const handle = installIlhaDevtools({ webmcp: false, window: false });
    cleanups.push(handle.dispose);
    expect(tools).toEqual([]);
  });
});
