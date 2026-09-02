// @ts-nocheck — config, not part of the src program
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/jsx-runtime.ts", "src/jsx-dev-runtime.ts", "src/define.ts"],
  platform: "neutral",
  dts: true,
  minify: false,
  external: ["effect"],
});
