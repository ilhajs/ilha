export const URLS = {
  SANDBOX: "https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/{template}",
  GITHUB: "https://github.com/ilhajs/ilha",
  DISCORD: "https://discord.gg/WnVTMCTz74",
  X_COM: "https://x.com/ilha_js",
} as const;

export const META_DESCRIPTION =
  "Build fast, interactive websites with JavaScript only where you need it. Ilha works with your existing stack and keeps every page lightweight.";

export const COUNTER_CODE = `import { atom, mount } from "ilha";

const Signup = () => {
  const email = atom("");
  const ready = atom(() => email().includes("@"));

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
        oninput={(e) => email.set((e.currentTarget as HTMLInputElement).value)}
      />
      <button disabled={!ready()}>Join waitlist</button>
    </form>
  );
};

mount(document.getElementById("signup")!, Signup);`;

export const SIGNALS_CODE = `import { atom, mount } from "ilha";
import * as Effect from "effect/Effect";

const Search = () => {
  const query = atom("");
  const results = atom(
    Effect.promise(() =>
      fetch(\`/api/search?q=\${encodeURIComponent(query())}\`).then((r) => r.json()),
    ),
  );

  return (
    <section class="card">
      <input
        name="q"
        placeholder="Search…"
        oninput={(e) => query.set((e.currentTarget as HTMLInputElement).value)}
      />
      <ul>{(results() ?? []).map((item) => <li>{item}</li>)}</ul>
    </section>
  );
};

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

export const PREVIEW_CODE = `import { atom } from "ilha";

let nextId = 4;

export default function Tasks() {
  const tasks = atom([
    { id: 1, label: "Ship the landing page", done: true },
    { id: 2, label: "Write unit tests", done: false },
    { id: 3, label: "Update README", done: false },
  ]);
  const pending = atom(() => tasks().filter((task) => !task.done).length);

  const add = (event: SubmitEvent) => {
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
        <h2 class="card-title text-base">My Tasks <span class="badge badge-primary">{pending}</span></h2>
        <ul class="flex flex-col gap-1">
          {tasks().map((task) => (
            <li key={task.id} class="flex items-center justify-between gap-2">
              <label class="label cursor-pointer justify-start gap-2">
                <input
                  type="checkbox"
                  class="checkbox"
                  checked={task.done}
                  onchange={(event: Event) => {
                    const done = (event.currentTarget as HTMLInputElement).checked;
                    tasks.update((current) =>
                      current.map((item) => (item.id === task.id ? { ...item, done } : item)),
                    );
                  }}
                />
                <span>{task.label}</span>
              </label>
              <button type="button" class="btn btn-ghost btn-xs" onclick={() => tasks.update((current) => current.filter((item) => item.id !== task.id))}>\u2715</button>
            </li>
          ))}
        </ul>
        <form onsubmit={add} class="flex gap-2">
          <input name="text" class="input input-bordered input-sm w-full" placeholder="New task\u2026" />
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
      </div>
    </div>
  );
}
`;

export const PRIMARY_ILHA_CARDS = [
  {
    id: "syntax",
    label: "Easy to follow",
    title: "Keep each interaction in one clear place.",
    description:
      "The data, user actions, and HTML for a feature stay together. You can understand it at a glance, move it between pages, or remove it cleanly.",
    points: ["Familiar event handling", "Type-safe actions", "No app shell required"],
    file: "signup.tsx",
    code: COUNTER_CODE,
  },
  {
    id: "signals",
    label: "Efficient updates",
    title: "Update only what changed.",
    description:
      "Signals connect your data directly to the page. When something changes, Ilha updates the affected element instead of redrawing the whole interface.",
    points: ["Simple state updates", "Stale requests cancel automatically", "No page-wide redraws"],
    file: "signals.tsx",
    code: SIGNALS_CODE,
  },
  {
    id: "rendering",
    label: "Flexible delivery",
    title: "Send useful content before JavaScript loads.",
    description:
      "Render HTML on your server for a fast first view, then activate only the components people can interact with. Each island works independently.",
    points: ["Fast server-rendered HTML", "Async data support", "Independent interactivity"],
    file: "product-card.tsx",
    code: RENDERING_CODE,
  },
] as const;

export const USEFUL_EXTRAS_CARD = {
  label: "Add what you need",
  title: "Start small. Expand when your product grows.",
  description:
    "Begin with one lightweight package. Add routing, shared data, or Astro support only when your website needs it.",
  points: [
    "Pages and dynamic routes",
    "Shared data for carts and sessions",
    "First-class Astro integration",
  ],
} as const;
