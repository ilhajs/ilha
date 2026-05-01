---
title: Composition
description: Embed child islands directly inside a parent's template, rendered inline during SSR and activated independently on the client.
---

# Composing Islands

Child islands are interpolated directly inside a parent's html&grave;&grave; template. The child is rendered inline during SSR and activated independently on the client. Each child is managed as its own island — it owns its own state, lifecycle, and reactivity.

## Basic usage

```ts twoslash
import ilha, { html } from "ilha";

const Icon = ilha.render(() => `<svg>…</svg>`);

const Card = ilha.render(
  () => html`
    <div class="card">
      ${Icon}
      <p>Card content</p>
    </div>
  `,
);
```

## Passing props to a child

Call the child island with a props object to forward data:

```ts twoslash
import ilha, { html } from "ilha";
import { z } from "zod";

const Badge = ilha
  .input(
    z.object({
      label: z.string(),
      color: z.string().default("teal"),
    }),
  )
  .render(({ input }) => html` <span style="background:${input.color}">${input.label}</span> `);

const Card = ilha.render(
  () => html`
    <div>
      ${Badge({ label: "New", color: "coral" })} // [!code highlight]
      <p>Content</p>
    </div>
  `,
);
```

Props are validated against the child island's schema, so type errors surface at authoring time.

## Multiple children

Interpolate as many child islands as needed:

```ts twoslash
import ilha, { html } from "ilha";

const Avatar = ilha.render(() => `<img src="/avatar.png" />`);
const Actions = ilha.render(() => html`<button>Follow</button>`);

const Profile = ilha.render(
  () => html`
    <div class="profile">
      ${Avatar}
      <div class="profile-actions">${Actions}</div>
    </div>
  `,
);
```

## Keyed children

Use `.key()` when a child may reorder or appear conditionally. Keys must be unique within a parent render:

```ts twoslash
const items = [] as any[];
// ---cut---
import ilha, { html } from "ilha";

const Item = ilha.input<{ name: string }>().render(({ input }) => html`<span>${input.name}</span>`);

const List = ilha.render(
  () =>
    html`<ul>
      ${items.map((item) => html`<li>${Item.key(item.id)({ name: item.name })}</li>`)}
    </ul>`,
);
```

## SSR behavior

During SSR, interpolating a child island renders its HTML inline as part of the parent's output. The child island's styles, derived values, and render function all run as part of the parent's SSR pass.

```html
<!-- Output of Card.toString() -->
<div class="card">
  <svg>…</svg>
  <p>Card content</p>
</div>
```

## Client behavior

On the client, each child is mounted independently into its own host element. The parent manages the lifecycle of its children — when the parent unmounts, all children are unmounted too.

Children are preserved across parent re-renders. If a keyed list reorders, live child subtrees are detached before the parent morphs and reattached afterwards, so DOM state, listeners, and internal state remain intact.

## Accessing child state from the parent

Child islands are self-contained — the parent cannot directly read or write the child's state. If you need to share values between parent and child, use [`context()`](/guide/helpers/signals) to create a shared global signal that both islands can read and write:

```ts twoslash
import ilha, { html, context } from "ilha";

const expanded = context("card.expanded", false);

const Toggle = ilha
  .on("button@click", () => expanded(!expanded()))
  .render(() => html`<button>Toggle</button>`);

const Content = ilha
  .effect(() => {
    // reacts to expanded signal from sibling
  })
  .render(() => html`<p>Content</p>`);

const Card = ilha.render(() => html` <div>${Toggle} ${Content}</div> `);
```

## Notes

- The parent's render cycle and the child's render cycle are independent. A state change in a child does not trigger a re-render in the parent.
- Child props are serialized as `data-ilha-props` on the child's host element, so they are available during hydration without passing them again manually.
- A dev warning is logged when two children in the same parent render share the same key.
