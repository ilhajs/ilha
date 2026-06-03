export const URLS = {
  SANDBOX: "https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/{template}",
  CLAUDE: "https://claude.ai/new",
  CHATGPT: "https://chatgpt.com/",
  PERPLEXITY: "http://perplexity.ai/",
  GITHUB: "https://github.com/ilhajs/ilha",
  AREIA: "https://areia.ilha.build",
  DISCORD: "https://discord.gg/WnVTMCTz74",
  X_COM: "https://x.com/ilha_js",
} as const;

export const AI_SYSTEM_PROMPT =
  "Source code of `ilha`: https://raw.githubusercontent.com/ilhajs/ilha/refs/heads/main/packages/ilha/src/index.ts. Use it to perform this task: ";

export const COUNTER_CODE = `import ilha, { mount } from "ilha";

export const Signup = ilha
  .state("email", "")
  .derived("isReady", ({ state }) =>
    state.email().includes("@"))
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
        disabled={!derived.isReady()}
      >
        Join the waitlist
      </button>
    </form>
  ));

mount({ Signup });
`;

export const RENDERING_CODE = `import { mount } from "ilha";
import { ProductCard } from "./product-card";

// Ship plain HTML for instant first paint.
const html = ProductCard.toString({ featured: true });

// Add interactivity only where it matters.
const island = await ProductCard.hydratable(
  { featured: true },
  { name: "ProductCard", snapshot: true },
);

// Or mount it client-side when SEO is not needed.
mount({ ProductCard });
`;

export const ILHA_ROUTER_CODE = `// vite.config.ts
import { pages } from "@ilha/router/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [pages()],
});

// src/pages/pricing.tsx becomes /pricing.
// src/pages/blog/[slug].tsx becomes /blog/:slug.
import { pageRouter } from "ilha:pages";

pageRouter.start();
`;

export const ILHA_STORE_CODE = `// src/lib/cart.ts
import { createStore } from "@ilha/store";

export const cart = createStore({ items: [] }, (set, get) => ({
  add(product) {
    set({ items: [...get().items, product] });
  },
  clear() {
    set({ items: [] });
  },
}));

cart.getState().add({ id: "pro", name: "Pro plan" });
cart.getState().items.length; // → 1`;

export const SIGNALS_CODE = `\
const Search = ilha
  .state("query", "")
  .derived("results", async ({ state, signal }) => {
    if (!state.query()) return [];

    const res = await fetch(
      \`/api/search?q=\${state.query()}\`,
      { signal },
    );
    return res.json() as Promise<string[]>;
  })
  .bind("[name=q]", "query")
  .render(({ derived }) => (
    <section class="card">
      <input name="q" placeholder="Search docs, products, or posts…" />
      <Results items={derived.results() ?? []} />
    </section>
  ));`;
