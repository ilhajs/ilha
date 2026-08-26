import { expect, test } from "bun:test";

import { action, html, ilha } from "./index";
import { setServerManifestSerializer } from "./internal";
import "../happydom.ts";

// Test adapter standing in for @ilha/router's manifest serializer: captures
// the manifest data core collects instead of asserting on markup ownership.
const capturedManifests: Array<Record<string, unknown>> = [];
setServerManifestSerializer({
  template(manifest) {
    const entry = Object.fromEntries(manifest);
    capturedManifests.push(entry);
    return `<template data-ilha-actions='${JSON.stringify(entry).replace(/'/g, "&#39;")}'></template>`;
  },
});
function lastManifest(): Record<string, unknown> {
  return capturedManifests[capturedManifests.length - 1] ?? {};
}

test("no action() slots → forwarded closures are NEVER executed during manifest SSR", async () => {
  let foreignCalls = 0;
  const deleteTask = (id: string) => {
    foreignCalls++;
    return id;
  };
  const List = ilha(() => {
    // user's exact pattern: direct reference to a server export, no action()
    return html`<ul>
      <li><button onclick=${() => deleteTask("t1")}>del</button></li>
    </ul>`;
  });
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (m: unknown) => warnings.push(String(m));
  const out = await renderState(List);
  console.warn = orig;
  // Fail closed: the closure is never invoked during SSR, so non-action code
  // cannot run server-side. It also gets no hydration-manifest entry.
  expect(foreignCalls).toBe(0);
  expect(out).toContain("del");
  expect(warnings.join("\n")).toMatch(/never executed during server rendering/);
});

test("with actions but a closure that records nothing → dev warning, no manifest entry", async () => {
  let foreignCalls = 0;
  const logIt = () => {
    foreignCalls++;
  };
  const List = ilha(() => {
    const ping = action((_x: string) => "ok");
    return html`<div>
      <button data-a onclick=${ping}>a</button>
      <button data-b onclick=${() => logIt()}>b</button>
    </div>`;
  });
  const out = await renderState(List);
  expect(foreignCalls).toBe(0); // fail closed — handlers are never probed
  expect(lastManifest()).toMatchObject({ "click:0": "a0" });
  expect(out).not.toContain("&quot;click:1&quot;"); // no manifest entry for the dead handler
});

function renderState(island: unknown): Promise<string> {
  return (island as Record<symbol, any>)[Symbol.for("ilha.renderState")]({});
}

test("a throwing closure never breaks SSR rendering", async () => {
  const Boom = ilha(() => {
    return html`<button
      onclick=${() => {
        throw new Error("must not surface during SSR");
      }}
    >
      boom
    </button>`;
  });
  // renderState (manifest mode)
  await expect(renderState(Boom)).resolves.toContain("boom");
});

test("a counter-mutating closure is never executed during SSR", async () => {
  let mutations = 0;
  const Counter = ilha(() => {
    return html`<button onclick=${() => mutations++}>inc</button>`;
  });
  await renderState(Counter);
  await renderState(Counter);
  expect(mutations).toBe(0);
});

test(".with() binds an explicit payload without executing anything", async () => {
  let deleteCalls = 0;
  const App = ilha(() => {
    const remove = action((_id: string) => {
      deleteCalls++;
      return "ok";
    });
    return html`<ul>
      <li><button onclick=${remove.with("task-42")}>Delete</button></li>
    </ul>`;
  });
  // SSR: no manifest-render execution of the action body.
  expect(deleteCalls).toBe(0);
  const out = await renderState(App);
  expect(deleteCalls).toBe(0);
  expect(lastManifest()).toMatchObject({ "click:0": { k: "a0", a: ["task-42"] } });
  expect(out).toContain("Delete");

  // Client click path: bound reference invokes the accessor with the payload.
  const el = document.createElement("div");
  document.body.appendChild(el);
  let clientPayload: unknown;
  const Client = ilha(() => {
    const remove = action((id: string) => {
      clientPayload = id;
    });
    return html`<button onclick=${remove.with("task-7")}>go</button>`;
  });
  const unmount = Client.mount(el);
  el.querySelector("button")!.click();
  await new Promise((r) => setTimeout(r, 10));
  expect(clientPayload).toBe("task-7");
  unmount();
});

test(".with() rejects non-JSON-safe and oversized payloads at bind time", async () => {
  let ping!: (x?: unknown) => unknown;
  const App = ilha(() => {
    const op = action((_x: unknown) => "ok");
    ping = op as unknown as (x?: unknown) => unknown;
    return html`<b></b>`;
  });
  await renderState(App);
  expect(() => (ping as any).with(() => 1)).toThrow(/rejects function/);
  expect(() => (ping as any).with("x".repeat(9000))).toThrow(/exceeds/);
});

test("closures are never executed across every server render API", async () => {
  let sideEffects = 0;
  const boom = () => {
    sideEffects++;
    throw new Error("never during SSR");
  };
  const App = ilha(() => html`<button onclick=${() => boom()}>x</button>`);
  expect(() => (App as any).toString()).not.toThrow();
  await expect((App as any).toStringAsync()).resolves.toContain("x");
  await expect((App as any).hydratable({}, { name: "X" })).resolves.toContain("x");
  await renderState(App);
  expect(sideEffects).toBe(0);
});

test(".with() strictly rejects values that would silently transform", () => {
  let op!: (x?: unknown) => unknown;
  const App = ilha(() => {
    const a = action((x?: unknown) => x);
    op = a as unknown as (x?: unknown) => unknown;
    return html`<b></b>`;
  });
  return renderState(App).then(() => {
    expect(() => (op as any).with({ value: undefined })).toThrow();
    expect(() => (op as any).with({ value: () => {} })).toThrow();
    expect(() => (op as any).with(NaN)).toThrow(/non-finite/);
    expect(() => (op as any).with(Infinity)).toThrow(/non-finite/);
    expect(() => (op as any).with(new Date())).toThrow(/plain objects only|rejects object/);
    expect(() => (op as any).with(new Map())).toThrow(/plain objects only/);
    expect(() => (op as any).with(1n)).toThrow(/rejects bigint/);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => (op as any).with(circular)).toThrow(/circular/);
    // Unsafe keys rejected — no prototype-pollution smuggling.
    expect(() => (op as any).with(JSON.parse('{"__proto__": {"polluted": true}}'))).toThrow(
      /unsafe key "__proto__"/,
    );
    expect(() => (op as any).with({ constructor: { prototype: {} } })).toThrow(
      /unsafe key "constructor"/,
    );
  });
});

test(".with() preserves a valid nested payload exactly", async () => {
  let bound!: unknown[];
  const App = ilha(() => {
    const remove = action((_x?: unknown) => "ok");
    const ref = (remove as any).with({ task: { id: "task-42", tags: ["a", "b"] } }) as Record<
      symbol,
      unknown
    >;
    void html`<button onclick=${ref as never}>x</button>`;
    return html`<b></b>`;
  });
  await renderState(App);
  void bound;
  // Re-bind and inspect the stored payload directly for deep equality.
  const App2 = ilha(() => {
    const remove = action((_x?: unknown) => "ok");
    const ref = (remove as any).with({ task: { id: "task-42", tags: ["a", "b"] } }) as Record<
      symbol,
      unknown[]
    >;
    bound = ref[Symbol.for("ilha.actionBoundArgs")] as unknown[];
    return html`<b></b>`;
  });
  await renderState(App2);
  expect(bound).toEqual([{ task: { id: "task-42", tags: ["a", "b"] } }]);
});
