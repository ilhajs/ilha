# Imprensa Starter

A documentation site template powered by [imprensa](https://github.com/ilhajs/imprensa/tree/main/packages/imprensa), [Ilha](https://ilha.build), and [Areia](https://github.com/ilhajs/areia).

## Requirements

- Node.js 20+ or Bun

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173.

### Scaffold from GitHub

```bash
npx giget@latest gh:ilhajs/imprensa/templates/starter my-docs
cd my-docs
npm install
npm run dev
```

## Scripts

```bash
npm run dev      # start dev server
npm run build    # vite build + prerender + typecheck
npm run preview  # preview production build
npm run lint     # oxlint
```

## Project structure

```text
src/
  main.ts                 # client + export prerender (vite-prerender-plugin)
  app.css
  lib/
    landing-snippets.ts   # optional; powers imprensa/landing-shiki
    landing-previews.tsx  # raw() HTML from imprensa/landing-shiki
    components/           # landing / app UI
  pages/
    index.tsx, +layout.tsx, (content)/…
public/
```

## Layouts

Two chrome patterns ship by default:

- **Landing (`/`)** — `src/lib/components/topbar.tsx` (logo, search, theme toggle, social links)
- **Docs (`/getting-started`, etc.)** — resizable `Sidebar` with the same controls plus navigation tree

Customize or merge UI in `src/lib/components/`.

## Writing docs

Add MDX files under `src/pages/(content)/`. The `(content)` segment is a route group — it does not appear in URLs.

Add optional frontmatter to control navigation, search, SEO, and AI exports:

```mdx
---
title: Getting Started
description: Create a Imprensa documentation site.
order: 1
tags: [setup, starter]
---
```

Build-time checks (enabled by default):

- Exactly one `h1` per page
- No skipped heading levels
- No dead internal links or anchor references

The `h1` does not need to match the frontmatter `title`; use `title` for navigation/search and the `h1` for the best visible page heading.

Disable with `detectDeadLink: false` in `vite.config.ts` while migrating content.

## Customization checklist

1. **Brand color** — set `--areia-primary` in `src/app.css`
2. **Logo** — replace `public/logo.svg`
3. **Site name** — edit `LogoButton` text via a custom component, or fork from `imprensa/components`
4. **Top bar / socials** — edit `src/lib/components/topbar.tsx` (`DEFAULT_TOPBAR_SOCIALS` or `socials` prop); sidebar footer uses `imprensa({ socials })` in `vite.config.ts`
5. **Landing copy** — edit `src/pages/index.tsx`
6. **Footer** — edit `src/lib/components/footer.tsx`

## Plugin configuration

```ts
// vite.config.ts
imprensa({
  repo: "https://github.com/org/repo",
  repoPath: "templates/starter", // optional monorepo prefix
  contentDir: "src/pages/(content)",
  shiki: {
    themes: { light: "night-owl-light", dark: "houston" },
    langs: ["ts", "mdx", "shell"],
  },
});
```

Content pages use `DocArticle` from `imprensa/doc` (already wired in `[...slug].tsx`) to show an **Open** menu above the page title (copy markdown, GitHub, view as markdown, ChatGPT, Claude).

## Dependencies

The starter only declares packages you import directly (`areia`, `ilha`, `lucide`). MDX Shiki, Tailwind, prerender, and search come through `imprensa`.

## LLM exports

Each production build writes:

- `dist/<route>/index.md` — raw source alongside `index.html`
- `dist/llms.txt` — site outline with links and descriptions for each doc
- `dist/llms-full.txt` — full concatenated doc content
- `dist/llms.json` — structured page metadata for agents and tooling

Disable with `llms: false` in `vite.config.ts`, or customize the outline:

```ts
imprensa({
  llms: {
    siteName: "My Docs",
    summary: "API and guides for My Product.",
    section: "Documentation",
  },
});
```
