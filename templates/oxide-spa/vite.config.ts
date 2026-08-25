import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import oxide from "oxidejs/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [oxide({ middleware: ["@ilha/router/ssr"] }), pages(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
  },
});
