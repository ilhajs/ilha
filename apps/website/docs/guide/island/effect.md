---
title: .effect()
---

Registers a reactive side effect that runs after the island mounts and re-runs automatically whenever any signal it reads changes. Use it to sync state to the outside world — the DOM, browser APIs, timers, or external systems.

## Basic usage

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .state("title", "Hello")
  .effect(({ state }) => {
    document.title = state.title();
  })
  .render(({ state }) => `<input value="${state.title()}" />`);
```

Every time `state.title` changes, the effect re-runs and updates `document.title`.

## Cleanup

Return a function from the effect to clean up before the next run or on unmount:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .state("delay", 1000)
  .effect(({ state }) => {
    const id = setInterval(() => {
      console.log("tick");
    }, state.delay());

    return () => clearInterval(id);
  })
  .render(({ state }) => `<p>Interval: ${state.delay()}ms</p>`);
```

The cleanup runs before the effect re-runs with new values, and once more on unmount. This prevents stale timers, subscriptions, or event listeners from accumulating.

## Effect context

The effect function receives an `EffectContext`:

```ts
{
  state: IslandState; // reactive state signals
  input: TInput; // resolved input props
  host: Element; // island root element
}
```

Note that `derived` is not available in effects. If you need a derived value inside an effect, read the state signals it depends on directly and let the effect track those dependencies.

## Multiple effects

Chain `.effect()` as many times as needed. Each runs independently with its own dependency tracking:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .state("title", "Hello")
  .state("color", "teal")
  .effect(({ state }) => {
    document.title = state.title();
  })
  .effect(({ state }) => {
    document.body.style.backgroundColor = state.color();
  })
  .render(({ state }) => `<p>${state.title()}</p>`);
```

## Conditional reads

Dependencies are tracked based on which signals are actually read during a run. Signals inside a branch that does not execute are not tracked:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .state("enabled", false)
  .state("value", 0)
  .effect(({ state }) => {
    if (!state.enabled()) return; // if false, state.value is never read
    console.log(state.value()); // only tracked when enabled is true
  })
  .render(({ state }) => `<p>${state.value()}</p>`);
```

This means the effect only re-runs when `state.value` changes if `state.enabled` was `true` during the last run.

## `.effect()` vs `.onMount()`

Both run after mount, but they serve different purposes:

|                    | `.effect()`                    | `.onMount()`   |
| ------------------ | ------------------------------ | -------------- |
| Re-runs            | Yes, when dependencies change  | No, runs once  |
| Tracks signals     | Yes                            | No             |
| Receives `derived` | No                             | Yes            |
| Cleanup support    | Yes                            | Yes            |
| Use for            | Reactive sync to external APIs | One-time setup |

If you need something to happen only once after mount, use [`.onMount()`](/guide/island/onmount). If you need it to stay in sync with state over time, use `.effect()`.

## Notes

- Effects run client-side only. They are not called during SSR.
- The effect runs synchronously after the first mount, before the browser paints. Keep effects fast to avoid blocking rendering.
- Avoid writing to signals inside an effect that reads those same signals — this creates an infinite loop.
