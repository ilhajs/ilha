export const URLS = {
  DISCORD: "https://discord.gg/WnVTMCTz74",
  GITHUB: "https://github.com/ilhajs/ilha",
  SANDBOX:
    "https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/{template}",
  X_COM: "https://x.com/ilha_js",
} as const;

export const DEFAULT_INSTALL_COMMAND =
  "npx giget@latest gh:ilhajs/ilha/templates/vite-spa my-app";

export const META_DESCRIPTION =
  "Ilha is a tiny, isomorphic UI library. Render function components to HTML on the server, then hydrate only the islands that need JavaScript. No virtual DOM, no compiler.";

export const COUNTER_CODE = `import { atom, mount } from "ilha";

const Signup = () => {
  const email = atom("");

  const join = (event: SubmitEvent) => {
    event.preventDefault();
    fetch("/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: email() }),
    });
  };

  return (
    <form class="card" onsubmit={join}>
      <input
        name="email"
        placeholder="you@company.com"
        value={email}
        oninput={(e) =>
          email.set(e.currentTarget.value)
        }
      />
      <button disabled={!email().includes("@")}>Join waitlist</button>
    </form>
  );
};

mount(document.getElementById("signup")!, Signup);`;

export const SIGNALS_CODE = `import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Atom from "effect/reactivity/Atom";
import { atom, mount, when } from "ilha";

function* Search() {
  const query = atom("");
  yield (
    <section class="card">
      <input
        name="q"
        placeholder="Search…"
        value={query}
        oninput={(e) =>
          query.set(e.currentTarget.value)
        }
      />
    </section>
  );
  yield* when(
    Atom.toStream(query.atom).pipe(Stream.debounce("200 millis")),
    function* (q) {
      if (!q) return undefined;
      const items = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(\`/api/search?q=\${encodeURIComponent(q)}\`, { signal }).then(
            (r) => r.json(),
          ),
        catch: (e) => e,
      });
      yield <ul>{(items as string[]).map((item) => <li>{item}</li>)}</ul>;
      return undefined;
    },
  );
}

mount(document.getElementById("search")!, Search);`;

export const RENDERING_CODE = `import { mount, renderToString } from "ilha";
import { ProductCard } from "./product-card";

// server.ts — paint HTML and embed atom snapshots
const html = await renderToString(() => ProductCard({ featured: true }));

// client.ts — restore the snapshots and attach events
const host = document.querySelector("#product-card")!;
mount(host, () => ProductCard({ featured: true }), { hydrate: true });`;

export const ILHA_ROUTER_CODE = `// vite.config.ts
import pages from "@ilha/router/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [pages()],
});

// File-based routes under src/pages/
//   index.tsx        → /
//   pricing.tsx      → /pricing
//   blog/[slug].tsx  → /blog/:slug
import { pageRouter } from "ilha:pages/client";
pageRouter.mount("#app", { hydrate: true });`;

export const ILHA_CONTEXT_CODE = `import { atom, context, createContext } from "ilha";

const Theme = createContext("light");

const Label = () => {
  const theme = context(Theme);
  return <span>{theme}</span>;
};

export const App = () => {
  const mode = atom("dark");
  return (
    <Theme.Provider value={mode()}>
      <button type="button" onclick={() => mode.set("light")}>
        Light
      </button>
      <Label />
    </Theme.Provider>
  );
};`;

export const ILHA_ASTRO_CODE = `// astro.config.ts
import { defineConfig } from "astro/config";
import ilha from "@ilha/astro";

export default defineConfig({
  integrations: [ilha()],
});`;

export const PREVIEW_CODE = `import * as Atom from "effect/reactivity/Atom";
import { atom } from "ilha";

let nextId = 4;

export default function Tasks() {
  const tasks = atom([
    { id: 1, label: "Ship the landing page", done: true },
    { id: 2, label: "Write unit tests", done: false },
    { id: 3, label: "Update README", done: false },
  ]);

  const pending = atom(
    Atom.map(tasks.atom, (list) => list.filter((task) => !task.done).length),
  );

  const addItem = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const label = String(new FormData(form).get("text") ?? "").trim();
    if (!label) return;
    tasks.update((current) => [...current, { id: nextId++, label, done: false }]);
    form.reset();
  };

  return (
    <div class="card bg-base-100 shadow">
      <div class="card-body gap-3 p-3">
        <h2 class="card-title text-base">
          My Tasks <span class="badge badge-primary">{pending}</span>
        </h2>
        <ul class="flex flex-col gap-1">
          {tasks().map((task) => (
            <li key={task.id} class="flex items-center justify-between gap-2">
              <label class="label cursor-pointer justify-start gap-2">
                <input
                  type="checkbox"
                  class="checkbox"
                  checked={task.done}
                  onchange={(event) => {
                    const done = event.currentTarget.checked;
                    tasks.update((current) =>
                      current.map((item) =>
                        item.id === task.id ? { ...item, done } : item,
                      ),
                    );
                  }}
                />
                <span>{task.label}</span>
              </label>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() =>
                  tasks.update((current) => current.filter((item) => item.id !== task.id))
                }
              >
                {'\\u2715'}
              </button>
            </li>
          ))}
        </ul>
        <form onsubmit={addItem} class="flex gap-2">
          <input
            name="text"
            class="input input-bordered input-sm w-full"
            placeholder="New task..."
          />
          <button type="submit" class="btn btn-primary btn-sm">
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
`;

export const PRIMARY_ILHA_CARDS = [
  {
    code: COUNTER_CODE,
    description:
      "A component is a function that returns JSX. You declare atom() values inside it, and markup, state, and events stay in one file you can read top to bottom.",
    file: "signup.tsx",
    id: "syntax",
    label: "Components",
    points: [
      "Plain functions, no classes or hooks rules to learn",
      "Lowercase native events: onclick, oninput",
      "Interpolations escape by default",
    ],
    title: "Write a function. Return HTML-shaped JSX.",
  },
  {
    code: SIGNALS_CODE,
    description:
      "Reading an atom subscribes the component that read it. A write reruns only that component and morphs its host DOM, with no virtual DOM diffing a whole tree.",
    file: "search.tsx",
    id: "signals",
    label: "Fine-grained reactivity",
    points: [
      "Derived values with Atom.map and Atom.transform",
      "Effect Streams for debounce, merge, and live feeds",
      "when() interrupts stale async work",
    ],
    title: "Update only the component that changed.",
  },
  {
    code: RENDERING_CODE,
    description:
      "You call await renderToString() on the server and mount() with hydrate: true in the browser. The same function runs in both places, so you never split server and client copies.",
    file: "product-card.tsx",
    id: "rendering",
    label: "Isomorphic rendering",
    points: [
      "Runs in Node, Bun, and edge runtimes without a DOM polyfill",
      "Atom snapshots travel with the HTML",
      "Every island hydrates on its own",
    ],
    title: "Render on the server. Hydrate in the browser.",
  },
] as const;

export const USEFUL_EXTRAS_CARD = {
  description:
    "The core package covers components, atoms, and rendering. Add file-system routing, context, or the Astro integration when your project asks for them.",
  label: "Grow when you need to",
  points: [
    "@ilha/router: file-system routes and server islands",
    "createContext() for values shared across a subtree",
    "@ilha/astro: Ilha components as Astro islands",
  ],
  title: "Start with one package. Add the rest later.",
} as const;
