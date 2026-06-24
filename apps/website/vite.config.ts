import { imprensa } from "imprensa";
import { defineConfig } from "vite";
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    imprensa({
      hostname: "https://ilha.build",
      siteName: "Ilha",
      topLevelSplit: true,
      logoSrc: "/logo.svg",
      repo: "https://github.com/ilhajs/ilha",
      repoPath: "apps/website",
      order: {
        "guide.getting-started": 1,
        "guide.island": 2,
        "guide.helpers": 3,
        "guide.libraries": 4,
        "guide.resources": 5,
      },
      shiki: {
        themes: { light: "night-owl-light", dark: "houston" },
        langs: ["typescript", "tsx", "mdx", "shell", "yaml", "json"],
      },
      head: {
        title: "Build Modern UI, Your Way",
        meta: [
          {
            name: "description",
            content:
              "Ilha is a lightweight UI framework under 2,500 lines of code. Simple enough to fit in a single AI context window, powerful enough to build modern interfaces your way.",
          },
          { property: "og:image", content: "https://ilha.build/og.jpg" },
          { name: "twitter:image", content: "https://ilha.build/og.jpg" },
        ],
        link: [{ rel: "canonical", href: "https://ilha.build" }],
      },
      socials: [
        { service: "x", url: "https://x.com/ilha_js" },
        { service: "discord", url: "https://discord.gg/WnVTMCTz74" },
        { service: "github", url: "https://github.com/ilhajs/ilha" },
      ],
    }),
  ],
});
