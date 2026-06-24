/** Landing card samples → Shiki HTML via virtual module `imprensa/landing-shiki` (read automatically when this file exists). */

import {
  COUNTER_CODE,
  ILHA_ROUTER_CODE,
  ILHA_STORE_CODE,
  RENDERING_CODE,
  SIGNALS_CODE,
} from "./landing-const.ts";

export const landingSnippets = {
  fileTree: {
    lang: "shell",
    code: `src/
  lib/components/
  main.ts
  pages/
    (content)/*.mdx`,
  },
  mdx: {
    lang: "mdx",
    code: `# Writing great docs

\`\`\`ts
const path = "/guide/getting-started/introduction"
\`\`\`

<Button>Try it</Button>`,
  },
  build: {
    lang: "shell",
    code: `$ bun run build
✓ dist/index.html
✓ dist/guide/getting-started/introduction/index.html

Deploy dist/ anywhere.`,
  },
  syntax: { lang: "tsx", code: COUNTER_CODE },
  signals: { lang: "tsx", code: SIGNALS_CODE },
  rendering: { lang: "tsx", code: RENDERING_CODE },
  routing: { lang: "tsx", code: ILHA_ROUTER_CODE },
  store: { lang: "tsx", code: ILHA_STORE_CODE },
} as const;
