---
title: .on()
description: Attach DOM event listeners to island hosts or descendant elements with selector syntax and modifiers.
---

# On

Attaches a DOM event listener to the island host or any descendant element. Listeners are set up at mount time and cleaned up automatically on unmount.

[Interactive Tutorial](/tutorial/counter/on)

## Basic usage

```ts twoslash
import ilha, { html } from "ilha";

const Counter = ilha
  .state("count", 0)
  .on("button@click", ({ state }) => state.count(state.count() + 1)) // [!code highlight]
  .render(
    ({ state }) => html`
      <div>
        <p>Count: ${state.count()}</p>
        <button>Increment</button>
      </div>
    `,
  );
```

## Selector syntax

The first argument combines a CSS selector and an event name using `@` as a separator:

```
"cssSelector@eventName"
```

Omit the selector to target the island host element itself:

```ts
.on("@click", handler)              // host click
.on("button@click", handler)        // any <button> inside the island
.on("input.search@input", handler)  // input with class "search"
.on("#submit@click", handler)       // element with id="submit"
```

## Event modifiers

Append modifiers after the event name with `:` as a separator:

| Modifier    | Equivalent          | Description                                                |
| ----------- | ------------------- | ---------------------------------------------------------- |
| `once`      | `{ once: true }`    | Listener fires only once, then removes itself              |
| `capture`   | `{ capture: true }` | Listens in the capture phase                               |
| `passive`   | `{ passive: true }` | Hints the browser this handler won't call `preventDefault` |
| `abortable` | —                   | `ctx.signal` aborts when the same listener fires again     |

```ts
.on("button@click:once", handler)
.on("@scroll:passive", handler)
.on("button@click:once:capture", handler)
```

Multiple modifiers can be combined in any order.

## Handler context

The handler receives a `HandlerContext` with everything needed to respond to the event:

```ts
{
  state: IslandState; // reactive state signals
  derived: IslandDerived; // current derived values
  input: TInput; // resolved input props
  host: Element; // island root element
  target: Element; // element that fired the event
  event: Event; // the native DOM event
  signal: AbortSignal; // aborts on unmount, and on next fire if :abortable
}
```

Both `target` and `event` are typed when the event name is a known HTML event:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .state("value", "")
  .on("input@input", ({ state, event }) => {
    state.value((event.target as HTMLInputElement).value);
  })
  .render(({ state }) => `<input value="${state.value()}" />`);
```

## Cancelling async work with `ctx.signal`

Every handler receives an `AbortSignal` on `ctx.signal`. It aborts when the island unmounts, so you can pass it directly to `fetch` or any abort-aware API to cancel stale work automatically:

```ts twoslash
import ilha, { html } from "ilha";

const Island = ilha
  .state("results", [])
  .on("button@click", async ({ state, signal }) => {
    const res = await fetch("/api/data", { signal });
    state.results(await res.json());
  })
  .render(
    () =>
      html`<button>Load</button>
        <ul></ul>`,
  );
```

## Race-cancellation with `:abortable`

When the same listener fires again on the same target, the previous invocation's signal aborts. This is opt-in via the `:abortable` modifier:

```ts twoslash
import ilha, { html } from "ilha";

const Search = ilha
  .state("query", "")
  .state("results", [])
  .on("input@input:abortable", async ({ state, event, signal }) => {
    const q = (event.target as HTMLInputElement).value;
    const res = await fetch(`/search?q=${q}`, { signal });
    if (signal.aborted) return;
    state.results(await res.json());
  })
  .render(
    ({ state }) => html`
      <input value="${state.query()}" />
      <ul>
        ${state.results().map((r) => html`<li>${r}</li>`)}
      </ul>
    `,
  );
```

Race-cancellation is scoped per-target — clicking button A does not cancel an in-flight handler on button B.

## Async handlers and errors

Async errors (and sync throws) are caught automatically and routed to [`.onError()`](/guide/island/onerror) handlers if any are registered. `AbortError` rejections from cancelled work are filtered out and do not reach `.onError()` or `console.error`.

```ts twoslash
import ilha, { html } from "ilha";

const Form = ilha
  .state("loading", false)
  .on("form@submit", async ({ state, event, signal }) => {
    event.preventDefault();
    state.loading(true);
    try {
      await fetch("/api/submit", { method: "POST", signal });
    } finally {
      state.loading(false);
    }
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

## Multiple listeners

Chain `.on()` as many times as needed. Each call adds an independent listener:

```ts twoslash
import ilha, { html } from "ilha";

const Counter = ilha
  .state("count", 0)
  .on("[data-action=increment]@click", ({ state }) => state.count(state.count() + 1))
  .on("[data-action=decrement]@click", ({ state }) => state.count(state.count() - 1))
  .on("[data-action=reset]@click", ({ state }) => state.count(0))
  .render(
    ({ state }) => html`
      <div>
        <p>${state.count()}</p>
        <button data-action="increment">+</button>
        <button data-action="decrement">−</button>
        <button data-action="reset">Reset</button>
      </div>
    `,
  );
```

## Implicit batching

Multiple synchronous state writes inside a single handler produce one re-render, not one per write:

```ts
.on("@click", ({ state }) => {
  state.a(1);
  state.b(2);
  state.c(3); // → one render, not three
})
```

## Dev mode warnings

In development, if a selector matches no elements at mount time, ilha logs a warning. This is not an error — the element may not exist yet if it is rendered conditionally. The warning is suppressed in production.

## Notes

- Listeners are attached to the island host and use standard `addEventListener` under the hood — there is no event delegation layer.
- Selectors are evaluated with `querySelectorAll` at mount time and after each re-render. If new matching elements appear after mount, they are picked up automatically on the next re-render cycle.
- The `once` modifier tracks fired listeners per entry. If the island re-renders before a `once` listener fires, the listener is still considered active and will not be re-attached.
