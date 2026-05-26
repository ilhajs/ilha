import { pages } from "@ilha/router/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [pages()],
});
