---
title: Composition
description: Embed child islands directly inside a parent's JSX, rendered inline during SSR and activated independently on the client.
---

# Composing Islands

Child islands are rendered directly inside a parent's JSX. The child is rendered inline during SSR and activated independently on the client. Each child is managed as its own island — it owns its own state, lifecycle, and reactivity.

## Basic usage

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Icon = ilha.render(() => <svg>…</svg>);

const Card = ilha.render(() => (
  <div class="card">
    <Icon />
    <p>Card content</p>
  </div>
));
```

## Passing props to a child

Pass props as JSX attributes (or call with a props object in non-JSX usage):

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";
import { z } from "zod";

const Badge = ilha
  .input(
    z.object({
      label: z.string(),
      color: z.string().default("teal"),
    }),
  )
  .render(({ input }) => <span style={`background:${input.color}`}>{input.label}</span>);

const Card = ilha.render(() => (
  <div>
    <Badge label="New" color="coral" /> // [!code highlight]
    <p>Content</p>
  </div>
));
```

Props are validated against the child island's schema, so type errors surface at authoring time.

## Multiple children

Render as many child islands as needed:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha from "ilha";

const Avatar = ilha.render(() => <img src="/avatar.png" />);
const Actions = ilha.render(() => <button>Follow</button>);

const Profile = ilha.render(() => (
  <div class="profile">
    <Avatar />
    <div class="profile-actions">
      <Actions />
    </div>
  </div>
));
```

## Keyed children

Use `.key()` when a child may reorder or appear conditionally. Keys must be unique within a parent render:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
const items = [] as any[];
// ---cut---
import ilha from "ilha";

const Item = ilha.input<{ name: string }>().render(({ input }) => <span>{input.name}</span>);

const List = ilha.render(() => (
  <ul>
    {items.map((item) => {
      const KeyedItem = Item.key(item.id);
      return (
        <li>
          <KeyedItem name={item.name} />
        </li>
      );
    })}
  </ul>
));
```

## SSR behavior

During SSR, rendering a child island in JSX renders its HTML inline as part of the parent's output. The child island's styles, derived values, and render function all run as part of the parent's SSR pass.

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

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha, { context } from "ilha";

const expanded = context("card.expanded", false);

const Toggle = ilha
  .on("button@click", () => expanded(!expanded()))
  .render(() => <button>Toggle</button>);

const Content = ilha
  .effect(() => {
    // reacts to expanded signal from sibling
  })
  .render(() => <p>Content</p>);

const Card = ilha.render(() => (
  <div>
    <Toggle /> <Content />
  </div>
));
```

## Notes

- The parent's render cycle and the child's render cycle are independent. A state change in a child does not trigger a re-render in the parent.
- Child props are serialized as `data-ilha-props` on the child's host element, so they are available during hydration without passing them again manually.
- A dev warning is logged when two children in the same parent render share the same key.
