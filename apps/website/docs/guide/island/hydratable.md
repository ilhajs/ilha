---
title: .hydratable()
---

# Hydratable

Renders the island wrapped in a hydration container. The output includes everything `ilha.mount()` needs to activate the island on the client — the rendered HTML, serialized props, and optionally a state snapshot — all embedded as data attributes on a wrapper element.

Use this method in your SSR handler whenever you want the island to become interactive in the browser without a full client-side re-render.

## Basic usage

```ts twoslash
import ilha from "ilha";

const MyIsland = ilha.state("count", 0).render(({ state }) => `<p>${state.count()}</p>`);

const html = await MyIsland
  // [!code highlight]
  .hydratable({ count: 42 }, { name: "MyIsland" });
// → '<div data-ilha="MyIsland" data-ilha-props="{"count":42}">
//      <p>42</p>
//    </div>'
```

## Options

```ts
interface HydratableOptions {
  name: string; // required
  as?: string; // default: "div"
  snapshot?: boolean | { state?: boolean; derived?: boolean }; // default: false
  skipOnMount?: boolean; // default: false
}
```

| Option        | Type                | Default | Description                                                                           |
| ------------- | ------------------- | ------- | ------------------------------------------------------------------------------------- |
| `name`        | `string`            | —       | Registry key used by `mount()` to find the matching island on the client              |
| `as`          | `string`            | `"div"` | Tag name for the wrapper element                                                      |
| `snapshot`    | `boolean \| object` | `false` | Embed state and/or derived values in `data-ilha-state`                                |
| `skipOnMount` | `boolean`           | `false` | Skip all [`.onMount()`](/guide/island/onmount) callbacks when hydrating from snapshot |

## The `name` option

The name must match the key used when registering the island in your client-side `mount()` or `hydrate()` call:

```ts twoslash
// server
import ilha from "ilha";
import { mount } from "ilha";

const Counter = ilha.state("count", 0).render(({ state }) => `<p>${state.count()}</p>`);

const html = await Counter.hydratable({}, { name: "Counter" });

// client
mount({ Counter }); // ← "Counter" matches the name above
```

If the name has no match in the registry, `mount()` skips the element silently.

## The `snapshot` option

Snapshots embed current signal values into `data-ilha-state` so the client can restore them on mount without re-computing or re-fetching.

```ts twoslash
import ilha from "ilha";

const Counter = ilha.state("count", 0).render(({ state }) => `<p>${state.count()}</p>`);

// Snapshot state only
await Counter.hydratable({ count: 5 }, { name: "Counter", snapshot: true });
// → data-ilha-state='{"count":5}'

// Fine-grained control
await Counter.hydratable(
  { count: 5 },
  {
    name: "Counter",
    snapshot: { state: true, derived: false },
  },
);
```

| `snapshot` value                  | State snapshotted | Derived snapshotted |
| --------------------------------- | ----------------- | ------------------- |
| `false`                           | No                | No                  |
| `true`                            | Yes               | Yes                 |
| `{ state: true, derived: false }` | Yes               | No                  |
| `{ state: false, derived: true }` | No                | Yes                 |

When no snapshot is set, the island mounts fresh on the client — state initializers run again and [`.onMount()`](/guide/island/onmount) always fires.

## The `skipOnMount` option

When restoring from a snapshot, you often do not want [`.onMount()`](/guide/island/onmount) to run — the DOM is already correct and setup work would be redundant. Set `skipOnMount: true` to suppress all [`.onMount()`](/guide/island/onmount) callbacks during hydration:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .onMount(() => {
    console.log("this is skipped on hydration");
  })
  .render(() => `<div>hello</div>`);

await Island.hydratable(
  {},
  {
    name: "my-island",
    snapshot: true,
    skipOnMount: true,
  },
);
```

Note that `skipOnMount` only suppresses [`.onMount()`](/guide/island/onmount) — [`.effect()`](/guide/island/effect) callbacks always run on mount regardless.

## The `as` option

The wrapper element tag defaults to `"div"`. Change it when the surrounding HTML requires a specific element — for example inside a `<ul>` where a `<div>` would be invalid:

```ts twoslash
import ilha from "ilha";

const Item = ilha.render(() => `<li>item</li>`);

await Item.hydratable({}, { name: "item", as: "li" });
// → '<li data-ilha="item">…</li>'
```

## SSR output structure

The full rendered output looks like this:

```html
<div data-ilha="MyIsland" data-ilha-props='{"count":42}' data-ilha-state='{"count":42}'>
  <p>42</p>
</div>
```

- `data-ilha` — the registry key, used by `mount()` for discovery.
- `data-ilha-props` — serialized input props, read automatically on `mount()`.
- `data-ilha-state` — serialized signal snapshot, only present when `snapshot` is set.

## With scoped styles

If the island uses [`.css()`](/guide/island/css), the `<style>` tag is included inside the wrapper regardless of the snapshot option:

```html
<div data-ilha="Card">
  <style data-ilha-css>
    @scope (:scope) to ([data-ilha]) {
      .title {
        font-weight: 700;
      }
    }
  </style>
  <div>
    <p class="title">Hello</p>
  </div>
</div>
```

## With `@ilha/router`

When using file-system routing, `.hydratable()` is called internally by `renderHydratable()` and `renderResponse()`. You typically do not call it directly — the router handles it:

```ts
import { pageRouter } from "ilha:pages";
import { registry } from "ilha:registry";

// The router calls .hydratable() internally for the matched island
const html = await pageRouter.renderHydratable(request.url, registry);
```

For manual setups without the router, call `.hydratable()` directly in your SSR handler.

## Full SSR + hydration example

```ts twoslash
// server.ts
import ilha, { html } from "ilha";
import { mount } from "ilha";

const Counter = ilha
  .state("count", 0)
  .on("button@click", ({ state }) => state.count(state.count() + 1))
  .render(
    ({ state }) => html`
      <div>
        <p>Count: ${state.count()}</p>
        <button>Increment</button>
      </div>
    `,
  );

// Server — render with snapshot
const body = await Counter.hydratable(
  { count: 10 },
  { name: "Counter", snapshot: true, skipOnMount: true },
);

// Client — hydrate in place
mount({ Counter });
```

## Notes

- `.hydratable()` is always async — it awaits all [`.derived()`](/guide/island/derived) values before rendering, regardless of whether the snapshot includes them.
- Props are JSON-serialized into `data-ilha-props`. Values that are not JSON-serializable (functions, class instances, circular references) will cause a runtime error. Keep props plain and serializable.
- The snapshot serializes signal values at the moment `.hydratable()` is called. If state changes after this point on the server, those changes are not reflected in the snapshot.
