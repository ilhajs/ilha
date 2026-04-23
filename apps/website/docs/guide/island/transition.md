---
title: .transition()
description: Attach enter and leave animation callbacks to islands for async mount and unmount transitions.
---

# Transition

Attaches enter and leave animation callbacks to the island. The enter callback runs when the island mounts, and the leave callback runs when it unmounts. Both are async — ilha awaits the leave transition before tearing down the island.

## Basic usage

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .transition({
    enter: async (host) => {
      await host.animate(
        [
          {
            opacity: 0,
          },
          { opacity: 1 },
        ],
        {
          duration: 300,
          fill: "forwards",
        },
      ).finished;
    },
    leave: async (host) => {
      await host.animate(
        [
          {
            opacity: 1,
          },
          { opacity: 0 },
        ],
        {
          duration: 300,
          fill: "forwards",
        },
      ).finished;
    },
  })
  .render(() => `<div>content</div>`);
```

## Enter transition

The `enter` callback receives the host element immediately after mount. It does not block the island from being interactive — event listeners and effects are already active when it runs.

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .transition({
    // [!code highlight:9]
    enter: (host) => {
      host.animate(
        [
          { transform: "translateY(8px)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 200, easing: "ease-out" },
      );
    },
  })
  .render(() => `<div>content</div>`);
```

The enter callback does not need to be async if you do not need to await the animation.

## Leave transition

The `leave` callback is awaited before ilha runs cleanup. This means event listeners, effects, and signals remain active for the full duration of the leave animation — state updates and re-renders still work while the island is leaving.

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .transition({
    // [!code highlight:4]
    leave: async (host) => {
      await host.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished;
    },
  })
  .render(() => `<div>content</div>`);
```

If `leave` throws or rejects, cleanup still runs — the transition error is logged to the console but does not prevent unmounting.

## Combining enter and leave

Both callbacks are optional. You can define only one if the other is not needed:

```ts twoslash
import ilha from "ilha";

const Drawer = ilha
  .transition({
    enter: async (host) => {
      await host.animate([{ transform: "translateX(-100%)" }, { transform: "translateX(0)" }], {
        duration: 250,
        easing: "ease-out",
      }).finished;
    },
    leave: async (host) => {
      await host.animate([{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }], {
        duration: 250,
        easing: "ease-in",
      }).finished;
    },
  })
  .render(() => `<div class="drawer">content</div>`);
```

## Using CSS transitions

You are not limited to the Web Animations API. Any async work is valid — including toggling a class and waiting for a CSS transition to finish:

```ts twoslash
import ilha from "ilha";

function cssTransitionEnd(el: Element): Promise<void> {
  return new Promise((resolve) => {
    el.addEventListener("transitionend", () => resolve(), { once: true });
  });
}

const Island = ilha
  .transition({
    enter: async (host) => {
      host.classList.add("is-entering");
      await cssTransitionEnd(host);
      host.classList.remove("is-entering");
    },
    leave: async (host) => {
      host.classList.add("is-leaving");
      await cssTransitionEnd(host);
    },
  })
  .render(() => `<div>content</div>`);
```

## Interaction with [`.onMount()`](/guide/island/onmount)

The enter transition and [`.onMount()`](/guide/island/onmount) both run after mount, but in a specific order:

1. Island mounts and renders into the DOM.
2. Effects are set up.
3. [`.onMount()`](/guide/island/onmount) callbacks run.
4. Enter transition runs.

This means [`.onMount()`](/guide/island/onmount) always completes before the enter animation starts.

## Notes

- Only one `.transition()` call is supported per builder chain. Calling it more than once replaces the previous transition options.
- Transitions are client-side only and are never called during SSR.
- The `leave` transition is awaited, so a very long or stalled animation will delay cleanup. Make sure your leave animations have a bounded duration or a timeout.
