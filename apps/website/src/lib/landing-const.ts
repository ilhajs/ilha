export const URLS = {
  SANDBOX: "https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/{template}",
  GITHUB: "https://github.com/ilhajs/ilha",
  AREIA: "https://areia.ilha.build",
  DISCORD: "https://discord.gg/WnVTMCTz74",
  X_COM: "https://x.com/ilha_js",
} as const;

export const META_DESCRIPTION =
  "Ilha ships interactive UI as plain HTML, then hydrates only what needs to move. Tiny core.";

export const COUNTER_CODE = `import ilha, { mount } from "ilha";

const Signup = ilha
  .state("email", "")
  .derived("ready", ({ state }) =>
    state.email().includes("@")
  )
  .on("[data-action=join]@click", async ({ state }) => {
    await fetch("/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: state.email() }),
    });
  })
  .render(({ state, derived }) => (
    <form class="card">
      <input
        name="email"
        bind:value={state.email}
        placeholder="you@company.com"
      />
      <button
        data-action="join"
        disabled={!derived.ready()}
      >
        Join waitlist
      </button>
    </form>
  ));

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

// Or mount client-side when SEO is not required.
mount({ ProductCard });`;

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
import { pageRouter } from "ilha:pages";
pageRouter.start();`;

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
import { each } from "quando";

let nextId = 4;

export default ilha
  .state("tasks", [
    { id: 1, label: "Ship the landing page", done: true },
    { id: 2, label: "Write unit tests", done: false },
    { id: 3, label: "Update README", done: false },
  ])
  .state("draft", "")
  .derived("pending", ({ state }) =>
    state.tasks().filter((t) => !t.done)
  )
  .on("form@submit", ({ state, event }) => {
    event.preventDefault();
    const label = state.draft().trim();
    if (!label) return;
    state.tasks([
      ...state.tasks(),
      { id: nextId++, label, done: false }
    ]);
    state.draft("");
  })
  .on("[data-remove]@click", ({ state, target }) => {
    const id = Number(target.dataset.remove);
    state.tasks(state.tasks().filter((t) => t.id !== id));
  })
  .render(({ state, derived }) => (
    <LayerCard>
      <LayerCard.Title>
        My Tasks ({derived.pending().length})
      </LayerCard.Title>
      <LayerCard.Content class="p-0">
        <ul class="divide-y divide-areia-border">
          {each(state.tasks())
            .as((task, i) => (
              <li
                key={task.id}
                class="flex items-center gap-2 p-2"
              >
                <div class="flex-1">
                  <Checkbox
                    bind:checked={state.tasks.select((tasks) => tasks[i].done)}
                    label={task.label}
                  />
                </div>
                <Button data-remove={task.id} size="sm">
                  ✕
                </Button>
              </li>
            ))
            .else(<div class="p-2">No tasks</div>)}
        </ul>
        <form
          class="flex gap-2 border-t border-areia-border p-2"
        >
          <Input
            placeholder="New task…"
            bind:value={state.draft}
            class="flex-1"
          />
          <Button type="submit" disabled={state.draft.length}>
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
    title: "One island holds the whole interaction.",
    description:
      "State, events, and markup live in one builder chain — so interactive UI stays local, readable, and easy to move.",
    points: ["Svelte-like reactivity", "React-flavored templating", "No app shell required"],
    file: "signup.tsx",
    code: COUNTER_CODE,
  },
  {
    id: "signals",
    label: "Signals",
    title: "Update only what the user touched.",
    description:
      "Signals track what your UI actually reads. Pages stay quiet until something changes — then only that part moves.",
    points: ["Fine-grained updates", "Abortable async work", "No app-wide re-render loop"],
    file: "signals.tsx",
    code: SIGNALS_CODE,
  },
  {
    id: "rendering",
    label: "Rendering",
    title: "Choose HTML, hydration, or client — per island.",
    description:
      "Keep most of the page as static HTML. Opt into SSR hydration or client-only where the interaction earns the JavaScript.",
    points: ["Static HTML", "Server-rendered hydration", "Client-only islands"],
    file: "product-card.tsx",
    code: RENDERING_CODE,
  },
] as const;

export const USEFUL_EXTRAS_CARD = {
  label: "Libraries",
  title: "Grow the stack only when the product asks.",
  description:
    "Start with a single import. Add file-based routes or Zustand-shaped stores when navigation or shared state shows up — not before.",
  points: [
    "File-based routes and dynamic pages",
    "Shared cart and session state",
    "Astro islands with client directives",
  ],
} as const;
