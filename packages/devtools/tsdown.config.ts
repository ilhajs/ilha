import { defineConfig } from "tsdown";

export default defineConfig({
  dts: false,
  entry: ["src/index.ts", "src/page.ts", "src/protocol.ts"],
  external: [
    "devframe",
    /^devframe\//u,
    "ilha",
    /^ilha\//u,
    "@ilha/model",
    "effect",
    /^node:/u,
  ],
  minify: false,
  platform: "neutral",
});
