# Ilha + Elysia

A minimal Ilha app with [Elysia](https://elysiajs.com) on Bun. Pages live in `src/pages/` and hydrate on the client via `@ilha/router`.

## Requirements

- [Bun](https://bun.sh)

## Getting started

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command         | Description                         |
| --------------- | ----------------------------------- |
| `bun run dev`   | Build and start the server with HMR |
| `bun run build` | Build server and client bundles     |
| `bun run start` | Run the production server           |

## Project layout

```
src/
  pages/       # File-based routes (+layout, index, learn, …)
  client.ts    # Client entry — mounts islands
  server.tsx   # Elysia server — static assets + SPA shell
  app.css      # Tailwind + Areia styles
```

The demo includes a todo island, a server-rendered island at `/server-island`, and [Areia](https://areia.ilha.build) UI components.

## Learn more

- [Ilha docs](https://ilha.build/docs)
- [Scaffold a new project](https://ilha.build/docs/guide/getting-started/installation)
