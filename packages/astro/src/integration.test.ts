/**
 * Integration tests that exercise the real @ilha/astro integration against
 * a real Astro build, combined with another JSX framework (Solid).
 *
 * These are heavier than the unit tests in index.test.ts: they build the
 * `ilha` and `@ilha/astro` packages (the renderer-tag fix lives in core), then
 * scaffold a throwaway Astro project and run `astro build`. They exist to lock
 * in the one behavior that unit tests cannot: that ilha islands are routed to
 * ilha's renderer even when another renderer with a permissive `check()`
 * (Solid) is registered first in `astro.config`.
 */
import { afterAll, describe, expect, it, beforeAll } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = import.meta.dir; // packages/astro/src
const PKG_DIR = join(SRC_DIR, ".."); // packages/astro
const ROOT = join(PKG_DIR, "..", ".."); // repo root

const ASTRO_BIN = join(
  dirname(fileURLToPath(import.meta.resolve("astro/package.json"))),
  "bin",
  "astro.mjs",
);

const JSX_COUNTER = `/** @jsxImportSource ilha */
import ilha from "ilha";
export const Counter = ilha
  .input<{ start?: number }>({ start: 0 })
  .state("count", (input) => input.start ?? 0)
  .action("increment", (_, { state }) => state.count((count) => count + 1))
  .render(({ state, action }) => (
    <div class="flex gap-2">
      {state.count()}
      <button type="button" onclick={() => action.increment()}>Increment with Ilha-JSX</button>
    </div>
  ));
`;

const HTML_COUNTER = `/** @jsxImportSource ilha */
import ilha, { html } from "ilha";
export const Counter = ilha
  .input<{ start?: number }>({ start: 0 })
  .state("count", (input) => input.start ?? 0)
  .action("increment", (_, { state }) => state.count((count) => count + 1))
  .render(({ state, action }) => html\`
    <div class="flex gap-2">
      \${state.count()}
      <button type="button" onclick=\${() => action.increment()}>
        Increment with Ilha-HTML
      </button>
    </div>
  \`);
`;

const SOLID_COUNTER = `/** @jsxImportSource fake-js */
import { createSignal } from "fake-js";
export function Counter(props: { start?: number }) {
  const [count, setCount] = createSignal<number>(props.start ?? 3);
  const increment = () => setCount(count() + 1);
  return (
    <div class="flex gap-2">
      {count()}
      <button onClick={increment}>Increment with Solid</button>
    </div>
  );
}
`;

const PAGE = `---
import { Counter as SolidCounter } from "../components/solid/Counter";
import { Counter as IlhaCounter } from "../components/ilha/Counter";
import { Counter as IlhaHtmlCounter } from "../components/ilha/CounterHtml";
---
<html>
  <head><title>Fixture</title></head>
  <body>
    <SolidCounter client:load />
    <IlhaCounter start={4} client:load />
    <IlhaHtmlCounter start={5} client:load />
  </body>
</html>
`;

const TSCONFIG = `{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"],
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "ilha",
    "paths": { "~/*": ["./src/*"] }
  }
}
`;

function astroConfig(ilhaFirst: boolean, include: boolean): string {
  const opts = (mod: string) =>
    include ? `${mod}({ include: "**/${mod === "ilha" ? "ilha" : "solid"}/**" })` : `${mod}()`;
  const ilha = opts("ilha");
  const solid = include ? 'solidJs({ include: "**/solid/**" })' : "solidJs()";
  const install = ilhaFirst ? `${ilha}, ${solid}` : `${solid}, ${ilha}`;
  return `import { defineConfig } from "astro/config";
import solidJs from "@astrojs/fake-integration";
import ilha from "@ilha/astro";
export default defineConfig({
  integrations: [ ${install} ],
  output: "static",
});\n`;
}

let fixtureDir = "";
let buildsDone = false;

function build(cmd: string): void {
  try {
    execSync(cmd, {
      cwd: ROOT,
      stdio: "pipe",
      // Slow under a fully-parallel CI load; a finite budget keeps a hung
      // build from blocking the suite forever and is well above any real run.
      timeout: 180_000,
    });
  } catch (error: any) {
    // execSync hides stdout/stderr unless we graft them onto the error, which
    // is exactly what makes a failed build debuggable in CI.
    error.message += `\n--- stdout ---\n${(error.stdout ?? "").toString()}--- stderr ---\n${(error.stderr ?? "").toString()}`;
    throw error;
  }
}

function freshDist(): void {
  if (buildsDone) return;
  build("bun run --filter ilha build");
  build("bun run --filter @ilha/astro build");
  // Flag completion only after both builds succeeded so a failed first build
  // re-runs both on a retry rather than skipping the never-completed work.
  buildsDone = true;
}

