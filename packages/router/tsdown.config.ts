import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/vite.ts", "src/rsbuild.ts", "src/ssr.ts", "src/server-island.ts"],
  platform: "neutral",
  dts: false,
  minify: false,
  external: ["ilha", "ilha:pages/server", "node:async_hooks"],
});
