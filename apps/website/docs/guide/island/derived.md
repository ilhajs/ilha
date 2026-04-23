---
title: .derived()
description: Declare computed values that depend on state or input, with built-in loading and error envelopes.
---

# Derived

Declares a computed value that depends on state or input. Derived values can be synchronous or async, and they re-run automatically when any reactive dependency changes.

## Basic usage

```ts twoslash
import ilha, { html } from "ilha";

const UserCard = ilha
  .state("userId", 1)
  // [!code highlight:4]
  .derived("user", async ({ state, signal }) => {
    const res = await fetch(`/api/users/${state.userId()}`, { signal });
    return res.json();
  })
  .render(({ derived }) => {
    if (derived.user.loading) return `<p>Loading…</p>`;
    if (derived.user.error) return `<p>Error: ${derived.user.error.message}</p>`;
    return `<p>${derived.user.value.name}</p>`;
  });
```

## The derived envelope

Every derived value exposes three properties:

| Property  | Type                 | Description                           |
| --------- | -------------------- | ------------------------------------- |
| `loading` | `boolean`            | `true` while the function is running  |
| `value`   | `T \| undefined`     | The last successfully resolved value  |
| `error`   | `Error \| undefined` | Set if the function threw or rejected |

Always check `loading` and `error` before reading `value`. On first render, `loading` is `true` and `value` is `undefined`.

## Synchronous derived values

The function does not have to be async. If it returns a plain value, the envelope resolves immediately with `loading: false`:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .state("price", 100)
  .state("qty", 3)
  .derived("total", ({ state }) => state.price() * state.qty())
  .render(({ derived }) => `<p>Total: ${derived.total.value}</p>`);
```

## Reactive dependencies

The derived function re-runs whenever any signal it reads changes. Dependencies are tracked automatically — you do not need to declare them manually.

```ts twoslash
import ilha, { html } from "ilha";

const Search = ilha
  .state("query", "")
  .derived("results", async ({ state, signal }) => {
    const res = await fetch(`/api/search?q=${state.query()}`, { signal });
    return res.json() as Promise<string[]>;
  })
  .render(
    ({ state, derived }) => html`
      <input value="${state.query}" />
      ${derived.results.loading
        ? html`<p>Searching…</p>`
        : html`<ul>
            ${derived.results.value?.map((r) => html`<li>${r}</li>`)}
          </ul>`}
    `,
  );
```

## Abort signal

Every async derived function receives an `AbortSignal` that aborts when the function is about to re-run. Pass it to `fetch` or any other cancellable API to avoid stale responses:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .state("id", 1)
  .derived("data", async ({ state, signal }) => {
    const res = await fetch(`/api/items/${state.id()}`, { signal });
    return res.json();
  })
  .render(({ derived }) => `<p>${derived.data.value?.name ?? "…"}</p>`);
```

If the signal was already aborted before your async work completes, the result is discarded silently.

## Keeping stale value during reload

When a derived function re-runs, `loading` becomes `true` but `value` retains the previous result until the new one resolves. This lets you avoid layout shifts by showing stale content while refreshing:

```ts twoslash
import ilha, { html } from "ilha";

const Island = ilha
  .state("page", 1)
  .derived("items", async ({ state, signal }) => {
    const res = await fetch(`/api/items?page=${state.page()}`, { signal });
    return res.json() as Promise<string[]>;
  })
  .render(
    ({ state, derived }) => html`
      <ul style="opacity: ${derived.items.loading ? "0.5" : "1"}">
        ${derived.items.value?.map((i) => html`<li>${i}</li>`)}
      </ul>
      <button>Next page</button>
    `,
  );
```

## SSR behavior

During SSR, derived functions are called once. If they are async, the island awaits them before rendering when called as `await island(props)`. When called synchronously via `island.toString()`, async derived values render with `loading: true` immediately.

```ts
// Async — waits for all derived values to resolve
const html = await MyIsland({ userId: 1 });

// Sync — derived renders in loading state
const html = MyIsland.toString({ userId: 1 });
```

## Hydration snapshots

When using `.hydratable()` with `snapshot: true`, derived values are embedded in the server output and restored on the client. This means the island can render immediately on mount without re-fetching, using the server-resolved value as the initial state.

See [`.hydratable()`](/guide/island/hydratable) for full snapshot options.

## Notes

- Derived keys must be unique within the same builder chain.
- Async schemas are not supported as derived functions — the function itself can be async, but ilha[`.input()`](/guide/island/input) schemas must remain synchronous.
- Multiple derived entries are independent. Each tracks its own dependencies and re-runs on its own schedule.
