---
title: Signals
description: Create free-standing reactive signals, share state across islands, batch writes, and peek at values without creating dependencies.
---

# Signals

Reactive signals are the primitive that powers state in ilha. In addition to `.state()` (local to an island), ilha exports four signal helpers for cross-island sharing, performance, and control:

| Helper      | Purpose                                                      |
| ----------- | ------------------------------------------------------------ |
| `signal()`  | Create a free-standing signal for one-off shared state       |
| `context()` | Create a named global signal accessible from anywhere by key |
| `batch()`   | Group multiple writes into a single propagation pass         |
| `untrack()` | Read a signal without subscribing the surrounding scope      |

---

## `signal(initial)`

Creates a free-standing reactive signal that lives outside any island. Useful for sharing state across multiple islands without prop drilling, or for binding form inputs to module-level state.

### Basic usage

```ts twoslash
import { signal } from "ilha";

const count = signal(0);

count(); // → 0  (read)
count(5); // → sets to 5 (write)
```

Reading the signal inside any reactive scope — `.render()`, `.derived()`, `.effect()` — automatically subscribes that scope, so when the signal changes, dependents re-run as if it were local state.

### Sharing state between islands

Because `signal()` returns a plain accessor, you can import it into any island. When one island writes to it, all others that read it re-render automatically:

```ts twoslash
import ilha, { html, signal } from "ilha";

const cartCount = signal(0);

const CartButton = ilha
  .on("button@click", () => cartCount(cartCount() + 1)) // [!code highlight]
  .render(() => html` <button>Add to cart</button> `);

const CartBadge = ilha
  // [!code highlight]
  .render(() => html`<span>${cartCount()}</span>`);
```

Both islands share the same `cartCount` signal. Clicking the button in `CartButton` updates the badge in `CartBadge` without any wiring between them.

### Using signals in [`.bind()`](/guide/island/bind)

Pass a signal directly to `.bind()` to sync a form element across islands:

```ts twoslash
import ilha, { html, signal } from "ilha";

const query = signal("");

const SearchInput = ilha
  // [!code highlight]
  .bind("input", query)
  .render(() => html`<input type="search" />`);

const SearchResults = ilha.render(() => html`<p>Results for: ${query()}</p>`);
```

---

## `context(key, initial)`

Creates a **named global signal** — a reactive signal shared across all islands. Identical keys always return the same signal instance, which makes it useful for app-wide singletons (theme, locale, current user) where you want registry semantics.

```ts twoslash
import { context } from "ilha";

const theme = context("app.theme", "light");

theme(); // → "light"
theme("dark"); // → sets to "dark"
```

### `signal()` vs `context()`

Both return the same accessor shape and can be passed to `.bind()`. Reach for `signal()` when you hold the reference yourself and import it where needed. Reach for `context()` when you want a name-keyed registry so the same signal can be looked up from anywhere by string key — for example, when the consumer lives in a different package or module from where the signal is defined.

### Sharing state between islands

Any island that calls `context()` with the same key gets the same signal. When one island writes to it, all others that read it re-render automatically:

```ts twoslash
import ilha, { html, context } from "ilha";

const cartCount = context("cart.count", 0);

const CartButton = ilha
  .on("button@click", () => cartCount(cartCount() + 1)) // [!code highlight]
  .render(() => html` <button>Add to cart</button> `);

const CartBadge = ilha
  // [!code highlight]
  .render(() => html`<span>${cartCount()}</span>`);
```

### Using context in [`.bind()`](/guide/island/bind)

Pass a context signal directly to `.bind()` to sync a form element across islands:

```ts twoslash
import ilha, { html, context } from "ilha";

const query = context("search.query", "");

const SearchInput = ilha
  // [!code highlight]
  .bind("input", query)
  .render(() => html`<input type="search" />`);

const SearchResults = ilha.render(() => html`<p>Results for: ${query()}</p>`);
```

### Initializing with a type

The second argument sets the initial value and infers the signal type. The type is fixed at first call — subsequent calls with the same key return the existing signal regardless of what initial value is passed:

