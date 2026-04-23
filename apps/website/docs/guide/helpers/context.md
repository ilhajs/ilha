---
title: context()
---

# Context

Creates a named global signal shared across all islands. Identical keys always return the same signal instance, making it the primary way to share reactive state between islands without prop drilling or a separate store.

## Basic usage

```ts twoslash
import { context } from "ilha";

const theme = context("app.theme", "light");

theme(); // → "light"  (read)
theme("dark"); // → sets to "dark" (write)
```

## Sharing state between islands

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

Both islands share the same `cartCount` signal. Clicking the button in `CartButton` updates the badge in `CartBadge` without any wiring between them.

## Using context in [`.bind()`](/guide/island/bind)

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

## Initializing with a type

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

## Reading context inside effects and derived

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

## SSR behavior

`context()` is safe to call during SSR. The registry is module-level, so signals persist for the lifetime of the process. In a server environment where requests share the same module instance, be careful not to store user-specific state in context signals — use [`.input()`](/guide/island/input) and [`.state()`](/guide/island/state) for per-request data instead.

## Notes

- Keys are global strings. Use namespaced keys like `"app.theme"` or `"cart.count"` to avoid accidental collisions across different parts of your app.
- There is no way to delete or reset a context signal once created short of reloading the module.
- Context signals are not included in [`.hydratable()`](/guide/island/hydratable) snapshots. If you need server-rendered context values on the client, pass them as island props via [`.input()`](/guide/island/input) and initialize the context signal inside [`.onMount()`](/guide/island/onmount).
