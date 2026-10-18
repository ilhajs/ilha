/**
 * The Ilha devtools as a Devframe definition. Mount it with any Devframe
 * adapter, for example `devframeVitePlugin(ilhaDevtools)` from
 * `@devframes/vite/single`. Run `installIlhaDevtools()` from
 * `@ilha/devtools/page` in the app so the panel has a page to inspect.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineDevframe } from "devframe";

import { ILHA_DEVTOOLS_CHANNEL, ILHA_DEVTOOLS_PANEL_PATH } from "./protocol";

export {
  ILHA_DEVTOOLS_CHANNEL,
  ILHA_DEVTOOLS_PANEL_PATH,
  parseTree,
} from "./protocol";
export type {
  AtomJson,
  IlhaDevtoolsProtocol,
  IlhaInspectNode,
  IlhaTreeState,
  SetAtomResult,
} from "./protocol";

const packageUrl = new URL("../package.json", import.meta.url);
const { version, name } = JSON.parse(readFileSync(packageUrl, "utf-8"));

export const ilhaDevtools = defineDevframe({
  basePath: ILHA_DEVTOOLS_PANEL_PATH,
  clientAssets: fileURLToPath(new URL("../dist/spa", import.meta.url)),
  description: "Inspect live Ilha islands and edit their atoms",
  homepage: "https://ilha.build/guide/devtools",
  icon: "ph:island-duotone",
  id: "ilha-devtools",
  importMetaUrl: import.meta.url,
  name: "Ilha",
  packageName: name,
  setup: (ctx) => {
    ctx.agent.registerTool({
      description:
        "Locate how to inspect live Ilha islands. Call it before debugging component state: it names the page tools and the Node-free fallback.",
      handler: () => ({
        channel: ILHA_DEVTOOLS_CHANNEL,
        hint: "Call the page tools ilha_inspect, ilha_highlight, and ilha_set_atom over WebMCP, or ilha-devtools inspect over the in-page channel. In tests, import inspect from ilha/debug.",
        panel: ILHA_DEVTOOLS_PANEL_PATH,
      }),
      id: "ilha-devtools:docs",
      safety: "read",
    });
  },
  version,
});

export default ilhaDevtools;