function setupFixture() {
  fixtureDir = join(tmpdir(), `ilha-astro-fixture-${Math.random().toString(36).slice(2)}`);
  const src = join(fixtureDir, "src");
  mkdirSync(join(src, "components", "ilha"), { recursive: true });
  mkdirSync(join(src, "components", "solid"), { recursive: true });
  mkdirSync(join(src, "pages"), { recursive: true });
  writeFileSync(join(fixtureDir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  writeFileSync(join(fixtureDir, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(src, "components", "ilha", "Counter.tsx"), JSX_COUNTER);
  writeFileSync(join(src, "components", "ilha", "CounterHtml.tsx"), HTML_COUNTER);
  writeFileSync(join(src, "components", "solid", "Counter.tsx"), SOLID_COUNTER);
  writeFileSync(join(src, "pages", "index.astro"), PAGE);

  // Link the real workspace deps so Astro resolves a single copy of each.
  // Leaf symlinks (not a whole-scope dir) — Node's ESM loader reliably follows
  // a symlinked package, but not a symlinked `@astrojs` scope directory.
  const nm = join(fixtureDir, "node_modules");
  mkdirSync(join(nm, "@ilha"), { recursive: true });
  mkdirSync(join(nm, "@astrojs"), { recursive: true });
  symlinkSync(PKG_DIR, join(nm, "@ilha", "astro"));
  symlinkSync(join(PKG_DIR, "..", "ilha"), join(nm, "ilha"));
  symlinkSync(join(PKG_DIR, "node_modules", "astro"), join(nm, "astro"));
  symlinkSync(join(PKG_DIR, "test-stubs", "fake-js"), join(nm, "fake-js"));
  symlinkSync(
    join(PKG_DIR, "test-stubs", "@astrojs", "fake-integration"),
    join(nm, "@astrojs", "fake-integration"),
  );
}

function runBuild(ilhaFirst: boolean, include: boolean): string {
  writeFileSync(join(fixtureDir, "astro.config.mjs"), astroConfig(ilhaFirst, include));
  rmSync(join(fixtureDir, "dist"), { recursive: true, force: true });
  try {
    execFileSync("node", [ASTRO_BIN, "build"], {
      cwd: fixtureDir,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
    });
  } catch (error: any) {
    error.message += `\n--- stdout ---\n${(error.stdout ?? "").toString()}--- stderr ---\n${(error.stderr ?? "").toString()}`;
    throw error;
  }
  return readFileSync(join(fixtureDir, "dist", "index.html"), "utf8");
}

function unescape(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

interface IslandInfo {
  solidRenderId: string | undefined;
  content: string;
}

function islands(rawHtml: string): IslandInfo[] {
  const out: IslandInfo[] = [];
  const text = unescape(rawHtml);
  const re = /<astro-island\b([^>]*)>([\s\S]*?)<\/astro-island>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const attrs = m[1];
    const solidRenderId = /data-solid-render-id="([^"]+)"/.exec(attrs)?.[1];
    out.push({ solidRenderId, content: m[2] });
  }
  return out;
}

beforeAll(async () => {
  // Building `ilha` + `@ilha/astro` under a fully-parallel CI test load can
  // take much longer than Bun's default 5s hook budget; without a larger
  // timeout Bun kills the dangling build process and freshDist fails with a
  // bare "Command failed" instead of a build error.
  freshDist();
  setupFixture();
}, 180_000);

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

describe("@ilha/astro + fake permissive renderer real build", () => {
  // The reported issue: when another JSX renderer with a permissive check()
  // (Solid) is registered BEFORE ilha in astro.config, Solid claims ilha
  // components and renders their markup as escaped raw HTML. The renderer tag
  // must make ilha islands route to ilha's renderer regardless of order. Test
  // both orderings with `include` set (the config the reporter used; without
  // `include`, Astro documents mixing JSX renderers as "unexpected behavior").
  const scenarios: Array<[string, boolean]> = [
    ["solid first", false],
    ["ilha first", true],
  ];

  for (const [label, ilhaFirst] of scenarios) {
    it(`routes ilha islands to the ilha renderer when ${label} in astro.config`, () => {
      const html = runBuild(ilhaFirst, true);
      const list = islands(html);
      expect(list.length).toBe(3);

      // Solid SSR emits `data-hk`; ilha islands emit `data-ilha`. If Solid had
      // claimed an ilha island it would carry `data-hk` + a Solid render id and
      // lose its `data-ilha` markup — the exact regression this test locks in.
      const ilhaIslands = list.filter((i) => i.content.includes("data-ilha="));
      const solidIslands = list.filter((i) => i.content.includes("data-hk"));

      expect(ilhaIslands.length).toBe(2);
      expect(solidIslands.length).toBe(1);

      for (const island of ilhaIslands) {
        expect(island.solidRenderId).toBeUndefined();
        expect(island.content).not.toContain("data-hk");
      }
      expect(ilhaIslands.some((i) => i.content.includes("Increment with Ilha-JSX"))).toBe(true);
      expect(ilhaIslands.some((i) => i.content.includes("Increment with Ilha-HTML"))).toBe(true);

      // The Solid island is untouched: Solid SSR markers + a Solid render id.
      expect(solidIslands[0].solidRenderId).toBeDefined();
      expect(solidIslands[0].content).toContain("Increment with Solid");
    });
  }
});
