---
title: raw()
description: Mark strings as trusted HTML to bypass escaping inside html`` templates.
---

# Raw

Marks a string as trusted HTML, bypassing escaping when interpolated inside [`html`](/guide/helpers/html). Use it when you need to inject markup you fully control — icons, pre-rendered fragments, or server-sanitized content.

## Basic usage

```ts twoslash
import { html, raw } from "ilha";

html`<div>${raw("<em>hello</em>")}</div>`;
// → <div><em>hello</em></div>
```

Without `raw()`, the same string would be escaped:

```ts twoslash
import { html } from "ilha";

html`<div>${"<em>hello</em>"}</div>`;
// → <div>&lt;em&gt;hello&lt;/em&gt;</div>
```

## When to use it

`raw()` is appropriate when the markup comes from a source you fully control:

```ts twoslash
import ilha, { html, raw } from "ilha";

// SVG icons defined in your codebase
const chevron = `<svg viewBox="0 0 16 16">
    <path d="M4 6l4 4 4-4"/>
</svg>`;

const Dropdown = ilha
  // [!code highlight]
  .render(() => html`<button>Options ${raw(chevron)}</button>`);
```

```ts twoslash
import { html, raw } from "ilha";

// Pre-rendered HTML from a trusted server-side renderer
const renderedMarkdown = `<h1>Title</h1><p>Body text.</p>`;

html`<article>${raw(renderedMarkdown)}</article>`;
```

## When not to use it

Never pass user input to `raw()`. It disables all escaping, so any unescaped string becomes a potential XSS vector:

```ts twoslash
import { html, raw } from "ilha";

// ❌ Never do this
const userComment = `<script>alert(1)</script>`;
html`<p>${raw(userComment)}</p>`;

// ✅ Do this instead — html`` escapes it automatically
html`<p>${userComment}</p>`;
```

## Composing with [`html`](/guide/helpers/html)

[`html`](/guide/helpers/html) results are already treated as safe and pass through unescaped without needing`raw()`. Reserve `raw()` for plain strings that contain trusted markup:

```ts twoslash
import { html, raw } from "ilha";

// html`` result — no raw() needed
const badge = html`<span class="badge">New</span>`;
html`<div>${badge}</div>`;

// Plain string with markup — raw() required
const iconStr = `<svg>…</svg>`;
html`<div>${raw(iconStr)}</div>`;
```

## Return type

`raw()` returns a `RawHtml` object — the same type produced by [`html`](/guide/helpers/html). This means raw values compose freely with nested templates and arrays:

```ts twoslash
import { html, raw } from "ilha";

const icons = ["<svg>…</svg>", "<svg>…</svg>"];

html`
  <ul>
    ${icons.map((icon) => html`<li>${raw(icon)}</li>`)}
  </ul>
`;
```

## Notes

- `raw()` only has an effect inside [`html`](/guide/helpers/html). Outside of a template it simply wraps the string in a `RawHtml` object with no other transformation.
- There is no runtime sanitization inside `raw()`. If you need to accept user-generated HTML, sanitize it with a dedicated library such as [DOMPurify](https://github.com/cure53/DOMPurify) before passing it to `raw()`.
