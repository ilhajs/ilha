import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ConfigEnv, Plugin, UserConfig } from "vite";
import { scanPages } from "void/pages";
import type { PageScanResult } from "void/pages";
import { ISLANDS_CLIENT_ENTRY_ID } from "void/pages-islands-plugin";

import { voidIlha } from "./plugin";
import {
  generateIslandClientEntry,
  generateIslandRendererModule,
  generateWrapperModule,
  islandsPlugin,
} from "./plugin-islands";
import { generateClientEntry, generateRendererModule } from "./plugin-pages";

const WRAPPER_IMPORT = /"(?<id>\/@ilha-void-island\/[^"]+)"/u;

interface TransformHook {
  handler: (
    this: { warn: (message: string) => void },
    code: string,
    id: string
  ) => { code: string } | undefined;
}

interface LoadHook {
  handler: (id: string) => string | undefined;
}

const runTransform = (plugin: Plugin, code: string, id: string) => {
  // SAFETY: @ilha/void:islands declares object-form `transform` and `load` hooks.
  const { handler } = plugin.transform as TransformHook;
  return handler.call({ warn: () => {} }, code, id);
};

const runLoad = (plugin: Plugin, id: string) =>
  // SAFETY: see runTransform.
  (plugin.load as LoadHook).handler(id);

let root = "";
let pagesDir = "";
let scan: PageScanResult;

const write = (file: string, code: string): void => {
  const full = path.join(pagesDir, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, code);
};

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "ilha-void-"));
  pagesDir = path.join(root, "pages");
  write("layout.tsx", "export default ({ children }) => children;");
  write("index.tsx", "export default () => <p>home</p>;");
  write("users/[id].tsx", "export default () => <p>user</p>;");
  write("_Counter.tsx", "export default () => <button>0</button>;");
  write(
    "about.island.tsx",
    `import Counter from "./_Counter" with { island: "visible" };
export default () => <Counter start={1} />;`
  );
  scan = await scanPages(root, { pagesDir });
});

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("pages modules", () => {
  it("builds renderPage from the component manifest", () => {
    const code = generateRendererModule(scan, pagesDir);
    expect(code).toContain(
      'import { createPageRenderer } from "@ilha/void/server"'
    );
    expect(code).toContain("export const renderPage = createPageRenderer");
    expect(code).toContain(`${pagesDir}/users/[id].tsx`);
  });

  it("starts the Void Router with the configured options", () => {
    const code = generateClientEntry(scan, pagesDir, {
      prefetch: { cacheFor: "1m", hoverDelay: 120 },
      viewTransitions: true,
    });
    expect(code).toContain("export const router = await startPages({");
    expect(code).toContain('parseCacheFor("1m")');
    expect(code).toContain("prefetchHoverDelay: 120");
    expect(code).toContain("viewTransitions: true");
    expect(code).toContain("staticPageData: false");
  });
});

describe("islands modules", () => {
  it("wraps an island import with its id and strategy", () => {
    const code = generateWrapperModule({
      hydrate: "media:(max-width: 600px)",
      islandId: "pages/_Counter",
      src: "/app/pages/_Counter.tsx",
    });
    expect(code).toContain('import Component from "/app/pages/_Counter.tsx"');
    expect(code).toContain(
      'createIsland(Component, { hydrate: "media:(max-width: 600px)", id: "pages/_Counter" })'
    );
  });

  it("builds renderIslandPage with the pages that need JavaScript", () => {
    const code = generateIslandRendererModule(scan, pagesDir, {
      markdownScriptIds: new Set(["docs"]),
      pagesNeedingClientJS: new Set(["about"]),
    });
    expect(code).toContain(
      "export const renderIslandPage = createIslandPageRenderer"
    );
    expect(code).toContain('pagesNeedingClientJS: new Set(["about"])');
    expect(code).toContain('markdownScriptIds: new Set(["docs"])');
  });

  it("lazy-loads each island once in the client entry", () => {
    const entry = {
      componentPath: "/app/pages/_Counter.tsx",
      hydrate: "load",
      islandId: "pages/_Counter",
    };
    const code = generateIslandClientEntry(
      new Map([
        ["a", entry],
        ["b", { ...entry, hydrate: "idle" }],
      ]),
      { cssImports: ['import "/app/pages/app.css";'] }
    );
    expect(code).toContain('import { mountIsland } from "@ilha/void/islands"');
    expect(code).toContain('import "/app/pages/app.css";');
    expect(
      code.match(/import\("\/app\/pages\/_Counter\.tsx"\)/gu)
    ).toHaveLength(1);
  });

  it("rewrites island imports in .island pages", () => {
    const plugin = islandsPlugin(pagesDir, { root });
    const file = path.join(pagesDir, "about.island.tsx");
    const result = runTransform(
      plugin,
      `import Counter from "./_Counter" with { island: "visible" };
export default () => <Counter start={1} />;`,
      file
    );
    expect(result?.code).toMatch(
      /^import Counter from "\/@ilha-void-island\/island_\d+\.js"/u
    );

    const wrapperId = WRAPPER_IMPORT.exec(result?.code ?? "")?.groups?.id;
    const wrapper = wrapperId ? runLoad(plugin, wrapperId) : undefined;
    expect(wrapper).toContain('hydrate: "visible", id: "pages/_Counter"');
  });
});

