import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [nitro(), pages(), tailwindcss()],
  resolve: {
    dedupe: ["ilha"],
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
  server: {
    watch: {
      usePolling: true,
    },
  },
});
