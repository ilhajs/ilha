---
title: Core Concepts
---

ilha is built around a small set of ideas: islands, signals, HTML-first rendering, and a builder-based API. Once these click, the rest of the library feels straightforward.

## Islands

An island is a self-contained UI component that can render itself to HTML on the server and mount itself in the browser. It owns its own state, behavior, and rendering, so each piece of interactivity stays local and explicit.

This makes ilha a good fit for server-rendered pages that only need interactivity in specific places. Instead of turning the whole page into one client app, you can activate only the parts that need to be interactive.

## Isomorphic components

The same island can be used in two ways:

- Rendered to an HTML string for SSR.
- Mounted into a DOM element for client-side interactivity.

That means you do not have to split a component into separate “server” and “client” versions. One definition can handle both output and activation.

## Signals

ilha uses signals for reactive state. A signal is a value you can read and update, and when it changes, the island reacts to that change.

A state accessor works as both a getter and setter:

```ts
state.count(); // read
state.count(5); // write
```

Inside `html\`\``, you can interpolate the accessor directly:

```ts
html`<p>${state.count()}</p>`;
```

This keeps reactive state small and direct. You read what you need, update what you need, and the island updates accordingly.

## Builder chain

You create islands with a fluent builder chain. Each method adds one capability, and [`.render()`](/guide/island/render) finalizes the component.

A typical island might include:

- [`.input()`](/guide/island/input) for typed props.
- [`.state()`](/guide/island/state) for local reactive state.
- [`.derived()`](/guide/island/derived) for computed or async values.
- [`.on()`](/guide/island/on) for event handlers.
- [`.bind()`](/guide/island/bind) for form binding.
- [`.effect()`](/guide/island/effect) and [`.onMount()`](/guide/island/onmount) for side effects.
- [`.slot()`](/guide/island/slot) for child islands.
- [`.css()`](/guide/island/css) for scoped styles.
- [`.render()`](/guide/island/render) to produce the final island.

This step-by-step structure is one of the core design ideas in ilha. Instead of putting everything in one large options object, you compose behavior in a readable chain.

## HTML-first rendering

ilha uses tagged template literals to build HTML. The main template helper is [`html`](/guide/helpers/html), which escapes interpolated values by default.

```ts twoslash
const userInput = "Ilha is awesome";
// ---cut---
import { html } from "ilha";

html`<p>${userInput}</p>`;
```

This keeps markup easy to read while making the safe path the default. If you really need to inject trusted markup, you can opt into that explicitly with [`raw()`](/guide/helpers/raw).

## Derived values

Not every value belongs in local state. Sometimes a component needs data that depends on state or input, including async data.

That is what [`.derived()`](/guide/island/derived) is for. A derived value exposes a small envelope with:

- `loading`
- `value`
- `error`

This makes loading and error states part of the normal rendering model instead of something bolted on from the outside.

## Events and effects

ilha separates user interaction from side effects.

Use [`.on()`](/guide/island/on) for DOM events such as clicks, input, and change events. Use [`.effect()`](/guide/island/effect) when you want reactive behavior that runs after mount and reruns when its dependencies change. Use [`.onMount()`](/guide/island/onmount) when something should run once after the island is attached to the DOM.

This separation helps keep component logic easier to scan:

- Events respond to user actions.
- Effects respond to reactive changes.
- Mount hooks handle lifecycle setup.

## Scoped styles

ilha supports component-level styles with [`.css()`](/guide/island/css). Styles are scoped to the island so they stay local and do not leak into nested child islands.

This lets you keep structure, behavior, and styling close together when that is useful, without giving up isolation.

## Slots

An island can include other islands through named slots. This gives you composition without losing encapsulation.

A parent can render a child island inline during SSR, and that child can still mount independently on the client. In practice, this means you can build larger interfaces out of smaller interactive units.

## SSR and hydration

ilha is designed to work naturally with server rendering and hydration. You can render HTML on the server, send it to the browser, and later activate the island in place.

When using hydratable output, ilha can also embed snapshots of state and derived values. That helps restore the component without unnecessary work on first mount.

## Mental model

A useful way to think about an island is:

- **Input** is data coming in.
- **State** is reactive data owned by the component.
- **Derived** is data computed from input or state.
- **Render** turns all of that into HTML.
- **Mount** activates behavior in the browser.

If you keep that model in mind, most of the API becomes intuitive. Each builder method just adds one more piece to that flow.