```ts twoslash
import { context } from "ilha";

const count = context("ui.count", 0); // creates signal<number>
const same = context("ui.count", 999); // returns same signal, ignores 999
```

This means context initialization is effectively first-write-wins. Define context signals in a shared module to ensure consistent initialization across your app:

```ts
// contexts.ts
import { context } from "ilha";

export const theme = context("app.theme", "light");
export const userId = context("app.userId", null as string | null);
export const sidebar = context("ui.sidebar", true);
```

### Reading context inside effects and derived

Context signals are reactive — reading them inside [`.effect()`](/guide/island/effect) or [`.derived()`](/guide/island/derived) creates a dependency just like reading local state:

```ts twoslash
import ilha, { context } from "ilha";

const theme = context("app.theme", "light");

const Island = ilha
  .effect(() => {
    document.documentElement.dataset["theme"] = theme();
  })
  .render(() => `<div>content</div>`);
```

Whenever `theme` is updated anywhere in the app, this effect re-runs.

### SSR behavior

`context()` is safe to call during SSR. The registry is module-level, so signals persist for the lifetime of the process. In a server environment where requests share the same module instance, be careful not to store user-specific state in context signals — use [`.input()`](/guide/island/input) and [`.state()`](/guide/island/state) for per-request data instead.

---

## `batch(fn)`

Runs `fn` as an atomic batch — multiple signal writes inside the callback produce a single propagation pass, so dependents (effects, deriveds, island re-renders) see the final state and run once instead of once per write. Returns whatever `fn` returns.

### Before and after

Without batch, each write triggers its own propagation pass:

```ts twoslash
import { signal } from "ilha";

const a = signal(0);
const b = signal(0);

a(1); // → effects re-run
b(2); // → effects re-run again
```

With batch, both writes flush together:

```ts twoslash
import { signal, batch } from "ilha";

const a = signal(0);
const b = signal(0);

batch(() => {
  a(10);
  b(20);
}); // → effects re-run once
```

### Implicit batching

`.on()` handlers and `.effect()` runs are batched implicitly, so you only need `batch()` when triggering multiple writes from outside an island — for example from a top-level event listener, a `setTimeout` callback, or a WebSocket message handler.

### Nesting

Nested `batch()` calls are safe and only flush when the outermost batch ends:

```ts twoslash
import { signal, batch } from "ilha";

const count = signal(0);

batch(() => {
  batch(() => {
    count(1);
  }); // still inside outer batch — no flush yet
  count(2);
}); // outermost batch ends — single flush
```

---

## `untrack(fn)`

Runs `fn` with reactive tracking suspended. Reading signals inside `fn` returns their current value without subscribing the surrounding scope. Use this in effects or deriveds when you want to peek at state without causing a re-run on its changes.

### React to A, peek at B

The canonical pattern: an effect should re-run when `tracked` changes, but read `peeked` only as a one-off value:

```ts twoslash
import ilha, { signal, untrack } from "ilha";

const tracked = signal(0);
const peeked = signal("hello");

const Island = ilha
  .effect(() => {
    // Re-runs when `tracked` changes, but NOT when `peeked` changes.
    console.log(
      tracked(),
      untrack(() => peeked()),
    );
  })
  .render(() => `<p>x</p>`);
```

`untrack()` returns whatever `fn` returns, so it also works for peeking at derived values or any other reactive read:

```ts twoslash
import { signal, untrack } from "ilha";

const s = signal(42);
const value = untrack(() => s()); // → 42, no subscription created
```

---

## Notes

- `signal()` vs `context()` — both return the same accessor shape and can be passed to `.bind()`. Use `signal()` for one-off shared state where you hold the reference; use `context()` when you want a name-keyed registry.
- Keys are global strings. Use namespaced keys like `"app.theme"` or `"cart.count"` to avoid accidental collisions across different parts of your app.
- There is no way to delete or reset a context signal once created short of reloading the module.
- Context signals are not included in [`.hydratable()`](/guide/island/hydratable) snapshots. If you need server-rendered context values on the client, pass them as island props via [`.input()`](/guide/island/input) and initialize the context signal inside [`.onMount()`](/guide/island/onmount).
