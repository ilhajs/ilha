# `@ilha/astro`

An [Astro](https://astro.build) integration that renders and hydrates [Ilha](https://github.com/ilhajs/ilha) components as Astro islands.

---

## Installation

```bash
bun add @ilha/astro
```

---

## Usage

```ts
// astro.config.mjs
import { defineConfig } from "astro/config";
import ilha from "@ilha/astro";

export default defineConfig({
  integrations: [ilha()],
});
```

When you use multiple JSX frameworks, restrict each integration to its own files:

```ts
export default defineConfig({
  integrations: [ilha({ include: ["**/ilha/**"] })],
});
```

You can also pass `exclude` globs. Files outside the filter remain available to other Astro JSX renderers.

Then use any Ilha component as an Astro component, with a [client directive](https://docs.astro.build/en/reference/directives-reference/#client-directives) to control hydration:

```astro
---
import { Counter } from "../islands/counter";
---

<Counter client:load start={10} />
```

## How it works

- **Server-side:** the renderer calls `renderToString()`, which wraps output in a `[data-ilha]` element with a state snapshot.
- **Client-side:** the renderer finds that host inside Astro's island wrapper and calls `mount(..., { hydrate: true })`.

Every [Astro client directive](https://docs.astro.build/en/reference/directives-reference/#client-directives) (`client:load`, `client:idle`, `client:visible`, `client:media`, `client:only`) works as expected.

## Notes

- Astro slots arrive as string children. Plain text renders; HTML in slot content is escaped — don't pass markup through slots.
- `client:only` skips SSR and mounts fresh in the browser.
