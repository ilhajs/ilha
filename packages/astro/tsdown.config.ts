import { defineConfig } from "tsdown";

export default defineConfig({
  dts: false,
  entry: ["src/index.ts", "src/server.ts", "src/client.ts"],
  external: ["ilha", "astro", "virtual:@ilha/astro/options"],
  minify: false,
  platform: "neutral",
});
