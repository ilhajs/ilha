# Ilha

**Ilha** is a tiny, yet powerful web UI library built around the [islands architecture](https://www.patterns.dev/vanilla/islands-architecture/) — ship minimal JavaScript, hydrate only what matters.

## Features

- **Universal rendering** — SSR, static generation, hybrid, and edge rendering out of the box
- **Flexible scope** — write simple islands to progressively enhance HTML, or build fully self-contained apps
- **Backend agnostic** — integrates with any backend framework
- **Prompt-sized source** — small enough to fit the entire source into an AI context window
- **Type-safe by default** — first-class TypeScript support throughout
- **Vanilla TS utilities** — extra libraries to write cleaner, framework-free TypeScript
- **Template starters** — hit the ground running with Vite, Hono, or Nitro templates

## Quick Navigation

- [Website](#)
- [Documentation](#)
- [Tutorial](#)
- [Templates](#)
- [Discord](#)
- [Follow us on X](https://x.com)

## Getting Started

```sh
npm install ilha
# or with Bun
bun add ilha
```

## Templates

| Stack | Command                                           | Sandbox                                                                              | Directory                                                                    |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Vite  | `npx giget@latest gh:ilhajs/ilha/templates/vite`  | [Start Sandbox](https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/vite)  | [/templates/vite](https://github.com/ilhajs/ilha/tree/main/templates/vite)   |
| Hono  | `npx giget@latest gh:ilhajs/ilha/templates/hono`  | [Start Sandbox](https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/hono)  | [/templates/hono](https://github.com/ilhajs/ilha/tree/main/templates/hono)   |
| Nitro | `npx giget@latest gh:ilhajs/ilha/templates/nitro` | [Start Sandbox](https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/nitro) | [/templates/nitro](https://github.com/ilhajs/ilha/tree/main/templates/nitro) |

## Your First Island

Place a mount point anywhere in your HTML:

```html
<body>
  <div data-ilha="counter"></div>
</body>
```

Then define and mount your island:

```ts
import ilha, { html, mount } from "ilha";

const counter = ilha
  .state("count", 0)
  .on("[data-action=increase]@click", ({ state }) => state.count(state.count() + 1))
  .on("[data-action=decrease]@click", ({ state }) => state.count(state.count() - 1))
  .render(
    ({ state }) => html`
      <p>Count: ${state.count()}</p>
      <button data-action="increase">Increase</button>
      <button data-action="decrease">Decrease</button>
    `,
  );

mount({ counter });
```

## Documentation

Full docs available at [ilha.build/docs](https://ilha.build/docs).

## Community

Have questions or want to share what you're building? [Join our Discord server](https://discord.gg/WnVTMCTz74) to connect with other Ilha developers.
