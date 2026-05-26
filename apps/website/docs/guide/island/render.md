---
title: .render()
description: Finalize the builder chain and produce a callable island that can render JSX to HTML or mount in the browser.
---

# Render

Finalizes the builder chain and returns a callable `Island`. This is always the last method in the chain — every other builder method must be called before `.render()`.

## JSX setup

ilha ships its own JSX runtime. For TypeScript projects, set `jsxImportSource` to `"ilha"`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "ilha"
  }
}
```

For individual examples or files, you can use a file pragma instead:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Hello = ilha.render(() => <p>Hello, ilha!</p>);
```

JSX is the recommended authoring style for islands. The lower-level [`html`` `](/guide/helpers/html) helper is still available and is useful for no-build environments or places where you do not want JSX tooling. For example, you can drop an `<script type="module">` into a plain `index.html` with an import map and author islands entirely with `html`` ` — no build step or compiler required.

## Basic usage

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Counter = ilha.state("count", 0).render(({ state }) => <p>Count: {state.count()}</p>);
```

Calling the island renders an HTML string:

```ts
Counter(); // → <p>Count: 0</p>
Counter.toString(); // sync render
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

The render function returns JSX, a plain string, or a `RawHtml` object. In day-to-day code, prefer JSX:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha, { raw } from "ilha";

// JSX — safe interpolation with auto-escaping
const A = ilha.render(() => <p>Hello</p>);

// Plain string — okay for fully static markup
const B = ilha.render(() => `<p>hello</p>`);

// raw() — trusted markup inside JSX
const C = ilha.render(() => <div>{raw("<em>trusted</em>")}</div>);
```

Use JSX whenever you interpolate dynamic values. Plain strings do not escape interpolated values, so reserve them for static or already-safe markup.

## Escaping and safe values

JSX children are escaped by default:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
const userInput = '<script>alert("xss")</script>';

<p>{userInput}</p>;
// → <p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>
```

`null` and `undefined` render as empty strings. Arrays are flattened and rendered without commas.

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
<p>{["a", null, undefined, "b"]}</p>
// → <p>ab</p>
```

Use [`raw()`](/guide/helpers/raw) only for trusted markup you control:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import { raw } from "ilha";

const icon = `<svg aria-hidden="true">…</svg>`;

<button>{raw(icon)} Save</button>;
```

## Signals in JSX

State entries are signal accessors. You can call them explicitly:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Counter = ilha.state("count", 0).render(({ state }) => <p>{state.count()}</p>);
```

You can also pass the accessor itself as a child; ilha will read it and escape the value:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Label = ilha.state("label", "<b>safe</b>").render(({ state }) => <p>{state.label}</p>);
// → <p>&lt;b&gt;safe&lt;/b&gt;</p>
```

## Attributes

JSX attributes are escaped. Boolean `true` renders as a boolean attribute, while `false`, `null`, and `undefined` omit the attribute.

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
<button disabled={true} title={'a"b'}>
  Save
</button>
// → <button disabled title="a&quot;b">Save</button>
```

Use `class` normally. `className` and `htmlFor` are also accepted and normalized to `class` and `for`.

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
<label htmlFor="email" className="field">
  Email
</label>
```

`class` also accepts arrays and object maps:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
const active = true;

<div class={["tab", active && "is-active"]}>Tab</div>;
<div class={{ tab: true, "is-active": active }}>Tab</div>;
```

Function event props such as `onClick={...}` are intentionally omitted from the generated HTML. Use [`.on()`](/guide/island/on) for behavior instead.

## Events and re-rendering

Attach DOM events with `.on()`, then render JSX from `.render()`:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Counter = ilha
  .state("count", 0)
  .on("button@click", ({ state }) => {
    state.count(state.count() + 1);
  })
  .render(({ state }) => (
    <div>
      <p>Count: {state.count()}</p>
      <button type="button">+</button>
    </div>
  ));
```

When `state.count` changes, only this island re-renders and morphs its host DOM.

## Conditional rendering

Use normal JavaScript control flow and ternaries:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Island = ilha
  .state("loading", false)
  .state("error", "")
  .state("items", [] as string[])
  .render(({ state }) => {
    if (state.loading()) return <p>Loading…</p>;
    if (state.error()) return <p>Error: {state.error()}</p>;

    return (
      <ul>
        {state.items().map((item) => (
          <li>{item}</li>
        ))}
      </ul>
    );
  });
```

## List rendering

Arrays of JSX results are joined without commas. Do not call `.join("")`:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const List = ilha.state("fruits", ["apple", "banana", "cherry"]).render(({ state }) => (
  <ul>
    {state.fruits().map((fruit) => (
      <li>{fruit}</li>
    ))}
  </ul>
));
```

Each item is escaped independently, so mapped user content stays safe.

## Fragments

