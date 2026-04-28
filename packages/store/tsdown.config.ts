import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/form.ts"],
  platform: "browser",
  dts: true,
});
