import { defineConfig } from "tsdown";

export default defineConfig({
  dts: false,
  entry: [
    "src/index.ts",
    "src/vite.ts",
    "src/rsbuild.ts",
    "src/ssr.ts",
    "src/server-island.ts",
  ],
  external: ["ilha", "ilha:pages/server", "ilha:loaders", "node:async_hooks"],
  minify: false,
  platform: "neutral",
});
