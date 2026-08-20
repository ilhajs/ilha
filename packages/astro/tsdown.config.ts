import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/server.ts", "src/client.ts"],
  platform: "neutral",
  dts: false,
  minify: false,
  external: ["ilha", "astro", "virtual:@ilha/astro/options"],
});