const runIslandsConfig = (
  dir: string,
  rootDir: string,
  command: "build" | "serve"
): Promise<UserConfig | undefined> => {
  const plugin = islandsPlugin(dir, { root: rootDir });
  // SAFETY: the islands plugin declares `config` as an async function hook.
  const hook = plugin.config as (
    config: UserConfig,
    env: ConfigEnv
  ) => Promise<UserConfig | undefined>;
  return hook(
    {},
    { command, mode: command === "build" ? "production" : "development" }
  );
};

describe("islands client input", () => {
  it("adds the islands-client input when island pages exist", async () => {
    const result = await runIslandsConfig(pagesDir, root, "build");
    expect(result?.build?.rollupOptions?.input).toMatchObject({
      "islands-client": ISLANDS_CLIENT_ENTRY_ID,
    });
    expect(result?.build?.manifest).toBe(true);
  });

  it("omits the islands-client input when no island pages exist", async () => {
    const plainRoot = mkdtempSync(path.join(tmpdir(), "ilha-void-plain-"));
    try {
      const plainPagesDir = path.join(plainRoot, "pages");
      mkdirSync(plainPagesDir, { recursive: true });
      writeFileSync(
        path.join(plainPagesDir, "index.tsx"),
        "export default () => <p>home</p>;"
      );
      await expect(
        runIslandsConfig(plainPagesDir, plainRoot, "build")
      ).resolves.toBeUndefined();
    } finally {
      rmSync(plainRoot, { force: true, recursive: true });
    }
  });

  it("omits the islands-client input in dev", async () => {
    await expect(
      runIslandsConfig(pagesDir, root, "serve")
    ).resolves.toBeUndefined();
  });
});

const runConfig = (userConfig: UserConfig): UserConfig => {
  const [configPlugin] = voidIlha();
  // SAFETY: @ilha/void:config declares `config` as a plain function hook.
  const hook = (configPlugin as Plugin).config as (
    config: UserConfig,
    env: ConfigEnv
  ) => UserConfig;
  return hook(userConfig, { command: "serve", mode: "development" });
};

describe("voidIlha", () => {
  it("compiles JSX with ilha and keeps one ilha instance", () => {
    expect(runConfig({})).toMatchObject({
      oxc: { jsx: { importSource: "ilha", runtime: "automatic" } },
      resolve: { dedupe: expect.arrayContaining(["ilha", "@ilha/void"]) },
      ssr: { noExternal: expect.arrayContaining(["ilha", "@ilha/void"]) },
    });
  });

  it("leaves an explicit JSX config alone", () => {
    expect(
      runConfig({ oxc: { jsx: { importSource: "custom" } } })
    ).not.toHaveProperty("oxc");
  });

  it("keeps existing noExternal entries", () => {
    expect(runConfig({ ssr: { noExternal: "areia" } })).toMatchObject({
      ssr: { noExternal: expect.arrayContaining(["areia", "ilha"]) },
    });
    expect(runConfig({ ssr: { noExternal: true } })).toMatchObject({
      ssr: { noExternal: true },
    });
  });
});
