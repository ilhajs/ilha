# Ilha + Void

A server-rendered Ilha app on [Void](https://void.cloud). Pages live in `pages/`. Void handles routing, loaders, actions, and deployment; `@ilha/void` renders and hydrates them with Ilha.

## Requirements

- Node.js 24.21+ (Void's minimum) and [Bun](https://bun.sh) or npm

## Getting started

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command           | Description                  |
| ----------------- | ---------------------------- |
| `bun run dev`     | Start the Vite dev server    |
| `bun run build`   | Build for production         |
| `bun run preview` | Preview the production build |
| `bun run check`   | Typecheck, lint, and test    |

## Project layout

```text
pages/
  layout.tsx          # Wraps every page; keeps its state across navigations
  index.tsx           # Todos page, hydrated and navigated by the Void Router
  index.server.ts     # Loader and action for the todos page
  about.island.tsx    # Island page: static HTML plus the counter island
  _counter.tsx        # Imported `with { island: "load" }` on the about page
  _counter.test.tsx   # Server-render test with `renderHtml` from `ilha/test`
AGENTS.md             # Commands and canonical APIs for AI coding agents
.oxlintrc.json        # Enables the Ilha Oxlint plugin
```

Read the [Ilha Void guide](https://ilha.build/guide/void) and the [Void docs](https://void.cloud) to go further.
