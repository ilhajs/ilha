import { defineConfig } from "tsdown";

export default defineConfig({
  dts: false,
  entry: ["src/index.ts", "src/test.ts"],
  external: ["ilha", /^ilha\//u, "effect", /^effect\//u],
  minify: false,
  platform: "neutral",
});
