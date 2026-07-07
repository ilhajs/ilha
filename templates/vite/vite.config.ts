import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [pages(), tailwindcss()],
  resolve: {
    dedupe: ["ilha"],
  },
  server: {
    watch: {
      usePolling: true,
    },
  },
});
