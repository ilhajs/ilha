import { defineConfig } from "tsdown";

export default defineConfig({
  dts: false,
  entry: [
    "src/index.ts",
    "src/client.ts",
    "src/islands.ts",
    "src/plugin.ts",
    "src/server.ts",
  ],
  external: ["ilha", "vite", "void", /^void\//u, /^node:/u],
  minify: false,
  platform: "neutral",
});
