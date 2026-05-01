# Changelog

## `ilha`

### 0.4.0 - 2026-05-01

- added `:abortable` modifier for `.on()`.
- added `signal` property to the context of `.effect()`.
- added `.onError()` builder method that callects errors from all of the lifecycle.
- added more signal elements.

### 0.3.1 - 2026-04-24

- Fixes hydratable() snapshot interactivity regression.

### 0.3.0 - 2026-04-24

- **Breaking:** Removes `.slot()` builder method and `slots` render context. Child islands are now interpolated directly inside `html\`\``` templates.
- **Breaking:** Removes `SlotAccessor`, `SlotsProxy`, `SlotMap`, and `InferIslandInput` types.
- Adds `ISLAND` and `ISLAND_CALL` symbols for branding islands and composition markers.
- Adds `Island.key()` and `KeyedIsland` for explicit child keys in lists and conditional rendering.
- Adds render-time child preservation across parent re-renders via detach-before-morph / rehome-after-morph.
- Adds backward-compatible island call behavior: inside `html\`\``` it returns a slot marker; outside it returns an SSR string.

### 0.2.1 - 2026-04-23

- Removes `type()` helper.
- Adds `.input<{}>()` simple typing instead of `type()` helper.

### 0.2.0 - 2026-04-21

- Adds scoped CSS with client and SSR support

### 0.1.0 — 2026-04-14

Initial release of **ilha** — a tiny, isomorphic island framework for building reactive UI components. Renders to HTML strings on the server and mounts as fine-grained reactive islands in the browser. No virtual DOM. No compiler. Powered by [alien-signals](https://github.com/stackblitz/alien-signals).

- Adds fluent builder API: `.input(schema)` — typed external props via any Standard Schema validator (Zod, Valibot, ArkType, or the built-in `type()` helper); async schemas are not supported
- Adds fluent builder API: `.state(key, init?)` — reactive signal; init can be a static value or a function receiving resolved input
- Adds fluent builder API: `.derived(key, fn)` — sync or async derived value with `{ loading, value, error }` envelope; re-runs reactively; supports `AbortSignal` cancellation on re-run
- Adds fluent builder API: `.on(selector@event[modifiers], handler)` — delegated event listener with `once`, `capture`, `passive` modifiers; omit selector to target the host; handler receives `{ state, derived, input, host, target, event }`
- Adds fluent builder API: `.effect(fn)` — reactive effect that runs after mount and re-runs when tracked signals change; supports cleanup return
- Adds fluent builder API: `.onMount(fn)` — runs once after mount; receives `{ state, derived, input, host, hydrated }`; supports cleanup return; skipped when `snapshot.skipOnMount` is set
- Adds fluent builder API: `.bind(selector, stateKey | externalSignal)` — two-way binds form elements (input, textarea, select, checkbox, radio, number) to a state key or a context signal
- Adds fluent builder API: `.slot(name, island)` — embeds a child island as a named slot; inline SSR output and independent client activation
- Adds fluent builder API: `.transition({ enter, leave })` — async enter/leave callbacks; leave is awaited before teardown
- Adds fluent builder API: `.render(fn)` — finalises the builder and returns an `Island`
- Adds island interface: `island(props?)` / `island.toString(props?)` — synchronous HTML string render; async derived values render as `loading: true`
- Adds island interface: `await island(props?)` — async render that awaits all derived values
- Adds island interface: `island.mount(host, props?)` — mounts into a DOM element; reads `data-ilha-props` and `data-ilha-state` automatically; returns an `unmount()` function
- Adds island interface: `island.hydratable(props, options)` — async SSR helper wrapping output in a `data-ilha` hydration container with optional state snapshot
- Adds helpers and utilities: `mount(registry, options?)` — auto-discovers `data-ilha` elements and mounts matching islands; supports `root` scoping and `lazy` IntersectionObserver activation
- Adds helpers and utilities: `from(selector | Element, island, props?)` — mounts a single island into the first matching element; returns `unmount` or `null`
- Adds helpers and utilities: `context(key, initial)` — global named reactive signal shared across all islands; same key always returns the same signal instance; SSR-safe
- Adds helpers and utilities: `` html`...` `` — XSS-safe template tag; HTML-escapes by default; supports `raw()`, signal accessors, arrays, and nested `html` results
- Adds helpers and utilities: `raw(value)` — marks a string as trusted raw HTML, bypassing escaping inside `html`
- Adds helpers and utilities: `type(coerce?)` — lightweight Standard Schema validator for `.input()` without a full validation library

## `@ilha/form`

### 0.2.1 - 2026-04-28

- Deprecated the library in favor for handling form management with `@ilha/store` using `@ilha/store/form` helpers.

### 0.2.0 - 2026-04-21

- Adds `defaultValues` property to set initial form state
- Adds Programmatic `form.setValue` API

### 0.1.0 — 2026-04-14

Initial release of **@ilha/form** — a tiny, typed form binding library for ilha islands. Binds a Standard Schema validator to a native `<form>` element; wires up typed submission, per-field error tracking, and dirty state using native DOM events only. No virtual DOM. No external runtime dependencies. Async schema validation is not supported.

- Adds `createForm(options)` — creates a form binding instance; does not attach any listeners until `.mount()` is called; accepts `el`, `schema`, `onSubmit`, `onError`, and `validateOn`
- Adds `createForm` option `onSubmit(values, event)` — called with fully typed schema output on valid submission; not called if validation fails
- Adds `createForm` option `onError(issues, event)` — called with structured `StandardSchemaV1.Issue[]` on invalid submission
- Adds `createForm` option `validateOn` — controls when live validation runs against field changes: `"submit"` (default, submission only), `"change"` (after a field loses focus with a new value), or `"input"` (every keystroke)
- Adds `form.mount()` — attaches event listeners to the form; returns a cleanup function equivalent to calling `form.unmount()`
- Adds `form.unmount()` — removes all event listeners; idempotent, safe to call multiple times
- Adds `form.values` — reads and validates current form values synchronously against the schema; returns a discriminated union `{ ok: true, data }` or `{ ok: false, issues }`; never throws; can be called before mount
- Adds `form.errors` — returns the per-field error map from the last validation run as `Record<string, string[]>`; keys are dot-separated field paths (e.g. `user.email`); empty object before first validation; returns a copy — mutations do not affect internal state
- Adds `form.isDirty` — `true` if any field value has changed since mount was called (detected via `change` events); stays `true` after unmount
- Adds `form.submit()` — programmatically triggers the validate / `onSubmit` / `onError` cycle; dispatches a real `SubmitEvent` when mounted, runs validation directly when not mounted
- Adds exported helper `issuesToErrors(issues)` — converts a `StandardSchemaV1.Issue[]` array into a `FormErrors` map; useful for wiring `onError` into island state
- Adds exported types: `FormResult<T>`, `FormErrors`, `ValidateOn`, `Form<S>`, `CreateFormOptions<S>`

## `@ilha/router`

### 0.2.4 - 2026-05-01

- Updates Ilha dependency to 0.4.0

### 0.2.3 - 2026-04-24

- Updates Ilha dependency to 0.3.1

### 0.2.2 - 2026-04-24

- Updates Ilha dependency to 0.3.0

### 0.2.1 - 2026-04-23

- Updates Ilha dependency to 0.2.1

### 0.2.0 - 2026-04-21

- Adds route groups - not affecting pathname
- Adds defineLayout helper
- Adds SPA and SSR data loaders

### 0.1.0 — 2026-04-14

Initial release of **@ilha/router** — a lightweight, isomorphic router for ilha islands. Runs in the browser with full signal reactivity and on the server as a synchronous HTML string renderer. Pairs natively with Nitro and includes a Vite plugin for file-system based routing. Powered by [rou3](https://github.com/unjs/rou3), the same matching engine used by Nitro.

- Adds `router()` — creates a new `RouterBuilder` instance with a fresh route registry; always call fresh, never share instances across server requests
- Adds `RouterBuilder.route(pattern, island)` — registers a route; patterns are matched in declaration order, first match wins; supports static segments (`about`), named params (`:id`), and wildcards (`...slug`); static segments take priority over params
- Adds `RouterBuilder.render(url)` — resolves the URL against the registry and returns a synchronous HTML string; populates all route signals; decodes percent-encoded params automatically; renders `<div data-router-empty>` when no route matches
- Adds `RouterBuilder.renderHydratable(url, registry, options?)` — async SSR variant that wraps the active island in `data-ilha` hydration markers; falls back to plain SSR with a warning if the island is not found in the registry; supports `snapshot` option (default `true`)
- Adds `RouterBuilder.mount(target, options?)` — mounts the router into a DOM element or CSS selector; sets up `popstate` listening and intercepts internal `<a>` clicks automatically; `hydrate: true` preserves existing SSR DOM on first mount; no-op with warning outside a browser environment
- Adds `RouterBuilder.prime()` — primes route context signals from `window.location` before `ilha.mount` runs; prevents signal mismatch that would destroy hydrated bindings; must be called after all routes are registered
- Adds `RouterBuilder.hydrate(registry, options?)` — convenience method combining `.prime()`, `ilha.mount()`, and `.mount()` into a single call; recommended client entry point; returns an unmount function
- Adds `navigate(to, options?)` — programmatically navigates to a path; updates URL, history stack, and all reactive signals; duplicate navigations are no-ops; `replace: true` uses `history.replaceState`; no-op on the server
- Adds `prime()` — standalone export of the same signal-priming logic as `.prime()` on the builder; useful when managing the priming step separately
- Adds `useRoute()` — returns reactive signal accessors `{ path, params, search, hash }` for the current route state; safe inside any island render on both client and server
- Adds `routePath`, `routeParams`, `routeSearch`, `routeHash` — raw context signals for direct access outside of islands
- Adds `isActive(pattern)` — returns `true` if the current path matches the given registered pattern; uses O(1) reverse island lookup internally
- Adds `enableLinkInterception(root?)` — attaches a delegated click listener that intercepts internal `<a>` navigations; skips external links, `target="_blank"`, anchor-only hashes, and modifier-key clicks; returns a cleanup function; called automatically by `.mount()`; no-op on the server
- Adds `RouterView` — outlet island that wraps the active route island in `<div data-router-view>`; renders `<div data-router-empty>` when no route matches; usable standalone for SSR (`.toString()`) and client (`.mount()`)
- Adds `RouterLink` — declarative link island that calls `navigate()` on click; accepts `href` and `label` state
- Adds `wrapLayout(layout, page)` — wraps a page island with a layout handler; used by the Vite plugin codegen and available for manual composition
- Adds `wrapError(handler, page)` — wraps a page island with an error boundary; catches errors during SSR `.toString()` and client `.mount()`; the nearest boundary wins; re-throwing escalates to the next outer boundary
- Adds Vite plugin `pages(options?)` from `@ilha/router/vite` — scans `src/pages`, resolves layout and error boundary chains, and generates a ready-to-use router; exposes virtual modules `ilha:pages` (`pageRouter`) and `ilha:registry` (`registry`); regenerates only on structural changes to avoid unnecessary HMR invalidation; supports `dir` and `generated` options
- Adds file-system route conventions: `index.ts` → `/`, `about.ts` → `/about`, `[id].ts` → `/:id`, `[...slug].ts` → `/:slug`; `layout.ts` wraps all pages in its directory and subdirectories; `error.ts` catches render errors in its directory and subdirectories; `.test.ts`, `.spec.ts`, and `.d.ts` files are excluded automatically
- Adds exported types: `RouteRecord`, `RouteSnapshot`, `AppError`, `LayoutHandler`, `ErrorHandler`, `NavigateOptions`, `MountOptions`, `HydrateOptions`, `HydratableRenderOptions`, `RouterBuilder`

## `@ilha/store`

### 0.2.1 - 2026-05-01

- Updates Ilha dependency to 0.4.0

### 0.2.0 - 2026-04-28

- Adds `@ilha/store/form` helpers to work with <form> elements which lets deprecate `@ilha/form`.

### 0.1.4 - 2026-04-24

- Updates Ilha dependency to 0.3.1

### 0.1.3 - 2026-04-24

- Updates Ilha dependency to 0.3.0

### 0.1.2 - 2026-04-23

- Updates Ilha dependency to 0.2.1

### 0.1.1 - 2026-04-21

- Updates Ilha dependency to 0.2.0

### 0.1.0 — 2026-04-14

Initial release of **@ilha/store** — a zustand-shaped reactive store for ilha islands. Backed by alien-signals, the same engine powering ilha core state, for shared global state that lives outside any single island. Use it when state needs to be shared across multiple islands, updated from outside an island (e.g. a WebSocket handler), or persisted globally.

- Adds `createStore(initialState, actions?)` — creates a reactive store; optionally accepts an actions creator for encapsulating state mutations; the actions creator receives `set`, `get`, and `getInitialState`
- Adds `store.getState()` — returns the current state snapshot; returns a stable reference when state has not changed
- Adds `store.getInitialState()` — returns the frozen initial state as it was at construction time; unaffected by subsequent `setState` calls; useful for implementing reset actions
- Adds `store.setState(update)` — merges a partial state update shallowly; accepts a plain object or an updater function receiving the latest state
- Adds `store.subscribe(listener)` — subscribes to all state changes; listener receives `(nextState, prevState)`; does not fire on initial subscription; returns an unsubscribe function
- Adds `store.subscribe(selector, listener)` — slice subscription variant; fires only when the selected value changes (compared with `Object.is`); listener receives `(newSlice, prevSlice)`; returns an unsubscribe function
- Adds `store.bind(el, render)` — reactively renders a store-driven HTML string into a DOM element whenever state changes; render function receives the full state and may return a plain string or an `html` tagged template result; renders immediately on bind; returns an unsubscribe function
- Adds `store.bind(el, selector, render)` — slice bind variant; re-renders only when the selected slice changes; render function receives only the selected slice
- Adds `effectScope` — re-exported from `alien-signals`; groups multiple `subscribe` and `bind` calls so they can all be torn down with a single `stop()` call
- Adds exported types: `StoreApi<T>`, `SetState<T>`, `GetState<T>`, `Listener<T>`, `SliceListener<T, S>`, `RenderResult`, `Unsub`
