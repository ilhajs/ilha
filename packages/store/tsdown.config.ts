import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/form.ts"],
  platform: "browser",
  dts: true,
  minify: true,
  // Share one alien-signals + ilha with the app (bind accessor brands, signals).
  external: ["alien-signals", "ilha"],
});