Use fragments when a render function needs to return siblings without an extra wrapper:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Form = ilha.render(() => (
  <>
    <input name="email" />
    <button>Submit</button>
  </>
));
```

## Child islands

Render child islands as JSX components:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Child = ilha.state("count", 0).render(({ state }) => <button>{state.count()}</button>);

const Parent = ilha.render(() => (
  <section>
    <h1>Parent</h1>
    <Child />
  </section>
));
```

Child islands render inline during SSR and mount independently on the client. A state change in the child does not re-render the parent.

Pass props with normal JSX attributes:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";
import { z } from "zod";

const Badge = ilha
  .input(z.object({ label: z.string() }))
  .render(({ input }) => <strong>{input.label}</strong>);

const Page = ilha.render(() => <Badge label="New" />);
```

For keyed child islands in lists, create a keyed component before rendering it:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";
import { z } from "zod";

const items = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
];

const Item = ilha
  .input(z.object({ label: z.string() }))
  .render(({ input }) => <li>{input.label}</li>);

const List = ilha.render(() => (
  <ul>
    {items.map((item) => {
      const KeyedItem = Item.key(item.id);
      return <KeyedItem label={item.label} />;
    })}
  </ul>
));
```

## Function components

Small JSX helper components can return JSX or strings. They receive an object even when no props are passed, so destructuring is safe:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
function EmptyState({ label = "Nothing here" }: { label?: string }) {
  return <p>{label}</p>;
}

const out = <EmptyState />;
```

For stateful, mountable UI, prefer an ilha island (`ilha.render(...)`) over a plain function component.

## Template bindings

Inside JSX, use `bind:property={signal}` to create two-way bindings between form elements and signals. When the signal changes, the element updates. When the user interacts with the element, the signal updates.

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Name = ilha.state("name", "Ada").render(({ state }) => (
  <div>
    <input bind:value={state.name} />
    <p>Hello, {state.name()}</p>
  </div>
));
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

### Radio and checkbox groups

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Plan = ilha.state("plan", "pro").render(({ state }) => (
  <>
    <input type="radio" name="plan" value="free" bind:group={state.plan} />
    <input type="radio" name="plan" value="pro" bind:group={state.plan} />
  </>
));

const Tags = ilha.state<string[]>("tags", ["ts"]).render(({ state }) => (
  <>
    <input type="checkbox" name="tag" value="js" bind:group={state.tags} />
    <input type="checkbox" name="tag" value="ts" bind:group={state.tags} />
    <input type="checkbox" name="tag" value="rust" bind:group={state.tags} />
  </>
));
```

### Element references

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Focus = ilha
  .state("ref", null as HTMLInputElement | null)
  .render(({ state }) => <input bind:this={state.ref} />);
```

### External signals

Any signal created with [`signal()`](/guide/helpers/signals) works as a binding target:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha, { signal } from "ilha";

const username = signal("");

const LoginForm = ilha.render(() => <input bind:value={username} placeholder="Username" />);
```

## `html`` ` interop

JSX and [`html`` `](/guide/helpers/html) values compose. You can render an `html`` ` result inside JSX, and JSX returns the same `RawHtml` shape:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import { html } from "ilha";

const result = <div>{html`<span>${"safe"}</span>`}</div>;
```

This is useful when incrementally migrating older `html`` ` templates to JSX.

## Async rendering

If the island uses async [`.derived()`](/guide/island/derived) values, calling the island as a function awaits all of them before rendering:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Island = ilha
  .derived("user", async () => {
    const res = await fetch("/api/user");
    return res.json();
  })
  .render(({ derived }) => {
    if (derived.user.loading) return <p>Loading…</p>;
    return <p>{derived.user.value?.name}</p>;
  });

// Async — waits for derived values
const html = await Island();

// Sync — derived renders in loading state
const html2 = Island.toString();
```

## What `.render()` returns

Calling `.render()` produces an `Island` object with these methods:

```ts
island(props?) // renders to string, async if derived values are async
island.toString(props?) // always renders synchronously
island.mount(host, props?) // mounts into a DOM element, returns unmount()
island.hydratable(props, options) // renders wrapped in hydration container
```

## Notes

- `.render()` must be called exactly once and always last in the chain.
- JSX output follows ilha's escaping rules; use `raw()` only for trusted markup.
- Use `.on()` for DOM events. JSX `onClick`-style function props are not how ilha attaches behavior.
- The render function runs on every re-render triggered by a signal change. Keep it fast and free of side effects — use [`.effect()`](/guide/island/effect) or [`.onMount()`](/guide/island/onmount) for side effects instead.
- During SSR the render function runs synchronously. Avoid browser-only APIs (`window`, `document`) at the top level of the render function.
- The render function does not receive `host` — if you need the host element, use [`.onMount()`](/guide/island/onmount) or [`.effect()`](/guide/island/effect).
