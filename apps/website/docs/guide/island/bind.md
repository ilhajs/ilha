---
title: .bind()
---

Two-way binds a form element to a state key or external signal. When the state changes, the element updates. When the user interacts with the element, the state updates.

## Basic usage

```ts twoslash
import ilha, { html } from "ilha";

const Form = ilha
  .state("name", "")
  .bind("input.name", "name")
  .render(
    ({ state }) => html`
      <form>
        <input class="name" />
        <p>Hello, ${state.name}!</p>
      </form>
    `,
  );
```

## Supported elements

`.bind()` handles the correct property and event for each element type automatically:

| Element                       | Bound property      | Trigger event |
| ----------------------------- | ------------------- | ------------- |
| `<input>` (text, email, etc.) | `value`             | `input`       |
| `<input type="number">`       | `valueAsNumber`     | `input`       |
| `<input type="checkbox">`     | `checked`           | `change`      |
| `<input type="radio">`        | `checked` / `value` | `change`      |
| `<select>`                    | `value`             | `change`      |
| `<textarea>`                  | `value`             | `input`       |

No configuration needed — the element type is detected at runtime.

## Multiple bindings

Chain `.bind()` for each form element:

```ts twoslash
import ilha, { html } from "ilha";

const Settings = ilha
  .state("username", "")
  .state("notifications", true)
  .state("role", "viewer")
  .bind("input.username", "username")
  .bind("input[type=checkbox]", "notifications")
  .bind("select.role", "role")
  .render(
    ({ state }) => html`
      <form>
        <input class="username" />
        <input type="checkbox" />
        <select class="role">
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
        <p>${state.username} · ${state.role}</p>
      </form>
    `,
  );
```

## Type coercion

`.bind()` reads the current state value to determine the expected type and coerces the element's raw string output accordingly:

- A `number` state receives `valueAsNumber`, with `NaN` falling back to `0`.
- A `boolean` state receives a boolean coercion of the element's value.
- Everything else is treated as a string.

This means you rarely need to parse or cast values manually in your handlers.

## Binding to an external signal

Instead of a state key, you can pass a signal created with [`context()`](/guide/helpers/context). This is useful when multiple islands need to share the same form value:

```ts twoslash
import ilha, { html, context } from "ilha";

const theme = context("app.theme", "light");

const ThemePicker = ilha.bind("select", theme).render(
  () => html`
    <select>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  `,
);
```

## Binding the host element

Pass an empty string as the selector to bind the island host element itself:

```ts twoslash
import ilha from "ilha";

const Island = ilha
  .state("value", "")
  .bind("", "value")
  .render(({ state }) => `<input value="${state.value()}" />`);
```

## Combining with `.on()`

`.bind()` handles value synchronization. If you also need to react to the same change — for example to trigger validation — combine it with `.on()`:

```ts twoslash
import ilha, { html } from "ilha";

const EmailForm = ilha
  .state("email", "")
  .state("error", "")
  .bind("input", "email")
  .on("input@input", ({ state }) => {
    const valid = state.email().includes("@");
    state.error(valid ? "" : "Enter a valid email");
  })
  .render(
    ({ state }) => html`
      <input type="email" />
      ${state.error() ? html`<p>${state.error}</p>` : ""}
    `,
  );
```

## Dev mode warnings

In development, if the selector matches no elements at mount time, ilha logs a warning. Check that the element exists in your render output and that the selector is correct.

## Notes

- `.bind()` initializes the element's value from state on mount, so the element always reflects the current state on first render.
- For radio inputs, `.bind()` sets `checked` on the radio whose `value` attribute matches the current state value. Writing a new value to state checks the matching radio automatically.
- `.bind()` does not replace `.on()` — it only handles value synchronization. Use `.on()` for anything beyond reading and writing the element's value.
