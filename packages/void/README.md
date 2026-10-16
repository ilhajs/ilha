# `@ilha/void`

Render [Void](https://void.cloud) pages, layouts, forms, and islands with [Ilha](https://github.com/ilhajs/ilha). Void handles file routing, loaders, actions, and deployment. `@ilha/void` renders each page with `renderToString()` and hydrates it with `mount()`.

---

## Installation

```bash
bun add @ilha/void
```

`ilha`, `vite`, and `void` are peer dependencies. Void needs Node.js 24.21 or newer.

---

## Usage

Add `voidIlha()` after `voidPlugin()` in your Vite config:

```ts
// vite.config.ts
import { voidIlha } from "@ilha/void/plugin";
import { defineConfig } from "vite";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [voidPlugin(), voidIlha()],
});
```

Set `jsxImportSource` to `ilha` in `tsconfig.json`. Each file in `pages/` default-exports an Ilha component whose props come from the page's loader:

```tsx
// pages/index.tsx
import { Link } from "@ilha/void";

export default function Home({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
      <Link href="/about" prefetch>
        About
      </Link>
    </main>
  );
}
```

Name a page `*.island.tsx` for static HTML, and import components `with { island: "visible" }` to hydrate only those.

Scaffold an app with `npx giget@latest gh:ilhajs/ilha/templates/void`.

---

## Exports

| Import path | Exports |
| --- | --- |
| `@ilha/void` | `Link`, `Form`, `useForm`, `useIslandForm`, `useParams`, `useShared`, `useNavigation`, `useRouter`, `action` |
| `@ilha/void/plugin` | `voidIlha()` |

Docs: [ilha.build/guide/void](https://ilha.build/guide/void)
