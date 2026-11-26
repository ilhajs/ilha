import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/jsx-runtime.ts",
    "src/jsx-dev-runtime.ts",
    "src/renderer.ts",
    "src/test.ts",
    "src/debug.ts",
  ],
  external: ["effect"],
  minify: false,
  platform: "neutral",
});
