import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/jsx-runtime.ts", "src/jsx-dev-runtime.ts"],
  platform: "neutral",
  dts: true,
  minify: true,
  define: { __ILHA_DEV__: JSON.stringify(false) },
  // One alien-signals instance for ilha + @ilha/store in app bundles.
  external: ["alien-signals"],
});
