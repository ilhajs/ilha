import { expect, test } from "bun:test";

import { ilha, html } from "ilha";
import { setServerManifestSerializer } from "ilha/internal";

import { __ilhaServerAction } from "./ssr";

// Capture manifest DATA (router owns serialization; this adapter mirrors it).
const manifests: Array<Record<string, unknown>> = [];
setServerManifestSerializer({
  template(manifest) {
    const entry = Object.fromEntries(manifest);
    manifests.push(entry);
    return `<template data-ilha-actions='${JSON.stringify(entry).replace(/'/g, "&#39;")}'></template>`;
  },
});

const deleteTask = __ilhaServerAction("x:deleteTask", async (id: string) => `deleted:${id}`);
const toggleTask = __ilhaServerAction("x:toggleTask", async (id: string) => `toggled:${id}`);

test("server actions bind payloads without a separate ilha action", async () => {
  const List = ilha(() => html`<button onclick=${deleteTask.with("t1")}>del</button>`);
  const rs = (List as unknown as Record<symbol, (props?: unknown) => Promise<string>>)[
    Symbol.for("ilha.renderState")
  ];
  await rs({});
  expect(manifests.at(-1)).toEqual({ "click:0": { k: "x:deleteTask", a: ["t1"] } });
});

test("server-export closures are never executed during SSR and record nothing", async () => {
  const manifestCount = manifests.length;
  let executed = 0;
  const realDelete = __ilhaServerAction("x:real", async (id: string) => {
    executed++;
    return `deleted:${id}`;
  });
  const List = ilha(() => {
    return html`<ul>
      <li>
        <input type="checkbox" data-c onclick=${() => toggleTask("t1")} />
        <button onclick=${() => realDelete("t1")}>del</button>
      </li>
    </ul>`;
  });
  const rs = (List as unknown as Record<symbol, (props?: unknown) => Promise<string>>)[
    Symbol.for("ilha.renderState")
  ];
  await rs({});
  // Fail closed: manifest rendering must not execute handler closures, so the
  // wrapped server action never runs server-side. No manifest entries either.
  expect(executed).toBe(0);
  expect(manifests).toHaveLength(manifestCount);

  // Outside rendering the shim passes through.
  expect(await deleteTask("z")).toBe("deleted:z");
});
