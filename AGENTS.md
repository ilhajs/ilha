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

- `packages/ilha/src/index.ts` — public entrypoint; core implementation lives alongside it in `packages/ilha/src/`.
- `packages/ilha/src/jsx-runtime.ts` — JSX factory; do not merge with `index.ts`.
- `packages/router/` follows the same single-entrypoint pattern with its own `tsdown.config.ts` and `package.json`.
- `templates/` — official starters (vite-spa, oxide-spa). Keep them minimal and copy-pasteable; do not add build-time complexity.
- `apps/website/docs/` — all MDX documentation lives here. Directory structure maps to URLs; `meta.ts` files control navigation order.

## Island API conventions

- A component is a function (sync, async, or generator) that returns a view: `const Counter = () => JSX`.
- Nested plain functions share the parent fiber and its primitive slots. `mount(host, Component)` or `renderToString(Component)` makes a function a root.
- Primitives are order-based: `atom()`, `atom.lazy()`, and `watch()` slots persist across rerenders. Call them at the top level of the component, in the same order on every render. `yield* when(...)` follows the same ordering rules inside a generator body.
- Put conditional and async logic inside primitives, not around registration. Use `atom.lazy(() => expensive())` for one-time init; use `atom(Atom.map(...))` or `atom(Atom.transform(...))` for derived values; store function values with `atom.lazy(() => fn)`.
- Reading atoms during render subscribes the component; changes rerun it and morph the host DOM. State initialized from props does not reset on later prop changes.
- DOM event handlers are plain functions (`onclick={handler}`). Use `atom(Atom.fn(...))` when `.set()` should run an Effect (for example a form submit).
- Prefer lowercase native event props (`onclick`, `onchange`) in JSX.
- Mount with `mount(host, Component)` or `mount(host, Component, { hydrate: true })`. SSR uses `await renderToString(Component)`.
- Read with `count()`, replace with `count.set(1)`, patch with `count.update((previous) => previous + 1)`.
- Derived and mutation atoms come from Effect (`Atom.map`, `Atom.transform`, `Atom.fn`, `Atom.batch`). Ilha exports `batch` as a convenience re-export and `watch` for lifecycle-bound `registry.subscribe`. Pass `handle.atom` to Effect APIs, then wrap the result in `atom()`.
- Keep the public API surface minimal: named exports (`atom`, `batch`, `watch`, `when`, `mount`, `renderToString`, `h`, `Fragment`) and the JSX runtime.
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

- **Address the reader as "you."** Describe what they do, not what the library has: "You declare local state with `atom()`," not "Ilha provides a state primitive."
- **Prefer active voice.** "`mount()` discovers every `[data-ilha]` element," not "elements are discovered by `mount()`."
- **Keep it tight.** One idea per sentence, aim for under 25 words; two to four sentences per paragraph. Use numbered lists for sequences and tables for option matrices.
- **Headings in sentence case, written for intent.** "Set up SSR," not "SSR Configuration." Never skip heading levels. Page titles come from frontmatter (`title`); do not add a duplicate `# Title` H1 in the MDX body — DocsLayout already renders it.
- **One term per concept.** Use `component`, `atom`, `mount`, `hydration`, and `renderToString()` consistently — match the names in code exactly and do not drift between synonyms.
- **Make rendering mode explicit.** Use `await renderToString(Component)` for SSR examples and `mount(host, Component, { hydrate: true })` for hydration examples.
- **Be direct, cut filler.** Drop "simply," "just," "in order to," "it's worth noting that." No "powerful," "blazing fast," "seamless."
- **Show, then explain.** Lead with a minimal, runnable code example, then describe what it does. Examples must be type-correct and copy-pasteable.
- **Destructure callback contexts in examples.** Prefer `({ signal }) =>`, `({ host, hydrated }) =>`, and `({ error, source }) =>` over named context parameters such as `(ctx) =>`. Destructure only the members the example uses.
- **Every new feature updates the docs.** Add or revise the relevant guide page, then run `bun run fmt` (oxfmt formats MDX). Build the site (`cd apps/website && bun run build`) to confirm the page prerenders without dead-link errors. Register MDX components in `apps/website/components.ts`. Put Preview demo source in a sibling `*.examples.ts` file when the sample contains PascalCase JSX tags.

## LLM exports

Each production docs build emits `dist/llms.txt`, `dist/llms-full.txt`, `dist/agent-readability.json`, and per-page Markdown mirrors via Blume. Do not disable these outputs — they are how agents (including this one) read the full documentation. If you add a new guide, verify it appears in `llms.txt` after a build.

## Agent behavior

- Prefer small, focused changes. The core package lives in `packages/ilha/src/` with `index.ts` as the public entrypoint.
- Do not add Ilha wrappers around Effect Atom APIs (`Atom.map`, `Atom.transform`, `Atom.fn`). Document Effect usage with `handle.atom` instead.
- Prefer destructured named option objects for internal helpers with more than two logical inputs. Preserve public positional APIs and required JSX runtime signatures.
- If you are unsure how a change affects SSR serialization, hydration state restoration, nested island ownership, or the JSX runtime, ask for clarification rather than guessing.
- If you introduce a new feature or change documented behavior, update the corresponding MDX guide and verify `bun run build` passes in `apps/website`.

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Oxlint + Oxfmt (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**

- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Oxlint + Oxfmt Can't Help

Oxlint + Oxfmt's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Oxlint + Oxfmt can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Oxlint + Oxfmt. Run `bun x ultracite fix` before committing to ensure compliance.
