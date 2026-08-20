# `@ilha/astro`

An [Astro](https://astro.build) integration that renders and hydrates [Ilha](https://github.com/ilhajs/ilha) islands as Astro components.

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

Then use any Ilha island as an Astro component, with a [client directive](https://docs.astro.build/en/reference/directives-reference/#client-directives) to control hydration:

```astro
---
import { Counter } from "../islands/counter";
---

<Counter client:load start={10} />
```

## How it works

- **Server-side:** the component is rendered with [`.hydratable()`](https://github.com/ilhajs/ilha), which wraps the island's SSR output in a `[data-ilha]` element carrying serialized props and a state snapshot.
- **Client-side:** on hydration, the renderer finds that `[data-ilha]` element inside Astro's island wrapper and calls the island's own `.mount()` — no re-render, no flicker, `.onMount()` is skipped since the snapshot already matches the DOM.

Because hydration is driven entirely by Ilha's own `data-ilha-*` attributes, every [Astro client directive](https://docs.astro.build/en/reference/directives-reference/#client-directives) (`client:load`, `client:idle`, `client:visible`, `client:media`, `client:only`) works as expected.

## Notes

- Ilha islands don't support Astro's `<slot />` / children forwarding — render everything through the island's own `.render()` function and props.
- `client:only` skips SSR entirely and mounts fresh in the browser, matching Astro's usual behavior for other framework renderers.
