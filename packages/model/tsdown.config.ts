import { defineConfig } from "tsdown";

export default defineConfig({
  dts: { tsconfig: "./tsconfig.build.json" },
  entry: [
    "src/index.ts",
    "src/devtools.ts",
    "src/validation/index.ts",
    "src/test/index.ts",
  ],
  external: ["ilha", /^ilha\//u, "effect", /^effect\//u],
  minify: false,
  platform: "neutral",
});
