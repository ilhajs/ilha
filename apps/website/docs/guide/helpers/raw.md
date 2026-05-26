---
title: raw()
description: Mark strings as trusted HTML to bypass escaping in JSX and html templates.
---

# Raw

Marks a string as trusted HTML, bypassing escaping when rendered in JSX or interpolated inside [`html`](/guide/helpers/html). Use it when you need to inject markup you fully control — icons, pre-rendered fragments, or server-sanitized content.

## Basic usage

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import { raw } from "ilha";

<div>{raw("<em>hello</em>")}</div>;
// → <div><em>hello</em></div>
```

Without `raw()`, the same string would be escaped:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
<div>{"<em>hello</em>"}</div>
// → <div>&lt;em&gt;hello&lt;/em&gt;</div>
```

## When to use it

`raw()` is appropriate when the markup comes from a source you fully control:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import ilha, { raw } from "ilha";

// SVG icons defined in your codebase
const chevron = `<svg viewBox="0 0 16 16">
    <path d="M4 6l4 4 4-4"/>
</svg>`;

const Dropdown = ilha
  // [!code highlight]
  .render(() => <button>Options {raw(chevron)}</button>);
```

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import { raw } from "ilha";

// Pre-rendered HTML from a trusted server-side renderer
const renderedMarkdown = `<h1>Title</h1><p>Body text.</p>`;

<article>{raw(renderedMarkdown)}</article>;
```

## When not to use it

Never pass user input to `raw()`. It disables all escaping, so any unescaped string becomes a potential XSS vector:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import { raw } from "ilha";

// ❌ Never do this
const userComment = `<script>alert(1)</script>`;
<p>{raw(userComment)}</p>;

// ✅ Do this instead — JSX escapes it automatically
<p>{userComment}</p>;
```

## Composing with JSX

JSX results are already treated as safe and pass through unescaped without needing `raw()`. Reserve `raw()` for plain strings that contain trusted markup:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import { raw } from "ilha";

// JSX result — no raw() needed
const badge = <span class="badge">New</span>;
<div>{badge}</div>;

// Plain string with markup — raw() required
const iconStr = `<svg>…</svg>`;
<div>{raw(iconStr)}</div>;
```

## Return type

`raw()` returns a `RawHtml` object. This means raw values compose freely with JSX and arrays:

```tsx twoslash
/** @jsxImportSource ilha */
// ---cut---
import { raw } from "ilha";

const icons = ["<svg>…</svg>", "<svg>…</svg>"];

<ul>
  {icons.map((icon) => (
    <li>{raw(icon)}</li>
  ))}
</ul>;
```

## Notes

- `raw()` only has an effect when rendered by ilha JSX or [`html`](/guide/helpers/html). Elsewhere it simply wraps the string in a `RawHtml` object with no other transformation.
- There is no runtime sanitization inside `raw()`. If you need to accept user-generated HTML, sanitize it with a dedicated library such as [DOMPurify](https://github.com/cure53/DOMPurify) before passing it to `raw()`.
