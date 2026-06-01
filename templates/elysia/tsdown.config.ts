import { spawnSync } from "node:child_process";

import { defineConfig } from "tsdown";

function buildCss(input: string, output: string) {
  const result = spawnSync("bun", ["x", "@tailwindcss/cli", "-i", input, "-o", output], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`tailwindcss failed for ${input}`);
  }
}

export default defineConfig([
  {
    entry: ["src/server.tsx"],
    platform: "node",
  },
  {
    entry: ["src/client.ts"],
    platform: "browser",
    deps: {
      alwaysBundle: ["ilha", "@ilha/router", "ilha/jsx-runtime", "areia", "quando"],
    },
    copy: [
      { from: "public/*", to: "dist" },
      { from: "index.html", to: "dist" },
    ],
    hooks: {
      "build:done": () => {
        buildCss("src/app.css", "dist/app.css");
      },
    },
  },
]);
