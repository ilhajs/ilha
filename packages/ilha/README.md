# `ilha`

A tiny, isomorphic island framework for building reactive UI components. Runs in the browser with fine-grained signal reactivity and on the server as a synchronous HTML string renderer. Powered by [alien-signals](https://github.com/stackblitz/alien-signals) — zero virtual DOM, no compiler required.

---

## Installation

```bash
npm install ilha
# or Bun
bun add ilha
```

---

## Quick Start

```ts
import ilha, { html } from "ilha";

const Counter = ilha
  .state("count", 0)
  .on("button@click", ({ state }) => state.count(state.count() + 1))
  .render(
    ({ state }) => html`
      <div>
        <p>Count: ${state.count()}</p>
        <button>Increment</button>
      </div>
    `,
  );

// SSR
Counter.toString(); // → '<div><p>Count: 0</p><button>Increment</button></div>'

// Client
Counter.mount(document.getElementById("app"));
```

---

## Core Concepts

Islands are **self-contained reactive components** that know how to render themselves to an HTML string (SSR) and mount themselves into the DOM (client). You build an island using a fluent builder chain: declare inputs, state, events, effects, then call `.render()` to get a callable `Island` object.

State is managed with signals — when a signal changes, only the affected island re-renders using a minimal DOM morph. No virtual DOM diffing, no framework overhead.

---

## Builder API

Every island starts from the `ilha` builder object (or `ilha.input<T>()` / `ilha.input(schema)` if you need typed props).

### `ilha.input<T>()` / `ilha.input(schema)`

Declares the island's external input type. Two forms:

**1. Type-only (no runtime validation):**

```ts
const MyIsland = ilha
  .input<{ name: string }>()
  .render(({ input }) => `<p>Hello, ${input.name}!</p>`);
```

**2. With a [Standard Schema](https://standardschema.dev/) validator** (Zod, Valibot, ArkType, etc.) — runs validation at render time and uses the schema's inferred output type:

```ts
import { z } from "zod";

const MyIsland = ilha
  .input(z.object({ name: z.string().default("World") }))
  .render(({ input }) => `<p>Hello, ${input.name}!</p>`);

MyIsland.toString({ name: "Ilha" }); // → '<p>Hello, Ilha!</p>'
```

Async schemas are not supported.

---

### `.state(key, init?)`

Declares a reactive state signal. The initial value can be a static value or a function receiving the resolved `input`.

```ts
ilha
  .state("count", 0)
  .state("name", "anonymous")
  .state("double", ({ count }) => count * 2) // init from input
  .render(({ state }) => `<p>${state.count()}</p>`);
```

State accessors are **getters and setters** — call without arguments to read, call with a value to write:

```ts
state.count(); // → 0  (read)
state.count(5); // → sets to 5 (write)
```

Inside `html\`\``, you can interpolate signal accessors directly **without calling them** — `ilha` detects signal accessors and calls them for you, also applying HTML escaping:

```ts
html`<p>${state.count}</p>`; // same as html`<p>${state.count()}</p>`
```

---

### `.derived(key, fn)`

Declares an async (or sync) derived value. The function receives `{ state, input, signal }` where `signal` is an `AbortSignal` that aborts on re-run. Re-runs automatically when any reactive dependency changes.

```ts
ilha
  .state("userId", 1)
  .derived("user", async ({ state, signal }) => {
    const res = await fetch(`/api/users/${state.userId()}`, { signal });
    return res.json();
  })
  .render(({ derived }) => {
    if (derived.user.loading) return `<p>Loading…</p>`;
    if (derived.user.error) return `<p>Error: ${derived.user.error.message}</p>`;
    return `<p>${derived.user.value.name}</p>`;
  });
```

Each derived value exposes `{ loading, value, error }`.

---

### `.on(selector, handler)`

Attaches a delegated event listener. The selector string uses the format `"cssSelector@eventName"`. Omit the selector part to target the island host itself.

```ts
ilha
  .state("count", 0)
  .on("@click", ({ state }) => state.count(state.count() + 1)) // host click
  .on("button.inc@click", ({ state }) => state.count(state.count() + 1)) // child click
  .on("input@input", ({ state, event }) => {
    state.query((event.target as HTMLInputElement).value);
  })
  .render(({ state }) => html`<div><button class="inc">+</button></div>`);
```

**Event modifiers** — append after a `:` separator:

| Modifier    | Description                                                               |
| ----------- | ------------------------------------------------------------------------- |
| `once`      | Listener fires only once                                                  |
| `capture`   | Capture phase                                                             |
| `passive`   | `{ passive: true }`                                                       |
| `abortable` | `ctx.signal` aborts when the same listener fires again on the same target |

Multiple modifiers can be combined: `@click:once:capture`.

The handler receives a `HandlerContext`:

```ts
{
  state: IslandState; // reactive state signals
  derived: IslandDerived; // derived values
  input: TInput; // resolved input props
  host: Element; // island root element
  target: Element; // element that fired the event (typed per event name)
  event: Event; // the native event (typed per event name)
  signal: AbortSignal; // aborts on unmount, and on next fire if `:abortable`
}
```

**Cancelling async work with `ctx.signal`** — pass it to `fetch` or any abort-aware API to cancel stale requests when the island unmounts:

```ts
ilha
  .state("results", [])
  .on("button@click", async ({ state, signal }) => {
    const res = await fetch("/api/data", { signal });
    state.results(await res.json());
  })
  .render(
    () =>
      html`<button>Load</button>
        <ul></ul>`,
  );
```

**Race-cancellation with `:abortable`** — when the same listener fires again on the same target, the previous invocation's signal aborts. Useful for search-as-you-type and other patterns where only the latest invocation should win:

```ts
ilha
  .on("input@input:abortable", async ({ state, event, signal }) => {
    const q = (event.target as HTMLInputElement).value;
    const res = await fetch(`/search?q=${q}`, { signal }); // earlier requests cancelled
    if (signal.aborted) return;
    state.results(await res.json());
  })
  .render(
    () =>
      html`<input />
        <ul></ul>`,
  );
```

Race-cancellation is scoped per-target — clicking button A doesn't cancel an in-flight handler on button B.

**Implicit batching** — multiple synchronous state writes in a single handler produce one re-render, not one per write:

```ts
.on("@click", ({ state }) => {
  state.a(1);
  state.b(2);
  state.c(3); // → one render, not three
})
```

`AbortError` rejections from cancelled async work are filtered out automatically — they do not reach `.onError()` or `console.error`.

---

### `.effect(fn)`

Registers a reactive effect that runs after mount and re-runs when any signal it reads changes. Optionally returns a cleanup function.

```ts
ilha
  .state("title", "Hello")
  .effect(({ state }) => {
    document.title = state.title();
    return () => {
      document.title = "";
    }; // cleanup on unmount or re-run
  })
  .render(({ state }) => `<p>${state.title()}</p>`);
```

The handler receives an `EffectContext`:

```ts
{
  state: IslandState;
  input: TInput;
  host: Element;
  signal: AbortSignal; // aborts when the effect re-runs OR the island unmounts
}
```

**Cancelling async work with `ctx.signal`** — unlike `.on()`, race-cancellation is the **default** behaviour for effects (no opt-in modifier needed) because dependency changes invariably make the previous run stale. Pass `signal` to async work to bail out of stale invocations without needing a manual cleanup function:

```ts
ilha
  .state("userId", 1)
  .state("user", null)
  .effect(({ state, signal }) => {
    (async () => {
      try {
        const res = await fetch(`/api/users/${state.userId()}`, { signal });
        if (signal.aborted) return;
        state.user(await res.json());
      } catch (err) {
        if (err && (err as Error).name === "AbortError") return;
        throw err;
      }
    })();
  })
  .render(({ state }) => html`<p>${state.user?.name ?? "Loading…"}</p>`);
```

Both the user-supplied cleanup function (if any) and the signal abort fire when the effect re-runs, so you can mix patterns.

**Implicit batching** — multiple synchronous state writes inside an effect run produce a single propagation pass.

---

### `.onMount(fn)`

Runs once after the island is mounted into the DOM. Receives `{ state, derived, input, host, hydrated }` where `hydrated` is `true` when the island was mounted over existing SSR content. Optionally returns a cleanup function called on unmount.

```ts
ilha
  .onMount(({ host, hydrated }) => {
    console.log("mounted", hydrated ? "(hydrated)" : "(fresh)");
    return () => console.log("unmounted");
  })
  .render(() => `<div>hello</div>`);
```

`.onMount()` is skipped when `snapshot.skipOnMount` is set via `.hydratable()`.

---

### `.onError(fn)`

Registers an error handler that catches errors thrown by `.on()` handlers (sync throws and async rejections) and `.effect()` runs (sync throws). Multiple `.onError()` calls compose — all run in declaration order. If no `.onError()` is registered, errors fall back to `console.error` so they are never silently swallowed.

```ts
ilha
  .state("count", 0)
  .on("@click", ({ state }) => {
    if (state.count() > 5) throw new Error("too many clicks");
    state.count(state.count() + 1);
  })
  .onError(({ error, source }) => {
    console.error(`[${source}] ${error.message}`);
    Sentry.captureException(error);
  })
  .render(({ state }) => `<button>${state.count()}</button>`);
```

The handler receives an `ErrorContext`:

```ts
{
  error: Error; // always wrapped to Error if a non-Error was thrown
  source: "on" | "effect";
  state: IslandState;
  derived: IslandDerived;
  input: TInput;
  host: Element;
}
```

`AbortError` rejections from `.on()` handlers are **not** routed to `.onError()` — they are the expected outcome of cancellation (via `:abortable` race-cancel or unmount) and would otherwise pollute error tracking.

An error thrown inside an `.onError()` handler does not break other registered handlers; it is logged to `console.error` and execution continues with the next handler.

---

### `.bind(selector, stateKey | externalSignal)`

Two-way binds a form element to a state key or an external signal. Handles `input`, `select`, `textarea`, `checkbox`, `radio`, and `number` inputs automatically.

```ts
ilha
  .state("name", "")
  .state("agreed", false)
  .bind("input.name", "name")
  .bind("input[type=checkbox]", "agreed")
  .render(
    ({ state }) => html`
      <form>
        <input class="name" value="${state.name}" />
        <input type="checkbox" />
        <p>Hello, ${state.name}! Agreed: ${state.agreed}</p>
      </form>
    `,
  );
```

You can also bind to an external signal — either a free-standing one created with `signal()` or a named global one created with `context()`:

```ts
import { signal, context } from "ilha";

const username = signal("");
const theme = context("app.theme", "light");

ilha.bind("input.name", username).bind("select.theme", theme).render(/* … */);
```

---

### `.css(strings, ...values)`

Attaches scoped styles to the island. Accepts a tagged template literal or a plain string. The CSS is automatically wrapped in a `@scope` rule bounded to the island host, so styles are contained within the island and do not leak into child islands.

```ts
import { css } from "ilha";

const Card = ilha.state("active", false).css`
    .title { font-weight: 700; }
    button { background: teal; color: white; }
  `.render(
  ({ state }) => html`
    <div>
      <p class="title">Hello</p>
      <button>Toggle</button>
    </div>
  `,
);
```

Interpolations are supported:

```ts
const accent = "teal";

ilha.css`button { background: ${accent}; }`.render(() => `<button>Go</button>`);
```

You can also pass a plain string (e.g. from an external `.css` file):

```ts
import styles from "./card.css?raw";

ilha.css(styles).render(() => `<div class="card">…</div>`);
```

**SSR output** — a `<style data-ilha-css>` tag is prepended as the first child of the island's rendered HTML:

```html
<style data-ilha-css>
  @scope (:scope) to ([data-ilha]) {
    .title {
      font-weight: 700;
    }
  }
</style>
<div>…</div>
```

**Client mount** — the style element is injected once as the first child of the host and preserved across re-renders (morph never replaces it). During hydration, the SSR-emitted `<style>` node is reused and not duplicated.

**`.hydratable()` integration** — the style tag is included inside the `data-ilha` wrapper regardless of the `snapshot` option.

> **Note:** Calling `.css()` more than once on the same builder chain is not supported. In dev mode a warning is logged and only the last stylesheet is used. Compose all your styles into a single `.css()` call.

---

### Composing Islands

Child islands are interpolated directly inside a parent's html&grave;&grave; template. During SSR the child's HTML is rendered inline; during client mount the child is activated independently inside its own host element.

```ts
const Icon = ilha.render(() => `<svg>…</svg>`);

const Card = ilha.render(
  () => html`
    <div class="card">
      ${Icon}
      <p>Card content</p>
    </div>
  `,
);
```

**Passing props** — call the child island with a props object:

```ts
const Badge = ilha
  .input(z.object({ label: z.string(), color: z.string().default("teal") }))
  .render(({ input }) => html`<span style="background:${input.color}">${input.label}</span>`);

const Card = ilha.render(
  () => html`
    <div>
      ${Badge({ label: "New", color: "coral" })}
      <p>Content</p>
    </div>
  `,
);
```

**Keyed children** — use `.key()` when a child may reorder or appear conditionally. Keys must be unique within a parent render:

```ts
const List = ilha.render(
  () =>
    html`<ul>
      ${items.map((item) => html`<li>${Item.key(item.id)({ name: item.name })}</li>`)}
    </ul>`,
);
```

---

### `.transition(opts)`

Attaches enter/leave transition callbacks called on mount and unmount respectively.

```ts
ilha
  .transition({
    enter: async (host) => {
      host.animate([{ opacity: 0 }, { opacity: 1 }], 300).finished;
    },
    leave: async (host) => {
      await host.animate([{ opacity: 1 }, { opacity: 0 }], 300).finished;
    },
  })
  .render(() => `<div>content</div>`);
```

The `leave` transition is awaited before cleanup runs.

---

### `.render(fn)`

Finalises the builder and returns an `Island`. The render function receives `{ state, derived, input }` and must return a string or `RawHtml`.

```ts
const MyIsland = ilha.state("x", 1).render(({ state, input }) => html`<p>${state.x}</p>`);
```

---

## Island Interface

Every island produced by `.render()` exposes:

### `island(props?)` / `island.toString(props?)`

Render the island to an HTML string synchronously. `island.toString()` is always synchronous. If `.derived()` entries have async functions, they render in `loading: true` state when called synchronously.

Calling `island(props)` returns a `string` (or `Promise<string>` when derived values are async and awaited).

```ts
MyIsland.toString(); // always sync
MyIsland.toString({ name: "Ilha" }); // with props
await MyIsland({ name: "Ilha" }); // async — awaits derived
```

---

### `island.mount(host, props?)`

Mounts the island into a DOM element. Reads `data-ilha-props` and `data-ilha-state` from the host element automatically — no need to pass props when hydrating SSR output.

Returns an `unmount` function.

```ts
const unmount = MyIsland.mount(document.getElementById("app"));
unmount(); // → stops effects, removes listeners, runs leave transition
```

In dev mode, double-mounting the same element logs a warning and returns a no-op.

---

### `island.hydratable(props, options)`

Async method that renders the island wrapped in a `data-ilha` hydration container. Used for SSR+hydration pipelines.

```ts
const html = await MyIsland.hydratable(
  { name: "Ilha" },
  {
    name: "MyIsland", // registry key for client-side activation
    as: "div", // wrapper tag (default: "div")
    snapshot: true, // embed state + derived as data-ilha-state
    skipOnMount: false, // skip onMount on hydration (default: true when snapshot)
  },
);
// → '<div data-ilha="MyIsland" data-ilha-props="…" data-ilha-state="…">…</div>'
```

**`snapshot` option:**

| Value                             | Behaviour                                     |
| --------------------------------- | --------------------------------------------- |
| `false`                           | No snapshot — onMount always runs             |
| `true`                            | Snapshots both state and derived values       |
| `{ state: true, derived: false }` | Fine-grained control over what is snapshotted |

---

## Top-level Helpers

### `ilha.mount(registry, options?)` / `mount(registry, options?)`

Auto-discovers all `[data-ilha]` elements in the DOM and mounts the corresponding island from the registry.

```ts
import { mount } from "ilha";

const { unmount } = mount(
  { counter: Counter, card: Card },
  {
    root: document.getElementById("app"), // default: document.body
    lazy: true, // use IntersectionObserver (mount on visibility)
  },
);

unmount(); // → unmounts all discovered islands
```

---

### `ilha.from(selector, island, props?)` / `from(selector, island, props?)`

Mounts a single island into the first element matching `selector`. Returns the `unmount` function, or `null` if the element is not found.

```ts
import { from } from "ilha";

const unmount = from("#hero", HeroIsland, { title: "Welcome" });
```

---

### `signal(initial)`

Creates a free-standing reactive signal that lives outside any island. Useful for sharing state across multiple islands without prop drilling, or for binding form inputs to module-level state.

```ts
import { signal } from "ilha";

const count = signal(0);

count(); // → 0  (read)
count(5); // → sets to 5 (write)
```

Reading the signal inside any reactive scope — `.render()`, `.derived()`, `.effect()` — automatically subscribes that scope, so when the signal changes, dependents re-run as if it were local state.

```ts
import ilha, { signal, html } from "ilha";

const username = signal("anonymous");

const Header = ilha.render(() => html`<header>Hi, ${username()}!</header>`);
const Footer = ilha.render(() => html`<footer>Logged in as ${username()}</footer>`);

// Both islands re-render when `username` changes from anywhere.
username("alice");
```

Pairs naturally with `.bind()` for two-way form bindings against module-level state.

---

### `context(key, initial)`

Creates a **global context signal** — a named reactive signal shared across all islands. Identical keys always return the same signal instance, which makes it useful for app-wide singletons (theme, locale, current user) where you want the registry semantics.

```ts
import { context } from "ilha";

const theme = context("app.theme", "light");

theme(); // → "light"
theme("dark"); // → sets to "dark"
```

Safe to call in both SSR and browser environments.

> **`signal()` vs `context()`** — both return the same accessor shape and can be passed to `.bind()`. Use `signal()` for one-off shared state where you'd hold the reference yourself; use `context()` when you want a name-keyed registry so the same signal can be looked up from anywhere by string key.

---

### `batch(fn)`

Runs `fn` as an atomic batch — multiple signal writes inside the callback produce a single propagation pass, so dependents see the final state and run once instead of once per write. Returns whatever `fn` returns.

```ts
import { signal, batch } from "ilha";

const a = signal(0);
const b = signal(0);

// Without batch: each write triggers a propagation pass.
a(1); // → effects re-run
b(2); // → effects re-run

// With batch: both writes flush together.
batch(() => {
  a(10);
  b(20);
}); // → effects re-run once
```

`.on()` handlers and `.effect()` runs are batched implicitly, so you only need `batch()` when triggering multiple writes from outside an island — e.g. from a top-level event listener, a `setTimeout` callback, or a WebSocket message handler. Nested `batch()` calls are safe and only flush when the outermost batch ends.

---

### `untrack(fn)`

Runs `fn` with reactive tracking suspended. Reading signals inside `fn` returns their current value without subscribing the surrounding scope. Use this in effects or deriveds when you want to peek at state without causing a re-run on its changes.

```ts
import ilha, { signal, untrack } from "ilha";

const tracked = signal(0);
const peeked = signal("hello");

ilha
  .effect(() => {
    // Re-runs when `tracked` changes, but NOT when `peeked` changes.
    console.log(
      tracked(),
      untrack(() => peeked()),
    );
  })
  .render(() => `<p>x</p>`);
```

Returns whatever `fn` returns.

---

### `html\`\`` tagged template

XSS-safe HTML template tag. Interpolated values are HTML-escaped by default. Pass `raw()` to opt out of escaping.

```ts
import { html, raw } from "ilha";

const name = "<script>alert(1)</script>";
html`<p>${name}</p>`; // → <p>&lt;script&gt;…</p>  (escaped)
html`<p>${raw("<b>hi</b>")}</p>`; // → <p><b>hi</b></p>      (raw)
```

Interpolation rules:

| Value type           | Behaviour                                   |
| -------------------- | ------------------------------------------- |
| `string` / `number`  | HTML-escaped                                |
| `null` / `undefined` | Omitted (empty string)                      |
| `raw(str)`           | Inserted as-is (no escaping)                |
| `html\`…\``          | Inserted as-is (already safe)               |
| Signal accessor      | Called and escaped                          |
| Island / Island call | Emitted as `data-ilha-slot` host element    |
| Array                | Each item processed recursively (no commas) |

**List rendering pattern:**

```ts
const items = ["apple", "banana", "cherry"];
html`<ul>
  ${items.map((item) => html`<li>${item}</li>`)}
</ul>`;
```

---

### `raw(value)`

Marks a string as trusted raw HTML, bypassing escaping when used inside `html\`\``.

```ts
import { raw } from "ilha";

raw("<strong>bold</strong>"); // → passes through unescaped
```

---

### `css\`\`` tagged template

A passthrough tagged template for CSS strings. Functionally identical to a plain template literal — no runtime transformation occurs. Its purpose is purely to enable editor tooling (LSP syntax highlighting, Prettier formatting) to recognise the contents as CSS.

```ts
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

ilha.css(styles).render(() => `<button class="label">Go</button>`);
```

Interpolations work as normal string concatenation:

```ts
const accent = "coral";
const styles = css`
  button {
    background: ${accent};
  }
`;
```

> **Note:** `css` (the named export) is the plain passthrough tag for tooling. `ilha.css` is the builder chain method that attaches styles to an island. They are intentionally separate.

---

## SSR + Hydration

The recommended SSR + hydration pattern uses `.hydratable()` on the server and `ilha.mount()` on the client.

### Server

```ts
import { MyIsland } from "./islands";

const html = await MyIsland.hydratable({ count: 42 }, { name: "my-island", snapshot: true });

return `<!doctype html><html><body>${html}</body></html>`;
```

### Client

```ts
import { mount } from "ilha";
import { MyIsland } from "./islands";

mount({ MyIsland });
```

The client reads `data-ilha-state` to restore signal values from the snapshot, skipping a needless re-render and calling `.onMount()` only if `skipOnMount` is not set.

### State snapshot flow

```
server                                    client
──────────────────────────────────────    ──────────────────────────────────────────
.hydratable({ count: 42 }, {              mount({ MyIsland })
  name: "my-island",                        → reads data-ilha-state
  snapshot: true                            → restores signals from snapshot
})                                          → skips onMount (skipOnMount: true)
→ data-ilha-state='{"count":42}'            → attaches event listeners
                                            → starts effects + derived watchers
```

---

## TypeScript

Key exported types:

```ts
import type {
  Island,
  IslandState,
  IslandDerived,
  DerivedValue,
  KeyedIsland,
  HydratableOptions,
  OnMountContext,
  HandlerContext,
  HandlerContextFor,
  ErrorContext,
  ErrorSource,
  ExternalSignal,
  MountOptions,
  MountResult,
} from "ilha";
```

---

## License

MIT
