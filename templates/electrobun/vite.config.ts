import { pages } from "@ilha/router/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [pages({ dir: "src/mainview/pages" })],
  server: {
    port: 5173,
    strictPort: true,
  },
});
