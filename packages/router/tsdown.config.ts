import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/vite.ts",
    "src/rsbuild.ts",
    "src/server.ts",
    "src/ssr.ts",
    "src/server-island.ts",
  ],
  platform: "neutral",
  dts: false,
  minify: false,
  external: ["ilha", "ilha:pages/server", "ilha:loaders", "node:async_hooks"],
});
