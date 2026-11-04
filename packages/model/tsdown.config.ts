import { defineConfig } from "tsdown";

export default defineConfig({
  dts: false,
  entry: ["src/index.ts", "src/test.ts"],
  external: ["ilha", "effect", /^effect\//u],
  minify: false,
  platform: "neutral",
});
