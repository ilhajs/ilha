import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/vite.ts", "src/rspack.ts", "src/rolldown.ts"],
  platform: "neutral",
  dts: true,
});
