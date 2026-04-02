---
title: Ilha
description: Tiny, framework-free island architecture library
base: /docs/
logo:
  src: PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDI0IiBoZWlnaHQ9IjEwMjQiIGZpbGw9Im5vbmUiPjxkZWZzPjxjbGlwUGF0aCBpZD0iYSIgY2xhc3M9ImZyYW1lLWNsaXAgZnJhbWUtY2xpcC1kZWYiPjxyZWN0IHdpZHRoPSIxMDI0IiBoZWlnaHQ9IjEwMjQiIHJ4PSIwIiByeT0iMCIvPjwvY2xpcFBhdGg+PC9kZWZzPjxnIGNsYXNzPSJmcmFtZS1jb250YWluZXItd3JhcHBlciI+PGcgY2xhc3M9ImZyYW1lLWNvbnRhaW5lci1ibHVyIj48ZyBjbGFzcz0iZnJhbWUtY29udGFpbmVyLXNoYWRvd3MiIGNsaXAtcGF0aD0idXJsKCNhKSI+PGcgY2xhc3M9ImZpbGxzIj48cmVjdCB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiBjbGFzcz0iZnJhbWUtYmFja2dyb3VuZCIgcng9IjAiIHJ5PSIwIi8+PC9nPjxnIGNsYXNzPSJmcmFtZS1jaGlsZHJlbiI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJiIiB4MT0iMCIgeDI9IjEiIHkxPSIuNSIgeTI9Ii41Ij48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMyZDYxZmYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyOGJmZmYiLz48L2xpbmVhckdyYWRpZW50PjxwYXR0ZXJuIGlkPSJjIiB3aWR0aD0iNTY0LjkiIGhlaWdodD0iNTY0LjkiIHg9Ijg4LjQiIHk9IjIyOS42IiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNMCAwaDU2NXY1NjVIMHoiIHN0eWxlPSJmaWxsOnVybCgjYikiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSI1NjQuOSIgaGVpZ2h0PSI1NjQuOSIgeD0iODguNCIgeT0iMjI5LjYiIGZpbGw9InVybCgjYykiIGNsYXNzPSJmaWxscyIgcng9IjgwIiByeT0iODAiIHRyYW5zZm9ybT0icm90YXRlKDQ1IDM3MSA1MTIpIi8+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJkIiB4MT0iMCIgeDI9IjEiIHkxPSIuNSIgeTI9Ii41Ij48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMyOGJmZmYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyZDYxZmYiLz48L2xpbmVhckdyYWRpZW50PjxwYXR0ZXJuIGlkPSJlIiB3aWR0aD0iNTY0LjkiIGhlaWdodD0iNTY0LjkiIHg9IjM3MC44IiB5PSIyMjkuNiIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMGg1NjV2NTY1SDB6IiBzdHlsZT0iZmlsbDp1cmwoI2QpIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iNTY0LjkiIGhlaWdodD0iNTY0LjkiIHg9IjM3MC44IiB5PSIyMjkuNiIgZmlsbD0idXJsKCNlKSIgY2xhc3M9ImZpbGxzIiByeD0iODAiIHJ5PSI4MCIgdHJhbnNmb3JtPSJyb3RhdGUoNDUgNjUzIDUxMikiLz48L2c+PC9nPjwvZz48L2c+PC9zdmc+
footer:
  text: Copyright © %YEAR% ilha
---

# Ilha

> A tiny, framework-agnostic **island** library for building interactive UI components with SSR, hydration, signals-based reactivity.

## Overview

Ilha lets you define **islands** — self-contained interactive components that:

- Render to plain HTML strings on the **server** (SSR).
- **Hydrate** and become reactive on the **client**.
- Track fine-grained reactive state via signals (powered by `alien-signals`).
- Use a fluent, immutable **builder API** — no decorators, no compilers, no virtual DOM.

Each island is just a plain function that returns an HTML string plus a `mount()` method for client-side activation.

---

## Installation

```bash
npm install ilha
# or
bun add ilha
```

