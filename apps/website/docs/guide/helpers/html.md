---
title: html&grave;&grave;
description: An XSS-safe tagged template for building HTML strings with automatic escaping and signal interpolation.
---

# HTML

An XSS-safe tagged template for building HTML strings. This is ilha's low-level templating API: you can use it directly, but JSX is the preferred authoring style for most apps.

Because `html`` ` is plain TypeScript/JavaScript, it does not require JSX syntax, a JSX runtime import, or a build transform. That makes it a great fit for no-build apps, small scripts, server-only rendering, or any place where you want ilha's escaping and composition rules without JSX tooling.

Interpolated values are HTML-escaped by default, making the safe path the default and explicit opt-in required for raw markup.

## Basic usage

```ts twoslash
import { html } from "ilha";

const name = "<script>alert(1)</script>";

html`<p>${name}</p>`;
// → <p>&lt;script&gt;alert(1)&lt;/script&gt;</p>
```

## Interpolation rules

| Value type           | Behavior                                   |
| -------------------- | ------------------------------------------ |
| `string` / `number`  | HTML-escaped                               |
| `null` / `undefined` | Omitted — renders as empty string          |
| `raw(str)`           | Inserted as-is, no escaping                |
| `html\`…\``          | Inserted as-is, already safe               |
| Signal accessor      | Called automatically, value is escaped     |
| Array                | Each item processed recursively, no commas |

## Escaping

All string and number interpolations are escaped automatically:

```ts twoslash
import { html } from "ilha";

const userInput = `<img src=x onerror="alert(1)">`;
const count = 42;

html`<p>${userInput}</p>`; // → <p>&lt;img src=x…&gt;</p>
html`<p>${count}</p>`; // → <p>42</p>
```

The characters `&`, `<`, `>`, `"`, and `'` are all escaped.

## Skipping null and undefined

`null` and `undefined` are silently omitted, making conditional rendering clean:

```ts twoslash
import { html } from "ilha";

const error = null;

html`<div>${error}</div>`;
// → <div></div>
```

## Trusted markup with `raw()`

When you need to inject pre-sanitized or server-controlled markup, use [`raw()`](/guide/helpers/raw) to opt out of escaping:

```ts twoslash
import { html, raw } from "ilha";

const icon = `<svg aria-hidden="true">…</svg>`;

html`<button>${raw(icon)} Submit</button>`;
// → <button><svg aria-hidden="true">…</svg> Submit</button>
```

Only use `raw()` with markup you fully control. Never pass user input to `raw()`.

## Nesting html&grave;&grave; results

Results of html&grave;&grave; are already safe and pass through unescaped when interpolated into a parent template. This is the foundation of composable templates:

```ts twoslash
import { html } from "ilha";

const badge = html`<span class="badge">New</span>`;

html`<div class="card">
  ${badge}
  <p>Content</p>
</div>`;
// → <div class="card"><span class="badge">New</span><p>Content</p></div>
```

## Signal accessors

Signal accessors can be interpolated without calling them. ilha detects signal accessors and calls them automatically, then escapes the result:

```ts twoslash
import ilha, { html } from "ilha";

const Island = ilha
  .state("label", "<b>hello</b>")
  // [!code highlight]
  .render(({ state }) => html` <p>${state.label}</p> `);
```

Both forms are equivalent. The no-call shorthand is purely a convenience.

## List rendering

Arrays are processed recursively with no comma joining. The canonical list pattern is:

```ts twoslash
import { html } from "ilha";

const fruits = ["apple", "banana", "cherry"];

html`
  <ul>
    ${fruits.map((fruit) => html`<li>${fruit}</li>`)}
  </ul>
`;
// → <ul><li>apple</li><li>banana</li><li>cherry</li></ul>
```

Each html&grave;&grave; result in the array passes through unescaped. Mixed arrays of strings and html&grave;&grave; results also work — each item is processed by its own rules.

## Whitespace and indentation

`html\`\`` automatically strips leading and trailing blank lines and dedents the template based on the minimum indentation found. This keeps rendered output clean regardless of how the template is indented in source:

```ts twoslash
import { html } from "ilha";

const result = html`
  <div>
    <p>Hello</p>
  </div>
`;
// → <div>\n  <p>Hello</p>\n</div>
```

## Return type

html&grave;&grave; returns a `RawHtml` object, not a plain string. This lets ilha distinguish between trusted and untrusted content when the result is interpolated into another template. To get the plain string value, access `.value` or let ilha unwrap it at a render boundary:

```ts twoslash
import { html } from "ilha";

const result = html`<p>hello</p>`;

result.value; // → "<p>hello</p>"
```

In practice you rarely need to access `.value` directly — ilha handles unwrapping automatically at render time.

## Notes

- html&grave;&grave; is purely a runtime helper with no compiler step. It works in any JavaScript environment including Node, Bun, Deno, and the browser.
- Do not use html&grave;&grave; for CSS or attribute values where HTML escaping is not appropriate. Use the [css&grave;&grave;](/guide/helpers/css) tag for stylesheets and plain template literals for everything else.
