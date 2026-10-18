# AGENTS.md

A server-rendered [Ilha](https://ilha.build) app on [Void](https://void.cloud). Pages live in `pages/`. Void owns routing, loaders, actions, and deployment; `@ilha/void` renders and hydrates pages with Ilha.

## Commands

| Command | Use it to |
| --- | --- |
| `bun run check` | Typecheck, lint, and test. Run it before you finish. |
| `bun run typecheck` | Run `tsc --noEmit`. |
| `bun run lint` | Run Oxlint with the Ilha plugin. Add `--fix` to apply autofixes. |
| `bun run test` | Run the tests with `bun test`. |
| `bun run dev` | Start the Vite dev server on http://localhost:5173. |
| `bun run build` | Build for production. |

## Canonical APIs

A component is a function that returns JSX. Primitives are order-based: call them at the top level of the component, in the same order on every render — never in `if`, loops, callbacks, or after `await`.

```tsx
import * as Atom from "effect/reactivity/Atom";
import { atom, watch } from "ilha";

export default function Counter({ start = 0 }: { start?: number }) {
  const count = atom(start); // state; read count(), write count.set(1) / count.update((n) => n + 1)
  const doubled = atom(Atom.map(count.atom, (n) => n * 2)); // derived value
  const startedAt = atom.lazy(() => Date.now()); // one-time init, or a stored function value
  watch.once(() => {
    // mount-only side effect; return a cleanup function if needed
  });
  return (
    <button type="button" onclick={() => count.update((n) => n + 1)}>
      {count} / {doubled} (since {startedAt})
    </button>
  );
}
```

- Use lowercase DOM names on native elements: `onclick`, `class`, `for`. Never `onClick`, `className`, `htmlFor`.
- `atom(value)` takes a value, an Effect atom, an Effect, or a Stream. It never takes a plain function — use `atom.lazy(() => …)`.
- Derive values with `atom(Atom.map(source.atom, …))` or `atom(Atom.transform(…))` from `effect/reactivity/Atom`. Pass `handle.atom` to Effect APIs.
- Give every component returned from `.map()` a stable `key`.
- Use `yield* when(…)` only inside a generator component.
- Void owns data: loaders and actions live in `pages/*.server.ts`; read them with `Props` and `useForm`, not with ad-hoc `fetch`.

## Testing and debugging

- `renderHtml(Component)` from `ilha/test` returns the server HTML; assert on it in `pages/*.test.tsx`.
- `render(Component)` from `ilha/test` mounts into a DOM (needs happy-dom) and drives `click`, `input`, and `submit`.
- `inspect()` from `ilha/debug` returns the live component and atom tree as JSON.

## Errors

Every Ilha error and warning carries a code such as `ILHA002`, a `Fix:` line, and a link. Read the fix first; the full list is at https://ilha.build/errors.

## References

- Full docs for agents: https://ilha.build/llms.txt (everything in one file: https://ilha.build/llms-full.txt)
- Error codes: https://ilha.build/errors
- Lint rules: https://ilha.build/guide/recipes/oxlint
- Void guide: https://ilha.build/guide/void
