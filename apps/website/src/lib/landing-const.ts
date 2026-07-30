export const URLS = {
  SANDBOX: "https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/{template}",
  GITHUB: "https://github.com/ilhajs/ilha",
  AREIA: "https://areia.ilha.build",
  DISCORD: "https://discord.gg/WnVTMCTz74",
  X_COM: "https://x.com/ilha_js",
} as const;

export const META_DESCRIPTION =
  "Build typed interactive UI that renders to plain HTML and hydrates only where it needs to move. No compiler or virtual DOM.";

export const COUNTER_CODE = `import ilha, { mount } from "ilha";

const Signup = ilha
  .state("email", "")
  .derived("ready", ({ state }) =>
    state.email().includes("@")
  )
  .action("join", async (event: SubmitEvent, { state }) => {
    event.preventDefault();
    await fetch("/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: state.email() }),
    });
  })
  .render(({ state, derived, action }) => (
    <form class="card" onsubmit={action.join}>
      <input
        name="email"
        bind:value={state.email}
        placeholder="you@company.com"
      />
      <button disabled={!derived.ready()}>
        {action.join.pending ? "Joining…" : "Join waitlist"}
      </button>
    </form>
  ));

// Hydrate matching server-rendered Signup hosts.
mount({ Signup });`;

export const SIGNALS_CODE = `import ilha from "ilha";

const Search = ilha
  .state("query", "")
  .derived("results", async ({ state, signal }) => {
    if (!state.query()) return [];
    const res = await fetch(
      \`/api/search?q=\${encodeURIComponent(state.query())}\`,
      { signal }
    );
    return res.json() as Promise<string[]>;
  })
  .render(({ state, derived }) => (
    <section class="card">
      <input
        name="q"
        placeholder="Search…"
        bind:value={state.query}
      />
      <Results items={derived.results() ?? []} />
    </section>
  ));`;

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
import { store } from "@ilha/store";

export const cart = store({ items: [] as Item[] })
  .action("add", (product: Item, ctx) => ({
    items: [...ctx.get().items, product],
  }))
  .action("remove", (id: string, ctx) => ({
    items: ctx.get().items.filter((p) => p.id !== id),
  }))
  .action("clear", () => ({ items: [] }))
  .on("change", (state) => {
    localStorage.setItem("cart", JSON.stringify(state));
  })
  .build();

cart.add({ id: "pro", name: "Pro plan" });`;

export const ILHA_ASTRO_CODE = `// astro.config.ts
import { defineConfig } from "astro/config";
import ilha from "@ilha/astro";

export default defineConfig({
  integrations: [ilha()],
});`;

export const PREVIEW_CODE = `import ilha from "ilha";
import { Button, Checkbox, Input, LayerCard } from "areia";

let nextId = 4;

export default ilha
  .state("tasks", [
    { id: 1, label: "Ship the landing page", done: true },
    { id: 2, label: "Write unit tests", done: false },
    { id: 3, label: "Update README", done: false },
  ])
  .state("draft", "")
  .derived("pending", ({ state }) =>
    state.tasks().filter((task) => !task.done)
  )
  .action("add", (event: SubmitEvent, { state }) => {
    event.preventDefault();
    const label = state.draft().trim();
    if (!label) return;
    state.tasks((tasks) => [
      ...tasks,
      { id: nextId++, label, done: false },
    ]);
    state.draft("");
  })
  .action("remove", (id: number, { state }) => {
    state.tasks((tasks) =>
      tasks.filter((task) => task.id !== id)
    );
  })
  .render(({ state, derived, action }) => (
    <LayerCard>
      <LayerCard.Title>
        My Tasks ({derived.pending().length})
      </LayerCard.Title>
      <LayerCard.Content class="p-0">
        <ul class="divide-y divide-areia-border">
          {state.tasks().map((task, index) => (
            <li
              key={task.id}
              class="flex items-center gap-2 p-2"
            >
              <div class="flex-1">
                <Checkbox
                  bind:checked={state.tasks.select(
                    (tasks) => tasks[index].done
                  )}
                  label={task.label}
                />
              </div>
              <Button
                onclick={() => action.remove(task.id)}
                size="sm"
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
        <form
          onsubmit={action.add}
          class="flex gap-2 border-t border-areia-border p-2"
        >
          <Input
            placeholder="New task…"
            bind:value={state.draft}
            class="flex-1"
          />
          <Button type="submit" disabled={!state.draft()}>
            Add
          </Button>
        </form>
      </LayerCard.Content>
    </LayerCard>
  ));
`;

export const PRIMARY_ILHA_CARDS = [
  {
    id: "syntax",
    label: "Syntax",
    title: "Read the feature from top to bottom.",
    description:
      "Typed state, derived values, actions, and markup stay in one builder chain. The interaction is local, portable, and easy to delete.",
    points: ["Lowercase native events", "Typed reusable actions", "No app shell required"],
    file: "signup.tsx",
    code: COUNTER_CODE,
  },
  {
    id: "signals",
    label: "Signals",
    title: "Signals are functions, not ceremony.",
    description:
      "Read a signal by calling it. Write a value or pass an updater. Async derived work cancels when its dependencies change.",
    points: ["Functional setters", "Abortable async work", "No app-wide render loop"],
    file: "signals.tsx",
    code: SIGNALS_CODE,
  },
  {
    id: "rendering",
    label: "Rendering",
    title: "Render each island the way the page needs.",
    description:
      "Call .toString() for synchronous HTML, await the island for async SSR, or emit hydratable markup with explicit state snapshots.",
    points: ["Synchronous HTML", "Awaited server rendering", "Independent hydration"],
    file: "product-card.tsx",
    code: RENDERING_CODE,
  },
] as const;

export const USEFUL_EXTRAS_CARD = {
  label: "Libraries",
  title: "Grow the stack only when the product asks.",
  description:
    "Start with a single import. Add file-based routes or signal-based shared stores when navigation or shared state shows up — not before.",
  points: [
    "File-based routes and dynamic pages",
    "Shared cart and session state",
    "Astro islands with client directives",
  ],
} as const;
