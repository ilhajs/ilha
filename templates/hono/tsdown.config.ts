import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

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
    plugins: [
      {
        name: "raw-import",
        async load(id) {
          if (id.endsWith("?raw")) {
            const content = await readFile(id.replace("?raw", ""), "utf-8");
            return `export default ${JSON.stringify(content)};`;
          }
        },
      },
    ],
  },
  {
    entry: ["src/client.ts"],
    platform: "browser",
    outDir: "dist/static",
    deps: {
      alwaysBundle: ["ilha", "@ilha/router", "ilha/jsx-runtime", "areia", "quando"],
    },
    copy: [{ from: "public/*", to: "dist/static" }],
    hooks: {
      "build:done": () => {
        buildCss("src/app.css", "dist/static/app.css");
      },
    },
  },
]);
