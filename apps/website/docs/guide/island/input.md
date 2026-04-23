---
title: .input()
---

# Input

Declares the island's external props and their types. Two forms are supported: a type-only generic for when you just need TypeScript inference, and a [Standard Schema](https://standardschema.dev/)-compatible validator (Zod, Valibot, ArkType, etc.) for runtime validation too.

## Basic usage

**Type-only** — TypeScript inference, no runtime validation:

```ts twoslash
import ilha from "ilha";

const Greeting = ilha
  .input<{ name: string }>() // [!code highlight]
  .render(({ input }) => `<p>Hello, ${input.name}!</p>`);

Greeting.toString({ name: "ilha" }); // → <p>Hello, ilha!</p>
```

**With a schema** — inference plus runtime validation and coercion:

```ts twoslash
import ilha from "ilha";
import { z } from "zod";

const Greeting = ilha
  .input(z.object({ name: z.string().default("World") })) // [!code highlight]
  .render(({ input }) => `<p>Hello, ${input.name}!</p>`);

Greeting.toString({ name: "ilha" }); // → <p>Hello, ilha!</p>
Greeting.toString(); // → <p>Hello, World!</p>
```

## Why use `.input()`

Without `.input()`, any props passed to an island are untyped and unvalidated. Adding a type or schema gives you:

- Full TypeScript inference for `input` inside [`.state()`](/guide/island/state), [`.render()`](/guide/island/render), [`.on()`](/guide/island/on), [`.effect()`](/guide/island/effect), and every other builder method.
- Runtime validation and coercion on every call, including during SSR and hydration (schema form only).
- Default values handled by the schema itself, so the island works without props (schema form only).

## Choosing a form

|                      | `.input<T>()` | `.input(schema)`       |
| -------------------- | ------------- | ---------------------- |
| TypeScript inference | ✓             | ✓                      |
| Runtime validation   | —             | ✓                      |
| Default values       | —             | ✓ (via schema)         |
| Extra dependency     | —             | ✓ (Zod, Valibot, etc.) |

Use `.input<T>()` for simple islands where you control the call sites and don't need validation. Use `.input(schema)` when you need defaults, coercion, or validation — especially for islands that are hydrated from serialized server props.

## Using defaults

Defaults are defined in the schema, not in ilha. Any Standard Schema validator that supports defaults will apply them automatically when a prop is omitted.

```ts twoslash
import ilha from "ilha";
import { z } from "zod";

const Card = ilha
  .input(
    z.object({
      title: z.string(),
      accent: z.string().default("teal"),
    }),
  )
  .render(({ input }) => `<div style="color:${input.accent}">${input.title}</div>`);
```

## State initialized from input

Once you have typed input, you can use it to initialize state:

```ts twoslash
import ilha from "ilha";
import { z } from "zod";

const Counter = ilha
  .input(z.object({ start: z.number().default(0) }))
  .state("count", ({ start }) => start) // [!code highlight]
  .render(({ state }) => `<p>${state.count()}</p>`);
```

The initializer function receives the resolved input object, so state stays in sync with whatever props were passed in. This works identically with both forms.

## Async schemas

Async schemas are not supported. If your validator's `validate()` method returns a `Promise`, ilha will throw at runtime. Keep schemas synchronous.

## Notes

- `.input()` must be called before any other builder method if you want the input type to flow through the chain.
- Calling `.input()` resets the builder — any previously chained [`.state()`](/guide/island/state) or other methods are not carried over.
- If `.input()` is omitted entirely, props are accepted as `Record<string, unknown>` with no validation.
