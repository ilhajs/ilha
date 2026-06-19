import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/form.ts"],
  platform: "browser",
  dts: true,
  minify: true,
  // Must share one alien-signals instance with ilha (preview CDN + app bundlers).
  external: ["alien-signals"],
});
