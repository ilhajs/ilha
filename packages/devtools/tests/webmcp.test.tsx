import { afterEach, describe, expect, it } from "bun:test";

import { installIlhaDevtools } from "../src/page.ts";
import { Counter, mountHost, settle } from "./helpers.tsx";

interface RegisteredTool {
  name: string;
  execute: (
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- mirrors the WebMCP tool signature under test.
    args: Record<string, unknown>
  ) =>
    | { content: { text: string }[] }
    | Promise<{ content: { text: string }[] }>;
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
        options?: { signal?: AbortSignal }
      ) => {
        tools.push(tool);
        if (options?.signal) {
          signals.push(options.signal);
        }
        return { unregister: () => {} };
      },
    },
  });
  return { signals, tools };
};

const toolByName = (tools: RegisteredTool[], name: string): RegisteredTool => {
  const found = tools.find((tool) => tool.name === name);
  if (!found) {
    throw new Error(`tool ${name} missing`);
  }
  return found;
};

const readResult = async (
  tool: RegisteredTool,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- mirrors the WebMCP tool signature under test.
  args: Record<string, unknown>
) => {
  const executed = await tool.execute(args);
  return JSON.parse(executed.content[0]?.text ?? "{}");
};

describe("WebMCP tools", () => {
  it("registers island and ilha_model_* tools that drive the page", async () => {
    const { tools, signals } = fakeModelContext();
    const mounted = await mountHost(Counter);
    const handle = installIlhaDevtools({ window: false });
    cleanups.push(mounted.unmount, handle.dispose);
    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      "ilha_highlight",
      "ilha_inspect",
      "ilha_model_count_entries",
      "ilha_model_diff_state",
      "ilha_model_get_chain",
      "ilha_model_get_entry",
      "ilha_model_get_message_schema",
      "ilha_model_get_state",
      "ilha_model_list_entries",
      "ilha_model_list_instances",
      "ilha_model_list_sessions",
      "ilha_model_resume",
      "ilha_model_show_entry",
      "ilha_model_wait",
      "ilha_set_atom",
    ]);

    const inspectTool = toolByName(tools, "ilha_inspect");
    const tree = await readResult(inspectTool, {});
    const root = tree.find(
      (node: { host?: string }) => node.host === `div#${mounted.host.id}`
    );
    expect(root.component).toBe("Counter");

    const setAtomTool = toolByName(tools, "ilha_set_atom");
    const ok = await readResult(setAtomTool, {
      id: root.id,
      index: 1,
      value: "via mcp",
    });
    expect(ok).toEqual({ ok: true });
    await settle();
    expect(mounted.host.querySelector("p")?.textContent).toContain("via mcp");

    const bad = await readResult(setAtomTool, { id: root.id });
    expect(bad.error).toContain("Pass id (string)");

    handle.dispose();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("answers model tools from the page backend", async () => {
    const { tools } = fakeModelContext();
    const mounted = await mountHost(Counter);
    const handle = installIlhaDevtools({ window: false });
    cleanups.push(mounted.unmount, handle.dispose);

    const sessions = await readResult(
      toolByName(tools, "ilha_model_list_sessions"),
      {}
    );
    expect(sessions).toEqual({ result: [] });

    const missing = await readResult(
      toolByName(tools, "ilha_model_get_entry"),
      {
        seq: 1,
        session: "nope",
      }
    );
    expect(missing.error).toContain("No session nope");
  });

  it("registers dispatch only when the page enables it", async () => {
    const { tools: off } = fakeModelContext();
    const mounted = await mountHost(Counter);
    const plain = installIlhaDevtools({ window: false });
    cleanups.push(mounted.unmount, plain.dispose);
    expect(off.some((tool) => tool.name === "ilha_model_dispatch")).toBe(false);
    expect(off.some((tool) => tool.name === "ilha_model_show_entry")).toBe(
      true
    );

    const { tools: on } = fakeModelContext();
    const gated = installIlhaDevtools({ dispatch: true, window: false });
    cleanups.push(gated.dispose);
    const dispatch = on.find((tool) => tool.name === "ilha_model_dispatch");
    if (dispatch === undefined) {
      throw new Error("dispatch tool missing");
    }
    const refused = await readResult(dispatch, {
      instance: 1,
      message: {},
      session: "nope",
    });
    expect(refused.error).toContain("No session nope");
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
