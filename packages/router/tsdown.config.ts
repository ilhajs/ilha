import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/vite.ts",
    "src/rsbuild.ts",
    "src/ssr.ts",
    "src/server-island.ts",
    "src/server-island-registry.ts",
  ],
  platform: "neutral",
  dts: false,
  minify: false,
  external: ["ilha", "ilha:pages/server", "ilha:loaders", "node:async_hooks"],
});
