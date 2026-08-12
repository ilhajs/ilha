import { pages } from "@ilha/router/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [nitro(), pages(), tailwindcss()],
    nitro: {
      serverDir: "./src",
    },
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      watch: {
        usePolling: env.VITE_USE_POLLING === "true",
      },
    },
  };
});
