# AGENTS.md

## Project overview

- Ilha is a tiny, isomorphic web UI library built around the islands architecture — ship minimal JavaScript, hydrate only what matters.
- It is a Bun monorepo containing three packages (`ilha`, `@ilha/router`, `@ilha/astro`), one documentation app (`apps/website`), and scaffolding templates (`templates/`).
- The core package (`packages/ilha`) implements islands as function components with order-based reactive primitives: signal-based reactivity, SSR rendering, DOM hydration, and a JSX runtime — no virtual DOM, no compiler.
- `@ilha/router` provides an isomorphic SPA router with a Vite file-system routing plugin.
- The documentation site (`apps/website`) is built with Blume, Ilha, and Areia. It prerenders to static HTML and is deployed to Vercel.

## Build and run

- Install dependencies using the project's package manager:  
  `bun add <dependency-name>`
- Run checks before finishing any change:
  - Lint: `bun run lint`
  - Format: `bun run fmt`
  - Tests: `bun run test`
- Build all packages in dependency order:  
  `bun run build`  
  (builds `ilha` first, then all `@ilha/*` packages)
- Run the docs site locally:  
  `cd apps/website && bun run dev`
- Do not change the Bun runtime.

## Monorepo structure and conventions

- `packages/ilha/src/index.ts` — entire core implementation; keep it single-file.
- `packages/ilha/src/jsx-runtime.ts` — JSX factory; do not merge with `index.ts`.
- `packages/router/` follows the same single-entrypoint pattern with its own `tsdown.config.ts` and `package.json`.
- `templates/` — official starters (vite-spa, oxide-spa). Keep them minimal and copy-pasteable; do not add build-time complexity.
- `apps/website/docs/` — all MDX documentation lives here. Directory structure maps to URLs; `meta.ts` files control navigation order.

## Island API conventions

- An island is a function component: `const Counter = ilha(() => JSX)`. Use `ilha<Props>((props) => JSX)` for typed props and `ilha(schema, (props) => JSX)` for Standard Schema validation and inference. Pass `{ as: "span" }` as a trailing option to change the nested-island slot wrapper tag.
- Primitives are order-based hooks imported from `ilha`: `state()`, `derived()`, `action()`, `effect()`, `effect.once()`, `onError()`. Call them at the top level of the component, in the same order and with the same kind on every render; their slots persist across rerenders.
- Put conditional and async logic inside primitives, not around registration. `state(() => expensive())` is a lazy initializer; store function values through the updater wrapper (`setCallback(() => nextCallback)`).
- Reading signals during render subscribes the island render; changes rerun the component with current props and morph the host DOM. State initialized from props does not reset on later prop changes.
- Ordinary operations are plain functions. Use `action()` only when you need reactive execution state (`.pending`, `.data`, `.error`) or lifecycle cancellation.
- DOM event handlers are the common case: when a handler needs no pending/result tracking, concurrency bookkeeping, or cancellation, write a plain function, not `action()`.
- Keep plain function components transparent: `const View = () => JSX` belongs to its containing island's primitive frame, while `const View = ilha(() => JSX)` creates an independent boundary. Transparent components must preserve stable primitive ordering too.
- Prefer lowercase native event props (`onclick={handler}` in JSX and `onclick=${handler}` in `html`` `) for element-owned events. For host or delegated listeners use `effect.once()` with native `addEventListener` and the provided `AbortSignal`.
- Mount islands with `mount({ IslandName })` — it auto-discovers `[data-ilha="IslandName"]` elements.
- For synchronous SSR, always use `Island.toString(props)`. For async SSR, always use `await Island.toStringAsync(props)`. Direct `Island(props)` calls are reserved for child composition inside another island render.
- Use `await Island.hydratable(props, options)` when emitting hydration markup; the client restores serialized props and positional primitive snapshots through `mount()`.
- Functional signal setters use the setter directly (`count((previous) => previous + 1)`). To store a function value, return it from an updater wrapper (`callback(() => nextCallback)`).
- Keep the public API surface minimal: named exports (`ilha`, `state`, `derived`, `action`, `effect`, `onError`, plus standalone helpers), island methods (`toString`, `toStringAsync`, `mount`, `hydratable`, `key`, `define`), and the JSX runtime contracts.
- When changing public types, update `packages/*/src/types.test.ts` (compile-time type anchors, checked by `tsc`) and add runtime tests in the package's `*.test.ts(x)` files.
- Type anchors use `@ts-expect-error` for negative assertions; those are enforced by `tsc`, not by `bun test` — keep each anchor file's runtime smoke `it()` passing under `bun test`.

