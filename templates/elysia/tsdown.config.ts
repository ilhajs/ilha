import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/server.ts"],
    platform: "node",
  },
  {
    entry: ["src/client.ts"],
    platform: "browser",
    deps: {
      alwaysBundle: ["ilha", "@ilha/router"],
    },
    copy: [
      { from: "public/*", to: "dist" },
      { from: "index.html", to: "dist" },
      { from: "src/app.css", to: "dist" },
    ],
  },
]);
