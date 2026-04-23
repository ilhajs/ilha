---
title: mount()
description: Auto-discover and mount ilha islands from the DOM, with support for lazy loading and hydration.
---

# Mount

Auto-discovers all `[data-ilha]` elements in the DOM and mounts the matching island from a registry. This is the recommended way to activate islands on a page, especially when using SSR and hydration.

## Basic usage

```ts
import { mount } from "ilha";
import { Counter, Card } from "./islands";

mount({ Counter, Card });
```

Each key in the registry maps to a `data-ilha` attribute value in the HTML:

```html
<div data-ilha="Counter"></div>
<div data-ilha="Card"></div>
```

## Options

```ts
import { mount } from "ilha";
import { Counter } from "./islands";

const { unmount } = mount(
  { counter: Counter },
  {
    root: document.getElementById("app"), // default: document.body
    lazy: true, // mount on visibility
  },
);
```

| Option | Type      | Default         | Description                                       |
| ------ | --------- | --------------- | ------------------------------------------------- |
| `root` | `Element` | `document.body` | Scope discovery to a subtree                      |
| `lazy` | `boolean` | `false`         | Use `IntersectionObserver` to mount on visibility |

## Unmounting

`mount()` returns an object with an `unmount` function that tears down all discovered islands at once:

```ts
import { mount } from "ilha";
import { Counter } from "./islands";

const { unmount } = mount({ Counter });

// Later — stops all effects, removes all listeners
unmount();
```

## Lazy mounting

When `lazy: true` is set, islands are not mounted immediately. Instead, each host element is observed with an `IntersectionObserver` and mounted only when it enters the viewport. This keeps the initial page load lean when islands are below the fold.

```ts
import { mount } from "ilha";
import { HeavyChart } from "./islands";

mount({ HeavyChart }, { lazy: true });
```

Once an island becomes visible it mounts normally and is no longer observed.

## Passing props

Props can be embedded directly in the HTML using `data-ilha-props`. `mount()` reads and parses this attribute automatically — no need to pass props through JavaScript:

```html
<div data-ilha="Counter" data-ilha-props='{"start":10}'></div>
```

```ts
import { mount } from "ilha";
import { Counter } from "./islands";

// No props needed here — they are read from data-ilha-props
mount({ Counter });
```

## Hydration with state snapshots

When using `.hydratable()` on the server, the rendered HTML includes a `data-ilha-state` attribute with a snapshot of signal values. `mount()` reads this automatically and restores state without re-fetching or re-computing:

```html
<div data-ilha="Counter" data-ilha-state='{"count":42}'></div>
```

```ts
import { mount } from "ilha";
import { Counter } from "./islands";

// Reads data-ilha-state and restores signals from snapshot
mount({ Counter });
```

See [`.hydratable()`](/guide/island/hydratable) for how to generate this output on the server.

## Scoping to a subtree

Pass a `root` element to limit discovery to a specific part of the page. This is useful when islands are injected dynamically into a container:

```ts
import { mount } from "ilha";
import { Widget } from "./islands";

const container = document.getElementById("dynamic-content")!;
const { unmount } = mount({ Widget }, { root: container });
```

## Notes

- If a `data-ilha` value has no matching key in the registry, that element is silently skipped.
- In dev mode, double-mounting the same element logs a warning and returns a no-op for that element.
- `mount()` is safe to call before the DOM is fully loaded if you wrap it in a `DOMContentLoaded` listener or place the script at the end of `<body>`.
