import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/ssr.ts", "src/vite.ts", "src/rspack.ts", "src/rolldown.ts"],
  platform: "neutral",
  dts: false,
  minify: true,
  // Share one `ilha` instance with the app (bind sentinels, mount, islands).
  external: ["ilha", "ilha:pages/server", "ilha:loaders", "node:async_hooks"],
});
