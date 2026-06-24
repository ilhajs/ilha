import { spawnSync } from "node:child_process";

import { pages } from "@ilha/router/rolldown";
import { defineConfig } from "tsdown";

function buildCss(input: string, output: string) {
  const result = spawnSync("npx", ["@tailwindcss/cli", "-i", input, "-o", output], {
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
    plugins: [pages()],
    deps: {
      // Bundle every ilha-touching dep into the single client bundle so they
      // share one ilha instance. jsx-dev-runtime must be here too: dev/watch
      // JSX compiles to jsxDEV, and an externalized jsx-dev-runtime would chain
      // to a second ilha (its own renderCtxStack) and break hydration.
      alwaysBundle: [
        "ilha",
        "@ilha/router",
        "@ilha/store",
        "@ilha/store/form",
        "ilha/jsx-runtime",
        "ilha/jsx-dev-runtime",
        "areia",
        "quando",
      ],
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
