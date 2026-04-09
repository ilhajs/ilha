import { pages } from "@ilha/router/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [nitro(), pages()],
  nitro: {
    serverDir: "./src",
  },
});
