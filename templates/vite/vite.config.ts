import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [pages(), tailwindcss()],
  server: {
    watch: {
      usePolling: true,
    },
  },
});
