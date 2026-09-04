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
  "Build fast, interactive websites with JavaScript only where you need it. Ilha works with your existing stack and keeps every page lightweight.";

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
import * as Atom from "effect/unstable/reactivity/Atom";
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

const html = await renderToString(() => ProductCard({ featured: true }));

const host = document.querySelector("#product-card")!;
mount(host, () => ProductCard({ featured: true }), { hydrate: true });`;

export const ILHA_ROUTER_CODE = `// vite.config.ts
import { pages } from "@ilha/router/vite";
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

export const ILHA_STORE_CODE = `// src/lib/cart.ts
import { atom } from "ilha";
import type { Item } from "./types";

export const cart = atom<Item[]>([]);
export const add = (product: Item) =>
  cart.update((items) => [...items, product]);
export const remove = (id: string) =>
  cart.update((items) => items.filter((p) => p.id !== id));
export const count = () => cart().length;`;

export const ILHA_ASTRO_CODE = `// astro.config.ts
import { defineConfig } from "astro/config";
import ilha from "@ilha/astro";

export default defineConfig({
  integrations: [ilha()],
});`;

export const PREVIEW_CODE = `import * as Atom from "effect/unstable/reactivity/Atom";
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
      "The data, user actions, and HTML for a feature stay together. You can understand it at a glance, move it between pages, or remove it cleanly.",
    file: "signup.tsx",
    id: "syntax",
    label: "Easy to follow",
    points: [
      "Familiar event handling",
      "Local state with atom()",
      "No app shell required",
    ],
    title: "Keep each interaction in one clear place.",
  },
  {
    code: SIGNALS_CODE,
    description:
      "Signals connect your data directly to the page. When something changes, Ilha updates the affected element instead of redrawing the whole interface.",
    file: "signals.tsx",
    id: "signals",
    label: "Efficient updates",
    points: [
      "Simple state updates",
      "Stale requests cancel automatically",
      "No page-wide redraws",
    ],
    title: "Update only what changed.",
  },
  {
    code: RENDERING_CODE,
    description:
      "Render HTML on your server for a fast first view, then activate only the components people can interact with. Each island works independently.",
    file: "product-card.tsx",
    id: "rendering",
    label: "Flexible delivery",
    points: [
      "Fast server-rendered HTML",
      "Async data support",
      "Independent interactivity",
    ],
    title: "Send useful content before JavaScript loads.",
  },
] as const;

export const USEFUL_EXTRAS_CARD = {
  description:
    "Begin with one lightweight package. Add routing, shared data, or Astro support only when your website needs it.",
  label: "Add what you need",
  points: [
    "Pages and dynamic routes",
    "Shared data for carts and sessions",
    "First-class Astro integration",
  ],
  title: "Start small. Expand when your product grows.",
} as const;
