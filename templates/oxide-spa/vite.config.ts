import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import oxide from "oxidejs/vite";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const ilhaSrc = resolve(repo, "packages/ilha/src");

export default defineConfig({
  plugins: [oxide({ middleware: ["@ilha/router/ssr"] }), pages(), tailwindcss()],
  resolve: {
    alias: {
      "ilha/jsx-runtime": resolve(ilhaSrc, "jsx-runtime.ts"),
      "ilha/jsx-dev-runtime": resolve(ilhaSrc, "jsx-dev-runtime.ts"),
      ilha: resolve(ilhaSrc, "index.ts"),
    },
    tsconfigPaths: true,
    dedupe: ["ilha"],
  },
  optimizeDeps: {
    exclude: ["ilha", "ilha/jsx-runtime", "ilha/jsx-dev-runtime"],
  },
});
