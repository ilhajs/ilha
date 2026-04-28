# `@ilha/store`

A zustand-shaped reactive store for [Ilha](https://github.com/ilhajs/ilha) islands. Backed by [alien-signals](https://github.com/stackblitz/alien-signals) — the same engine that powers `ilha` core state — for shared global state that lives outside any single island.

Includes a `/form` subpath with unopinionated, type-safe form helpers built on [Standard Schema](https://standardschema.dev) — works with Zod, Valibot, ArkType, or any compatible library.

---

## Installation

```bash
bun add @ilha/store
```

---

## When to Use

`ilha` state is **island-local** — signals are scoped to a single component instance. Use `@ilha/store` when you need state that is:

- **Shared across multiple islands** — e.g. a cart, auth session, or theme
- **Updated from outside an island** — e.g. from a WebSocket handler or a global event bus
- **Persisted or derived globally** — e.g. synced to `localStorage` via a `subscribe` listener
- **Form state** — pair `createStore` with `@ilha/store/form` helpers for typed validation, error mapping, and submission handling

For state that only one island reads and writes, prefer `ilha`'s built-in `.state()`.

---

## Quick Start

```ts
import { createStore } from "@ilha/store";

const store = createStore({ count: 0 });

store.setState({ count: 1 });
store.getState(); // → { count: 1 }
```

---

## API

### `createStore(initialState, actions?)`

Creates a store. Optionally accepts an actions creator for encapsulating state mutations.

```ts
// State only
const store = createStore({ count: 0, name: "Ada" });

// State + actions
const store = createStore({ count: 0 }, (set, get) => ({
  increment() {
    set({ count: get().count + 1 });
  },
  reset() {
    set({ count: 0 });
  },
}));

store.getState().increment();
store.getState().count; // → 1
```

The actions creator receives:

| Argument                | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `set(patch \| updater)` | Merge a partial patch or apply an updater function   |
| `get()`                 | Read the current live state (includes other actions) |
| `getInitialState()`     | Read the frozen initial state snapshot               |

---

### `store.setState(update)`

Merges a partial state update. Accepts a plain object or an updater function.

```ts
store.setState({ count: 5 });
store.setState((s) => ({ count: s.count + 1 }));
```

---

### `store.getState()`

Returns the current state snapshot.

```ts
store.getState(); // → { count: 5 }
```

---

### `store.getInitialState()`

Returns the frozen initial state as it was at construction time.

```ts
store.getInitialState(); // → { count: 0 }
```

---

### `store.subscribe(listener)`

Subscribes to all state changes. The listener receives the next and previous state. Returns an unsubscribe function.

```ts
const unsub = store.subscribe((state, prev) => {
  console.log(state.count, prev.count);
});

unsub(); // stop listening
```

### `store.subscribe(selector, listener)` — slice subscription

Subscribes to a derived slice. The listener only fires when the selected value changes (compared with `Object.is`).

```ts
const unsub = store.subscribe(
  (s) => s.count,
  (count, prev) => console.log("count changed:", prev, "→", count),
);
```

---

### `store.bind(el, render)`

Reactively renders a store-driven HTML string into a DOM element whenever state changes. The render function may return a plain string or an `html\`\`` tagged template.

```ts
import { html } from "ilha";

const unsub = store.bind(
  document.getElementById("counter")!,
  (state) => html`<p>Count: ${state.count}</p>`,
);

unsub(); // detach
```

### `store.bind(el, selector, render)` — slice bind

Only re-renders when the selected slice changes.

```ts
store.bind(
  document.getElementById("badge")!,
  (s) => s.count,
  (count) => html`<span>${count}</span>`,
);
```

---

## Usage with Ilha Islands

The most common pattern is reading the store inside an island's `.effect()` and calling `store.subscribe()` to drive reactive re-renders:

```ts
import { createStore } from "@ilha/store";
import ilha, { html } from "ilha";

export const cartStore = createStore({ items: [] as string[] }, (set, get) => ({
  add(item: string) {
    set({ items: [...get().items, item] });
  },
  remove(item: string) {
    set({ items: get().items.filter((i) => i !== item) });
  },
}));

export const CartIsland = ilha
  .state("items", cartStore.getState().items)
  .effect(({ state }) => {
    return cartStore.subscribe(
      (s) => s.items,
      (items) => state.items(items),
    );
  })
  .render(
    ({ state }) => html`
      <ul>
        ${state.items().map((item) => html`<li>${item}</li>`)}
      </ul>
    `,
  );
```

---

## Forms — `@ilha/store/form`

Three small helpers for building typed, validated forms with any [Standard Schema](https://standardschema.dev)-compatible library. They are **unopinionated** — you compose them with `createStore` however you like; nothing is imposed about your form's state shape.

```ts
import { extractFormData, validateWithSchema, issuesToErrors } from "@ilha/store/form";
```

### `extractFormData(source)`

Turns an `HTMLFormElement` (or a `FormData` instance) into a plain object. Handles the `string` vs `string[]` dance correctly: single fields stay scalar, repeated keys (checkbox groups, multi-selects) collapse to arrays. File inputs pass through as `File` values.

```ts
const data = extractFormData(event.target as HTMLFormElement);
// → { email: "ada@example.com", role: ["admin", "editor"] }
```

### `validateWithSchema(schema, data)`

Runs a Standard Schema synchronously and returns a discriminated union — **never throws**.

```ts
const result = validateWithSchema(SignInSchema, data);
if (result.ok) {
  result.data; // ← fully typed schema output
} else {
  result.issues; // ← ReadonlyArray<StandardSchemaV1.Issue>
}
```

If your schema has async refinements (e.g. server-side uniqueness checks), use `validateWithSchemaAsync` instead — same return shape, always returns a `Promise`.

### `issuesToErrors(issues)`

Flattens Standard Schema issues into a per-field error map keyed by dot-separated path. Form-level errors (issues with no path) land under the `""` key.

```ts
issuesToErrors([
  { message: "Required", path: ["email"] },
  { message: "Invalid", path: ["user", "email"] },
]);
// → { email: ["Required"], "user.email": ["Invalid"] }
```

---

### Full example — contact form

```ts
import { createStore } from "@ilha/store";
import { extractFormData, validateWithSchema, issuesToErrors } from "@ilha/store/form";
import type { FormErrors } from "@ilha/store/form";
import ilha, { html } from "ilha";
import { z } from "zod";

const ContactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.email("Invalid email"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

const formStore = createStore({ errors: {} as FormErrors }, (set) => ({
  submit(event: SubmitEvent) {
    const result = validateWithSchema(
      ContactSchema,
      extractFormData(event.target as HTMLFormElement),
    );
    if (result.ok) {
      console.log("submitting:", result.data);
      set({ errors: {} });
    } else {
      set({ errors: issuesToErrors(result.issues) });
    }
  },
}));

export default ilha
  .on("form@submit", ({ event }) => {
    event.preventDefault();
    formStore.getState().submit(event);
  })
  .render(() => {
    const errors = formStore.getState().errors;
    return html`
      <form>
        <label>
          Name
          <input name="name" />
          ${errors.name ? html`<p role="alert">${errors.name.join(", ")}</p>` : ""}
        </label>
        <label>
          Email
          <input name="email" type="email" />
          ${errors.email ? html`<p role="alert">${errors.email.join(", ")}</p>` : ""}
        </label>
        <label>
          Message
          <textarea name="message"></textarea>
          ${errors.message ? html`<p role="alert">${errors.message.join(", ")}</p>` : ""}
        </label>
        <button type="submit">Send</button>
      </form>
    `;
  });
```

The store holds errors, the schema drives types, and `extractFormData` + `validateWithSchema` + `issuesToErrors` form a straight pipeline from DOM to error state.

---

## TypeScript

Key exported types:

```ts
import type {
  StoreApi, // the store instance interface
  SetState, // (patch | updater) => void
  GetState, // () => T
  Listener, // (state, prevState) => void
  SliceListener, // (slice, prevSlice) => void
  RenderResult, // string | RawHtml
  Unsub, // () => void
} from "@ilha/store";

import type {
  StandardSchemaV1, // the Standard Schema spec interface
  FormResult, // discriminated union: { ok: true, data } | { ok: false, issues }
  FormErrors, // Record<string, string[]>
} from "@ilha/store/form";
```

---

## License

MIT
