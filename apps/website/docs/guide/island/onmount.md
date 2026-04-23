---
title: .onMount()
description: Register one-time setup functions that run after an island is mounted into the DOM.
---

# onMount

Registers a function that runs once after the island is mounted into the DOM. Use it for one-time setup that needs access to the host element, such as initializing third-party libraries, measuring layout, or setting up manual DOM integrations.

## Basic usage

```ts twoslash
import ilha from "ilha";

const Island = ilha
  // [!code highlight:3]
  .onMount(({ host }) => {
    console.log("mounted", host);
  })
  .render(() => `<div>hello</div>`);
```

## Cleanup

Return a function to run cleanup on unmount:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .onMount(({ host }) => {
    const observer = new ResizeObserver(() => {
      console.log("resized", host.clientWidth);
    });
    observer.observe(host);

    return () => observer.disconnect(); // [!code highlight]
  })
  .render(() => `<div>hello</div>`);
```

The cleanup function is called when `unmount()` is invoked, just before the island tears down its listeners and effects.

## Mount context

The function receives an `OnMountContext`:

```ts
{
  state: IslandState; // reactive state signals
  derived: IslandDerived; // current derived values
  input: TInput; // resolved input props
  host: Element; // island root element
  hydrated: boolean; // true when mounted over SSR content
}
```

The `hydrated` flag tells you whether the island was activated over existing server-rendered HTML or freshly mounted into an empty element. This is useful when you want to skip an animation or initialization step for content that is already visible:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .onMount(({ host, hydrated }) => {
    if (!hydrated) {
      host.animate([{ opacity: 0 }, { opacity: 1 }], 300);
    }
  })
  .render(() => `<div>content</div>`);
```

## Initializing third-party libraries

`.onMount()` is the right place to hand off a DOM element to a library that manages its own rendering:

```ts twoslash
declare global {
  interface Window {
    MapLibrary: any;
  }
}
// ---cut---
import ilha from "ilha";

const Map = ilha
  .input<{ lat: number; lng: number }>()
  .onMount(({ host, input }) => {
    // [!code highlight:4]
    const map = new window.MapLibrary(host, {
      center: [input.lat, input.lng],
      zoom: 12,
    });

    return () => map.destroy();
  })
  .render(() => `<div style="height:400px"></div>`);
```

## Multiple onMount hooks

Chain `.onMount()` as many times as needed. Each runs independently in the order it was declared:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .onMount(({ host }) => {
    console.log("first", host);
  })
  .onMount(({ state }) => {
    console.log("second");
  })
  .render(() => `<div>hello</div>`);
```

## Skipping onMount during hydration

When using [`.hydratable()`](/guide/island/hydratable) with `snapshot: true`, the `skipOnMount` option tells ilha to skip all `.onMount()` calls when the island is rehydrated from a snapshot. This is useful when your mount logic would duplicate work that was already done on the server:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .onMount(({ host }) => {
    console.log("this is skipped on hydration");
  })
  .render(() => `<div>hello</div>`);

// On the server:
await Island.hydratable(
  {},
  {
    name: "my-island",
    snapshot: true,
    skipOnMount: true, // [!code highlight]
  },
);
```

## `.onMount()` vs `.effect()`

|                     | `.onMount()`                     | `.effect()`                                  |
| ------------------- | -------------------------------- | -------------------------------------------- |
| Runs                | Once after mount                 | After mount, then on every dependency change |
| Tracks signals      | No                               | Yes                                          |
| Receives `derived`  | Yes                              | No                                           |
| Receives `hydrated` | Yes                              | No                                           |
| Cleanup support     | Yes                              | Yes                                          |
| Use for             | One-time setup, third-party libs | Reactive sync to external APIs               |

If you need something to stay in sync with state over time, use [`.effect()`](/guide/island/effect) instead.

## Notes

- `.onMount()` runs client-side only and is never called during SSR.
- The mount function runs after the first render and after all effects have been set up.
- Writing to signals inside `.onMount()` is safe and will trigger a re-render.