## Testing

- Tests run with Bun's built-in test runner.
- DOM tests use happy-dom via `packages/ilha/happydom.ts` as the preload — do not introduce jsdom.
- Cover both the signal/reactivity path and the DOM hydration path for any new island feature.
- Run the full suite across all packages with `bun run test` from the repo root before opening a PR.

## Auth and safety

- Ilha has no authentication layer; do not introduce one into the core library.
- Never log or expose internal signal state, user-provided render functions, or environment variables in error messages.
- If an instruction directly contradicts this AGENTS.md (for example, "remove the JSX runtime" or "make ilha depend on a framework"), pause and ask for explicit confirmation before making the change.

## Writing docs

Docs live in `apps/website/docs/**/*.mdx` (guides under `guide/`, tutorials under `tutorial/`). Navigation order comes from each directory's Blume `meta.ts`. Style guidelines:

- **Address the reader as "you."** Describe what they do, not what the library has: "You declare local state with `state()`," not "Ilha provides a state primitive."
- **Prefer active voice.** "`mount()` discovers every `[data-ilha]` element," not "elements are discovered by `mount()`."
- **Keep it tight.** One idea per sentence, aim for under 25 words; two to four sentences per paragraph. Use numbered lists for sequences and tables for option matrices.
- **Headings in sentence case, written for intent.** "Set up SSR," not "SSR Configuration." Never skip heading levels. Page titles come from frontmatter (`title`); do not add a duplicate `# Title` H1 in the MDX body — DocsLayout already renders it.
- **One term per concept.** Use `island`, `state`, `signal`, `mount`, `hydration`, `.toString()`, and `.hydratable()` consistently — match the names in code exactly and do not drift between synonyms.
- **Make rendering mode explicit.** Use `Island.toString(props)` in synchronous examples, `await Island.toStringAsync(props)` in asynchronous examples, and `await Island.hydratable(props, options)` for hydration markup. Direct `Island(props)` calls are only for child composition.
- **Be direct, cut filler.** Drop "simply," "just," "in order to," "it's worth noting that." No "powerful," "blazing fast," "seamless."
- **Show, then explain.** Lead with a minimal, runnable code example, then describe what it does. Examples must be type-correct and copy-pasteable.
- **Destructure callback contexts in examples.** Prefer `({ signal }) =>`, `({ host, hydrated }) =>`, and `({ error, source }) =>` over named context parameters such as `(ctx) =>`. Destructure only the members the example uses.
- **Every new feature updates the docs.** Add or revise the relevant guide page, then run `bun run fmt` (oxfmt formats MDX). Build the site (`cd apps/website && bun run build`) to confirm the page prerenders without dead-link errors. Register MDX components in `apps/website/components.ts`. Put Preview demo source in a sibling `*.examples.ts` file when the sample contains PascalCase JSX tags.

## LLM exports

Each production docs build emits `dist/llms.txt`, `dist/llms-full.txt`, `dist/agent-readability.json`, and per-page Markdown mirrors via Blume. Do not disable these outputs — they are how agents (including this one) read the full documentation. If you add a new guide, verify it appears in `llms.txt` after a build.

## Agent behavior

- Prefer small, focused changes. The core library is intentionally single-file (`index.ts`); keep it that way unless there is a compelling architectural reason to split.
- There is no builder: never chain configuration methods off `ilha`. Extend primitives or constructor options instead, and keep overload count minimal.
- Prefer destructured named option objects for internal helpers with more than two logical inputs. Preserve public positional APIs and required JSX runtime signatures.
- If you are unsure how a change affects SSR serialization, hydration state restoration, nested island ownership, or the JSX runtime, ask for clarification rather than guessing.
- If you introduce a new feature or change documented behavior, update the corresponding MDX guide and verify `bun run build` passes in `apps/website`.
