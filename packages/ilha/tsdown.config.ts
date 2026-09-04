import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/jsx-runtime.ts",
    "src/jsx-dev-runtime.ts",
    "src/define.ts",
  ],
  external: ["effect"],
  minify: false,
  platform: "neutral",
});
