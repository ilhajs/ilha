# `ilha`

A tiny, isomorphic UI library. You write a function component, declare `atom()` values, and render with JSX. Runs in the browser with signal reactivity and on the server as HTML. Powered by [Effect](https://effect.website) — no virtual DOM, no compiler.

---

## Installation

```bash
npm install ilha effect
# or Bun
bun add ilha effect
```

`effect` is a peer dependency.

---

## Quick start

```tsx
import { atom, mount } from "ilha";

const Counter = () => {
  const count = atom(0);
  return (
    <button type="button" onclick={() => count.update((n: number) => n + 1)}>
      Count: {count}
    </button>
  );
};

mount(document.getElementById("app")!, Counter);
```

A **component** is a function, async function, or generator that returns a view. Nested functions share the parent fiber. `mount` / `renderToString` on a function makes it a root.

---

## Atoms

```tsx
import { atom } from "ilha";

const count = atom(0);
count(); // read
count.set(1); // replace
count.update((n) => n + 1); // patch
```

In JSX, `{count}` subscribes the render. A function initializer is a **computed** atom:

```tsx
const items = atom([{ n: 1 }, { n: 2 }]);
const total = atom(() => items().reduce((sum, item) => sum + item.n, 0));
```

Atoms hold data. Do not store JSX in an atom.

---

## Streams, when, watch, wait

Use a generator when you `yield*` instructions.

```tsx
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import { atom, when } from "ilha";

const Search = function* () {
  const q = atom("");
  yield (
    <input value={q} oninput={(e: Event) => q.set((e.currentTarget as HTMLInputElement).value)} />
  );
  yield* when(Atom.toStream(q.atom).pipe(Stream.debounce("200 millis")), function* (query) {
    if (!query) return;
    yield <p>{query}</p>;
  });
};
```

- `when(stream, body)` — render `body` for each value (SSR takes the first).
- `watch(source, fn)` — side effect on an atom or Stream.
- `wait(body)` — paint until `done(value)`, then continue the generator.

Map a Stream of arrays to JSX for lists (`Stream.map`, `Atom.toStream`).

---

## SSR

```tsx
import { atom, renderToString, mount } from "ilha";

const Counter = () => {
  const count = atom(0);
  return <p>{count}</p>;
};

const html = await renderToString(Counter);
// <div data-ilha data-ilha-state="…"><p>0</p></div>

const host = document.querySelector("[data-ilha]");
if (host) mount(host, Counter, { hydrate: true });
```

| Option           | Default | Meaning                        |
| ---------------- | ------- | ------------------------------ |
| `snapshot`       | `true`  | Embed atom values              |
| `markers`        | `true`  | Wrap in `<div data-ilha>`      |
| `timeout`        | none    | Serialize after this many ms   |
| `captureActions` | `false` | Probe handlers for server RPCs |

In Node, `renderToString` registers happy-dom when `document` is missing.

---

## JSX

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "ilha"
  }
}
```

Event props are lowercase (`onclick`, `onchange`). Use `class`, not `className`. Use `h()` when you cannot use JSX.

---

## Custom elements

```ts
import { atom } from "ilha";
import { define } from "ilha/define";

define("ilha-counter", () => {
  const count = atom(0);
  return (
    <button type="button" onclick={() => count.update((n: number) => n + 1)}>
      {count}
    </button>
  );
});
```

```html
<ilha-counter data-ilha></ilha-counter>
```

---

## Routing and Astro

- [`@ilha/router`](https://github.com/ilhajs/ilha/tree/main/packages/router) — file-system SPA routes and Oxide server islands.
- [`@ilha/astro`](https://github.com/ilhajs/ilha/tree/main/packages/astro) — Astro renderer (`renderToString` + `mount`).

Docs: [ilha.build](https://ilha.build)

---

## License

MIT
