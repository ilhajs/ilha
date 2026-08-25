import { expect, test } from "bun:test";

import { ilha, state, derived, action, effect, html } from "./index";
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

test("hydratable snapshot roundtrip", async () => {
  const Counter = ilha<{ start: number }>(({ start }) => {
    const count = state(start);
    const double = derived(() => count() * 2);
    return html`<p data-double=${double()}>${count()}</p>`;
  });

  const out = await Counter.hydratable({ start: 7 }, { name: "Counter", snapshot: true });
  expect(out).toContain('data-ilha="Counter"');
  expect(out).toContain("&quot;v&quot;:2");
  expect(out).toContain("&quot;s&quot;:[7]");
  expect(out).toContain("data-double=14");
});

test("mount over SSR DOM restores state and preserves markup", async () => {
  let hydratedFlag: boolean | null = null;
  const Counter = ilha<{ start: number }>(({ start }) => {
    const count = state(start);
    effect.once(({ hydrated }) => {
      hydratedFlag = hydrated;
    });
    return html`<button data-c="x">${count()}</button>`;
  });
  const out = await Counter.hydratable(
    { start: 3 },
    { name: "C", snapshot: true, skipOnMount: false },
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  host.innerHTML = out;
  const islandHost = host.querySelector("[data-ilha]")!;
  Counter.mount(islandHost as Element);
  expect(islandHost.querySelector("button")).not.toBeNull();
  expect(hydratedFlag === true).toBe(true);
});

test("action manifest emitted for direct action handler", async () => {
  const App = ilha(() => {
    const save = action((_x: string) => "done");
    return html`<button onclick=${save}>go</button>`;
  });
  await renderState(App);
  expect(Object.values(lastManifest())).toEqual(["a0"]);
});

function renderState(island: unknown): Promise<string> {
  return (island as Record<symbol, any>)[Symbol.for("ilha.renderState")]({});
}
