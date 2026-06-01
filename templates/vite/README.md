# Ilha + Vite

A minimal client-side Ilha app with [Vite](https://vite.dev). Pages live in `src/pages/` and mount on the client via `@ilha/router`.

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
  app.css      # Tailwind + Areia styles
```

The demo includes a todo island and [Areia](https://areia.ilha.build) UI components.

## Learn more

- [Ilha docs](https://ilha.build/docs)
- [Scaffold a new project](https://ilha.build/docs/guide/getting-started/installation)
