---
title: .render()
description: Finalize the builder chain and produce a callable island that can render to HTML or mount in the browser.
---

# Render

Finalizes the builder chain and returns a callable `Island`. This is always the last method in the chain — every other builder method must be called before `.render()`.

## Basic usage

```ts twoslash
import ilha, { html } from "ilha";

const MyIsland = ilha
  .state("x", 1)
  // [!code highlight]
  .render(({ state }) => html`<p>${state.x}</p>`);
```

## Render context

The render function receives a `RenderContext` with everything declared in the builder chain:

```ts
{
  state: IslandState; // reactive state signals
  derived: IslandDerived; // derived value envelopes
  input: TInput; // resolved input props
}
```

All three are always present, even if not declared. An island with no state gets an empty `state` object, and so on.

## Return type

The render function must return a `string` or a `RawHtml` object. In practice this means returning either a plain template literal or an [`html`](/guide/helpers/html)`\`\`` tagged template:

```ts twoslash
import ilha, { html, raw } from "ilha";

// Plain string — no escaping
const A = ilha.render(() => `<p>hello</p>`);

// html`` — safe interpolation with auto-escaping
const B = ilha.render(({ state }) => html`<p>${state}</p>`);

// raw() — trusted markup inside html``
const C = ilha.render(() => html`<div>${raw("<em>trusted</em>")}</div>`);
```

Use [`html`](/guide/helpers/html)`\`\`` whenever you interpolate dynamic values. Plain strings are fine for fully static markup.

## Conditional rendering

Use standard JavaScript expressions inside the render function:

```ts twoslash
import ilha, { html } from "ilha";

const Island = ilha
  .state("loading", false)
  .state("error", "")
  .state("items", [] as string[])
  .render(({ state }) => {
    // [!code highlight:2]
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

Arrays of [`html`](/guide/helpers/html)`\`\`` results are joined without commas. This is the canonical list rendering pattern:

```ts twoslash
import ilha, { html } from "ilha";

const List = ilha.state("fruits", ["apple", "banana", "cherry"]).render(
  ({ state }) => html`
    <ul>
      ${state.fruits().map((fruit) => html`<li>${fruit}</li>`)} // [!code highlight]
    </ul>
  `,
);
```

## Template bindings

Inside an `html\`\``template, use`bind:property=${signal}` to create two-way bindings between form elements and signals. When the signal changes, the element updates. When the user interacts with the element, the signal updates.

```ts twoslash
import ilha, { html } from "ilha";

const Form = ilha.state("name", "").render(
  ({ state }) => html`
    <input bind:value=${state.name} />
    <p>Hello, ${state.name()}!</p>
  `,
);
```

### Supported bindings

| Binding              | Element                                           | Bound property      | Trigger event |
| -------------------- | ------------------------------------------------- | ------------------- | ------------- |
| `bind:value`         | `<input>`, `<textarea>`, `<select>`               | `value`             | `input`       |
| `bind:valueAsNumber` | `<input type="number">`                           | `valueAsNumber`     | `input`       |
| `bind:valueAsDate`   | `<input type="date">`                             | `valueAsDate`       | `input`       |
| `bind:checked`       | `<input type="checkbox">`                         | `checked`           | `change`      |
| `bind:group`         | `<input type="radio">`, `<input type="checkbox">` | `checked` / `value` | `change`      |
| `bind:open`          | `<details>`                                       | `open`              | `toggle`      |
| `bind:files`         | `<input type="file">`                             | `files`             | `change`      |
| `bind:this`          | Any element                                       | element reference   | —             |

The element type is detected at runtime — no configuration needed.

### Type coercion

The binding reads the current signal value to determine the expected type and coerces the element's raw output accordingly:

- A `number` signal receives `valueAsNumber`, with `NaN` falling back to `0`.
- A `boolean` signal receives a boolean coercion.
- Everything else is treated as a string.

### Radio and checkbox groups

`bind:group` connects multiple inputs to a single signal. For radio buttons, the signal holds the selected `value`. For checkboxes, the signal holds an array of checked values:

```ts twoslash
import ilha, { html } from "ilha";

// Radio group — single value
const Plan = ilha.state("plan", "pro").render(
  ({ state }) => html`
    <input type="radio" name="plan" value="free" bind:group=${state.plan} />
    <input type="radio" name="plan" value="pro" bind:group=${state.plan} />
  `,
);

// Checkbox group — array of values
const Tags = ilha.state<string[]>("tags", ["ts"]).render(
  ({ state }) => html`
    <input type="checkbox" name="tag" value="js" bind:group=${state.tags} />
    <input type="checkbox" name="tag" value="ts" bind:group=${state.tags} />
    <input type="checkbox" name="tag" value="rust" bind:group=${state.tags} />
  `,
);
```

### Element references

`bind:this` writes the DOM element into a signal on mount and `null` on unmount. Useful for imperative access to elements:

```ts twoslash
import ilha, { html } from "ilha";

const Focus = ilha
  .state("ref", null as HTMLInputElement | null)
  .render(({ state }) => html`<input bind:this=${state.ref} />`);
```

### External signals

Any signal created with [`signal()`](/guide/helpers/signals) works as a binding target. This is useful for sharing state across multiple islands:

```ts twoslash
import ilha, { html, signal } from "ilha";

const username = signal("");

const LoginForm = ilha.render(() => html`<input bind:value=${username} placeholder="Username" />`);
```

### Combining with [`.on()`](/guide/island/on)

`bind:` handles value synchronization. If you also need to react to the same change — for example to trigger validation — combine it with `.on()`:

```ts twoslash
import ilha, { html } from "ilha";

const EmailForm = ilha
  .state("email", "")
  .state("error", "")
  .on("input@input", ({ state }) => {
    const valid = state.email().includes("@");
    state.error(valid ? "" : "Enter a valid email");
  })
  .render(
    ({ state }) => html`
      <input bind:value=${state.email} type="email" />
      ${state.error() ? html`<p>${state.error}</p>` : ""}
    `,
  );
```

## Async rendering

If the island uses async [`.derived()`](/guide/island/derived) values, calling the island as a function awaits all of them before rendering:

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
const html = await Island(); // [!code highlight]

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
- The render function runs on every re-render triggered by a signal change. Keep it fast and free of side effects — use [`.effect()`](/guide/island/effect) or [`.onMount()`](/guide/island/onmount) for side effects instead.
- During SSR the render function runs synchronously. Avoid browser-only APIs (`window`, `document`) at the top level of the render function.
- The render function does not receive `host` — if you need the host element, use [`.onMount()`](/guide/island/onmount) or [`.effect()`](/guide/island/effect).
