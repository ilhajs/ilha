import { afterEach, describe, expect, it } from "bun:test";

import { installIlhaDevtools } from "../src/page.ts";
import { Counter, modelApp, mountHost, settle } from "./helpers.tsx";

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

const toolByName = (tools: RegisteredTool[], name: string): RegisteredTool => {
  const found = tools.find((tool) => tool.name === name);
  if (!found) {
    throw new Error(`tool ${name} missing`);
  }
  return found;
};

const readResult = (tool: RegisteredTool, args: Record<string, string>) =>
  JSON.parse(tool.execute(args).content[0]?.text ?? "{}");

/**
 * Click `inc` until the page script's async attach starts recording, then
 * return the host's island id. Dispatches before the attach are lost, so the
 * wait retries instead of assuming the first click landed.
 */
const waitForRecording = async (
  tools: RegisteredTool[],
  host: HTMLElement,
  deadline = Date.now() + 2000
): Promise<string> => {
  const inspectTool = toolByName(tools, "ilha_inspect");
  const logTool = toolByName(tools, "ilha_model_log");
  host.querySelector("button")?.click();
  await settle(10);
  const tree = JSON.parse(inspectTool.execute({}).content[0]?.text ?? "[]");
  const id =
    tree.find((node: { host?: string }) => node.host === `div#${host.id}`)
      ?.id ?? "";
  if (readResult(logTool, { id }).ok === true) {
    return id;
  }
  if (Date.now() > deadline) {
    throw new Error("message log never started recording");
  }
  return waitForRecording(tools, host, deadline);
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
      "ilha_model_log",
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

  it("returns a model island's message log", async () => {
    const { tools } = fakeModelContext();
    const mounted = await mountHost(modelApp.component);
    const handle = installIlhaDevtools({ window: false });
    cleanups.push(mounted.unmount, handle.dispose);
    const id = await waitForRecording(tools, mounted.host);
    const logTool = toolByName(tools, "ilha_model_log");
    const result = JSON.parse(logTool.execute({ id }).content[0]?.text ?? "{}");
    expect(result.ok).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
    for (const entry of result.entries) {
      expect(entry.message).toEqual({ _tag: "Increment" });
      expect(entry.commands).toBe(0);
      expect(Number.isFinite(entry.at)).toBe(true);
      const { after, before } = entry.diff.changed.count;
      expect(after).toBe(before + 1);
    }
  });

  it("summarizes errors and cycles in logged messages", async () => {
    const { tools } = fakeModelContext();
    const mounted = await mountHost(modelApp.component);
    const handle = installIlhaDevtools({ window: false });
    cleanups.push(mounted.unmount, handle.dispose);
    const id = await waitForRecording(tools, mounted.host);
    mounted.host.querySelectorAll("button")[1]?.click();
    await settle();
    const logTool = toolByName(tools, "ilha_model_log");
    const result = JSON.parse(logTool.execute({ id }).content[0]?.text ?? "{}");
    const bang = result.entries.find(
      (entry: { message: { _tag?: string } }) => entry.message._tag === "Bang"
    );
    expect(bang?.message).toEqual({
      _tag: "Bang",
      err: "<Error: boom>",
      loop: { self: "<circular>" },
    });
  });

  it("explains islands without a log", async () => {
    const { tools } = fakeModelContext();
    const model = await mountHost(modelApp.component);
    const plain = await mountHost(Counter);
    const handle = installIlhaDevtools({ window: false });
    cleanups.push(model.unmount, plain.unmount, handle.dispose);
    await waitForRecording(tools, model.host);
    const inspectTool = toolByName(tools, "ilha_inspect");
    const logTool = toolByName(tools, "ilha_model_log");
    const tree = JSON.parse(inspectTool.execute({}).content[0]?.text ?? "[]");
    const plainId =
      tree.find(
        (node: { host?: string }) => node.host === `div#${plain.host.id}`
      )?.id ?? "";
    expect(
      JSON.parse(logTool.execute({ id: plainId }).content[0]?.text ?? "{}")
        .reason
    ).toContain("no recorded messages");
    expect(
      JSON.parse(logTool.execute({ id: "missing" }).content[0]?.text ?? "{}")
        .reason
    ).toContain("No live component");
    expect(logTool.execute({})?.isError).toBe(true);
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
