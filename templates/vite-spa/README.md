# Ilha + Vite

A minimal client-side Ilha app with [Vite](https://vite.dev). Pages live in `src/pages/` and mount on the client via `@ilha/router`. This template has **no backend** — everything ships as static files.

## Requirements

- [Bun](https://bun.sh) or Node.js 20+

## Getting started

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command           | Description                   |
| ----------------- | ----------------------------- |
| `bun run dev`     | Start the Vite dev server     |
| `bun run build`   | Type-check and build for prod |
| `bun run preview` | Preview the production build  |

## Project layout

```text
src/
  pages/       # File-based routes (+layout, index, learn, …)
  main.ts      # Client entry — mounts islands
  app.css      # Tailwind + daisyUI
```

The demo is a todo page: `atom()` for local state, file-system routes under `src/pages/`.
