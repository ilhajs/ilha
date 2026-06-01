import path from "node:path";
import { fileURLToPath } from "node:url";

import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(rootDir, "../../packages");

// https://vite.dev/config/
export default defineConfig({
  plugins: [nitro(), pages(), tailwindcss()],
  resolve: {
    // Always use workspace builds — stale .vite/deps prebundles broke hydration
    // (old wrapLayout never forwarded mount to the page inside k:page).
    alias: [
      {
        find: "@ilha/router/vite",
        replacement: path.resolve(packagesDir, "router/dist/vite.js"),
      },
      {
        find: "@ilha/router",
        replacement: path.resolve(packagesDir, "router/dist/index.js"),
      },
    ],
    dedupe: ["ilha", "@ilha/router"],
  },
  optimizeDeps: {
    exclude: ["ilha", "@ilha/router"],
  },
  nitro: {
    serverDir: "./src",
  },
  environments: {
    client: {
      build: {
        rollupOptions: { input: "./src/entry-client.ts" },
      },
    },
  },
});
