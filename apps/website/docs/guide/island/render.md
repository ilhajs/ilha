---
title: .render()
---

Finalizes the builder chain and returns a callable `Island`. This is always the last method in the chain — every other builder method must be called before `.render()`.

## Basic usage

```ts twoslash
import ilha, { html } from "ilha";

const MyIsland = ilha.state("x", 1).render(({ state }) => html`<p>${state.x}</p>`);
```

## Render context

The render function receives a `RenderContext` with everything declared in the builder chain:

```ts
{
  state: IslandState; // reactive state signals
  derived: IslandDerived; // derived value envelopes
  input: TInput; // resolved input props
  slots: SlotsProxy; // named slot accessors
}
```

All four are always present, even if not declared. An island with no state gets an empty `state` object, and so on.

## Return type

The render function must return a `string` or a `RawHtml` object. In practice this means returning either a plain template literal or an `html\`\`` tagged template:

```ts twoslash
import ilha, { html, raw } from "ilha";

// Plain string — no escaping
const A = ilha.render(() => `<p>hello</p>`);

// html`` — safe interpolation with auto-escaping
const B = ilha.render(({ state }) => html`<p>${state}</p>`);

// raw() — trusted markup inside html``
const C = ilha.render(() => html`<div>${raw("<em>trusted</em>")}</div>`);
```

Use `html\`\`` whenever you interpolate dynamic values. Plain strings are fine for fully static markup.

## Conditional rendering

Use standard JavaScript expressions inside the render function:

```ts twoslash
import ilha, { html } from "ilha";

const Island = ilha
  .state("loading", false)
  .state("error", "")
  .state("items", [] as string[])
  .render(({ state }) => {
    if (state.loading()) return html`<p>Loading…</p>`;
    if (state.error()) return html`<p>Error: ${state.error}</p>`;

    return html`
      <ul>
        ${state.items().map((item) => html`<li>${item}</li>`)}
      </ul>
    `;
  });
```

## List rendering

Arrays of `html\`\`` results are joined without commas. This is the canonical list rendering pattern:

```ts twoslash
import ilha, { html } from "ilha";

const List = ilha.state("fruits", ["apple", "banana", "cherry"]).render(
  ({ state }) => html`
    <ul>
      ${state.fruits().map((fruit) => html`<li>${fruit}</li>`)}
    </ul>
  `,
);
```

## Async rendering

If the island uses async `.derived()` values, calling the island as a function awaits all of them before rendering:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .derived("user", async () => {
    const res = await fetch("/api/user");
    return res.json();
  })
  .render(({ derived }) => {
    if (derived.user.loading) return `<p>Loading…</p>`;
    return `<p>${derived.user.value?.name}</p>`;
  });

// Async — waits for derived values
const html = await Island();

// Sync — derived renders in loading state
const html2 = Island.toString();
```

## What `.render()` returns

Calling `.render()` produces an `Island` object with three methods:

```ts
island(props?)           // renders to string, async if derived values are async
island.toString(props?)  // always renders synchronously
island.mount(host, props?) // mounts into a DOM element, returns unmount()
island.hydratable(props, options) // renders wrapped in hydration container
```

## Notes

- `.render()` must be called exactly once and always last in the chain.
- The render function runs on every re-render triggered by a signal change. Keep it fast and free of side effects — use `.effect()` or `.onMount()` for side effects instead.
- During SSR the render function runs synchronously. Avoid browser-only APIs (`window`, `document`) at the top level of the render function.
- The render function does not receive `host` — if you need the host element, use `.onMount()` or `.effect()`.
