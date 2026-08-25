import { expect, test } from "bun:test";

import { ilha, action, html } from "./index";
import { setServerManifestSerializer } from "./internal";
import "/home/ryuz/Ubuntu/Developer/ilha/packages/ilha/happydom.ts";

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

test("forwarding closures land in the hydration manifest", async () => {
  const App = ilha(() => {
    const toggle = action((_id: string) => "t");
    const remove = action((_id: string) => "r");
    return html`<ul>
      <li><button onclick=${() => remove("42")}>Delete</button></li>
      <li><button onclick=${toggle}>Toggle</button></li>
    </ul>`;
  });
  const out = await renderState(App);
  console.log(out);
  const manifest = lastManifest();
  expect(Object.values(manifest)).toContain("a0"); // direct reference (toggle)
  const forwarded = Object.values(manifest).find((v) => typeof v === "object") as {
    k: string;
    a: unknown[];
  };
  expect(forwarded.k).toBe("a1"); // forwarded remove with args
  expect(forwarded.a).toEqual(["42"]);
});

function renderState(island: unknown): Promise<string> {
  return (island as Record<symbol, any>)[Symbol.for("ilha.renderState")]({});
}
