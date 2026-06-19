export const URLS = {
  SANDBOX: "https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/{template}",
  GITHUB: "https://github.com/ilhajs/ilha",
  AREIA: "https://areia.ilha.build",
  DISCORD: "https://discord.gg/WnVTMCTz74",
  X_COM: "https://x.com/ilha_js",
} as const;

export const META_DESCRIPTION =
  "Ilha is a lightweight UI framework under 2,500 lines of code. Simple enough to fit in a single AI context window, powerful enough to build modern interfaces your way.";

/** Landing card snippets — kept to a similar line count for even code panel height. */
export const COUNTER_CODE = `import ilha, { mount } from "ilha";

const Signup = ilha
  .state("email", "")
  .derived("ready", ({ state }) => state.email().includes("@"))
  .on("[data-action=join]@click", async ({ state }) => {
    await fetch("/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: state.email() }),
    });
  })
  .render(({ state, derived }) => (
    <form class="card">
      <input name="email" bind:value={state.email} placeholder="you@company.com" />
      <button data-action="join" disabled={!derived.ready()}>
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
    const res = await fetch(\`/api/search?q=\${encodeURIComponent(state.query())}\`, { signal });
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
import { createStore } from "@ilha/store";

export const cart = createStore({ items: [] }, (set, get) => ({
  add(product) {
    set({ items: [...get().items, product] });
  },
  remove(id) {
    set({ items: get().items.filter((p) => p.id !== id) });
  },
  clear() {
    set({ items: [] });
  },
}));

cart.getState().add({ id: "pro", name: "Pro plan" });`;
