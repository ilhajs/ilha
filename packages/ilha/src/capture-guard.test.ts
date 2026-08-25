import { expect, test } from "bun:test";

import { action, html, ilha } from "./index";
import { setServerManifestSerializer } from "./internal";
import "../happydom.ts";

// Test adapter standing in for @ilha/router's manifest serializer: captures
// the manifest data core collects instead of asserting on markup ownership.
const capturedManifests: Array<Record<string, unknown>> = [];
setServerManifestSerializer({
  template(manifest) {
    const entry = { ...Object.fromEntries(manifest) };
    capturedManifests.push(entry);
    return `<template data-ilha-actions='${JSON.stringify(entry).replace(/'/g, "&#39;")}'></template>`;
  },
});
function lastManifest(): Record<string, unknown> {
  return capturedManifests[capturedManifests.length - 1] ?? {};
}

test("no action() slots → forwarded closures are NOT executed during manifest SSR", async () => {
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
  // Without a cooperating shim there is nothing to record — the closure is
  // probed (documented contract) and the handler simply cannot be replayed.
  expect(foreignCalls).toBe(1);
  expect(out).toContain("del");
  expect(warnings.join("\n")).toMatch(/cannot be replayed by the client/);
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
  expect(foreignCalls).toBe(1); // invoked once to probe (documented thunk contract)
  expect(lastManifest()).toMatchObject({ "click:0": "a0" });
  expect(out).not.toContain("&quot;click:1&quot;"); // no manifest entry for the dead handler
});

function renderState(island: unknown): Promise<string> {
  return (island as Record<symbol, any>)[Symbol.for("ilha.renderState")]({});
}
