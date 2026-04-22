export const URLS = {
  SANDBOX: "https://stackblitz.com/github/ilhajs/ilha/tree/main/templates/{template}",
  CLAUDE: "https://claude.ai/new",
  CHATGPT: "https://chatgpt.com/",
  PERPLEXITY: "http://perplexity.ai/",
  GITHUB: "https://github.com/ilhajs/ilha",
  DOCSOME: "https://github.com/guarana-studio/docsome",
  DISCORD: "https://discord.gg/WnVTMCTz74",
  X_COM: "https://x.com/ilha_js",
} as const;

export const AI_SYSTEM_PROMPT =
  "Source code of `ilha`: https://raw.githubusercontent.com/ilhajs/ilha/refs/heads/main/packages/ilha/src/index.ts. Use it to perform this task: ";

export const COUNTER_CODE = `import ilha, { html, mount } from "ilha";

export const counter = ilha
  .state("count", 0)
  .derived("doubled", ({ state }) => state.count() * 2)
  .on("[data-action=increase]@click", ({ state }) => {
    state.count(state.count() + 1);
  })
  .on("[data-action=decrease]@click", ({ state }) => {
    state.count(state.count() - 1);
  })
  .render(
    ({ state, derived }) => html\`
      <p>Count: \${state.count()}</p>
      <p>Doubled: \${derived.doubled.value}</p>
      <button data-action="increase">Increase</button>
      <button data-action="decrease">Decrease</button>
    \`,
  );

mount({ counter });
`;

export const RENDERING_CODE = `import { mount } from "ilha";
import { counter } from "./hero";

// Client side (lazy mount)
mount({ counter });
// Server side (only initial state)
counter.toString();
// Server side hydratable (execute derived)
await counter.hydratable();
`;

export const ILHA_ROUTER_CODE = `// vite.config.ts
import { pages } from "@ilha/router/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [pages()],
});

// main.ts
// Add routes in src/pages/ and import registered routes
import { pageRouter } from "ilha:pages";
`;

export const ILHA_STORE_CODE = `// src/lib/store.ts
import { createStore } from "@ilha/store";

const store = createStore({ count: 0 }, (set, get) => ({
  increment() {
    set({ count: get().count + 1 });
  },
}));

store.getState().increment();
store.getState().count; // → 1`;

export const ILHA_FORM_CODE = `// src/pages/index.ts
const form = createForm({
  el: document.querySelector("form")!,
  schema: mySchema,
  onSubmit(values, event) {
    /* … */
  },
  onError(issues, event) {
    /* … */
  },
});
`;

export const SIGNALS_CODE = `\
const search = ilha
  .state("query", "")
  .derived("results", async ({ state, signal }) => {
    const url = \`/api/search?q=\${state.query()}\`;
    const res = await fetch(url, { signal });
    return res.json() as Promise<string[]>;
  })
  .effect(({ state }) => {
    const title = \`Search: \${state.query() || "…"}\`;
    document.title = title;
  })
  .bind("[name=q]", "query")
  .render(({ state, derived }) => html\`
    <input name="q" placeholder="Search…" />
    <!--Render results-->
  \`);`;
