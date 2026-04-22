---
title: .slot()
---

Embeds a child island as a named slot inside a parent island. The child is rendered inline during SSR and activated independently on the client. Each slot is managed as its own island — it owns its own state, lifecycle, and reactivity.

## Basic usage

```ts twoslash
import ilha, { html } from "ilha";

const Icon = ilha.render(() => `<svg>…</svg>`);

const Card = ilha.slot("icon", Icon).render(
  ({ slots }) => html`
    <div class="card">
      ${slots.icon()}
      <p>Card content</p>
    </div>
  `,
);
```

## Passing props to a slot

Call the slot accessor with a props object to forward data to the child island:

```ts twoslash
import ilha, { html } from "ilha";
import { z } from "zod";

const Badge = ilha
  .input(z.object({ label: z.string(), color: z.string().default("teal") }))
  .render(({ input }) => html` <span style="background:${input.color}">${input.label}</span> `);

const Card = ilha.slot("badge", Badge).render(
  ({ slots }) => html`
    <div>
      ${slots.badge({ label: "New", color: "coral" })}
      <p>Content</p>
    </div>
  `,
);
```

Props are validated against the child island's schema, so type errors surface at authoring time.

## Multiple slots

Chain `.slot()` for each child island:

```ts twoslash
import ilha, { html } from "ilha";

const Avatar = ilha.render(() => `<img src="/avatar.png" />`);
const Actions = ilha.render(() => html`<button>Follow</button>`);

const Profile = ilha
  .slot("avatar", Avatar)
  .slot("actions", Actions)
  .render(
    ({ slots }) => html`
      <div class="profile">
        ${slots.avatar()}
        <div class="profile-actions">${slots.actions()}</div>
      </div>
    `,
  );
```

## SSR behavior

During SSR, calling `slots.icon()` renders the child island's HTML inline as part of the parent's output. The child island's styles, derived values, and render function all run as part of the parent's SSR pass.

```html
<!-- Output of Card.toString() -->
<div class="card">
  <svg>…</svg>
  <p>Card content</p>
</div>
```

## Client behavior

On the client, each slot is mounted independently into its own host element. The parent manages the lifecycle of its slots — when the parent unmounts, all slots are unmounted too.

Slots are re-mounted if their host element changes across re-renders, and the previous slot instance is cleaned up automatically.

## Accessing slot state from the parent

Slots are self-contained — the parent cannot directly read or write the child's state. If you need to share values between parent and child, use [`context()`](/guide/helpers/context) to create a shared global signal that both islands can read and write:

```ts twoslash
import ilha, { html, context } from "ilha";

const expanded = context("card.expanded", false);

const Toggle = ilha
  .on("button@click", () => expanded(!expanded()))
  .render(() => html`<button>Toggle</button>`);

const Content = ilha
  .effect(() => {
    // reacts to expanded signal from sibling slot
  })
  .render(() => html`<p>Content</p>`);

const Card = ilha
  .slot("toggle", Toggle)
  .slot("content", Content)
  .render(({ slots }) => html` <div>${slots.toggle()} ${slots.content()}</div> `);
```

## Notes

- Slot names must be unique within the same builder chain.
- Slots are always rendered — there is no built-in conditional slot. To make a slot optional, wrap the `slots.name()` call in a condition inside your render function.
- The parent's render cycle and the child's render cycle are independent. A state change in a child slot does not trigger a re-render in the parent.
- Slot props are serialized as `data-ilha-props` on the slot host element, so they are available during hydration without passing them again manually.
