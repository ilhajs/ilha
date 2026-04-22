---
title: .state()
---

Declares a reactive signal local to the island. State is the primary way to store values that change over time and drive re-renders.

## Basic usage

```ts twoslash
import ilha, { html } from "ilha";

const Counter = ilha
  .state("count", 0)
  .on("button@click", ({ state }) => state.count(state.count() + 1))
  .render(
    ({ state }) => html`
      <div>
        <p>Count: ${state.count}</p>
        <button>Increment</button>
      </div>
    `,
  );
```

## Reading and writing

Each state entry becomes a signal accessor — a function that both reads and writes depending on how it is called:

```ts
state.count(); // read → returns current value
state.count(5); // write → sets value to 5
```

When a signal is written, the island re-renders automatically. Only the affected island updates — nothing outside it is touched.

## Initializing from input

The initial value can be a static value or a function that receives the resolved input:

```ts twoslash
import ilha from "ilha";
import { z } from "zod";

const Counter = ilha
  .input(z.object({ start: z.number().default(0) }))
  .state("count", ({ start }) => start)
  .render(({ state }) => `<p>${state.count()}</p>`);
```

This is evaluated once at mount time. The initializer is not reactive — it only runs when the island is first created.

## Multiple state entries

Chain `.state()` as many times as needed. Each key becomes a typed accessor on the `state` object:

```ts twoslash
import ilha from "ilha";

const Form = ilha
  .state("name", "")
  .state("submitted", false)
  .state("count", 0)
  .render(({ state }) => `<p>${state.name()} — ${state.count()}</p>`);
```

## Inside `html\`\``

Signal accessors can be interpolated directly into `html\`\`` without calling them. ilha detects signal accessors and calls them automatically, and applies HTML escaping:

```ts twoslash
import ilha, { html } from "ilha";

const island = ilha
  .state("label", "<b>hello</b>")
  .render(({ state }) => html`<p>${state.label}</p>`);
//                                   ^^^^^^^^^^^ no () needed, value is escaped
```

If you call `state.label()` explicitly it works the same way — both forms are equivalent inside `html\`\``.

## Updating state from events

State accessors are plain functions, so they work directly as setters inside event handlers:

```ts twoslash
import ilha, { html } from "ilha";

const Toggle = ilha
  .state("open", false)
  .on("button@click", ({ state }) => state.open(!state.open()))
  .render(
    ({ state }) => html`
      <div>
        ${state.open() ? html`<p>Content</p>` : ""}
        <button>${state.open() ? "Close" : "Open"}</button>
      </div>
    `,
  );
```

## Sharing state across islands

State declared with `.state()` is local to one island. If you need to share a value across multiple islands, use [`context()`](/guide/helpers/context) instead, which creates a named global signal.

## Notes

- State keys must be unique within the same builder chain.
- The initial value type inferred from the second argument becomes the permanent type of the accessor. Passing a value of a different type later will cause a TypeScript error.
- State is not persisted between page loads unless you use `.hydratable()` with `snapshot: true` on the server side.
