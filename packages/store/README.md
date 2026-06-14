# `@ilha/store`

Shared reactive store for [Ilha](https://github.com/ilhajs/ilha) islands — global state outside any single island, backed by [alien-signals](https://github.com/stackblitz/alien-signals) (the same engine as Ilha core).

Includes a `/form` subpath with unopinionated, type-safe form helpers built on [Standard Schema](https://standardschema.dev) — works with Zod, Valibot, ArkType, or any compatible library.

| API                  | Use in Ilha apps                                                      |
| -------------------- | --------------------------------------------------------------------- |
| **`select`**         | Read-only slices in `html\`\`` / JSX — lists, labels, derived display |
| **`bind(selector)`** | Two-way `bind:value`, `bind:checked`, `bind:open`, etc.               |
| **`subscribe`**      | Side effects outside islands — `localStorage`, WebSockets, analytics  |

---

## Installation

Ilha apps already depend on `ilha`; add the store alongside it:

```bash
bun add @ilha/store ilha
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

For consuming a store inside an island, jump to [Usage with Ilha Islands](#usage-with-ilha-islands).

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

Actions are merged onto the same object as state (`store.getState().increment()`). Use **`select` / `bind` only on data fields** — not on action methods. For example, `store.bind((s) => s.count)` is valid; `store.bind((s) => s.increment)` is not (functions are not bindable paths).

---

### `store.setState(update)`

Merges a partial state update. Accepts a plain object or an updater function.

```ts
store.setState({ count: 5 });
store.setState((s) => ({ count: s.count + 1 }));
```

---

### `store.getState()`

Returns the current state snapshot. Non-reactive — use `select` for reactive reads inside an island.

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

### `store.select(selector)` — reactive accessor

Projects a slice of state into a **signal-shaped accessor**: a `() => S` function that reads the current value when called, and tracks reactivity automatically inside any ilha tracking scope (`.render()`, `.derived()`, `.effect()`).

```ts
const store = createStore({ count: 0, name: "Ada" });

const count = store.select((s) => s.count);
const name = store.select((s) => s.name);

count(); // → 0    (read)
store.setState({ count: 5 });
count(); // → 5    (reflects the change)
```

The returned accessor has the same shape as `signal()` and `context()` from `ilha` core, so it composes naturally with `html\`\`` interpolation. See [Usage with Ilha Islands](#usage-with-ilha-islands) below for the full pattern.

The slice is memoized — accessors only notify dependents when the selected value changes (compared with `Object.is`). Setting `count` to its current value, or mutating an unrelated field, does not trigger downstream re-runs.

> **Hoist `select` calls out of render functions.** Each call allocates a fresh `computed`. Define selectors at module scope or inside an island's closure setup — not inside the `.render()` callback itself.

---

### `store.subscribe(listener)`

Subscribes to all state changes. The listener receives the next and previous state. Returns an unsubscribe function. Use this for **imperative** subscriptions outside an island scope (e.g. a WebSocket handler, `localStorage` sync); inside an island, prefer `select`.

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

### `store.bind(selector)` — two-way fields for `bind:*`

Returns a **read/write accessor** for a property path in store state, compatible with Ilha's template `bind:*` syntax (`bind:value`, `bind:checked`, `bind:open`, and so on). Use this for form fields and toggles that must update the store when the user interacts with the DOM.

`select()` stays **read-only** — use it for derived values and list rendering inside `html\`\``.

```ts
const searchStore = createStore({
  search: { query: "", open: false },
  results: [] as string[],
});

const query = searchStore.bind((s) => s.search.query);
const open = searchStore.bind((s) => s.search.open);
const results = searchStore.select((s) => s.results);

// In an island:
// <dialog bind:open={open}><input bind:value={query} /></dialog>
```

- **Read:** `query()` — reactive inside `.render()`, `.derived()`, and `.effect()`.
- **Write:** `query("ilha")` — immutably updates `search.query` in the store.

Only **property-path** selectors are supported (`s => s.user.name`, `s => s.items[0].title`). Derived expressions (`s => s.query.trim()`, `s => s.a + s.b`) throw at accessor creation time.

Render store-driven UI with **`select` + islands**, not by writing into arbitrary DOM nodes. `@ilha/store` does not morph HTML outside Ilha's render pipeline.

---

## Usage with Ilha Islands

`select` returns the same `() => T` accessor shape as `signal()` and `context()` from `ilha` core. That means store-backed state composes with islands the same way context signals do — read it inside `html\`\``and the surrounding render scope subscribes automatically. No`.effect()`plumbing, no manual`subscribe` wiring.

```ts
import { createStore } from "@ilha/store";
import ilha, { html } from "ilha";

const cartStore = createStore({ items: [] as string[] }, (set, get) => ({
  add(item: string) {
    set({ items: [...get().items, item] });
  },
  remove(item: string) {
    set({ items: get().items.filter((i) => i !== item) });
  },
}));

const items = cartStore.select((s) => s.items);
const itemCount = cartStore.select((s) => s.items.length);

export const CartBadge = ilha.render(() => html`<span>${itemCount()}</span>`);

export const CartList = ilha.render(
  () => html`
    <ul>
      ${items().map((item) => html`<li>${item}</li>`)}
    </ul>
  `,
);
```

Both islands stay in sync automatically. `CartBadge` only re-renders when `items.length` changes; `CartList` only re-renders when the array itself changes.

### Inside `.derived()` and `.effect()`

`select` accessors work in any tracking scope — the same dependency tracking that powers `.state()` reads applies:

```ts
const userStore = createStore({ id: 1, name: "Ada" });
const userId = userStore.select((s) => s.id);

const Profile = ilha
  .derived("user", async ({ signal }) => {
    const res = await fetch(`/api/users/${userId()}`, { signal });
    return res.json();
  })
  .effect(() => {
    document.title = `User: ${userStore.select((s) => s.name)()}`;
    //                ^ inline is fine here — `.effect()` runs once per dep change,
    //                  not on every render. For hot paths, hoist the `select`.
  })
  .render(({ derived }) => html`<p>${derived.user()?.name ?? "…"}</p>`);
```

When `userId()` changes, the derived re-fetches automatically.

### When to use `select`, `bind`, or `subscribe`

| Use `select`                            | Use `bind(selector)`                            | Use `subscribe`                                  |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| Read-only slices in `html\`\``          | Two-way `bind:*` on inputs, checkboxes, dialogs | Imperative side effects outside an island        |
| Lists and derived display data          | `bind:value`, `bind:checked`, `bind:open`, etc. | Syncing to `localStorage`, WebSockets, analytics |
| `.derived()` / `.effect()` dependencies | Hoist accessors at module scope like `select`   | Non-reactive listeners outside islands           |

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

const errors = formStore.select((s) => s.errors);

export default ilha
  .on("form@submit", ({ event }) => {
    event.preventDefault();
    formStore.getState().submit(event);
  })
  .render(
    () => html`
      <form>
        <label>
          Name
          <input name="name" />
          ${errors().name ? html`<p role="alert">${errors().name.join(", ")}</p>` : ""}
        </label>
        <label>
          Email
          <input name="email" type="email" />
          ${errors().email ? html`<p role="alert">${errors().email.join(", ")}</p>` : ""}
        </label>
        <label>
          Message
          <textarea name="message"></textarea>
          ${errors().message ? html`<p role="alert">${errors().message.join(", ")}</p>` : ""}
        </label>
        <button type="submit">Send</button>
      </form>
    `,
  );
```

The store holds errors, the schema drives types, and `extractFormData` + `validateWithSchema` + `issuesToErrors` form a straight pipeline from DOM to error state. The `errors` accessor is reactive — when `submit` writes new errors, the island re-renders automatically.

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
  StoreBindable, // read/write accessor from bind(selector)
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