Ilha uses [alien-signals](https://github.com/stackblitz/alien-signals) internally and accepts any [Standard Schema v1](https://standardschema.dev/) compliant schema library for input validation (e.g. Zod, Valibot, ArkType).

---

## Core Concepts

| Concept        | Description                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| **Island**     | A component definition produced by `.render()`. Callable as a function (SSR) or via `.mount()` (client). |
| **Input**      | Validated external props passed when calling or mounting an island. Defined with `.input(schema)`.       |
| **State**      | Reactive signal values local to each mounted instance. Defined with `.state(key, init)`.                 |
| **Derived**    | Computed values (sync or async) that update automatically when state changes.                            |
| **Effect**     | Side-effect that runs on the client when reactive state it reads changes.                                |
| **OnMount**    | Callback that runs once when the island is mounted on the client.                                        |
| **Bind**       | Two-way data binding between a form element and a state signal or external signal.                       |
| **Slot**       | A composable child island injected at render time.                                                       |
| **Transition** | Optional `enter`/`leave` hooks for animated mount/unmount.                                               |
| **Context**    | Global shared reactive signals across islands, identified by a string key.                               |

---

## API Reference

### ilha (default export)

The root builder object. All builder methods are available directly on it. It also exposes utility functions as properties:

```ts
import ilha, { html, raw, mount, from, context, type } from "ilha";
```

| Property       | Type            | Description                                                    |
| -------------- | --------------- | -------------------------------------------------------------- |
| `ilha.html`    | tagged template | XSS-safe HTML template tag (same as the `html` named export)   |
| `ilha.raw`     | function        | Bypass escaping for trusted HTML (same as `raw`)               |
| `ilha.mount`   | function        | Auto-discover and mount all `[data-ilha]` elements             |
| `ilha.from`    | function        | Mount an island onto a single element by selector or reference |
| `ilha.context` | function        | Create or retrieve a global shared signal                      |

---

### .input()

Attach a [Standard Schema v1](https://standardschema.dev/) schema to validate and type external props.

```ts
ilha.input(schema);
```

| Parameter | Type               | Description                                                   |
| --------- | ------------------ | ------------------------------------------------------------- |
| `schema`  | `StandardSchemaV1` | Any Standard Schema v1 compatible schema (Zod, Valibot, etc.) |

**Returns** a new builder with `TInput` typed to the schema's output.  
Calling `.input()` resets all previously accumulated state, derived, and event definitions — use it as the **first** call in the chain.

```ts
import { z } from "zod";

const counter = ilha
  .input(z.object({ count: z.number().default(0) }))
  .render(({ input }) => `<p>${input.count}</p>`);
```

If invalid props are provided at call-time or mount-time, ilha throws:

```
[ilha] Validation failed:
  - Expected number, received string
```

---

### .state()

Define a reactive signal for local island state.

```ts
.state(key, init?)
```

| Parameter | Type                          | Description                                                |
| --------- | ----------------------------- | ---------------------------------------------------------- |
| `key`     | `string`                      | Name of the state slot                                     |
| `init`    | `V \| ((input: TInput) => V)` | Initial value or factory function receiving resolved input |

**Returns** a new builder with the state key added to `TStateMap`.

- `init` can be a plain value (e.g. `0`, `"hello"`, `[]`) or a function that receives the resolved input.
- State signals are available in `render`, `effect`, `onMount`, `on` handlers, and `derived` functions as `state.key` — a **signal accessor** that reads (`state.key()`) and writes (`state.key(newValue)`) the signal.

```ts
const counter = ilha
  .input(z.object({ count: z.number().default(0) }))
  .state("count", ({ count }) => count) // initialized from input
  .state("step", 1) // plain value
  .render(({ state }) => `<p>${state.count()}</p>`);
```

---

### .derived()

Compute a value from state and/or input. Re-computed whenever its reactive dependencies change.

```ts
.derived(key, fn)
```

| Parameter | Type                                         | Description                    |
| --------- | -------------------------------------------- | ------------------------------ |
| `key`     | `string`                                     | Name of the derived value      |
| `fn`      | `(ctx: DerivedFnContext) => V \| Promise<V>` | Sync or async factory function |

**`DerivedFnContext`:**

| Property | Type                     | Description                                               |
| -------- | ------------------------ | --------------------------------------------------------- |
| `state`  | `IslandState<TStateMap>` | All state signal accessors                                |
| `input`  | `TInput`                 | Resolved input props                                      |
| `signal` | `AbortSignal`            | Aborted when state changes or island unmounts (for async) |

**Returns** a new builder with the derived key added to `TDerivedMap`.

In `render`, derived values are accessed via `derived.key` which is a `DerivedValue<V>`:

```ts
interface DerivedValue<T> {
  loading: boolean; // true while async fn is pending
  value: T | undefined;
  error: Error | undefined;
}
```

**Sync derived:**

```ts
const island = ilha
  .state("n", 4)
  .derived("doubled", ({ state }) => state.n() * 2)
  .render(({ derived }) => `<p>${derived.doubled.value}</p>`);
```

**Async derived with stale-while-revalidate:**

```ts
const island = ilha
  .state("query", "hello")
  .derived("results", async ({ state, signal }) => {
    const res = await fetch(`/search?q=${state.query()}`, { signal });
    return res.json();
  })
  .render(({ derived }) =>
    derived.results.loading
      ? `<p>Loading... (prev: ${derived.results.value ?? "none"})</p>`
      : `<p>${JSON.stringify(derived.results.value)}</p>`,
  );
```

> **Note:** When state changes, the previous async result is preserved in `value` while `loading` is `true` (stale-while-revalidate pattern). The `AbortSignal` is aborted for superseded requests.

---

### .on()

Attach a DOM event handler to elements within the island. **No-op during SSR.**

```ts
.on(selectorOrCombined, handler)
```

**Combined `@`-syntax (recommended):**

```
"[selector]@eventName[:modifier[:modifier]]"
```

| Part         | Description                                                                     |
| ------------ | ------------------------------------------------------------------------------- |
| `[selector]` | CSS selector for target elements inside the island root. Omit for root element. |
| `@eventName` | Any `HTMLElementEventMap` event name (e.g. `click`, `keydown`, `input`)         |
| `:modifier`  | Optional: `once`, `capture`, `passive`                                          |

```ts
ilha
  .state("count", 0)
  .on("[data-inc]@click", ({ state }) => state.count(state.count() + 1))
  .on("[data-inc]@click:once", ({ state }) => console.log("first click"))
  .on("@click", ({ state }) => console.log("root clicked")) // no selector = root
  .render(({ state }) => `<p>${state.count()}</p><button data-inc>+</button>`);
```

**Handler context:**

| Property | Type                                        | Description                         |
| -------- | ------------------------------------------- | ----------------------------------- |
| `state`  | `IslandState<TStateMap>`                    | State signal accessors              |
| `input`  | `TInput`                                    | Resolved input props                |
| `host`   | `Element`                                   | The island root element             |
| `target` | `Element`                                   | The element that received the event |
| `event`  | Typed event (e.g. `MouseEvent` for `click`) | The DOM event                       |

**Modifiers:**

| Modifier  | Equivalent `addEventListener` option |
| --------- | ------------------------------------ |
| `once`    | `{ once: true }`                     |
| `capture` | `{ capture: true }`                  |
| `passive` | `{ passive: true }`                  |

Multiple modifiers can be chained: `@click:once:passive`.

---

### .effect()

Register a reactive side-effect that runs on the client whenever its reactive dependencies change.

```ts
.effect(fn)
```

| Parameter | Type                                           | Description                                    |
| --------- | ---------------------------------------------- | ---------------------------------------------- |
| `fn`      | `(ctx: EffectContext) => (() => void) \| void` | Effect function; may return a cleanup function |

**`EffectContext`:**

| Property | Type                     | Description             |
| -------- | ------------------------ | ----------------------- |
| `state`  | `IslandState<TStateMap>` | State signal accessors  |
| `input`  | `TInput`                 | Resolved input props    |
| `host`   | `Element`                | The island root element |

- Effects are **no-ops during SSR**.
- The returned cleanup function is called before the effect re-runs or on unmount.

```ts
ilha
  .state("count", 0)
  .effect(({ state, host }) => {
    document.title = `Count: ${state.count()}`;
    return () => {
      document.title = "";
    }; // cleanup
  })
  .render(({ state }) => `<p>${state.count()}</p>`);
```

---

### .onMount()

Register a callback that runs once when the island is mounted on the client.

```ts
.onMount(fn)
```

| Parameter | Type                                            | Description                                                     |
| --------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `fn`      | `(ctx: OnMountContext) => (() => void) \| void` | Mount callback; may return a cleanup function called on unmount |

**`OnMountContext`:**

| Property   | Type                         | Description                                                     |
| ---------- | ---------------------------- | --------------------------------------------------------------- |
| `state`    | `IslandState<TStateMap>`     | State signal accessors                                          |
| `derived`  | `IslandDerived<TDerivedMap>` | Derived value proxies                                           |
| `input`    | `TInput`                     | Resolved input props                                            |
| `host`     | `Element`                    | The island root element                                         |
| `hydrated` | `boolean`                    | `true` when the island was restored from a server-side snapshot |

```ts
ilha
  .state("open", false)
  .onMount(({ state, host, hydrated }) => {
    if (!hydrated) state.open(true);
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") state.open(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  })
  .render(({ state }) => `<div>${state.open() ? "Visible" : "Hidden"}</div>`);
```

---

### .bind()

Two-way binding between a form input element and a state signal (or external signal).

```ts
.bind(selector, stateKey)
.bind(selector, externalSignal)
```

| Parameter        | Type                       | Description                                                                   |
| ---------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `selector`       | `string`                   | CSS selector for target input inside the island. Empty string = root element. |
| `stateKey`       | `keyof TStateMap & string` | Name of an existing state key to bind                                         |
| `externalSignal` | `ExternalSignal<T>`        | An external `context()` signal or any `{ (): T; (v: T): void }`               |

Automatically detects the correct DOM event and property:

| Element type           | Event    | Property            |
| ---------------------- | -------- | ------------------- |
| `input[type=checkbox]` | `change` | `checked`           |
| `input[type=radio]`    | `change` | `checked` / `value` |
| `input[type=number]`   | `input`  | `valueAsNumber`     |
| `select`               | `change` | `value`             |
| All others             | `input`  | `value`             |

```ts
ilha
  .state("name", "")
  .bind("[data-name]", "name")
  .render(
    ({ state }) => `
    <input data-name value="${state.name()}" />
    <p>Hello, ${state.name()}!</p>
  `,
  );
```

---

### .slot()

Register a child island as a named slot, accessible in the render function.

```ts
.slot(name, island)
```

| Parameter | Type     | Description         |
| --------- | -------- | ------------------- |
| `name`    | `string` | Slot name           |
| `island`  | `Island` | Any island instance |

In `render`, `slots.name` is a **`SlotAccessor`** — a function that renders the child island to an HTML string and can receive props:

```ts
const badge = ilha
  .input(z.object({ label: z.string().default("") }))
  .render(({ input }) => `<span class="badge">${input.label}</span>`);

const card = ilha.slot("badge", badge).render(
  ({ slots }) => `
    <div class="card">
      ${slots.badge({ label: "New" })}
    </div>
  `,
);
```

`SlotAccessor` can be passed to `html\`\`` template directly and renders unescaped.

---

### .transition()

Define enter/leave animation hooks for mount and unmount.

```ts
.transition(options)
```

| Option  | Type                                       | Description                          |
| ------- | ------------------------------------------ | ------------------------------------ |
| `enter` | `(host: Element) => void \| Promise<void>` | Called right after mounting          |
| `leave` | `(host: Element) => void \| Promise<void>` | Called before teardown; may be async |

If `leave` returns a `Promise`, teardown (event listener removal, effect cleanup) is deferred until the promise resolves.

```ts
ilha
  .transition({
    enter: (host) => host.animate([{ opacity: 0 }, { opacity: 1 }], 200).finished,
    leave: (host) => host.animate([{ opacity: 1 }, { opacity: 0 }], 200).finished,
  })
  .render(() => `<div>Animated</div>`);
```

---

### .render()

Finalise the builder and produce an `Island`. **Must be called last.**

```ts
.render(fn): Island<TInput, TStateMap>
```

| Parameter | Type                             | Description                       |
| --------- | -------------------------------- | --------------------------------- |
| `fn`      | `(ctx: RenderContext) => string` | Function returning an HTML string |

**`RenderContext`:**

| Property  | Type                         | Description            |
| --------- | ---------------------------- | ---------------------- |
| `state`   | `IslandState<TStateMap>`     | State signal accessors |
| `derived` | `IslandDerived<TDerivedMap>` | Derived value proxies  |
| `input`   | `TInput`                     | Resolved input props   |
| `slots`   | `SlotsProxy<TSlots>`         | Named slot accessors   |

---

### Island — calling / SSR

The object returned by `.render()` is callable as a function for server-side rendering:

```ts
const html = island(props?)           // returns string (SSR)
const html = island.toString(props?)  // same, explicit
`<section>${island}</section>`        // implicit toString, uses schema defaults
```

| Parameter | Description                                                       |
| --------- | ----------------------------------------------------------------- |
| `props`   | Optional `Partial<TInput>`. If omitted, schema defaults are used. |

- `.on()` handlers and `.effect()` callbacks are **ignored** during SSR.
- `derived()` functions that return a `Promise` will show `loading: true` in SSR unless `.hydratable()` is used with `snapshot: { derived: true }`.
- Throws `[ilha] Validation failed` if props fail schema validation.

---

### island.mount()

Activate an island on a DOM element for client-side reactivity.

```ts
const unmount = island.mount(host, props?)
```

| Parameter | Type              | Description                                                                                    |
| --------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `host`    | `Element`         | The root DOM element for this island instance                                                  |
| `props`   | `Partial<TInput>` | Optional props. Falls back to `data-ilha-props`, then `data-ilha-state`, then schema defaults. |

**Returns** an `unmount` function. Calling it:

- Removes all event listeners registered via `.on()`.
- Cancels and cleans up all `.effect()` subscriptions.
- Aborts any pending async derived fetches.
- Awaits the `.transition({ leave })` hook before teardown.

**Prop resolution priority (highest → lowest):**

1. Explicit `props` argument to `mount()`
2. `data-ilha-state` attribute (server-side state snapshot)
3. `data-ilha-props` attribute (set by `hydratable()`)
4. Schema defaults

---

### island.hydratable()

Render the island as an HTML string **wrapped in a hydration container** for seamless SSR → client handoff.

```ts
const html = await island.hydratable(props, options);
```

| Parameter | Type                | Description               |
| --------- | ------------------- | ------------------------- |
| `props`   | `Partial<TInput>`   | Props to render with      |
| `options` | `HydratableOptions` | Configuration (see below) |

**`HydratableOptions`:**

| Option        | Type                                                | Default                     | Description                                                              |
| ------------- | --------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `name`        | `string`                                            | _(required)_                | Identifier matching the key in the `mount()` registry                    |
| `as`          | `string`                                            | `"div"`                     | Wrapper HTML tag                                                         |
| `snapshot`    | `boolean \| { state?: boolean; derived?: boolean }` | `false`                     | Embed state/derived snapshot so client can skip redundant initialisation |
| `skipOnMount` | `boolean`                                           | `true` when snapshot active | Suppress `.onMount()` handlers on the client when snapshot is present    |

**Output** is a `Promise<string>` of the form:

```html
<div data-ilha="counter" data-ilha-props='{"count":7}'>
  <p>7</p>
</div>
```

With `snapshot: true`:

```html
<div
  data-ilha="counter"
  data-ilha-props="..."
  data-ilha-state='{"count":7,"_derived":{...},"_skipOnMount":true}'
>
  <p>7</p>
</div>
```

The client calls `mount({ counter })` to automatically discover and hydrate all `[data-ilha="counter"]` elements.

---

### mount()

Auto-discover all `[data-ilha]` elements in the DOM and mount registered islands.

```ts
const { unmount } = mount(registry, options?)
```

| Parameter      | Type                     | Description                                                                   |
| -------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `registry`     | `Record<string, Island>` | Map of island name → island instance                                          |
| `options.root` | `Element`                | Scope discovery to this element's subtree (default: `document.body`)          |
| `options.lazy` | `boolean`                | Use `IntersectionObserver` to mount islands only when they enter the viewport |

**Returns** `{ unmount: () => void }` that tears down all discovered instances.

```ts
import { mount } from "ilha";
import { counter } from "./islands/counter";
import { dropdown } from "./islands/dropdown";

const { unmount } = mount({ counter, dropdown });

// Tear everything down:
unmount();
```

Malformed `data-ilha-props` JSON is handled gracefully (logs a warning, skips the element).

---

### from()

Mount a single island onto a CSS selector or Element reference.

```ts
const unmount = from(selector, island, props?)
```

| Parameter  | Type                | Description                        |
| ---------- | ------------------- | ---------------------------------- |
| `selector` | `string \| Element` | CSS selector string or DOM element |
| `island`   | `Island`            | Island to mount                    |
| `props`    | `Partial<TInput>`   | Optional props                     |

**Returns** an `unmount` function, or `null` if the selector does not match any element (and logs a warning).

```ts
import { from } from "ilha";

const unmount = from("#my-counter", counter, { count: 10 });
```

---

### context()

Create or retrieve a **globally shared reactive signal** identified by a string key.

```ts
const signal = context(key, initial);
```

| Parameter | Type     | Description                                          |
| --------- | -------- | ---------------------------------------------------- |
| `key`     | `string` | Unique string key for the context                    |
| `initial` | `T`      | Initial value (used only on first call for this key) |

**Returns** a signal accessor `{ (): T; (value: T): void }`.

- Calling `context()` with the same key always returns the **same signal**, regardless of `initial` value on subsequent calls.
- All islands that read the signal will re-render when it is written.

```ts
import { context } from "ilha";

const theme = context("theme", "light");

// Read
theme(); // "light"

// Write (triggers re-renders in all subscribed islands)
theme("dark");
```

---

### html\`\` tagged template

XSS-safe HTML template literal tag that auto-escapes interpolated values.

```ts
import { html } from "ilha";

html`<p>${userContent}</p>`;
```

**Interpolation behaviour:**

| Value type                  | Behaviour                                      |
| --------------------------- | ---------------------------------------------- |
| `string`, `number`          | HTML-escaped                                   |
| `null`, `undefined`         | Omitted (empty string)                         |
| `raw(...)` object           | Inserted **unescaped**                         |
| `SlotAccessor`              | Rendered via `.toString()`, inserted unescaped |
| Signal accessor (`state.x`) | Reads the signal, HTML-escapes the result      |
| Function `() => string`     | Called and result is HTML-escaped              |

Also strips common leading indentation from multiline templates (dedent).

```ts
const template = html`
  <div class="card">
    <h2>${title}</h2>
    ${raw("<em>trusted</em>")}
  </div>
`;
```

---

### raw()

Mark a string as trusted HTML to bypass `html\`\`` escaping.

```ts
raw(value: string): RawHtml
```

Only use `raw()` with HTML you control — it disables XSS protection.

```ts
html`<div>${raw("<strong>trusted bold</strong>")}</div>`;
// → "<div><strong>trusted bold</strong></div>"
```

---

### type()

Create a minimal, passthrough Standard Schema v1 schema with optional coercion. Useful when you want to type island input without a full validation library.

```ts
type<TInput, TOutput = TInput>(coerce?: (input: TInput) => TOutput): StandardSchemaV1
```

```ts
import { type } from "ilha";

const myIsland = ilha
  .input(type<{ count?: number }>((v) => ({ count: v.count ?? 0 })))
  .render(({ input }) => `<p>${input.count}</p>`);
```

---

## TypeScript Types

### Key exported types

```ts
import type {
  Island,
  IslandState,
  IslandDerived,
  DerivedValue,
  SlotAccessor,
  SignalAccessor,
  HydratableOptions,
  MountOptions,
  MountResult,
  HandlerContext,
  HandlerContextFor,
  OnMountContext,
} from "ilha";
```

| Type                                               | Description                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `Island<TInput, TStateMap>`                        | An island instance (callable + `.mount()` + `.hydratable()`)             |
| `IslandState<TStateMap>`                           | Map of signal accessors: `{ [K]: SignalAccessor<TStateMap[K]> }`         |
| `IslandDerived<TDerivedMap>`                       | Map of derived value proxies: `{ [K]: DerivedValue<TDerivedMap[K]> }`    |
| `DerivedValue<T>`                                  | `{ loading: boolean; value: T \| undefined; error: Error \| undefined }` |
| `SignalAccessor<T>`                                | `{ (): T; (value: T): void }` — reads or writes a signal                 |
| `SlotAccessor`                                     | A `(props?) => RawHtml` function representing a composable slot          |
| `HydratableOptions`                                | Options for `.hydratable()`                                              |
| `MountOptions`                                     | `{ root?: Element; lazy?: boolean }`                                     |
| `MountResult`                                      | `{ unmount: () => void }`                                                |
| `OnMountContext<TInput, TStateMap, TDerivedMap>`   | Context provided to `.onMount()`                                         |
| `HandlerContext<TInput, TStateMap>`                | Context provided to `.on()` handlers                                     |
| `HandlerContextFor<TInput, TStateMap, TEventName>` | `.on()` context with typed `event` based on event name                   |

---

## Hydration & SSR Workflow

### 1. Server — render with `hydratable()`

```ts
// server.ts
import { counter } from "./islands/counter";

const html = await counter.hydratable({ count: 0 }, { name: "counter" });
// Produces: <div data-ilha="counter" data-ilha-props='{"count":0}'><p>0</p></div>
```

### 2. Client — mount with auto-discovery

```ts
// client.ts
import { mount } from "ilha";
import { counter } from "./islands/counter";

document.addEventListener("DOMContentLoaded", () => {
  const { unmount } = mount({ counter });
});
```

### 3. With state snapshot (skip re-fetch on hydration)

```ts
// server.ts
const html = await counter.hydratable({ count: 42 }, { name: "counter", snapshot: true });
// Embeds data-ilha-state with current signal values so the client
// skips initialisation and .onMount() runs with hydrated: true
```

---

## Data Attributes Reference

These attributes are used internally by Ilha for hydration. You can also set them manually on server-rendered HTML.

| Attribute                  | Set by                     | Purpose                                                              |
| -------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `data-ilha="<name>"`       | `hydratable()`             | Island name for auto-discovery by `mount()`                          |
| `data-ilha-props='<json>'` | `hydratable()`             | Serialised input props for the island                                |
| `data-ilha-state='<json>'` | `hydratable({ snapshot })` | State/derived snapshot for hydration; skips redundant initialisation |
| `data-ilha-slot="<name>"`  | internal (slots)           | Marks a slot element on re-render for morphing stability             |

---

## Examples

### Counter

```ts
import { z } from "zod";
import ilha, { html } from "ilha";

export const counter = ilha
  .input(z.object({ count: z.number().default(0) }))
  .state("count", ({ count }) => count)
  .on("[data-inc]@click", ({ state }) => state.count(state.count() + 1))
  .on("[data-dec]@click", ({ state }) => state.count(state.count() - 1))
  .render(
    ({ state }) => html`
      <div>
        <button data-dec>−</button>
        <span>${state.count}</span>
        <button data-inc>+</button>
      </div>
    `,
  );
```

### Async search with loading state

```ts
export const search = ilha
  .state("query", "")
  .derived("results", async ({ state, signal }) => {
    const q = state.query();
    if (!q) return [];
    const res = await fetch(`/api/search?q=${q}`, { signal });
    return res.json() as Promise<string[]>;
  })
  .bind("[data-q]", "query")
  .render(
    ({ state, derived }) => html`
      <input data-q value="${state.query}" placeholder="Search…" />
      ${derived.results.loading
        ? raw(`<p>Loading…</p>`)
        : raw(`<ul>${(derived.results.value ?? []).map((r) => `<li>${r}</li>`).join("")}</ul>`)}
    `,
  );
```

### Global theme toggle

```ts
import ilha, { context, html } from "ilha";

const theme = context("theme", "light");

export const themeToggle = ilha
  .on("@click", () => theme(theme() === "light" ? "dark" : "light"))
  .render(() => html`<button>Toggle theme (current: ${theme})</button>`);

export const themeDisplay = ilha.render(() => html`<p>Theme: ${theme}</p>`);
```

### SSR + Hydration with snapshot

```ts
// island.ts
export const modal = ilha
  .input(z.object({ open: z.boolean().default(false) }))
  .state("open", ({ open }) => open)
  .on("[data-close]@click", ({ state }) => state.open(false))
  .onMount(({ state, hydrated }) => {
    if (!hydrated) console.log("fresh mount");
  })
  .render(({ state }) =>
    state.open() ? `<div role="dialog"><button data-close>×</button></div>` : `<div hidden></div>`,
  );

// server.ts
const html = await modal.hydratable(
  { open: true },
  {
    name: "modal",
    snapshot: { state: true },
    skipOnMount: true,
  },
);

// client.ts
mount({ modal });
```
