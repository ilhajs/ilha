---
title: css&grave;&grave;
---

A passthrough tagged template for CSS strings. It has no runtime effect — its sole purpose is to tell editors and language tools that the content is CSS, enabling syntax highlighting, autocompletion, and formatting.

## Basic usage

```ts twoslash
import { css } from "ilha";

const styles = css`
  button {
    background: teal;
    color: white;
  }
  .label {
    font-weight: 700;
  }
`;
```

The result is a plain string, identical to what you would get from an untagged template literal.

## Using with the builder

Pass the result to the [`.css()`](/guide/island/css) builder method to attach it to an island:

```ts twoslash
import ilha, { css, html } from "ilha";

const styles = css`
  .title {
    font-size: 1.25rem;
    font-weight: 700;
  }
  button {
    background: teal;
    color: white;
    border: none;
  }
`;

const Card = ilha
  // [!code highlight]
  .css(styles)
  .render(
    () => html`
      <div>
        <p class="title">Hello</p>
        <button>Action</button>
      </div>
    `,
  );
```

## Interpolations

Interpolations work as normal string concatenation — values are inserted as-is with no transformation:

```ts twoslash
import { css } from "ilha";

const accent = "coral";
const radius = 4;

const styles = css`
  button {
    background: ${accent};
    border-radius: ${radius}px;
  }
`;
```

## Difference from [`.css()`](/guide/island/css)

`css\`\``and`.css()` are intentionally separate:

|                | css&grave;&grave;             | .css()                               |
| -------------- | ----------------------------- | ------------------------------------ |
| What it is     | Named export, tagged template | Builder chain method                 |
| Runtime effect | None — returns a plain string | Attaches scoped styles to the island |
| Purpose        | Editor tooling support        | Actual style attachment              |

A common pattern is to use both together: author styles with css&grave;&grave; for tooling support, then pass the result to[`.css()`](/guide/island/css) to attach them:

```ts twoslash
import ilha, { css } from "ilha";

const styles = css`
  p {
    color: teal;
  }
`; // ← tooling sees CSS here

ilha.css(styles).render(() => `<p>hello</p>`); // ← styles are attached here
```

## Organizing styles

For larger islands, keeping styles in a separate variable improves readability and keeps the builder chain focused on structure and behavior:

```ts twoslash
import ilha, { css, html } from "ilha";

const styles = css`
  .card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1rem;
  }
  .card-title {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }
  .card-body {
    color: #4a5568;
  }
  button {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    background: teal;
    color: white;
  }
`;

const Card = ilha
  .state("expanded", false)
  .on("button@click", ({ state }) => state.expanded(!state.expanded()))
  .css(styles)
  .render(
    ({ state }) => html`
      <div class="card">
        <p class="card-title">Title</p>
        ${state.expanded() ? html`<p class="card-body">Content</p>` : ""}
        <button>${state.expanded() ? "Collapse" : "Expand"}</button>
      </div>
    `,
  );
```

## Notes

- css&grave;&grave; requires editor tooling to provide any benefit. The [vscode-styled-components](https://marketplace.visualstudio.com/items?itemName=styled-components.vscode-styled-components) extension and Prettier's `prettier-plugin-styled-components`recognize the`css` tag and apply CSS formatting automatically.
- The tag works with any string content — there is no validation or parsing at runtime. Syntax errors in your CSS will not be caught by ilha itself, only by your editor or browser.
