# `@ilha/router`

A lightweight, isomorphic router for [Ilha](https://github.com/ilhajs/ilha) islands. Runs in the browser with full reactivity and on the server as a synchronous HTML string renderer. Pairs natively with [Nitro](https://nitro.build/) and includes a Vite plugin for file-system based routing.

---

## Installation

```bash
npm install @ilha/router
# or Bun
bun add @ilha/router
```

---

## Quick Start

### Client-side

```ts
import { router } from "@ilha/router";
import { homePage, aboutPage, userPage, notFound } from "./pages";

router()
  .route("/", homePage)
  .route("/about", aboutPage)
  .route("/user/:id", userPage)
  .route("/**", notFound)
  .mount("#app");
```

### Server-side (SSR)

```ts
import { router } from "@ilha/router";
import { homePage, aboutPage, userPage, notFound } from "./pages";

export default defineEventHandler((event) => {
  const html = router()
    .route("/", homePage)
    .route("/about", aboutPage)
    .route("/user/:id", userPage)
    .route("/**", notFound)
    .render(event.node.req.url ?? "/");

  return new Response(`<!doctype html><html><body>${html}</body></html>`, {
    headers: { "content-type": "text/html" },
  });
});
```

### SSR + Client Hydration (recommended)

```ts
// routes/[...].ts — Nitro handler
import { pageRouter } from "ilha:pages";
import { registry } from "ilha:registry";

export default defineEventHandler(async (event) => {
  const html = await pageRouter.renderHydratable(event.node.req.url ?? "/", registry);
  return new Response(`<!doctype html><html><body>${html}</body></html>`, {
    headers: { "content-type": "text/html" },
  });
});
```

```ts
// src/client.ts — browser entry
import { pageRouter } from "ilha:pages";
import { registry } from "ilha:registry";

pageRouter.hydrate(registry);
```

---

## Core API

### `router()`

Creates a new router instance and **resets the route registry**. Always call `router()` fresh — never share instances across server requests.

Returns a `RouterBuilder`.

---

#### `.route(pattern, island)`

Registers a route. Patterns are matched in **declaration order** — first match wins. Uses [rou3](https://github.com/h3js/rou3) for matching, the same engine as Nitro.

| Pattern         | Matches             | `routeParams()`                   |
| --------------- | ------------------- | --------------------------------- |
| `/`             | `/`                 | `{}`                              |
| `/about`        | `/about`            | `{}`                              |
| `/user/:id`     | `/user/42`          | `{ id: "42" }`                    |
| `/:org/:repo`   | `/ilha/router`      | `{ org: "ilha", repo: "router" }` |
| `/docs/**:slug` | `/docs/guide/intro` | `{ slug: "guide/intro" }`         |
| `/**`           | anything            | `{}`                              |

> Static segments take priority over `:param` segments — `/user/me` will match before `/user/:id`.

Returns the same `RouterBuilder` for chaining.

---

#### `.mount(target, options?)` — browser only

Mounts the router into a DOM element or CSS selector. Sets up `popstate` listening and intercepts internal `<a>` clicks automatically.

```ts
const unmount = router().route("/", homePage).mount("#app");

// later:
unmount();
```

**Options:**

| Option     | Type                     | Default     | Description                                                |
| ---------- | ------------------------ | ----------- | ---------------------------------------------------------- |
| `hydrate`  | `boolean`                | `false`     | Preserve SSR DOM on first mount (no destructive re-render) |
| `registry` | `Record<string, Island>` | `undefined` | Island registry for interactive hydration on navigation    |

When `hydrate: true`, `.mount()` does **not** wipe existing SSR HTML. It instead mounts a hidden navigation handler that re-renders routes with hydration on subsequent navigations.

No-op with a console warning when called outside a browser environment.

---

#### `.render(url)` — server / SSR

Resolves the given URL against the route registry and returns a synchronous HTML string. Accepts a path string, full URL string, or `URL` object. Populates all route signals identically to the browser. Percent-encoded params are decoded automatically.

```ts
const html = router().route("/", homePage).route("/**", notFound).render("/");
// → '<div data-router-view><p>home</p></div>'
```

Renders `<div data-router-empty></div>` when no route matches.

---

#### `.renderHydratable(url, registry, options?)` — server / SSR

Async variant of `.render()` that outputs HTML with `data-ilha` hydration markers so the client can rehydrate without a full re-render.

```ts
const html = await router().route("/", homePage).renderHydratable("/", registry);
// → '<div data-router-view><div data-ilha="home">…</div></div>'
```

If the active island is not found in the registry, falls back to plain SSR and emits a `console.warn`.

**Options** extend `HydratableOptions` from `ilha`:

| Option     | Type      | Default | Description                                           |
| ---------- | --------- | ------- | ----------------------------------------------------- |
| `snapshot` | `boolean` | `true`  | Embed island state as `data-ilha-state` for hydration |

---

#### `.prime()` — browser only

Primes route context signals from the current `window.location` **before** `ilha.mount()` runs. This prevents a signal mismatch that would destroy hydrated bindings.

Call this after all routes are registered and before mounting islands for interactivity:

```ts
import { mount } from "ilha";
import { pageRouter } from "ilha:pages";
import { registry } from "ilha:registry";

pageRouter.prime();              // ← sync signals first
mount(registry, { root: … });   // ← then hydrate islands
pageRouter.mount("#app", { hydrate: true, registry });
```

---

#### `.hydrate(registry, options?)` — browser only

Convenience method that combines `.prime()`, `ilha.mount()`, and `.mount()` into a single call. Use this as the recommended client entry point.

```ts
pageRouter.hydrate(registry);

// With options:
pageRouter.hydrate(registry, {
  root: document.getElementById("root"), // defaults to document.body
  target: "#app", // defaults to root
});
```

Returns an `unmount` function that tears down all listeners and hydrated islands.

---

### `navigate(to, options?)`

Programmatically navigate to a path. Updates the URL, history stack, and all reactive signals. Duplicate navigations (same URL) are no-ops.

```ts
import { navigate } from "@ilha/router";

navigate("/about");
navigate("/about", { replace: true }); // replaces instead of pushing
```

No-op on the server.

---

### `prime()`

Standalone export of the same signal-priming function available as `.prime()` on the builder. Useful when managing the priming step separately from the router instance.

```ts
import { prime } from "@ilha/router";

prime();
```

---

### `useRoute()`

Returns reactive signal accessors for the current route state. Safe to call inside any island render function on both client and server.

```ts
import { useRoute } from "@ilha/router";

const MyPage = ilha.render(() => {
  const { path, params, search, hash } = useRoute();
  return `<p>user id: ${params().id}</p>`;
});
```

---

### `routePath` · `routeParams` · `routeSearch` · `routeHash`

The underlying context signals — use these outside of islands when you need direct signal access.

```ts
import { routePath, routeParams, routeSearch, routeHash } from "@ilha/router";

routePath(); // → "/user/42"
routeParams(); // → { id: "42" }
routeSearch(); // → "?tab=docs"
routeHash(); // → "#section"
```

---

### `isActive(pattern)`

Returns `true` if the current path matches the given registered pattern. Uses O(1) reverse island lookup internally.

```ts
import { isActive } from "@ilha/router";

isActive("/about"); // → true / false
isActive("/user/:id"); // → true when on any /user/* path
```

---

### `enableLinkInterception(root?)`

Attaches a delegated click listener to `root` (defaults to `document`) that intercepts `<a>` clicks and routes them client-side. Called automatically by `.mount()`.

Skips links that are external, `target="_blank"`, anchor-only (`#hash`), or modified (`Ctrl`/`Meta`/`Shift`). Also skips events already handled (`e.defaultPrevented`).

Returns a cleanup function.

```ts
const stop = enableLinkInterception(myContainer);
stop(); // remove listener
```

No-op on the server.

---

### `RouterView`

The outlet island rendered by `.mount()` and `.render()`. Wraps the active island in `<div data-router-view>`, or renders `<div data-router-empty></div>` when no route matches.

```ts
import { RouterView } from "@ilha/router";

RouterView.toString(); // SSR
RouterView.mount(el); // client
```

---

### `RouterLink`

A declarative link island that calls `navigate()` on click.

```ts
import { RouterLink } from "@ilha/router";

RouterLink.toString({ href: "/about", label: "About" });
// → '<a data-link href="/about">About</a>'
```

---

### `wrapLayout(layout, page)`

Wraps a page island with a layout handler. Used internally by the Vite plugin codegen — also available for manual composition.

```ts
import { wrapLayout } from "@ilha/router";

const wrapped = wrapLayout(myLayout, myPage);
```

---

### `wrapError(handler, page)`

Wraps a page island with an error boundary. If the page throws during SSR (`.toString()`), the `handler` receives the error and current route snapshot and returns a fallback island. Also intercepts errors during `.mount()` for client-side resilience.

```ts
import { wrapError } from "@ilha/router";

const safe = wrapError(myErrorHandler, myPage);
```

The nearest (innermost) `wrapError` boundary catches first. If the inner handler re-throws, the next outer boundary takes over.

---

## TypeScript Types

```ts
interface RouteSnapshot {
  path: string;
  params: Record<string, string>;
  search: string;
  hash: string;
}

interface AppError {
  message: string;
  status?: number;
  stack?: string;
}

type LayoutHandler = (children: Island) => Island;
type ErrorHandler = (error: AppError, route: RouteSnapshot) => Island;

interface NavigateOptions {
  replace?: boolean;
}

interface MountOptions {
  hydrate?: boolean;
  registry?: Record<string, Island>;
}

interface HydrateOptions {
  root?: Element;
  target?: string | Element;
}
```

---

## File-system Routing

`@ilha/router` includes a Vite plugin that scans `src/pages/`, resolves layout and error boundary chains, and generates a ready-to-use router — no manual route registration needed.

### Setup

```ts
// vite.config.ts
import { pages } from "@ilha/router/vite";

export default defineConfig({
  plugins: [pages()],
});
```

Add `.ilha/` (or your custom `generated` path) to `.gitignore`.

### Directory structure

```
src/pages/
  +layout.ts              ← root layout (wraps all pages)
  +error.ts               ← root error boundary
  index.ts                → /
  about.ts                → /about
  (auth)/                 ← route group — transparent to the URL
    +layout.ts            ← layout scoped to (auth) pages only
    sign-in.ts            → /sign-in
    sign-up.ts            → /sign-up
  (marketing)/            ← another route group
    index.ts              → /
  user/
    +layout.ts            ← nested layout (wraps user/* only)
    +error.ts             ← nested error boundary
    [id].ts               → /user/:id
    [id]/
      settings.ts         → /user/:id/settings
  [...slug].ts            → /**:slug
```

### Filename → pattern mapping

| File                      | Pattern         |
| ------------------------- | --------------- |
| `index.ts`                | `/`             |
| `about.ts`                | `/about`        |
| `[id].ts`                 | `/:id`          |
| `user/[id].ts`            | `/user/:id`     |
| `[org]/[repo].ts`         | `/:org/:repo`   |
| `[...slug].ts`            | `/**:slug`      |
| `(auth)/sign-in.ts`       | `/sign-in`      |
| `(auth)/[token].ts`       | `/:token`       |
| `(shop)/products/[id].ts` | `/products/:id` |

`.test.ts`, `.spec.ts`, and `.d.ts` files are automatically excluded.

### Route groups

Folders wrapped in parentheses — `(name)` — are **route groups**. They organise files without contributing a segment to the URL. The group name is completely invisible to the router.

```
src/pages/
  (auth)/
    sign-in.ts    → /sign-in   ✓  (not /auth/sign-in)
    sign-up.ts    → /sign-up   ✓
  (marketing)/
    index.ts      → /          ✓
    pricing.ts    → /pricing   ✓
```

Route groups are useful for:

- **Shared layouts without a shared URL prefix** — place a `+layout.ts` inside `(auth)/` and it wraps only those pages, with no `/auth` prefix in the URL.
- **Organising large page trees** — split pages into logical sections (`(admin)`, `(public)`, `(shop)`) while keeping flat URLs.
- **Co-locating related pages** — keep sign-in, sign-up, and password reset together in `(auth)/` for clarity.

> Groups can be nested: `(a)/(b)/page.ts` → `/page`. Both group folders are transparent.

> If two files in different groups resolve to the **same pattern** (e.g. `(auth)/sign-in.ts` and `sign-in.ts` both produce `/sign-in`), the plugin warns about a duplicate pattern and the first match wins.

### Route sorting

Routes are sorted automatically by specificity — no need to order files manually:

1. **Static** paths (`/about`) — highest priority
2. **Parameterised** paths (`/user/:id`)
3. **Wildcard** paths (`/**:slug`) — lowest priority

Within the same tier, longer segment counts and alphabetical order act as tiebreakers for determinism. Route group pages sort alongside regular pages by their resolved pattern — the group folder is not considered.

### Layouts

A `+layout.ts` wraps every page in its directory and all subdirectories. Layouts compose **inside-out** — the nearest layout is innermost, the root layout is outermost.

```ts
// src/pages/+layout.ts
import { html } from "ilha";
import type { LayoutHandler } from "@ilha/router/vite";

export default ((children) =>
  ilha.render(
    () => html`
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
      <main>${children}</main>
    `,
  )) satisfies LayoutHandler;
```

A `+layout.ts` inside a route group folder works exactly like a regular nested layout — it wraps only the pages inside that group, without affecting pages elsewhere.

```
src/pages/
  +layout.ts          ← wraps ALL pages (including those in groups)
  (auth)/
    +layout.ts        ← wraps (auth) pages only: /sign-in, /sign-up
    sign-in.ts
    sign-up.ts
  about.ts            ← wrapped by root layout only
```

### Error boundaries

A `+error.ts` catches any error thrown during rendering of pages in its directory and all subdirectories. The nearest boundary wins. If an inner boundary re-throws, the next outer boundary takes over. Receives the error and the current route snapshot.

```ts
// src/pages/+error.ts
import type { ErrorHandler } from "@ilha/router/vite";

export default ((error, route) =>
  ilha.render(
    () => `
    <div class="error">
      <h1>${error.status ?? 500}</h1>
      <p>${error.message}</p>
      <p>Path: ${route.path}</p>
    </div>
  `,
  )) satisfies ErrorHandler;
```

### Virtual modules

The plugin exposes two virtual modules:

| Module          | Export       | Description                                  |
| --------------- | ------------ | -------------------------------------------- |
| `ilha:pages`    | `pageRouter` | A `RouterBuilder` with all routes registered |
| `ilha:registry` | `registry`   | `Record<string, Island>` for hydration       |

```ts
// routes/[...].ts — Nitro catch-all handler
import { pageRouter } from "ilha:pages";
import { registry } from "ilha:registry";

export default defineEventHandler(async (event) => {
  const html = await pageRouter.renderHydratable(event.node.req.url ?? "/", registry);
  return new Response(`<!doctype html><html><body>${html}</body></html>`, {
    headers: { "content-type": "text/html" },
  });
});
```

```ts
// src/client.ts — browser entry
import { pageRouter } from "ilha:pages";
import { registry } from "ilha:registry";

pageRouter.hydrate(registry);
```

### Plugin options

```ts
pages({
  dir: "src/pages", // pages directory (default: "src/pages")
  generated: ".ilha/routes.ts", // generated file output (default: ".ilha/routes.ts")
});
```

The plugin regenerates the routes file only when content actually changes — avoiding unnecessary HMR invalidations. Structural changes (file add/remove, `+layout.ts`/`+error.ts` edits) trigger full HMR. Regular page content edits are handled by Vite's normal module HMR.

---

## SSR + Hydration

The same route config runs on both sides. Signals (`routePath`, `routeParams`, etc.) are populated identically by `.render()`/`.renderHydratable()` on the server and `.mount()`/`.hydrate()` on the client.

```ts
// server: resolves URL → hydratable HTML string
await pageRouter.renderHydratable("/user/42", registry);
routeParams(); // → { id: "42" }

// client: hydrates SSR DOM, sets up navigation
pageRouter.hydrate(registry);
navigate("/user/99");
routeParams(); // → { id: "99" }
```

### Full SSR → hydration flow

```
server                           client
──────────────────────────────   ──────────────────────────────────────────────
renderHydratable(url, registry)  pageRouter.prime()        ← sync signals first
  → data-ilha="…" markers        mount(registry, { root }) ← hydrate islands
  → data-ilha-state snapshot     pageRouter.mount(target,  ← setup navigation
                                   { hydrate: true, registry })
```

Or use the one-liner: `pageRouter.hydrate(registry)`.

---

## License

MIT
