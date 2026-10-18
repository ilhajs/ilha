# `@ilha/devtools`

Inspect live [Ilha](https://github.com/ilhajs/ilha) islands from a panel, a browser agent, or a test. Built on [Devframe](https://devfra.me).

---

## Installation

```bash
bun add -d @ilha/devtools
```

`ilha` and `effect` are peer dependencies.

---

## Usage

Start the page script in development. It answers panels and agents for this page.

```ts
// entry.client.ts
import { installIlhaDevtools } from "@ilha/devtools/page";

if (import.meta.env.DEV) {
  const devtools = installIlhaDevtools();
  // Open the panel in a popup that can find this page.
  // devtools.openPanel();
}
```

Serve the panel with any Devframe adapter. With Vite:

```ts
// vite.config.ts
import { devframeVitePlugin } from "@devframes/vite/single";
import { ilhaDevtools } from "@ilha/devtools";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [devframeVitePlugin(ilhaDevtools)],
});
```

The panel lives at `/__ilha-devtools/`.

---

## What the page exposes

| Function | Arguments | Returns |
| --- | --- | --- |
| `inspect` | none | Trees of every live island (JSON) |
| `highlight` | `id` or `null` | Whether the component has a box to outline |
| `setAtom` | `id`, `index`, JSON `value` | `{ ok: true }` or `{ ok: false, reason }` |

Each function carries Devframe `agent` metadata. When the browser provides WebMCP, `installIlhaDevtools()` also registers them as `ilha_inspect`, `ilha_highlight`, and `ilha_set_atom`. Pass `{ webmcp: false }` to skip that.

The `tree` shared state mirrors `inspect()` as panels connect and as islands change.

See the [devtools guide](https://ilha.build/guide/devtools) for details.
