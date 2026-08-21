import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import oxide from "oxidejs/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [oxide(), pages(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
  },
});
