export const URLS = {
  SANDBOX: "https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/{template}",
  GITHUB: "https://github.com/ilhajs/ilha",
  AREIA: "https://areia.ilha.build",
  DISCORD: "https://discord.gg/WnVTMCTz74",
  X_COM: "https://x.com/ilha_js",
} as const;

export const META_DESCRIPTION =
  "Build fast, interactive websites with JavaScript only where you need it. Ilha works with your existing stack and keeps every page lightweight.";

export const COUNTER_CODE = `import { ilha, state, derived, action, mount } from "ilha";

const Signup = ilha(() => {
  const email = state("");
  const ready = derived(() => email().includes("@"));
  const join = action(async (event: SubmitEvent) => {
    event.preventDefault();
    await fetch("/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: email() }),
    });
  });

  return (
    <form class="card" onsubmit={join}>
      <input
        name="email"
        bind:value={email}
        placeholder="you@company.com"
      />
      <button disabled={!ready()}>
        {join.pending ? "Joining…" : "Join waitlist"}
      </button>
    </form>
  );
});

// Hydrate matching server-rendered Signup hosts.
mount({ Signup });`;

export const SIGNALS_CODE = `import { ilha, state, derived } from "ilha";

const Search = ilha(() => {
  const query = state("");
  const results = derived(async ({ signal }) => {
    if (!query()) return [];
    const res = await fetch(
      \`/api/search?q=\${encodeURIComponent(query())}\`,
      { signal }
    );
    return res.json() as Promise<string[]>;
  });

  return (
    <section class="card">
      <input
        name="q"
        placeholder="Search…"
        bind:value={query}
      />
      <Results items={results() ?? []} />
    </section>
  );
});`;

export const RENDERING_CODE = `import { mount } from "ilha";
import { ProductCard } from "./product-card";

// Static HTML — instant first paint.
const html = ProductCard.toString({ featured: true });

// Hydrate only where you need interactivity.
const island = await ProductCard.hydratable(
  { featured: true },
  { name: "ProductCard", snapshot: true },
);

// Or render directly into a client-side host.
const host = document.querySelector("#product-card")!;
ProductCard.mount(host, { featured: true });`;

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
import { pageRouter, registry } from "ilha:pages/client";
pageRouter.hydrate(registry);`;

export const ILHA_STORE_CODE = `// src/lib/cart.ts
import { context, persist } from "ilha";

export const cart = context("cart.items", [] as Item[]);
persist(cart, "cart");

export const add = (product: Item) =>
  cart((items) => [...items, product]);
export const remove = (id: string) =>
  cart((items) => items.filter((p) => p.id !== id));

export const count = () => cart().length;`;

export const ILHA_ASTRO_CODE = `// astro.config.ts
import { defineConfig } from "astro/config";
import ilha from "@ilha/astro";

export default defineConfig({
  integrations: [ilha()],
});`;

export const PREVIEW_CODE = `import { ilha, state, derived, action } from "ilha";
import { Button, Checkbox, Input, LayerCard } from "areia";

let nextId = 4;

export default ilha(() => {
  const tasks = state([
    { id: 1, label: "Ship the landing page", done: true },
    { id: 2, label: "Write unit tests", done: false },
    { id: 3, label: "Update README", done: false },
  ]);
  const draft = state("");
  const pending = derived(() =>
    tasks().filter((task) => !task.done)
  );

  const add = action((event: SubmitEvent) => {
    event.preventDefault();
    const label = draft().trim();
    if (!label) return;
    tasks((current) => [
      ...current,
      { id: nextId++, label, done: false },
    ]);
    draft("");
  });
  const remove = action((id: number) => {
    tasks((current) =>
      current.filter((task) => task.id !== id)
    );
  });

  return (
    <LayerCard>
      <LayerCard.Title>
        My Tasks ({pending().length})
      </LayerCard.Title>
      <LayerCard.Content class="p-0">
        <ul class="divide-y divide-areia-border">
          {tasks().map((task, index) => (
            <li
              key={task.id}
              class="flex items-center gap-2 p-2"
            >
              <div class="flex-1">
                <Checkbox
                  bind:checked={tasks.select(
                    (current) => current[index].done
                  )}
                  label={task.label}
                />
              </div>
              <Button
                onclick={() => remove(task.id)}
                size="sm"
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
        <form
          onsubmit={add}
          class="flex gap-2 border-t border-areia-border p-2"
        >
          <Input
            placeholder="New task…"
            bind:value={draft}
            class="flex-1"
          />
          <Button type="submit" disabled={!draft()}>
            Add
          </Button>
        </form>
      </LayerCard.Content>
    </LayerCard>
  );
});
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
