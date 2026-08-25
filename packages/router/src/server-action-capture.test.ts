import { expect, test } from "bun:test";

import { ilha, html } from "ilha";
import { setServerManifestSerializer } from "ilha/internal";

import { __ilhaServerAction } from "./server-island-registry";

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

test("direct server-export closures record instead of executing", async () => {
  const List = ilha(() => {
    return html`<ul>
      <li>
        <input type="checkbox" data-c onclick=${() => toggleTask("t1")} />
        <button onclick=${() => deleteTask("t1")}>del</button>
      </li>
    </ul>`;
  });
  const rs = (List as unknown as Record<symbol, (props?: unknown) => Promise<string>>)[
    Symbol.for("ilha.renderState")
  ];
  const out = await rs({});
  console.log("OUT:", out.slice(0, 260));
  expect(manifests[manifests.length - 1]).toMatchObject({
    "click:0": { k: "x:toggleTask", a: ["t1"] },
    "click:1": { k: "x:deleteTask", a: ["t1"] },
  });

  // Outside capture frames the shim passes through.
  expect(await deleteTask("z")).toBe("deleted:z");
});
