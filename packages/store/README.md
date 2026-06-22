# `@ilha/store`

Shared reactive store for [Ilha](https://github.com/ilhajs/ilha) islands — global state outside any single island, backed by [alien-signals](https://github.com/stackblitz/alien-signals) (the same engine as Ilha core).

Includes a `/form` subpath with unopinionated, type-safe form helpers built on [Standard Schema](https://standardschema.dev) — works with Zod, Valibot, ArkType, or any compatible library.

| API                            | Use in Ilha apps                                                |
| ------------------------------ | --------------------------------------------------------------- |
| **`store.count()`**            | Read state reactively inside `html\`\`` / JSX                   |
| **`store.count(5)`**           | Write state directly — goes through middleware                  |
| **`store.setState({ a, b })`** | Atomic multi-key write — one commit, one re-render              |
| **`store.doubled()`**          | Read a derived value reactively (`.loading`/`.error` for async) |
| **`store.increment()`**        | Invoke a named action                                           |
| **`store.select(s => …)`**     | Ad-hoc reactive projection (allocates a `computed`)             |
| **`store.bind(s => s.x)`**     | Two-way accessor for ilha `bind:*` directives                   |
| **`store.subscribe(…)`**       | Imperative listener outside islands                             |

---

## Installation

```bash
bun add @ilha/store ilha
```

---

## When to Use

`ilha` state is **island-local**. Use `@ilha/store` when you need state that is:

- **Shared across multiple islands** — cart, auth session, theme
- **Updated from outside an island** — WebSocket handler, global event bus
- **Persisted globally** — synced to `localStorage` via `subscribe`
- **Form state** — pair with `@ilha/store/form` helpers

For state only one island reads and writes, prefer `ilha`'s built-in `.state()`.

---

## Quick Start

```ts
import { store } from "@ilha/store";

const counterStore = store({ count: 0, label: "counter" })
  .derived("doubled", (ctx) => ctx.get().count * 2)
  .middleware((patch, ctx, next) => {
    // guard: floor count at zero
    if (patch.count !== undefined && patch.count < 0) return;
    next(patch);
  })
  .action("increment", (_, ctx) => ({ count: ctx.get().count + 1 }))
  .action("decrement", (_, ctx) => ({ count: ctx.get().count - 1 }))
  .action("setLabel", (label: string) => ({ label }))
  .on("change", (state) => {
    localStorage.setItem("counter", JSON.stringify(state));
  })
  .build();

counterStore.count(); // 0  — reactive read
counterStore.count(5); // write → goes through middleware
counterStore.doubled(); // 10 — reactive derived
counterStore.increment(); // 6
counterStore.setLabel("hits");
counterStore.setState({ count: 0, label: "reset" }); // atomic multi-key
counterStore.getState(); // { count: 0, label: "reset" }
counterStore.reset(); // restores to initial state
```

---

## API

### `store(initialState)` · `store(schema)`

Returns a `StoreBuilder`. Chain builder methods, then call `.build()` to get a live reactive store.

```ts
const s = store({ count: 0 }).build();

// explicit state type when inference is too wide
const typed = store<{ foo: string }>({ foo: "bar" }).build();
```

Pass a [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType, …) to validate **every commit** — accessor writes, `setState`, `bind:*`, and action patches. Initial state is parsed from the schema (`.default()` fields apply when seeding with `{}`).

```ts
import { z } from "zod";

const s = store(
  z.object({
    email: z.email().default(""),
    age: z.coerce.number().min(0).default(0),
  }),
)
  .onError(({ error, issues, patch }) => {
    // invalid bind / setState — state is unchanged
  })
  .build();
```

`.build()` throws if any key collides — state vs derived vs action vs built-in names (`setState`, `subscribe`, `select`, `bind`, `getState`, `getInitialState`).

---

### Builder methods

All builder methods are **immutable** — each returns a new `StoreBuilder`. The original is never mutated.

#### `.derived(key, fn)`

Registers a computed value. `fn` receives a context object; `ctx.get()` returns the current raw state.

```ts
const s = store({ price: 10, qty: 2 })
  .derived("total", (ctx) => ctx.get().price * ctx.get().qty)
  .build();

s.total(); // 20 — reactive read-only
```

Derived accessors expose an **envelope** — `()`/`.value` (current value), `.loading`, `.error`. For a synchronous derived, `.loading` is always `false` and `.error` always `undefined`, so you typically just call it.

**Async derived** — if `fn` is `async` (or returns a `Promise`), the derived runs reactively with an envelope, mirroring ilha core's `.derived()`:

```ts
const userStore = store({ id: 1 })
  .derived("user", async (ctx) => {
    const res = await fetch(`/api/users/${ctx.get().id}`, { signal: ctx.signal });
    return res.json() as Promise<User>;
  })
  .build();

userStore.user.loading; // true while fetching
userStore.user(); // User | undefined (the resolved value)
userStore.user.value; // same as user()
userStore.user.error; // Error | undefined if it rejected
```

- It **re-runs** whenever a `ctx.get()` dependency changes (e.g. `userStore.id(2)` refetches).
- Re-runs **abort** the previous run via `ctx.signal`, and stale resolutions are dropped — the last write wins.
- The previous value stays visible (`.value`) while `.loading` is `true` during a refetch.

`DerivedCtx` is `{ get(), signal }` and read-only — derived functions must stay pure (no writes).

#### `.action(key, fn)`

Registers a named mutation. `fn` receives the props and a context object. Return a `Partial` patch to merge via `setState`, or return nothing when all writes go through `ctx.set` or the action is side-effect-only.

```ts
// Zero-arg action — omit or leave first param unannotated
.action("increment", (_, ctx) => ({ count: ctx.get().count + 1 }))

// Typed props — annotate the first parameter
.action("setLabel", (label: string) => ({ label }))
```

`ActionCtx` exposes `{ get(), getInitial(), set(patch) }`:

| Member             | Use                                                          |
| ------------------ | ------------------------------------------------------------ |
| `ctx.get()`        | Read the current state snapshot                              |
| `ctx.getInitial()` | Read the initial state (e.g. for reset-style actions)        |
| `ctx.set(patch)`   | Imperative write escape hatch for async / multi-step actions |

Actions may be **async**; return `Partial<TState>`, `void`, or `Promise` of either (e.g. `return void toast.error(...)` after `await`). Patches from returned promises are applied when the promise settles; sync returns still commit immediately.

The returned patch is the primary write path. Use `ctx.set` for multi-step writes inside an async action — you can return nothing when all updates go through `ctx.set`:

```ts
.action("load", (_, ctx) => {
  ctx.set({ loading: true });
  fetchUser().then((user) => ctx.set({ user, loading: false }));
})
```

#### `.middleware(fn)`

Intercepts every state mutation before it commits. Multiple middlewares compose in **registration order**; call `next(patch)` to pass control to the next one. Applies to all write paths: accessor writes, `setState`, actions, and `bind` writes.

```ts
store({ count: 0 })
  .middleware((patch, ctx, next) => {
    console.log("before:", ctx.get().count, "→", patch.count);
    next(patch);
  })
  .middleware((patch, _ctx, next) => {
    if (patch.count !== undefined && patch.count < 0) return; // block negatives
    next(patch);
  });
```

`MiddlewareCtx` exposes `{ get(), getInitial() }`; `ctx.get()` returns the current pre-commit state.

#### `.on(event, handler)`

Registers a lifecycle listener. `handler` receives `(nextState, prevState)`.

| Event      | When it fires                                    |
| ---------- | ------------------------------------------------ |
| `"init"`   | Once, synchronously inside `.build()`            |
| `"change"` | After every committed mutation (post-middleware) |

#### `.onError(handler)`

When the store was created with a Standard Schema, invalid commits are **rejected** (state unchanged). `handler` receives `{ error, source, patch?, path?, issues?, get() }`. `error` is a `StoreValidationError` with `.issues` and `.fieldErrors`. Without `.onError()`, failures log to `console.error`.

```ts
store({ count: 0 })
  .on("init", (state) => console.log("store ready", state))
  .on("change", (state) => localStorage.setItem("s", JSON.stringify(state)))
  .build();
```

---

### Built-in store methods

#### `store.setState(patch)`

Atomic multi-key write. One commit, one `"change"` event, one re-render. Routes through middleware.

```ts
s.setState({ a: 1, b: 2 }); // single commit
```

#### `store.reset()`

Resets the store to the initial state captured at `.build()` time. Routes through middleware; fires `"change"` only if the current state differs from the initial snapshot.

```ts
s.reset();
```

#### `store.getState()` / `store.getInitialState()`

Raw `TState` snapshots — no derived values, no actions. `getInitialState()` is frozen at `.build()` time.

#### `store.subscribe(listener)` / `store.subscribe(selector, listener)`

Full-state and slice forms. Neither fires on initial subscription. Both return an unsubscribe function.

```ts
const unsub = s.subscribe((state, prev) => console.log(state, prev));
const unsub2 = s.subscribe((state) => state.count, (count, prev) => …);
unsub();
```

#### `store.select(selector)` — reactive read accessor

Projects a slice into a `() => S` signal accessor. Each call allocates a fresh `computed` — **hoist out of render functions**.

```ts
const count = s.select((st) => st.count);
count(); // reactive
```

#### `store.bind(selector)` — two-way `bind:*` accessor

Returns a read/write accessor for ilha's `bind:*` template directives. Accepts property-path selectors only (`s => s.user.name`); derived expressions throw. Writes go through middleware.

```ts
const query = s.bind((st) => st.search.query);
query(); // read — reactive
query("ilha"); // write — goes through middleware
```

---

## Usage with Ilha Islands

State and derived accessors on the built store are **signal-shaped** — they are typed as ilha `SignalAccessor` (including `.select()` on state keys) and carry `[SIGNAL_ACCESSOR]`, so they work with Areia/ilha `bind:*` props (e.g. `<Input bind:value={form.email} />`). Use them inside `.render()`, `.derived()`, and `.effect()` without extra wrappers.

```ts
import { store } from "@ilha/store";
import ilha, { html } from "ilha";

const cartStore = store({ items: [] as string[] })
  .action("add", (item: string, ctx) => ({ items: [...ctx.get().items, item] }))
  .action("remove", (item: string, ctx) => ({ items: ctx.get().items.filter((i) => i !== item) }))
  .derived("count", (ctx) => ctx.get().items.length)
  .build();

// State and derived read directly as signal accessors — no .select() needed
export const CartBadge = ilha.render(() => html`<span>${cartStore.count()}</span>`);

export const CartList = ilha.render(
  () =>
    html`<ul>
      ${cartStore.items().map((item) => html`<li>${item}</li>`)}
    </ul>`,
);
```

Both islands stay in sync. `CartBadge` re-renders only when `count` changes; `CartList` only when `items` changes.

### `.select()` — for ad-hoc projections

Use `.select()` when you need a projection that isn't worth a named `.derived()`. Hoist the call outside the render callback — each `.select()` allocates a `computed`.

```ts
const evenCount = cartStore.select((s) => s.items.length % 2 === 0);

// inside island:
ilha.render(() => html`<p>${evenCount()}</p>`);
```

### `bind:*` for form fields

```ts
const searchStore = store({ query: "", open: false }).build();

ilha.render(
  () => html`
    <dialog bind:open=${searchStore.bind((s) => s.open)}>
      <input bind:value=${searchStore.bind((s) => s.query)} />
    </dialog>
  `,
);
```

---

## Forms — `@ilha/store/form`

```ts
import { extractFormData, validateWithSchema, issuesToErrors } from "@ilha/store/form";
```

### `extractFormData(source)` → `Record<string, unknown>`

Turns an `HTMLFormElement` or `FormData` into a plain object. Single fields stay scalar; repeated keys collapse to arrays; file inputs pass through as `File` values.

### `validateWithSchema(schema, data)` → `FormResult<T>`

Runs a Standard Schema synchronously. Never throws. Returns `{ ok: true, data }` or `{ ok: false, issues }`. Use `validateWithSchemaAsync` for async schemas.

### `issuesToErrors(issues)` → `FormErrors`

Flattens Standard Schema issues into a `Record<string, string[]>` keyed by dot-separated path. Form-level errors (no path) land under `""`.

### `preventDefault(fn)` → handler

Wraps an ilha `.on()` callback so `event.preventDefault()` runs first, then your function receives the same context (`event`, `state`, `target`, …).

### Full example

```ts
import { store } from "@ilha/store";
import {
  extractFormData,
  validateWithSchema,
  issuesToErrors,
  preventDefault,
} from "@ilha/store/form";
import type { FormErrors } from "@ilha/store/form";
import ilha, { html } from "ilha";
import { z } from "zod";

const ContactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.email("Invalid email"),
});

const formStore = store({ errors: {} as FormErrors })
  .action("submit", (event: SubmitEvent) => {
    const result = validateWithSchema(
      ContactSchema,
      extractFormData(event.target as HTMLFormElement),
    );
    return { errors: result.ok ? {} : issuesToErrors(result.issues) };
  })
  .build();

export default ilha
  .on(
    "form@submit",
    preventDefault(({ event }) => formStore.submit(event)),
  )
  .render(
    () => html`
      <form>
        <input name="name" />
        ${formStore.errors().name ? html`<p role="alert">${formStore.errors().name![0]}</p>` : ""}
        <input name="email" type="email" />
        ${formStore.errors().email ? html`<p role="alert">${formStore.errors().email![0]}</p>` : ""}
        <button type="submit">Send</button>
      </form>
    `,
  );
```

---

## TypeScript

```ts
import type {
  StoreBuilder, // the builder type
  BuiltStore, // the built store type
  StateAccessor, // <T>: () => T and (value: T) => void
  DerivedAccessor, // envelope accessor: () => T | undefined, .loading, .value, .error
  DerivedValue, // { loading, value, error } — the derived envelope
  DerivedCtx, // { get(), signal } — passed to .derived()
  ActionCtx, // { get(), getInitial(), set() } — passed to .action()
  MiddlewareCtx, // { get(), getInitial() } — passed to .middleware()
  StoreBindable, // <S>: read/write accessor for bind:*
  Listener, // (state, prevState) => void
  SliceListener, // (slice, prevSlice) => void
  Unsub, // () => void
} from "@ilha/store";

import type {
  FormResult, // { ok: true, data } | { ok: false, issues }
  FormErrors, // Record<string, string[]>
} from "@ilha/store/form";
```

---

## License

MIT
