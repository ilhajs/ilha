# ilha 0.16.1 — agent guide

Generated from `src/index.ts` by `scripts/agent-docs.ts`. Do not edit by hand.

ilha is a tiny, isomorphic islands UI library on Effect 4 (`effect` is the only peer dependency). A component is a function (sync, async, or generator) that returns JSX. State lives in order-based `atom()` slots. There is no virtual DOM and no compiler.

```tsx
import { atom, mount } from "ilha";

const Counter = () => {
  const count = atom(0);
  return (
    <button type="button" onclick={() => count.update((n) => n + 1)}>
      Count: {count}
    </button>
  );
};

mount(document.getElementById("app")!, Counter);
```

## Pick exactly one API per task

| Task | Use |
| --- | --- |
| Local state | `const n = atom(0)` |
| Derived value | `atom(Atom.map(source.atom, fn))` or `atom(Atom.transform(...))` |
| One-time init | `atom.lazy(() => expensive())` |
| React to a change | `watch(source, fn)` |
| Mount-only side effect | `watch.once(fn)` (return a cleanup) |
| Async data | `atom(Effect)`, read as `AsyncResult` — see /guide/recipes/data-fetching |
| Live data | `yield` an Effect `Stream` from a generator component |
| Per-emission interruptible flow | `yield* when(stream, function* (v) {...})` |
| Share values down the tree | `createContext()` + `context(ctx)` |
| Handle failures | `<ErrorBoundary fallback={...}>` |
| Server render | `await renderToString(Component)` |
| Client render | `mount(host, Component)`, or `mount(host, Component, { hydrate: true })` over server HTML |
| Raw trusted HTML | `unsafe(html)` |

Full table: https://ilha.build/guide/getting-started/choose-an-api

## Never do

- Never call `atom()`, `watch()`, or `when()` conditionally, in loops, or after an early return: slots are order-based.
- Never read an atom with `.value` or `.get()`: call `count()`, or pass `{count}` in JSX.
- Never wrap Effect Atom APIs (`Atom.map`, `Atom.transform`, `Atom.fn`): pass `handle.atom` to them and wrap the result in `atom()`.
- Never use `useState`, `useEffect`, or other React hooks: there is no hook layer.
- Never pass untrusted input to `unsafe()`.
- Never import removed APIs (`resource`, `invalidate`, `fromEventSource`, `ilha/define`, `structuralEqual`): see MIGRATIONS.md.
- Never use an atom handle from another island: it throws ILHA003.

## Public API (`ilha`)

- `atom` — Declare reactive state in a component: `atom(0)`, `atom(effect | stream)` (handle holds an `AsyncResult`), `atom(Atom.map(...))` (derived), `atom.lazy(() => init)` (one-time init). Read `count()`, write `count.set(v)` / `count.update(fn)`.
- `batch` — Group several atom writes into one rerender (re-export of Effect `Atom.batch`).
- `context` — Read a context value as an atom handle.
- `createContext` — `createContext(default)` returns a context whose `Provider` (`<Ctx.Provider value={v}>`) shares a value down the tree; read it with `context(ctx)`.
- `ErrorBoundary` — Catch subtree failures and paint a fallback.
- `Fragment` — Group children without a wrapper element (`<>...</>`).
- `h` — Build a vnode by hand; JSX compiles to this.
- `IlhaError` — Error thrown for misuse, with `code` (ILHA001..), `fix`, and `docs` fields.
- `mount` — `mount(host, Component, { hydrate?, onError?, onIdle? })` renders in the browser and returns a dispose function. With `{ hydrate: true }` it adopts server HTML.
- `renderToString` — `await renderToString(Component, { timeout?, snapshot?, markers? })` renders HTML on the server, awaiting async components and streams (first emission).
- `unsafe` — Mark a string as pre-rendered HTML and paint it without escaping.
- `untrack` — Read atoms inside `fn` without subscribing the active render.
- `watch` — `watch(source, ({ signal }) => ...)` reacts to an atom, Effect atom, or Stream; `watch.once(fn)` runs once on mount and may return a cleanup. Both return `Instruction<void>` — call at the top level of the component, in the same order every render.
- `when` — Rerun `body` for every value of `stream`, replacing the previous run.

Types: `AtomEquality`, `AtomHandle`, `AtomLazyOptions`, `AtomOptions`, `Component`, `ContextProviderProps`, `ErrorBoundaryProps`, `ErrorFallback`, `ErrorFallbackProps`, `IlhaCode`, `IlhaContext`, `MountOptions`, `RenderToStringOptions`, `UnsafeHtml`, `View`, `WatchCallback`, `WatchContext`, `WatchOnceCleanup`.

## Subpaths

- `ilha/jsx-runtime` — JSX factory. Set `jsxImportSource: "ilha"` in tsconfig; also `ilha/jsx-dev-runtime`.
- `ilha/renderer` — `createRenderer`/`PaintOps` seam for hosts that are not a DOM (native, test harness).
- `ilha/test` — `render(component)` harness for unit tests — see /guide/recipes/testing.
- `ilha/debug` — `inspect()` returns JSON-serializable trees of live islands; `roots()`, `onChange()` — see /guide/devtools.
- `ilha/oxlint` — Oxlint JS plugin enforcing ilha rules — see /guide/recipes/oxlint.
- `@ilha/devtools` — Separate package: in-browser inspector built on `ilha/debug` — see /guide/devtools.

## Errors

Every diagnostic is an `IlhaError` (or a console warning) with a stable code, a `fix` line, and a docs link.

| Code | Meaning |
| --- | --- |
| [ILHA001](https://ilha.build/errors/ILHA001) | Primitive called with no active component |
| [ILHA002](https://ilha.build/errors/ILHA002) | Atom/watch slot count changed between renders (warning) |
| [ILHA003](https://ilha.build/errors/ILHA003) | Atom handle used from a different island |
| [ILHA004](https://ilha.build/errors/ILHA004) | Generator resumed while an instruction is in flight |
| [ILHA005](https://ilha.build/errors/ILHA005) | Duplicate key among sibling components (warning) |
| [ILHA006](https://ilha.build/errors/ILHA006) | Hydration mismatch (warning) |
| [ILHA007](https://ilha.build/errors/ILHA007) | Unsafe raw text in <script>/<style> during renderToString |

Details and fixes: https://ilha.build/errors

## Where to read more

- Docs index for LLMs: https://ilha.build/llms.txt
- Removed or changed APIs: `MIGRATIONS.md` / `MIGRATIONS.json` in this package
- Testing: https://ilha.build/guide/recipes/testing
- Devtools and `ilha/debug`: https://ilha.build/guide/devtools
- Lint rules: https://ilha.build/guide/recipes/oxlint
