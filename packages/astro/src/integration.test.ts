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
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// packages/astro/src
const SRC_DIR = import.meta.dir;
// packages/astro
const PKG_DIR = path.join(SRC_DIR, "..");
// repo root
const ROOT = path.join(PKG_DIR, "..", "..");

const ASTRO_BIN = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("astro/package.json"))),
  "bin",
  "astro.mjs"
);

const JSX_COUNTER = `/** @jsxImportSource ilha */
import { atom } from "ilha";
export const Counter = ({ start = 0 }: { start?: number }) => {
  const count = atom(start);
  return (
    <div class="flex gap-2">
      {count}
      <button type="button" onclick={() => count.update((value: number) => value + 1)}>
        Increment with Ilha-JSX
      </button>
    </div>
  );
};
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
---
<html>
  <head><title>Fixture</title></head>
  <body>
    <SolidCounter client:load />
    <IlhaCounter start={4} client:load />
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

type ExecFailure = Error & {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
};

const rethrowWithOutput = (failure: ExecFailure): never => {
  failure.message += `\n--- stdout ---\n${(failure.stdout ?? "").toString()}--- stderr ---\n${(failure.stderr ?? "").toString()}`;
  throw failure;
};

const astroConfig = (ilhaFirst: boolean, include: boolean): string => {
  const opts = (mod: string) =>
    include
      ? `${mod}({ include: "**/${mod === "ilha" ? "ilha" : "solid"}/**" })`
      : `${mod}()`;
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
};

let fixtureDir = "";
let buildsDone = false;

const build = (cmd: string): void => {
  try {
    execSync(cmd, {
      cwd: ROOT,
      stdio: "pipe",
      // Slow under a fully-parallel CI load; a finite budget keeps a hung
      // build from blocking the suite forever and is well above any real run.
      timeout: 180_000,
    });
  } catch (error) {
    // SAFETY: execSync rejects with Error + stdout/stderr when stdio is "pipe".
    rethrowWithOutput(error as ExecFailure);
  }
};

const freshDist = (): void => {
  if (buildsDone) {
    return;
  }
  build("bun run --filter ilha build");
  build("bun run --filter @ilha/astro build");
  // Flag completion only after both builds succeeded so a failed first build
  // re-runs both on a retry rather than skipping the never-completed work.
  buildsDone = true;
};

const setupFixture = () => {
  fixtureDir = path.join(
    tmpdir(),
    `ilha-astro-fixture-${Math.random().toString(36).slice(2)}`
  );
  const src = path.join(fixtureDir, "src");
  mkdirSync(path.join(src, "components", "ilha"), { recursive: true });
  mkdirSync(path.join(src, "components", "solid"), { recursive: true });
  mkdirSync(path.join(src, "pages"), { recursive: true });
  writeFileSync(
    path.join(fixtureDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2)
  );
  writeFileSync(path.join(fixtureDir, "tsconfig.json"), TSCONFIG);
  writeFileSync(
    path.join(src, "components", "ilha", "Counter.tsx"),
    JSX_COUNTER
  );
  writeFileSync(
    path.join(src, "components", "solid", "Counter.tsx"),
    SOLID_COUNTER
  );
  writeFileSync(path.join(src, "pages", "index.astro"), PAGE);

  // Link the real workspace deps so Astro resolves a single copy of each.
  // Leaf symlinks (not a whole-scope dir) — Node's ESM loader reliably follows
  // a symlinked package, but not a symlinked `@astrojs` scope directory.
  const nm = path.join(fixtureDir, "node_modules");
  mkdirSync(path.join(nm, "@ilha"), { recursive: true });
  mkdirSync(path.join(nm, "@astrojs"), { recursive: true });
  symlinkSync(PKG_DIR, path.join(nm, "@ilha", "astro"));
  symlinkSync(path.join(PKG_DIR, "..", "ilha"), path.join(nm, "ilha"));
  symlinkSync(
    path.join(PKG_DIR, "node_modules", "astro"),
    path.join(nm, "astro")
  );
  symlinkSync(
    path.join(PKG_DIR, "test-stubs", "fake-js"),
    path.join(nm, "fake-js")
  );
  symlinkSync(
    path.join(PKG_DIR, "test-stubs", "@astrojs", "fake-integration"),
    path.join(nm, "@astrojs", "fake-integration")
  );
};

const runBuild = (ilhaFirst: boolean, include: boolean): string => {
  writeFileSync(
    path.join(fixtureDir, "astro.config.mjs"),
    astroConfig(ilhaFirst, include)
  );
  rmSync(path.join(fixtureDir, "dist"), { force: true, recursive: true });
  try {
    execFileSync("node", [ASTRO_BIN, "build"], {
      cwd: fixtureDir,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
    });
  } catch (error) {
    // SAFETY: execFileSync rejects with Error + stdout/stderr when stdio is pipe.
    rethrowWithOutput(error as ExecFailure);
  }
  return readFileSync(path.join(fixtureDir, "dist", "index.html"), "utf-8");
};

const unescape = (html: string): string =>
  html
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

interface IslandInfo {
  solidRenderId: string | undefined;
  content: string;
}

const islands = (rawHtml: string): IslandInfo[] => {
  const out: IslandInfo[] = [];
  const text = unescape(rawHtml);
  const re =
    /<astro-island\b(?<attrs>[^>]*)>(?<content>[\s\S]*?)<\/astro-island>/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const { attrs = "", content = "" } = m.groups ?? {};
    const solidRenderId = /data-solid-render-id="(?<id>[^"]+)"/u.exec(attrs)
      ?.groups?.id;
    out.push({ content, solidRenderId });
  }
  return out;
};

beforeAll(() => {
  // Building `ilha` + `@ilha/astro` under a fully-parallel CI test load can
  // take much longer than Bun's default 5s hook budget; without a larger
  // timeout Bun kills the dangling build process and freshDist fails with a
  // bare "Command failed" instead of a build error.
  freshDist();
  setupFixture();
}, 180_000);

afterAll(() => {
  if (fixtureDir) {
    rmSync(fixtureDir, { force: true, recursive: true });
  }
});

describe("@ilha/astro + fake permissive renderer real build", () => {
  // The reported issue: when another JSX renderer with a permissive check()
  // (Solid) is registered BEFORE ilha in astro.config, Solid claims ilha
  // components and renders their markup as escaped raw HTML. The renderer tag
  // must make ilha islands route to ilha's renderer regardless of order. Test
  // both orderings with `include` set (the config the reporter used; without
  // `include`, Astro documents mixing JSX renderers as "unexpected behavior").
  const scenarios: [string, boolean][] = [
    ["solid first", false],
    ["ilha first", true],
  ];

  for (const [label, ilhaFirst] of scenarios) {
    it(`routes ilha islands to the ilha renderer when ${label} in astro.config`, () => {
      const html = runBuild(ilhaFirst, true);
      const list = islands(html);
      expect(list.length).toBe(2);

      // Solid SSR emits `data-hk`; ilha islands emit `data-ilha`. If Solid had
      // claimed an ilha island it would carry `data-hk` + a Solid render id and
      // lose its `data-ilha` markup — the exact regression this test locks in.
      const ilhaIslands = list.filter((i) => i.content.includes("data-ilha"));
      const solidIslands = list.filter((i) => i.content.includes("data-hk"));

      expect(ilhaIslands.length).toBe(1);
      expect(solidIslands.length).toBe(1);

      for (const island of ilhaIslands) {
        expect(island.solidRenderId).toBeUndefined();
        expect(island.content).not.toContain("data-hk");
      }
      expect(
        ilhaIslands.some((i) => i.content.includes("Increment with Ilha-JSX"))
      ).toBe(true);

      // The Solid island is untouched: Solid SSR markers + a Solid render id.
      expect(solidIslands[0].solidRenderId).toBeDefined();
      expect(solidIslands[0].content).toContain("Increment with Solid");
    });
  }
});
