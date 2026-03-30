import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      $lib: path.resolve(import.meta.dirname, "src", "lib"),
      $routes: path.resolve(import.meta.dirname, "src", "routes"),
      ilha: path.resolve(import.meta.dirname, "..", "..", "packages", "ilha", "src", "index.ts"),
    },
  },
  server: {
    watch: {
      usePolling: true,
    },
  },
});
