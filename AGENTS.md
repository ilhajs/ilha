# AGENTS.md

## Project overview

- Ilha is a tiny, isomorphic web UI library built around the islands architecture — ship minimal JavaScript, hydrate only what matters.
- It is a Bun monorepo containing four packages (`ilha`, `@ilha/router`, `@ilha/store`, `@ilha/astro`), one documentation app (`apps/website`), and scaffolding templates (`templates/`).
- The core package (`packages/ilha`) is the island builder: signal-based reactivity, SSR rendering, DOM hydration, and a JSX runtime — no virtual DOM, no compiler.
- `@ilha/router` provides an isomorphic SPA router with a Vite file-system routing plugin; `@ilha/store` provides cross-island global state backed by alien-signals.
- The documentation site (`apps/website`) is built with Nimbus (Astro), Ilha, and Areia. It prerenders to static HTML and is deployed to Vercel.

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
- `packages/router/` and `packages/store/` follow the same single-entrypoint pattern with their own `tsdown.config.ts` and `package.json`.
- `templates/` — official starters (vite, hono, nitro, elysia). Keep them minimal and copy-pasteable; do not add build-time complexity.
- `apps/website/src/content/docs/` — all MDX documentation lives here (Nimbus/Astro content collections). Directory structure maps to URLs.

## Island API conventions

- Define an island by chaining the builder: `.state()` → `.on()` → `.render()`.
- Mount islands with `mount({ IslandName })` — it auto-discovers `[data-ilha="IslandName"]` elements.
- For SSR, use `renderToString(island, state)` server-side; the client restores state via hydration with zero flicker.
- Keep the public API surface minimal: `ilha` (default export), `html`, `mount`, `renderToString`, and the JSX runtime exports are the stable contracts — do not rename or remove them.
- When adding new public exports, update `packages/ilha/src/public-types.ts` and add corresponding tests in `index.test.ts` or `jsx-runtime.test.tsx`.

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

Docs live in `apps/website/src/content/docs/**/*.mdx` (guides under `guide/`, tutorials under `tutorial/`). Sidebar order comes from each file's frontmatter `sidebar.order` field. Style guidelines:

- **Address the reader as "you."** Describe what they do, not what the library has: "You define an island with `.state()`," not "Ilha provides a state primitive."
- **Prefer active voice.** "`mount()` discovers every `[data-ilha]` element," not "elements are discovered by `mount()`."
- **Keep it tight.** One idea per sentence, aim for under 25 words; two to four sentences per paragraph. Use numbered lists for sequences and tables for option matrices.
- **Headings in sentence case, written for intent.** "Set up SSR," not "SSR Configuration." Never skip heading levels. Page titles come from frontmatter (`title`); do not add a duplicate `# Title` H1 in the MDX body — DocsLayout already renders it.
- **One term per concept.** Use `island`, `state`, `signal`, `mount`, `hydration`, `renderToString` consistently — match the names in code exactly and do not drift between synonyms.
- **Be direct, cut filler.** Drop "simply," "just," "in order to," "it's worth noting that." No "powerful," "blazing fast," "seamless."
- **Show, then explain.** Lead with a minimal, runnable code example, then describe what it does. Examples must be type-correct and copy-pasteable.
- **Every new feature updates the docs.** Add or revise the relevant guide page, then run `bun run fmt` (oxfmt formats MDX). Build the site (`cd apps/website && bun run build`) to confirm the page prerenders without dead-link errors. Register MDX components in `apps/website/src/components.ts`. Put Preview demo source in a sibling `*.examples.ts` file when the sample contains PascalCase JSX tags (Nimbus MDX validation treats those as components).

## LLM exports

Each production docs build emits `dist/llms.txt`, `dist/llms-full.txt`, and per-section agent indexes via Nimbus. Do not disable these outputs — they are how agents (including this one) read the full documentation. If you add a new guide, verify it appears in `llms.txt` after a build.

## Agent behavior

- Prefer small, focused changes. The core library is intentionally single-file (`index.ts`); keep it that way unless there is a compelling architectural reason to split.
- When adding a new island API method, chain it onto the existing builder pattern — do not introduce a parallel API surface.
- If you are unsure how a change affects SSR serialization, hydration state restoration, or the JSX runtime, ask for clarification rather than guessing.
- If you introduce a new feature or change documented behavior, update the corresponding MDX guide and verify `bun run build` passes in `apps/website`.
