# Ilha + Nitro

A minimal Ilha app with [Vite](https://vite.dev) and [Nitro](https://nitro.build) for SSR. Pages live in `src/pages/`, render on the server, and hydrate on the client via `@ilha/router`.

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

```
src/
  pages/            # File-based routes (+layout, index, learn, …)
  entry-server.ts   # SSR — renders pages to HTML
  entry-client.ts   # Client entry — hydrates islands
  routes/api/       # Nitro API routes (e.g. server-island)
  app.css           # Tailwind + Areia styles
```

The demo includes a todo island, a server-rendered island at `/api/server-island`, and [Areia](https://areia.ilha.build) UI components.

## Learn more

- [Ilha docs](https://ilha.build/docs)
- [Scaffold a new project](https://ilha.build/docs/guide/getting-started/installation)
