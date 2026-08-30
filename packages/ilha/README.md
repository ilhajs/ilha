# `ilha`

A tiny, isomorphic island framework for building reactive UI components. Runs in the browser with fine-grained signal reactivity and on the server as a synchronous HTML string renderer. Powered by [alien-signals](https://github.com/stackblitz/alien-signals) — zero virtual DOM, no compiler required.

---

## Installation

```bash
npm install ilha
# or Bun
bun add ilha
```

---

## Quick Start

```ts
import { ilha, state, action, html, mount } from "ilha";

const Counter = ilha(() => {
  const count = state(0);

  const increment = action(() => {
    count.update((value) => value + 1);
  });

  return html`
    <div>
      <p>Count: ${count()}</p>
      <button onclick=${increment}>Increment</button>
    </div>
  `;
});

// SSR
Counter.toString(); // → '<div><p>Count: 0</p><button>Increment</button></div>'

// Client
Counter.mount(document.getElementById("app"));
```

---

## Core Concepts

Islands are **function components** that know how to render themselves to an HTML string (SSR) and mount themselves into the DOM (client). Create one by passing the component to `ilha()`.

An island reruns when a reactive value it reads during rendering changes. Reactive primitives — `state()`, `derived()`, `action()`, `effect()`, `effect.once()`, and `onError()` — are registered by call order and persist across rerenders. Declare them at the component's top level in a stable order.

### Choose the smallest component form

| Form                           | Ownership                                                           |
| ------------------------------ | ------------------------------------------------------------------- |
| `const View = () => JSX`       | The containing island owns rendering, events, and cleanup           |
| `const View = ilha(() => JSX)` | `View` owns an independent reactive scope, lifecycle, and hydration |

```tsx
const Label = ilha<{ label: string }>(({ label }) => <span>{label}</span>);
```

A plain function component stays transparent: its rendering, events, and cleanup belong to the containing island. Wrap it with `ilha()` when it needs independent ownership.

## Primitives

### `state(init?)`

Island-local reactive state. Returns a signal accessor — call it to read, use `.set()` / `.update()` to write:

```tsx
const Counter = ilha(() => {
  const count = state(0);
  return <p>{count()}</p>;
});

count(); // read
count.set(5); // write
count.update((previous) => previous + 1); // update from the latest value
```

A function argument is a lazy initializer. To store a function value, pass it to `.set`: `onSave.set(nextCallback)`.

A state initializer applies only when the instance is created. Later prop changes rerender the component but do not reset state:

```tsx
const Counter = ilha<{ start: number }>(({ start }) => {
  const count = state(start);
  return <p>{count()}</p>;
});
```

### `derived(fn)`

Compute a value from state or props. Supports synchronous values, promises, and async generators, with a built-in `{ loading, value, error }` envelope:

```tsx
const UserCard = ilha<{ userId: string }>(({ userId }) => {
  const user = derived(async ({ signal }) => {
    const res = await fetch(`/api/users/${userId}`, { signal });
    return res.json();
  });

  if (user.loading) return <p>Loading…</p>;
  if (user.error) return <p>Error: {user.error.message}</p>;
  return <p>{user()?.name}</p>;
});
```

Async generators stream: each yielded value feeds the envelope. Stale runs abort via the passed `signal`.

### `action(fn)`

Define a reusable operation with reactive execution state. Use it when you render `pending`, `data`, or `error`, or when you need unmount cancellation:

```tsx
const save = action(async (form: FormData, { signal }) => {
  const response = await fetch("/save", { method: "POST", body: form, signal });
  return response.json();
});

save(payload);
save.pending;
save.data;
save.error;
```

Direct action references work as native event handlers (`onclick={save}`). Use plain functions for ordinary operations.

### `effect(fn)` and `effect.once(fn)`

`effect()` runs a reactive side effect that reruns when its dependencies change, with cleanup before rerun and on unmount:

```tsx
const App = ilha(() => {
  effect(() => {
    document.title = count();
    return () => {
      /* cleanup */
    };
  });
  return <p>{count()}</p>;
});
```

`effect.once()` runs once after mount for one-time setup. It receives `{ host, signal, hydrated }` and supports cleanup. `effect()` and `effect.once()` are client-only; SSR never invokes them.

### `onError(fn)`

Register a per-island error handler. Context: `{ error, source, host }` with sources `"effect"`, `"once"`, `"event"`, and `"action"`. Fall back to the global [`onUncaughtError()`](#onuncaughterrorfn) for app-wide sinks.

## Typed props and validation

Pass a [Standard Schema](https://standardschema.dev)-compatible validator as the first `ilha()` argument to validate, coerce, and default props at runtime:

```tsx
import { z } from "zod";

const Greeting = ilha(z.object({ name: z.string().default("World") }), ({ name }) => (
  <p>Hello, {name}!</p>
));
```

Validation runs during SSR, hydration, mount, and prop updates.

## Composing Islands

Nest islands as JSX components. Child islands render inline during SSR and mount independently on the client — a state change in a child does not re-render the parent:

```tsx
const Badge = ilha<{ label: string }>(({ label }) => <strong>{label}</strong>);

const Page = ilha(() => <Badge label="New" />);
```

Each nested island is wrapped in a slot element (default `div`). Choose the wrapper tag with the child's `{ as }` constructor option:

```tsx
const Row = ilha(({ label }) => <li>{label}</li>, { as: "li" });
```

For keyed child islands in lists, create a keyed component with `Island.key()` before rendering it so identity — state, DOM, and focus — survives reorders:

```tsx
const Item = ilha<{ label: string }>(({ label }) => <li>{label}</li>);

const List = ilha(() => (
  <ul>
    {items.map((item) => {
      const Keyed = Item.key(item.id);
      return <Keyed label={item.label} />;
    })}
  </ul>
));
```

Keys must be unique within a parent render and cannot contain `:`.

## Island Interface

### `island.toString(props?)`

Synchronous SSR:

```ts
Counter.toString(); // → string
```

If the island declares async `derived()` values, `toString()` renders their loading state — use `await toStringAsync()` instead (a dev warning tells you when this happens).

### `await island.toStringAsync(props?)`

Async SSR — awaits async derived values and pulls the first value from async-generator derived values:

```ts
const html = await Counter.toStringAsync();
```

### `island.mount(host, props?)`

Mount into a DOM element. Returns an unmount function that stops listeners, effects, and other active behavior:

```ts
const unmount = Counter.mount(document.getElementById("app"));
```

### `await island.hydratable(props, options)`

Emit hydration markup with serialized props and an optional state snapshot. `name` must match the client registry key:

```ts
// Server
const html = await Counter.hydratable({}, { name: "Counter", snapshot: true });
```

```ts
// Client
mount({ Counter });
```

Snapshots are positional: state and derived values restore by primitive order. Malformed or incompatible snapshots are ignored safely.

### `island.key(key)`

Create a keyed child invocation for stable slot identity in lists (see [Composing Islands](#composing-islands)).

### `island.define(tagName, options?)`

Register the island as a custom element, usable from plain HTML or any framework:

```ts
Counter.define("x-counter", { observe: ["start"] });
```

## Top-level Helpers

### `mount(registry, options?)`

Auto-discover and mount `[data-ilha="Name"]` hosts:

```ts
mount({ Counter, Badge });
```

Pass `{ root, lazy }` to scope discovery to a root element or defer mounting until hosts scroll into view.

### `effect(fn)`

Run a standalone reactive effect outside any island; returns a stop function:

```ts
const stop = effect(() => {
  document.title = `${count()} items`;
});
```

Inside an island render, `effect()` registers an island effect slot instead.

### `context(key, initial)`

Get or create a keyed, app-wide shared signal:

```ts
const theme = context("app.theme", "light");
```

### `batch(fn)` / `untrack(fn)`

`batch()` groups multiple writes into one propagation pass. `untrack()` reads signals without subscribing the surrounding scope:

```ts
batch(() => {
  a(1);
  b(2);
});

const value = untrack(() => secret());
```

### `persist(accessor, key)`

Keep a standalone signal in sync with `localStorage`:

```ts
persist(cart, "cart");
```

### `onUncaughtError(fn)`

Register an app-wide error sink for islands with no local `onError()`:

```ts
const stop = onUncaughtError((error, source) => telemetry.capture(error, { source }));
```

### `html` / `raw`

`html\`…\``is an XSS-safe tagged template that accepts signals, arrays, and nested templates.`raw(str)` opts into trusted markup:

```ts
import { html, raw } from "ilha";

html`<p>${count()}</p>`;
html`<button>${raw(icon)}</button>`;
```

## Bindings

Use `bind:*` inside JSX or `html`` for two-way form synchronization:

```tsx
<input bind:value={name} />
<input type="checkbox" bind:checked={done} />
```

Supported kinds: `bind:value`, `bind:checked`, `bind:group`, `bind:open`, `bind:files`, and `bind:this`. Native event props keep modifiers `:once`, `:capture`, `:passive`, and `:abortable`.

## Security

JSX children and attributes are escaped by default. Use `raw()` only for trusted markup you control. `srcdoc` is always dropped, disallowed URL schemes are stripped, and unsafe inline styles are rejected.

## TypeScript

Configure JSX with the automatic runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "ilha"
  }
}
```

Build tools resolve `ilha/jsx-runtime` in production and `ilha/jsx-dev-runtime` in development.
