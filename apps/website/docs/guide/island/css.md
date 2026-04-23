---
title: .css()
---

Attaches scoped styles to the island. Styles are automatically wrapped in a `@scope` rule bounded to the island host, so they apply only within the island and do not leak into child islands.

## Basic usage

```ts twoslash
import ilha, { html } from "ilha";

const Card = ilha.css`
    // [!code highlight:7]
    .title {
        font-weight: 700;
    }
    button {
        background: teal;
        color: white;
    }
  `.render(
  () => html`
    <div>
      <p class="title">Hello</p>
      <button>Click me</button>
    </div>
  `,
);
```

## Plain string form

`.css()` also accepts a plain string, which is useful when importing styles from an external file:

```ts
import ilha from "ilha";
import styles from "./card.css?raw";

const Card = ilha.css(styles).render(() => `<div class="card">…</div>`);
```

## Interpolations

When using the tagged template form, interpolations work as normal string concatenation:

```ts twoslash
import ilha, { html } from "ilha";

const accent = "coral"; // [!code highlight]

const Button = ilha.css`
    button {
      background: ${accent}; // [!code highlight]
      color: white;
    }
  `.render(() => html`<button>Go</button>`);
```

## Using the `css` tagged template

ilha ships a named `css` export that works as a passthrough tag for editor tooling. It enables LSP syntax highlighting and Prettier formatting for CSS strings without any runtime transformation. Use it to author styles outside the builder chain and pass the result in:

```ts twoslash
import ilha, { css, html } from "ilha";

const styles = css`
  .label {
    font-weight: 700;
  }
  button {
    background: teal;
  }
`;

const Card = ilha.css(styles).render(
  () => html`
    <div>
      <p class="label">Title</p>
      <button>Action</button>
    </div>
  `,
);
```

> `css` (named export) is a plain passthrough tag for tooling. `.css()` (builder method) is what actually attaches styles to the island. They are intentionally separate.

## How scoping works

ilha wraps your styles in a `@scope` rule that constrains them to the island host and punches a hole at any nested `[data-ilha]` element:

```css
@scope (:scope) to ([data-ilha]) {
  .title {
    font-weight: 700;
  }
  button {
    background: teal;
    color: white;
  }
}
```

This means:

- Styles apply to descendants of the island host.
- Styles do not leak into child islands nested inside.
- Selectors use low specificity and do not win unnecessary cascade wars with utility classes.

## SSR output

During SSR, a `<style>` tag is prepended as the first child of the island's rendered HTML:

```html
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
```

## Client mount

On the client, the style element is injected once as the first child of the host. It is preserved across re-renders — morph never replaces it. During hydration, the SSR-emitted `<style>` node is reused and not duplicated.

## Notes

- Calling `.css()` more than once on the same builder chain is not supported. In dev mode a warning is logged and only the last stylesheet is used. Compose all styles into a single `.css()` call.
- `.css()` is compatible with [`.hydratable()`](/guide/island/hydratable) — the style tag is included inside the `data-ilha` wrapper regardless of the `snapshot` option.
- Browser support for `@scope` is required. Check [caniuse.com/css-cascade-scope](https://caniuse.com/css-cascade-scope) for current coverage if you need to support older browsers.
