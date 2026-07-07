import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/jsx-runtime.ts", "src/jsx-dev-runtime.ts"],
  platform: "neutral",
  dts: true,
  minify: false,
  define: { __ILHA_DEV__: JSON.stringify(false) },
  external: ["alien-signals"],
});
