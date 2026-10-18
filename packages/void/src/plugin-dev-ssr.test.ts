import { describe, expect, it } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createServer, createServerModuleRunner } from "vite";
import type { ViteDevServer } from "vite";

import { voidIlha } from "./plugin";

const fixtureDir = path.join(
  import.meta.dir,
  "../test-fixtures/ssr-single-ilha"
);
const fixtureModulesDir = path.join(fixtureDir, "node_modules");
/** ilha entries that must never be split across copies in a server graph. */
const SINGLETON_ENTRIES = {
  "@ilha/void": true,
  "@ilha/void/server": true,
  ilha: true,
  "ilha/jsx-dev-runtime": true,
  "ilha/jsx-runtime": true,
} satisfies Record<string, true>;

/**
 * Stage a registry-style copy: real files under the fixture's node_modules,
 * so Vite's optimizer treats the package as optimizable (workspace symlinks
 * realpath outside node_modules and are never prebundled).
 */
const stagePackageCopy = (name: string, sourceDir: string): void => {
  const dist = path.join(sourceDir, "dist");
  if (!existsSync(dist)) {
    throw new Error(
      `ssr-single-ilha fixture needs a build first: missing ${dist}`
    );
  }
  const target = path.join(fixtureModulesDir, name);
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { force: true, recursive: true });
  mkdirSync(target, { recursive: true });
  cpSync(
    path.join(sourceDir, "package.json"),
    path.join(target, "package.json")
  );
  cpSync(dist, path.join(target, "dist"), { recursive: true });
};

/** Link a runtime-only dependency through an anchor package that sees it. */
const stagePackageLink = (name: string, anchor: string): void => {
  const packageJson = createRequire(anchor).resolve(`${name}/package.json`);
  const target = path.join(fixtureModulesDir, name);
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { force: true, recursive: true });
  symlinkSync(path.dirname(realpathSync(packageJson)), target);
};

interface FixtureModule {
  renderFixture: () => Promise<string>;
}

/** The optimizer reports a mid-flight round as a reload, like a browser. */
const outdatedNeedsReload = (error: unknown): error is Error =>
  error instanceof Error && error.message.includes("pre-bundle");
/**
 * The happy-dom preload blankets the globals with browser ones; its
 * `setTimeout` has no `unref`, which Vite's optimizer calls. Unregistering
 * restores bun's timers for this test (files run sequentially) and the
 * finally re-registers for the DOM tests in the other files.
 */
const withoutHappyDom = async <T>(run: () => Promise<T>): Promise<T> => {
  await GlobalRegistrator.unregister();
  try {
    return await run();
  } finally {
    GlobalRegistrator.register();
  }
};

describe("dev SSR keeps a single ilha copy", () => {
  it("renders through a worker-like environment without prebundling ilha", async () => {
    await withoutHappyDom(async () => {
      const ilhaDir = path.join(import.meta.dir, "../../ilha");
      const voidDir = path.join(import.meta.dir, "..");
      stagePackageCopy("ilha", ilhaDir);
      stagePackageCopy("@ilha/void", voidDir);
      const voidPackageJson = createRequire(import.meta.url).resolve(
        "void/package.json"
      );
      stagePackageLink("void", import.meta.url);
      stagePackageLink("@void/edge", voidPackageJson);
      stagePackageLink("effect", path.join(ilhaDir, "package.json"));

      let server: ViteDevServer | undefined;
      try {
        server = await createServer({
          environments: {
            // Mirrors void's worker environment: nothing externalizes, so
            // every bare import goes through the transform pipeline and the
            // optimizer may discover it. `void` itself stays excluded, as
            // void's own plugin excludes it in real apps.
            worker: {
              consumer: "server",
              optimizeDeps: {
                exclude: ["void", "@void/edge"],
                noDiscovery: false,
              },
              resolve: { external: [], noExternal: true },
            },
          },
          logLevel: "silent",
          plugins: [voidIlha()],
          root: fixtureDir,
          server: { middlewareMode: true },
        });
        const { worker } = server.environments;
        const runner = createServerModuleRunner(worker);

        /** Retry an SSR load across optimizer "reload" invalidations. */
        const withReloadRetry = async <T>(
          load: () => Promise<T>
        ): Promise<T> => {
          let last: unknown;
          for (let attempt = 0; attempt <= 20; attempt += 1) {
            try {
              // oxlint-disable-next-line no-await-in-loop -- attempts run sequentially; each depends on the last outcome.
              return await load();
            } catch (error) {
              last = error;
              if (!outdatedNeedsReload(error)) {
                throw error;
              }
              // Real waits: the dev server and esbuild optimizer run on the
              // live event loop; fake timers would freeze the work polled here.
              // oxlint-disable-next-line no-await-in-loop -- backoff between sequential attempts.
              await Bun.sleep(500);
            }
          }
          throw last;
        };

        /** Wait until the worker optimizer stops committing new rounds. */
        const settleWorkerOptimizer = async (): Promise<void> => {
          let stable = 0;
          let previous = "";
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const metadata = worker.depsOptimizer?.metadata;
            const current =
              metadata === undefined
                ? "none"
                : `${metadata.hash}:${Object.keys(metadata.optimized).length}`;
            stable = current === previous ? stable + 1 : 0;
            previous = current;
            if (stable >= 4) {
              return;
            }
            // oxlint-disable-next-line no-await-in-loop -- polls a live condition until stable.
            await Bun.sleep(250);
          }
          throw new Error("worker optimizer never settled");
        };
        const optimizedSingletons = (): string[] =>
          Object.keys(worker.depsOptimizer?.metadata?.optimized ?? {}).filter(
            (id) => Object.hasOwn(SINGLETON_ENTRIES, id)
          );
        // Prime the renderer chain first, as void's routes load before page
        // components. Without the plugin fix this round prebundles
        // `@ilha/void/server` with its own inlined ilha copy.
        await withReloadRetry(() => runner.import("/renderer-only.ts"));
        await settleWorkerOptimizer();

        // SAFETY: the worker runner returns the entry's ESM namespace, whose
        // only export is the render function typed below.
        const entry = (await withReloadRetry(() =>
          runner.import("/entry-server.ts")
        )) as FixtureModule;
        const assertRenders = async (): Promise<void> => {
          const html = await withReloadRetry(() => entry.renderFixture());
          expect(html).toContain("Fixture");
          expect(html).toContain('class="home"');
          expect(html).toContain(">3<");
        };
        await assertRenders();
        expect(optimizedSingletons()).toEqual([]);
        await assertRenders();
      } finally {
        await server?.close();
        rmSync(fixtureModulesDir, { force: true, recursive: true });
      }
    });
  }, 120_000);
});
