import type { AstroIntegration, AstroRenderer } from "astro";

export function getRenderer(): AstroRenderer {
  return {
    name: "@ilha/astro",
    clientEntrypoint: "@ilha/astro/client.js",
    serverEntrypoint: "@ilha/astro/server.js",
  };
}

export default function ilhaIntegration(): AstroIntegration {
  return {
    name: "@ilha/astro",
    hooks: {
      "astro:config:setup": ({ addRenderer }) => {
        addRenderer(getRenderer());
      },
    },
  };
}
