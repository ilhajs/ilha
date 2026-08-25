import { expect, test } from "bun:test";

import { ilha, action, html } from "./index";
import { setServerManifestSerializer } from "./internal";
import "../happydom";

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

test("closures never execute during SSR and get no manifest entry; direct action refs do", async () => {
  const App = ilha(() => {
    const toggle = action((_id: string) => "t");
    return html`<ul>
      <li><button onclick=${() => toggle("42")}>Delete</button></li>
      <li><button onclick=${toggle}>Toggle</button></li>
    </ul>`;
  });
  const out = await renderState(App);
  const manifest = lastManifest();
  // Direct reference is manifest-eligible by identity; the closure is not —
  // and it was never invoked to find out what it calls.
  expect(manifest).toMatchObject({ "click:1": "a0" });
  expect(Object.keys(manifest)).not.toContain("click:0");
  expect(out).toContain("Delete");
});

function renderState(island: unknown): Promise<string> {
  return (island as Record<symbol, any>)[Symbol.for("ilha.renderState")]({});
}
