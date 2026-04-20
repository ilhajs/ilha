# Ilha

[![Continuous Integration](https://github.com/ilhajs/ilha/actions/workflows/ci.yml/badge.svg)](https://github.com/ilhajs/ilha/actions/workflows/ci.yml)
[![NPM Version](https://img.shields.io/npm/v/ilha)](https://www.npmjs.com/package/ilha)
[![Discord](https://img.shields.io/discord/1428724223756472373)](https://discord.gg/WnVTMCTz74)

> Alpha is live

**Ilha** is a tiny, isomorphic web UI library built around the [islands architecture](https://www.patterns.dev/vanilla/islands-architecture/) — ship minimal JavaScript, hydrate only what matters.

## Features

- **Universal rendering** — SSR, static generation, hybrid, and edge rendering out of the box
- **Fine-grained reactivity** — signal-based state with no virtual DOM and no compiler required
- **Flexible scope** — progressively enhance server-rendered HTML, or build fully self-contained apps
- **SSR + hydration** — render on the server, restore state on the client with zero flicker
- **File-system routing** — optional Vite plugin for automatic, convention-based routing
- **Shared global state** — zustand-shaped store backed by the same signal engine as the core
- **Typed forms** — schema-driven form binding with per-field error tracking and dirty state
- **Backend agnostic** — integrates with any backend; first-class Nitro and Hono support
- **Prompt-sized source** — small enough to fit the entire codebase into an AI context window
- **Type-safe by default** — first-class TypeScript support throughout

## Quick Navigation

- [Website](https://ilha.build)
- [Documentation](https://ilha.build/docs)
- [Templates](https://github.com/ilhajs/ilha/tree/main/templates)
- [Discord](https://discord.gg/WnVTMCTz74)
- [Follow us on X](https://x.com/ilha_js)

---

## Getting Started

```sh
npm install ilha
# or with Bun
bun add ilha
```

## Templates

Scaffold a project in seconds with one of the official starters:

| Template                                                                   | Command                                           | Sandbox                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| [Vite](https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/vite) | `npx giget@latest gh:ilhajs/ilha/templates/vite`  | [Open](https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/vite)  |
| [Hono](https://github.com/ilhajs/ilha/tree/main/templates/hono)            | `npx giget@latest gh:ilhajs/ilha/templates/hono`  | [Open](https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/hono)  |
| [Nitro](https://github.com/ilhajs/ilha/tree/main/templates/nitro)          | `npx giget@latest gh:ilhajs/ilha/templates/nitro` | [Open](https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/nitro) |

---

## Your First Island

Place a mount point anywhere in your HTML:

```html
<body>
  <div data-ilha="counter"></div>
</body>
```

Define your island and mount it:

```ts
import ilha, { html, mount } from "ilha";

const counter = ilha
  .state("count", 0)
  .on("[data-action=increase]@click", ({ state }) => state.count(state.count() + 1))
  .on("[data-action=decrease]@click", ({ state }) => state.count(state.count() - 1))
  .render(
    ({ state }) => html`
      <p>Count: ${state.count}</p>
      <button data-action="increase">Increase</button>
      <button data-action="decrease">Decrease</button>
    `,
  );

mount({ counter });
```

`mount()` auto-discovers every `[data-ilha]` element on the page and activates the matching island.

---

## Packages

This monorepo contains the following packages:

| Package                             | Description                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`ilha`](./packages/ilha)           | Core island builder — state, events, SSR rendering, and DOM hydration                                       |
| [`@ilha/router`](./packages/router) | Isomorphic SPA router with SSR support and a Vite file-system routing plugin                                |
| [`@ilha/store`](./packages/store)   | Zustand-shaped global store backed by alien-signals — share state across islands                            |
| [`@ilha/form`](./packages/form)     | Typed form binding via Standard Schema — submission, validation, and error state with no extra dependencies |

---

## Community

Have questions or want to share what you're building? [Join our Discord](https://discord.gg/WnVTMCTz74) to connect with other Ilha developers.

---

## License

MIT
