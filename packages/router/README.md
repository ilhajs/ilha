# `@ilha/router`

A tiny, isomorphic SPA router for [Ilha](https://github.com/ilhajs/ilha) islands. You register routes (or scan a `src/pages/` directory), mount the router in the browser, and render the same routes to HTML on the server. Server islands re-render through a guarded frame endpoint.

---

## Installation

```bash
bun add @ilha/router
```

`ilha` is a peer dependency. For server islands you also need [`oxidejs`](https://npmjs.com/package/oxidejs).

---

## Import paths

| Import path | Use it for |
| --- | --- |
| `@ilha/router` | Runtime router, navigation, `head`, route hooks |
| `@ilha/router/vite` | Vite file-system routing plugin (`pages()`) |
| `@ilha/router/rsbuild` | Rsbuild file-system routing plugin (`pages()`) |
| `@ilha/router/server-island` | Client proxies for `*.server` modules (generated) |
| `@ilha/router/ssr` | `POST /__ilha/frame` middleware and frame guards |

There is no loader API. Fetch data inside an async component, or stream from a server module.

---

## Quick start

### Client SPA

```tsx
import { router } from "@ilha/router";

const HomePage = () => <p>home</p>;
const AboutPage = () => <p>about</p>;
const NotFound = () => <p>not found</p>;

router()
  .route("/", HomePage)
  .route("/about", AboutPage)
  .route("/**", NotFound)
  .mount("#app");
```

A mounted SPA router intercepts same-origin `<a>` clicks. Use ordinary links for navigation; call `navigate()` after application logic.

### Server HTML

```ts
import { router } from "@ilha/router";
import { httpResponse } from "@ilha/router";

const app = router().route("/", HomePage).route("/**", NotFound);

const html = await app.render(new Request("https://app.test/"));
return httpResponse(html);
```

### SSR + hydration (recommended)

```ts
// server
const app = router().route("/", HomePage).route("/**", NotFound);

const res = await app.respond(new Request(request.url), {
  shell: (head, html) =>
    `<!doctype html><html${head.htmlAttrs}><head>${head.headTags}</head><body${head.bodyAttrs}>${html}</body></html>`,
});

// client
router()
  .route("/", HomePage)
  .route("/**", NotFound)
  .mount("#app", { hydrate: true });
```

`respond()` renders the route, injects the serialized `<head>` into your shell, and emits security headers. On the client, `{ hydrate: true }` preserves the SSR DOM, seeds state from snapshots, and re-renders with hydration on later navigations.

---

## Hash mode

The router uses the HTML5 History API by default. When you serve from `file://` (Electron, Electrobun, static disk) or a host without SPA fallbacks, switch to hash mode:

```ts
import { setHistoryMode } from "@ilha/router";

setHistoryMode("hash"); // call once, before .mount() or .hydrate()
```

Routes live in `location.hash` (`/#/user/42`). `navigate()`, link interception, and `isActive()` all operate against the hash. Links render the hash form automatically, so right-click → copy link works.

SSR + hydration is not supported in hash mode — the server cannot see hash routes.

---

## Core API

### `router(options?)`

| Option | Meaning |
| --- | --- |
| `mode` | `"spa"` (default) or `"static"` (registry only) |
| `notFound` | Component for unmatched paths |
| `interceptLinks` | Intercept same-origin `<a>` clicks (default `true`) |
| `viewTransitions` | Wrap navigations in the View Transition API |
| `allowExternalRedirects` | Allow cross-origin redirects (default `false`) |

### Builder

| Method | Purpose |
| --- | --- |
| `route(pattern, page)` | Register a URL pattern |
| `errorBoundary(pattern, handler)` | Catch failures for a pattern |
| `routes()` | The route records |
| `prime()` | Prime route signals (browser) |
| `mount(target, { hydrate?, interceptLinks? })` | Activate in the browser |
| `render(url)` | HTML string (server) |
| `renderResponse(url)` | `RenderResponse` discriminated union |
| `respond(url, options?)` | `Response` with head + security headers |
| `hydrate({ root?, interceptLinks? })` | Hydrate SSR markup, then navigate |

`renderResponse()` resolves to `{ kind: "html", html, status?, head? }`, `{ kind: "redirect", to, status }`, or `{ kind: "error", status, message, html, head? }`.

`respond()` options: `status`, `headers`, `cspNonce`, `contentSecurityPolicy`, `timeout`, `snapshot`, `markers`, and `shell(head, html)` to inject the serialized head into your document shell.

### Route patterns

| Pattern         | Example URL         | Params                    |
| --------------- | ------------------- | ------------------------- |
| `/`             | `/`                 | `{}`                      |
| `/user/:id`     | `/user/42`          | `{ id: "42" }`            |
| `/:org/:repo`   | `/ilha/router`      | `{ org, repo }`           |
| `/docs/**:slug` | `/docs/guide/intro` | `{ slug: "guide/intro" }` |
| `/**`           | any unmatched path  | `{}`                      |

Static segments win over parameters, then catch-alls.

### Route context

```tsx
import { useRoute, navigate, isActive } from "@ilha/router";

const Breadcrumb = () => {
  const { path, params, search } = useRoute();
  if (!isActive("/user/*")) return <span>{path()}</span>;
  return (
    <span>
      {path()} · {params().id}
    </span>
  );
};
```

| Export | Meaning |
| --- | --- |
| `useRoute()` | `{ path, params, search, hash, navigating }` accessors |
| `routePath()` / `routeParams()` / `routeSearch()` / `routeHash()` | Standalone accessors |
| `navigate(to, { replace?, scroll? })` | Programmatic navigation |
| `navigating()` | True while a navigation is in flight |
| `isActive(pattern, { end? })` | True when the current path matches |
| `beforeNavigate(fn)` / `afterNavigate(fn)` | Navigation hooks (can cancel) |
| `useContext()` | `{ request }` during SSR |
| `enableLinkInterception(root?)` | Manual link interception |

### Head

```tsx
import { head } from "@ilha/router";

export default function About() {
  head({ title: "About" });
  return <h1>About</h1>;
}
```

`HeadInput` fields: `title`, `titleTemplate`, `meta`, `link`, `script`, `htmlAttrs`, `bodyAttrs`. Call `head()` inside a page or layout; during SSR entries collect into the render window and `serializeHead()` turns them into shell fragments. On the client, entries apply to `document` on navigation.

### Pages, layouts, and errors

```tsx
import { defineLayout, wrapError, error, redirect } from "@ilha/router";

export default defineLayout(({ children }) => <main>{children}</main>);
```

| Export | Purpose |
| --- | --- |
| `wrapLayout(layout, page)` | Wrap a page in a layout (`children` carries it) |
| `wrapError(handler, page)` | Catch page throws, render a fallback view |
| `defineLayout(layout)` | Type helper for layout components |
| `redirect(to, status?)` | Throw `Redirect` — the router navigates |
| `error(status, message)` | Throw `RouteError` — a boundary catches it |
| `httpResponse(html, { status?, headers?, cspNonce?, contentSecurityPolicy? })` | Headered `Response` |

An error handler receives `AppError` (`message`, `status?`) and a route snapshot, and returns a view or a component.

---

## File-system routing

```ts
// vite.config.ts
import pages from "@ilha/router/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [pages()],
});
```

| File                  | URL            |
| --------------------- | -------------- |
| `pages/index.tsx`     | `/`            |
| `pages/about.tsx`     | `/about`       |
| `pages/user/[id].tsx` | `/user/:id`    |
| `pages/[...slug].tsx` | `/**:slug`     |
| `pages/+layout.tsx`   | wraps children |
| `pages/+error.tsx`    | error boundary |

Page modules export a default component, and may call `head()`. Layouts receive `children`.

### Plugin options

```ts
pages({
  dir: "src/pages", // pages directory (default: "src/pages")
  outDir: ".ilha", // generated modules (default: ".ilha")
  mode: "spa", // "spa" | "static" (default: "spa")
  interceptLinks: true,
  frameGuard: (request) => {
    /* dev frame guard */
  },
  trustedOrigins: ["https://app.example.com"],
  csrf: (request) => true,
  strict: false, // fail codegen on collisions instead of warning
});
```

- `mode: "spa"` — full client route graph, SSR/hydration, client navigation.
- `mode: "spa", interceptLinks: false` — route graph and SSR, but links do full document navigations.
- `mode: "static"` — island registry only; no route graph in the client bundle.

### Virtual modules

| Module | Exports | Use for |
| --- | --- | --- |
| `ilha:pages/server` | `pageRouter`, `registry` | SSR, prerender, server handlers |
| `ilha:pages/client` | `pageRouter`, `registry` | Browser hydration entry |

```ts
// src/client.ts — browser entry
import { pageRouter } from "ilha:pages/client";

pageRouter.mount("#app");
```

Hydrate when the host already has SSR markup:

```ts
pageRouter.mount("#app", { hydrate: true });
```

Static mode hydrates the island registered for the page — no route graph in the bundle:

```ts
import { mount } from "ilha";
import { registry } from "ilha:pages/client";

const host = document.querySelector<HTMLDivElement>("#app")!;
mount(host, registry["about"]);
```

---

## Server islands

Put a component in a `*.server.ts(x)` module. It renders on the server only; the browser gets a generated proxy that re-renders it through `POST /__ilha/frame`.

```tsx
// src/lib/tasks.server.tsx
import * as Stream from "effect/Stream";
import { action } from "oxidejs";

export const getTasks = action(async function* () {
  yield [{ id: "1", text: "One" }];
});

export const TaskList = async function TaskList() {
  return Stream.map(
    Stream.fromAsyncIterable(getTasks(), (error) =>
      error instanceof Error ? error : new Error(String(error))
    ),
    (list) => (
      <ul>
        {list.map((t) => (
          <li key={t.id}>{t.text}</li>
        ))}
      </ul>
    )
  );
};
```

Mark RPC functions with `action` from `oxidejs`. Event closures that call those actions serialize into the frame HTML — during hydration-manifest rendering the call is recorded, not executed. Each stream yield refetches the frame and morphs the HTML.

```tsx
// src/pages/index.tsx — plain page
import { TaskList } from "../lib/tasks.server";

export default function Home() {
  return <TaskList />;
}
```

The plugin rewrites the client-graph import of `TaskList` to a proxy (`@ilha/router/server-island`). You never import that module yourself.

---

## Frame security

The frame endpoint re-renders server islands from a client state snapshot. Island state is world-readable through frames unless you gate them.

| Concern | How |
| --- | --- |
| Production posture | Deny-by-default: `/__ilha/frame` returns `403` until you install a guard |
| Dev posture | Permissive unless a `frameGuard` is registered (plugin option) |
| Origin checks | `Origin` compared against `setFrameAuth({ trustedOrigins })` or the request's own `Host` |
| CSRF | `setFrameAuth({ csrf })` verifier for the state-changing POST |
| Identity | Only `cookie`, `authorization`, `user-agent` are forwarded to the scoped render |
| Body cap | 16 KiB; oversized bodies return `413` |

### `@ilha/router/ssr`

| Export | Purpose |
| --- | --- |
| `ssr` (default) | The production frame handler |
| `setFrameAuth({ defaultAction?, trustedOrigins?, csrf? })` | Install the frame-auth policy |
| `setFrameGuard(guard)` | Per-request allow/deny |
| `renderServerIsland(id, request, runWithScope, props?)` | Render one island — `Effect<string, FrameError>` |
| `renderServerIslandResult(...)` | Promise/`Result` variant for non-Effect callers |

```ts
import { setFrameAuth } from "@ilha/router/ssr";

setFrameAuth({
  defaultAction: "open", // public demo; deny is the production default
});
```

```ts
import { setFrameGuard } from "@ilha/router/ssr";

setFrameGuard((request) =>
  isSignedIn(request)
    ? undefined
    : new Response("Unauthorized", { status: 401 })
);
```

Frame render failures surface as `"frame failed"` — error details are never leaked to clients in production.

---

## Deployment

With [oxidejs](https://npmjs.com/package/oxidejs), the SSR middleware serves the frame endpoint in production:

```ts
// vite.config.ts
import pages from "@ilha/router/vite";
import oxide from "oxidejs/vite";

export default defineConfig({
  plugins: [oxide({ middleware: ["@ilha/router/ssr"] }), pages()],
});
```

Without oxidejs, host the router in your own fetch handler and use `render()`, `renderResponse()`, or `respond()`. In static (`mode: "static"`) builds, prerender each route at build time and hydrate the island from the client `registry`.

---

## License

MIT
