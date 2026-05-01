---
title: .onError()
description: Register error handlers that catch throws and rejections from .on() handlers and .effect() runs.
---

# onError

Registers an error handler that catches errors thrown by [`.on()`](/guide/island/on) handlers (sync throws and async rejections) and [`.effect()`](/guide/island/effect) runs (sync throws). If no `.onError()` handler is registered, errors fall back to `console.error` so they are never silently swallowed.

## Basic usage

```ts twoslash
import ilha from "ilha";

const Counter = ilha
  .state("count", 0)
  .on("button@click", ({ state }) => {
    if (state.count() > 5) throw new Error("too many clicks");
    state.count(state.count() + 1);
  })
  // [!code highlight:3]
  .onError(({ error, source }) => {
    console.error(`[${source}] ${error.message}`);
  })
  .render(({ state }) => `<button>${state.count()}</button>`);
```

## Catching async rejections

`.onError()` also catches rejections from async `.on()` handlers:

```ts twoslash
import ilha, { html } from "ilha";

const Form = ilha
  .state("loading", false)
  .on("form@submit", async ({ state, event, signal }) => {
    event.preventDefault();
    state.loading(true);
    const res = await fetch("/api/submit", { method: "POST", signal });
    if (!res.ok) throw new Error("Submit failed");
    state.loading(false);
  })
  // [!code highlight:3]
  .onError(({ error }) => {
    alert(error.message);
  })
  .render(
    ({ state }) => html`
      <form>
        <button type="submit" disabled="${state.loading()}">
          ${state.loading() ? "Submitting…" : "Submit"}
        </button>
      </form>
    `,
  );
```

## Error context

The handler receives an `ErrorContext`:

```ts
{
  error: Error; // always wrapped to Error if a non-Error was thrown
  source: "on" | "effect"; // where the error originated
  state: IslandState; // reactive state signals
  derived: IslandDerived; // current derived values
  input: TInput; // resolved input props
  host: Element; // island root element
}
```

Use `source` to distinguish between `.on()` handler errors and `.effect()` run errors:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .on("button@click", () => {
    throw new Error("click failed");
  })
  .onError(({ error, source }) => {
    if (source === "on") {
      console.error("Handler error:", error);
    } else {
      console.error("Effect error:", error);
    }
  })
  .render(() => `<button>Go</button>`);
```

## Multiple error handlers

Chain `.onError()` as many times as needed. All handlers run in declaration order. An error thrown inside one `.onError()` handler does not break the others — it is logged to `console.error` and execution continues:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .on("button@click", () => {
    throw new Error("boom");
  })
  .onError(({ error }) => {
    console.log("first handler", error.message);
  })
  .onError(({ error }) => {
    throw new Error("handler itself failed");
  })
  .onError(({ error }) => {
    console.log("third handler still runs", error.message);
  })
  .render(() => `<button>Go</button>`);
```

## AbortError is not an error

`AbortError` rejections from `.on()` handlers are **not** routed to `.onError()`. They are the expected outcome of cancellation (via `:abortable` race-cancel or unmount) and would otherwise pollute error tracking:

```ts twoslash
import ilha from "ilha";

const Search = ilha
  .state("query", "")
  .on("input@input:abortable", async ({ event, signal }) => {
    const q = (event.target as HTMLInputElement).value;
    await fetch(`/search?q=${q}`, { signal });
  })
  .onError(({ error }) => {
    // This is NOT called for AbortError rejections.
    console.error(error);
  })
  .render(() => `<input />`);
```

## Catching effect errors

`.onError()` catches synchronous throws from `.effect()` runs. Async work spawned inside an effect is not awaited by the runtime, so rejections from un-awaited promises are not caught — use `await` or `.catch()` inside the effect, or pass `signal` to abort-aware APIs:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .state("count", 0)
  .effect(({ state }) => {
    if (state.count() < 0) {
      throw new Error("count cannot be negative");
    }
  })
  .onError(({ error, source }) => {
    console.error(`[${source}] ${error.message}`);
  })
  .render(({ state }) => `<p>${state.count()}</p>`);
```

## Notes

- If no `.onError()` handler is registered, errors fall back to `console.error`.
- `AbortError` rejections from cancelled `.on()` work are always filtered out.
- Errors thrown inside `.onError()` handlers are logged but do not break subsequent handlers.
- `.onError()` runs client-side only and is never called during SSR.
