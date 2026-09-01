# Ilha + Oxide

A minimal Ilha app with [Oxide](https://oxide.build). Pages live in `src/pages/` and mount via `@ilha/router`. Learn renders on the server, and the todo list is a server island.

## Requirements

- [Bun](https://bun.sh) or Node.js 20+

## Getting started

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command           | Description                         |
| ----------------- | ----------------------------------- |
| `bun run dev`     | Start the Vite development server   |
| `bun run build`   | Build the server and client bundles |
| `bun run preview` | Preview the production build        |
| `bun run start`   | Run the production server           |

## Project layout

```text
src/
  pages/       # File-based routes (+layout, index, learn.server, …)
  lib/         # Server islands and actions
  client.ts    # Client entry — mounts islands
  server.ts    # Oxide server entry
  app.css      # Tailwind + daisyUI
```

The UI matches the Vite template, but `<TaskList />` keeps its data and mutations on the server. `learn.server.tsx` is a server page.
