<div align="center">

# Ilha

### The tiny, isomorphic UI library for interactive islands

Build reactive components once. Render them on the server, mount them in the browser, and ship JavaScript only where it earns its place.

[![Continuous Integration](https://github.com/ilhajs/ilha/actions/workflows/ci.yml/badge.svg)](https://github.com/ilhajs/ilha/actions/workflows/ci.yml)
[![NPM Version](https://img.shields.io/npm/v/ilha)](https://www.npmjs.com/package/ilha)
![Minified + gzip size](https://badgen.net/bundlephobia/minzip/ilha)
[![Discord](https://img.shields.io/discord/1428724223756472373)](https://discord.gg/WnVTMCTz74)

[Website](https://ilha.build) · [Documentation](https://ilha.build/guide/getting-started/introduction) · [Quick start](#quick-start) · [Templates](#start-from-a-template) · [LLM docs](https://ilha.build/llms.txt) · [Discord](https://discord.gg/WnVTMCTz74)

</div>

> **Beta:** Ilha is ready to try, but its API may still evolve before 1.0.

## Why Ilha?

Most UI frameworks hydrate an application. Ilha hydrates **only the components that need to be interactive**.

- **Tiny by architecture** — static HTML stays static. Your users download code for active islands, not an entire page.
- **No virtual DOM** — signals drive local updates and Ilha morphs the existing DOM in place.
- **No compiler required** — use standard JSX/TSX, or the `html\`\`` helper without JSX.
- **One component, every environment** — the same island renders on the server, mounts in the browser, and hydrates in place.
- **A consistent SSR story** — synchronous HTML, awaited async HTML, and hydratable output are explicit methods on every island.
- **Progressive by default** — add one island to server-rendered HTML or compose a complete SPA. You choose the boundary.
- **Small API, strong TypeScript** — function components, typed props, signals, derived values, effects, and tracked actions.
- **Backend and runtime agnostic** — Ilha uses web platform primitives and ESM, so it fits existing servers, edge runtimes, static sites, and browsers.

Because Ilha sends only the interactive parts of a page, real applications can ship **around 5× less client JavaScript than whole-page hydration**. The exact result depends on your component boundaries and dependencies—measure your production bundle, not the slogan.

## Ilha vs. full-app frameworks

|                             | Ilha                              | Typical full-app hydration           |
| --------------------------- | --------------------------------- | ------------------------------------ |
| Client boundary             | Each interactive island           | The application root                 |
| Update model                | Signals + direct DOM morphing     | Virtual DOM reconciliation           |
| Server and client component | The same function                 | Often separate execution constraints |
| SSR API                     | `.toString()`, `.toStringAsync()` | Framework-specific renderer          |
| Hydration                   | Explicit, local, snapshot-aware   | Usually application-wide             |
| Compiler                    | Optional                          | Often required for best results      |
| Adoption                    | One component or a complete app   | Usually controls the application     |

Ilha is not trying to be a batteries-included platform. It is the small rendering and reactivity layer you can bring to the stack you already have.

## Quick start

```sh
npm install ilha
```

Configure JSX once:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "ilha"
  }
}
```

Create an island:

```tsx
import { ilha, state } from "ilha";

export const Counter = ilha<{ start?: number }>(({ start = 0 }) => {
  const count = state(start);

  return (
    <button type="button" onclick={() => count((value) => value + 1)}>
      Count: {count()}
    </button>
  );
});
```

### Mount it in the browser

```html
<div data-ilha="Counter"></div>
```

```ts
import { mount } from "ilha";
import { Counter } from "./counter";

mount({ Counter });
```

`mount()` discovers every matching `[data-ilha]` host and activates it.

### Render it on the server

```ts
const html = Counter.toString({ start: 10 });
const asyncHtml = await Counter.toStringAsync({ start: 10 });
```

### Render now, hydrate later

```ts
// Server: HTML + serialized props + optional reactive snapshot
const html = await Counter.hydratable({ start: 10 }, { name: "Counter", snapshot: true });

// Client: restores the snapshot and activates the existing DOM
mount({ Counter });
```

No duplicate template. No separate client component. No hydration flicker.

## A small reactive toolbox

```tsx
import { action, derived, effect, ilha, onError, state } from "ilha";
```

| Primitive       | Use it for                                                     |
| --------------- | -------------------------------------------------------------- |
| `state()`       | Local signal state                                             |
| `derived()`     | Synchronous, promise, or async-generator derived values        |
| `action()`      | Operations that need reactive pending, result, error, or abort |
| `effect()`      | Side effects driven by reactive values                         |
| `effect.once()` | One-time DOM setup with automatic cleanup                      |
| `onError()`     | Island-local error handling                                    |

Ordinary event handlers stay ordinary functions. Reach for `action()` only when the UI needs operation state or cancellation.

## Built for the web you already have

### Add islands to any server-rendered page

Emit a `data-ilha` host, load your client module, and call `mount()`. Ilha does not require control over your backend or document.

### Build an isomorphic SPA

[`@ilha/router`](https://ilha.build/guide/routing/overview) adds signal-driven navigation, loaders, nested layouts, file-system routing for Vite and Rsbuild, and selective server islands.

### Use Ilha inside Astro

[`@ilha/astro`](https://ilha.build/guide/astro) turns Ilha components into first-class Astro islands with `client:load`, `client:idle`, `client:visible`, `client:media`, and `client:only`.

## Start from a template

| Template                                                                  | Create                                                | Try it                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Vite SPA](https://github.com/ilhajs/ilha/tree/main/templates/vite-spa)   | `npx giget@latest gh:ilhajs/ilha/templates/vite-spa`  | [StackBlitz](https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/vite-spa)  |
| [Oxide SPA](https://github.com/ilhajs/ilha/tree/main/templates/oxide-spa) | `npx giget@latest gh:ilhajs/ilha/templates/oxide-spa` | [StackBlitz](https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/oxide-spa) |

## Packages

| Package                             | What it does                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| [`ilha`](./packages/ilha)           | Islands, signals, JSX runtime, SSR, hydration, DOM morphing, and lifecycle   |
| [`@ilha/router`](./packages/router) | Isomorphic SPA routing, loaders, file-system routes, SSR, and server islands |
| [`@ilha/astro`](./packages/astro)   | Astro renderer integration and client-directive hydration                    |

## Documentation for humans and agents

- Read the [documentation](https://ilha.build/guide/getting-started/introduction).
- Give an AI coding tool the compact [`llms.txt`](https://ilha.build/llms.txt).
- Use [`llms-full.txt`](https://ilha.build/llms-full.txt) when it needs the complete documentation in one file.

## Community

Have a question or built something with Ilha? [Join Discord](https://discord.gg/WnVTMCTz74), [follow Ilha on X](https://x.com/ilha_js), or open an issue.

## Contributors

<a href="https://github.com/ilhajs/ilha/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ilhajs/ilha" alt="Ilha contributors" />
</a>

## License

[MIT](./LICENSE)
