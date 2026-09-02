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

In JSX, `{count}` subscribes the render. Derived values use Effect's `Atom.map` or `Atom.transform`:

```tsx
import * as Atom from "effect/unstable/reactivity/Atom";
import { atom } from "ilha";

const items = atom([{ n: 1 }, { n: 2 }]);
const total = atom(Atom.map(items.atom, (list) => list.reduce((sum, item) => sum + item.n, 0)));
```

Wrap multiple writes in `batch()`. Derived and mutation atoms use Effect's `Atom.map`, `Atom.transform`, and `Atom.fn` — pass `handle.atom`, then wrap in `atom()`. Use `watch(source, fn)` for side effects on atom changes.

Use `atom.lazy(() => …)` for one-time initialization or to store a function value.

Atoms hold data. Do not store JSX in an atom.

---

## Streams and when

Paint [Effect `Stream`](https://www.effect.website/docs/v4/api/effect/Stream) values. Yield a stream of views from a generator, or return one from an async component:

```tsx
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import { atom } from "ilha";

function* List() {
  const items = atom(["a", "b"]);
  yield Stream.map(Atom.toStream(items.atom), (list) => (
    <ul>
      {list.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ));
}
```

SSR takes the first emission (`take(1)`); the client keeps listening after `mount`.

Ilha also ships `when` for per-emission generator bodies (stale work interrupted). Side effects and pauses use Effect directly — see the [Streams guide](https://ilha.build/guide/ui/streams).

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

`renderToString` builds HTML without a DOM — no polyfill in Node, Bun, or edge runtimes.

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
