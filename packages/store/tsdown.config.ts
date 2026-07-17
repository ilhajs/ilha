import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/form.ts", "src/query.ts"],
  platform: "browser",
  dts: true,
  minify: false,
  external: ["alien-signals", "ilha", "@ilha/router"],
});
