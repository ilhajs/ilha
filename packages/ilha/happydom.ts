import { afterEach } from "bun:test";

import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { resetRenderTracking } from "./src/atom.ts";

GlobalRegistrator.register();

afterEach(() => {
  resetRenderTracking();
});
