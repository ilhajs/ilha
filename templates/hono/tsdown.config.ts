import { readFile } from "node:fs/promises";

import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/server.ts"],
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
      alwaysBundle: ["ilha"],
    },
    copy: [
      { from: "public/*", to: "dist/static" },
      { from: "src/app.css", to: "dist/static" },
    ],
  },
]);
