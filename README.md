<div align="center">

# Ilha

### The tiny, isomorphic UI library for interactive islands

Build reactive components once. Render them on the server, mount them in the browser, and ship JavaScript only where it earns its place.

[![Continuous Integration](https://github.com/ilhajs/ilha/actions/workflows/ci.yml/badge.svg)](https://github.com/ilhajs/ilha/actions/workflows/ci.yml) [![NPM Version](https://img.shields.io/npm/v/ilha)](https://www.npmjs.com/package/ilha) ![Minified + gzip size](https://badgen.net/bundlephobia/minzip/ilha) [![Discord](https://img.shields.io/discord/1428724223756472373)](https://discord.gg/WnVTMCTz74)

[Website](https://ilha.build) · [Documentation](https://ilha.build/guide/getting-started/introduction) · [Quick start](#quick-start) · [Templates](#start-from-a-template) · [LLM docs](https://ilha.build/llms.txt) · [Discord](https://discord.gg/WnVTMCTz74)

</div>

> **Beta:** Ilha is ready to try, but its API may still evolve before 1.0.

## Why Ilha?

Most UI frameworks hydrate an application. Ilha hydrates **only the components that need to be interactive**.

- **Tiny by architecture** — static HTML stays static. Your users download code for active regions, not an entire page.
- **No virtual DOM** — atoms drive local updates and Ilha morphs the existing DOM in place.
- **No compiler required** — standard JSX/TSX, or `h()` when you cannot use JSX.
- **One component, every environment** — the same function renders on the server, mounts in the browser, and hydrates in place.
- **A consistent SSR story** — `renderToString()` waits until idle, then serializes HTML and an optional atom snapshot.
- **Progressive by default** — add one component to server-rendered HTML or compose a complete SPA. You choose the boundary.
- **Small API, strong TypeScript** — function components, `atom()`, `watch()`, `when`, and JSX.
- **Backend and runtime agnostic** — web platform primitives and ESM, so it fits existing servers, edge runtimes, static sites, and browsers.

Because Ilha sends only the interactive parts of a page, real applications can ship **around 5× less client JavaScript than whole-page hydration**. The exact result depends on your component boundaries and dependencies—measure your production bundle, not the slogan.

## Ilha vs. full-app frameworks

|  | Ilha | Typical full-app hydration |
| --- | --- | --- |
| Client boundary | Each interactive component | The application root |
| Update model | Atoms + direct DOM morphing | Virtual DOM reconciliation |
| Server and client component | The same function | Often separate execution constraints |
| SSR API | `renderToString()` | Framework-specific renderer |
| Hydration | Explicit, local, snapshot-aware | Usually application-wide |
| Compiler | Optional | Often required for best results |
| Adoption | One component or a complete app | Usually controls the application |

Ilha is not trying to be a batteries-included platform. It is the small rendering and reactivity layer you can bring to the stack you already have.

## Quick start

```sh
npm install ilha effect
```

`effect` is a peer dependency.

Configure JSX once:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "ilha"
  }
}
```

Write a component:

```tsx
import { atom } from "ilha";

export const Counter = ({ start = 0 }: { start?: number }) => {
  const count = atom(start);

  return (
    <button
      type="button"
      onclick={() => count.update((value: number) => value + 1)}
    >
      Count: {count}
    </button>
  );
};
```

### Mount it in the browser

```ts
import { mount } from "ilha";
import { Counter } from "./counter";

mount(document.getElementById("app")!, () => Counter({ start: 0 }));
```

### Render it on the server

```ts
import { renderToString } from "ilha";
import { Counter } from "./counter";

const html = await renderToString(() => Counter({ start: 10 }));
```

### Render now, hydrate later

```ts
import { mount, renderToString } from "ilha";
import { Counter } from "./counter";

const html = await renderToString(() => Counter({ start: 10 }));

const host = document.querySelector("[data-ilha]");
if (host) mount(host, () => Counter({ start: 10 }), { hydrate: true });
```

No duplicate template. No separate client component. No hydration flicker.

## A small reactive toolbox

```tsx
import { atom, batch, watch, when, mount, renderToString, h } from "ilha";
```

| Export             | Use it for                                          |
| ------------------ | --------------------------------------------------- |
| `atom()`           | Component-local reactive slots                      |
| `batch()`          | Coalesce multiple atom writes                       |
| `watch()`          | Side effects on atom or stream changes              |
| `when()`           | Per-emission generator body (interrupts stale work) |
| `mount()`          | Activate a component in the DOM                     |
| `renderToString()` | Serialize a component to HTML                       |
| `h` / `Fragment`   | JSX factory                                         |

Ordinary event handlers stay ordinary functions (`onclick={handler}`). Lists are Streams of data, not atoms of JSX.

## Built for the web you already have

### Add components to any server-rendered page

Emit a `data-ilha` host, load your client module, and call `mount()`. Ilha does not require control over your backend or document.

### Build an isomorphic SPA

[`@ilha/router`](https://ilha.build/guide/routing/overview) adds file-system routing for Vite and Rsbuild, nested layouts, and Oxide server islands.

### Use Ilha inside Astro

[`@ilha/astro`](https://ilha.build/guide/astro) turns Ilha components into first-class Astro islands with `client:load`, `client:idle`, `client:visible`, `client:media`, and `client:only`.

## Start from a template

| Template | Create | Try it |
| --- | --- | --- |
| [Vite SPA](https://github.com/ilhajs/ilha/tree/main/templates/vite-spa) | `npx giget@latest gh:ilhajs/ilha/templates/vite-spa` | [StackBlitz](https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/vite-spa) |
| [Oxide SPA](https://github.com/ilhajs/ilha/tree/main/templates/oxide-spa) | `npx giget@latest gh:ilhajs/ilha/templates/oxide-spa` | [StackBlitz](https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/oxide-spa) |

## Packages

| Package | What it does |
| --- | --- |
| [`ilha`](./packages/ilha) | Components, atoms, JSX runtime, SSR, hydration, and DOM morphing |
| [`@ilha/router`](./packages/router) | Isomorphic SPA routing, file-system routes, and Oxide server islands |
| [`@ilha/astro`](./packages/astro) | Astro renderer (`renderToString` + `mount`) |

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
