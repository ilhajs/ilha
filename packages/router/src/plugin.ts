import { existsSync, readFileSync, watch } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import { createUnplugin } from "unplugin";
import type { UnpluginFactory } from "unplugin";

import { generate, resolveGeneratedPaths } from "./codegen";
import type { PagesMode } from "./codegen";

export const VIRTUAL_PAGES_SERVER = "ilha:pages/server";
export const VIRTUAL_PAGES_CLIENT = "ilha:pages/client";
export const VIRTUAL_LOADERS = "ilha:loaders";
export const RESOLVED_PAGES_SERVER = "\0ilha:pages/server";
export const RESOLVED_PAGES_CLIENT = "\0ilha:pages/client";
export const RESOLVED_LOADERS = "\0ilha:loaders";
export const RESOLVED_VIRTUAL_IDS = [
  RESOLVED_PAGES_SERVER,
  RESOLVED_PAGES_CLIENT,
  RESOLVED_LOADERS,
] as const;

/** Query suffix used on page/layout imports in the client file. */
export const CLIENT_QUERY = "?client";

/** Read & parse a package.json, returning null on any error. */
function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Resolve a dependency's package.json by walking up node_modules from `root`. */
function readDepPackageJson(root: string, name: string): Record<string, unknown> | null {
  let dir = root;
  for (;;) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return readJson(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Find app dependencies that bridge ilha primitives — i.e. declare `ilha` as a
 * peer or dependency (e.g. a UI library like `areia`). They render islands with
 * `bind:*`/slot directives, so they MUST share the app's single ilha instance.
 * Returned here so the plugin can give them the same `dedupe` + `ssr.noExternal`
 * treatment as the framework singletons; otherwise SSR externalizes them with
 * their own ilha copy (a second renderCtxStack) and hydration silently breaks.
 * Keeps app vite configs minimal — no manual `noExternal: ["areia"]` needed.
 */
function detectIlhaConsumers(root: string): string[] {
  const appPkg = readJson(join(root, "package.json"));
  if (!appPkg) return [];
  const deps = {
    ...((appPkg.dependencies as Record<string, string>) ?? {}),
    ...((appPkg.devDependencies as Record<string, string>) ?? {}),
  };
  const found: string[] = [];
  for (const name of Object.keys(deps)) {
    if (name === "ilha") continue;
    const pkg = readDepPackageJson(root, name);
    if (!pkg) continue;
    const peers = (pkg.peerDependencies as Record<string, string>) ?? {};
    const directDeps = (pkg.dependencies as Record<string, string>) ?? {};
    if ("ilha" in peers || "ilha" in directDeps) found.push(name);
  }
  return found;
}

export interface IlhaPagesOptions {
  /** Directory containing page files. Default: `src/pages` */
  dir?: string;
  /** Output directory for generated files. Default: `.ilha` */
  outDir?: string;
  /**
   * File-system router navigation mode.
   * - `spa` — full client route graph with SSR/hydration and client navigation.
   * - `static` — island registry only; no route graph bundled into the client.
   * Default: `spa`.
   */
  mode?: PagesMode;
  /**
   * When `false`, internal `<a>` clicks are not intercepted — browser performs
   * full document navigations. Only meaningful in `spa` mode.
   * Default: `true`.
   */
  interceptLinks?: boolean;
  /**
   * Fail codegen on duplicate route patterns / registry name collisions
   * instead of warning. Recommended for CI/production builds. Default: `false`.
   */
  strict?: boolean;
}

export function resolvePluginPaths(root: string, options: IlhaPagesOptions) {
  const pagesDir = resolve(root, options.dir ?? "src/pages");
  const outDir = resolve(root, options.outDir ?? ".ilha");
  const { serverFile, clientFile, loadersFile } = resolveGeneratedPaths(outDir);
  return { pagesDir, outDir, serverFile, clientFile, loadersFile };
}

export interface PagesPluginState {
  pagesDir: string;
  outDir: string;
  serverFile: string;
  clientFile: string;
  loadersFile: string;
  setPaths(root: string): void;
  regen(): Promise<void>;
  shouldRegenOnChange(file: string): boolean;
  isUnderPagesDir(file: string): boolean;
}

export function createPagesPluginState(options: IlhaPagesOptions): PagesPluginState {
  let pagesDir!: string;
  let outDir!: string;
  let serverFile!: string;
  let clientFile!: string;
  let loadersFile!: string;

  const setPaths = (root: string) => {
    ({ pagesDir, outDir, serverFile, clientFile, loadersFile } = resolvePluginPaths(root, options));
  };

  const regen = async () => {
    try {
      await generate(pagesDir, outDir, {
        mode: options.mode,
        interceptLinks: options.interceptLinks,
        strict: options.strict,
      });
    } catch (e) {
      console.error("[ilha:pages] codegen failed:", e);
      if (options.strict) throw e;
    }
  };

  const isUnderPagesDir = (file: string) => file === pagesDir || file.startsWith(pagesDir + sep);

  const shouldRegenOnChange = (file: string) => {
    if (!isUnderPagesDir(file)) return false;
    const base = basename(file);
    return base.startsWith("+") || /\.(ts|tsx)$/.test(base);
  };

  return {
    get pagesDir() {
      return pagesDir;
    },
    get outDir() {
      return outDir;
    },
    get serverFile() {
      return serverFile;
    },
    get clientFile() {
      return clientFile;
    },
    get loadersFile() {
      return loadersFile;
    },
    setPaths,
    regen,
    shouldRegenOnChange,
    isUnderPagesDir,
  };
}

export async function regenFromPagesChange(
  state: PagesPluginState,
  file: string,
  shouldRegen: (file: string) => boolean,
) {
  if (!shouldRegen(file)) return;
  await state.regen();
}

export function resolvePagesId(state: PagesPluginState, id: string, importer?: string) {
  if (id === VIRTUAL_PAGES_SERVER) return RESOLVED_PAGES_SERVER;
  if (id === VIRTUAL_PAGES_CLIENT) return RESOLVED_PAGES_CLIENT;
  if (id === VIRTUAL_LOADERS) return RESOLVED_LOADERS;

  if (id.endsWith(CLIENT_QUERY)) {
    const bare = id.slice(0, -CLIENT_QUERY.length);
    const resolved = importer ? resolve(importer.replace(/\?.*$/, ""), "..", bare) : resolve(bare);
    // Only page-dir modules may be re-exported through the ?client shim —
    // without this check any absolute path could be pulled into the module
    // graph via a crafted `…?client` import.
    // Fail closed when pagesDir isn't configured yet — containment can't be
    // checked, so nothing may pass through the ?client shim.
    if (!state.pagesDir || !state.isUnderPagesDir(resolved)) return;
    return resolved + CLIENT_QUERY;
  }
}

export function loadPagesModule(state: PagesPluginState, id: string) {
  if (id === RESOLVED_PAGES_SERVER) {
    const spec = state.serverFile.replace(/\.tsx?$/, "");
    return `export { pageRouter, registry } from ${JSON.stringify(spec)};`;
  }
  if (id === RESOLVED_PAGES_CLIENT) {
    const spec = state.clientFile.replace(/\.tsx?$/, "");
    return `export { pageRouter, registry } from ${JSON.stringify(spec)};`;
  }
  if (id === RESOLVED_LOADERS) {
    const spec = state.loadersFile.replace(/\.tsx?$/, "");
    return `import ${JSON.stringify(spec)};`;
  }

  if (id.endsWith(CLIENT_QUERY)) {
    const bare = id.slice(0, -CLIENT_QUERY.length);
    return `export { default } from ${JSON.stringify(bare)};`;
  }
}

type InvalidateModules = () => void | Promise<void>;

export function createStructuralInvalidate(state: PagesPluginState, invalidate: InvalidateModules) {
  return async (file: string) => {
    if (!state.isUnderPagesDir(file)) return;
    await state.regen();
    await invalidate();
  };
}

export function setupRspackPagesWatcher(
  state: PagesPluginState,
  structuralInvalidate: (file: string) => void | Promise<void>,
) {
  let watcher: ReturnType<typeof watch> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const attach = () => {
    watcher = watch(state.pagesDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const file = join(state.pagesDir, filename);
      void structuralInvalidate(file);
    });
  };

  // fs.watch throws ENOENT when the pages dir doesn't exist yet — poll until
  // it appears, then attach, so watching recovers if the dir is created later.
  if (existsSync(state.pagesDir)) {
    attach();
  } else {
    poll = setInterval(() => {
      if (closed || !existsSync(state.pagesDir)) return;
      clearInterval(poll!);
      poll = null;
      attach();
      // The dir appeared after startup — regenerate for its current contents.
      void structuralInvalidate(join(state.pagesDir, "."));
    }, 1000);
    poll.unref?.();
  }

  return () => {
    closed = true;
    if (poll) clearInterval(poll);
    watcher?.close();
  };
}

const pagesFactory: UnpluginFactory<IlhaPagesOptions | undefined> = (options = {}) => {
  const state = createPagesPluginState(options);

  return {
    name: "ilha:pages",

    async buildStart() {
      if (!state.pagesDir) state.setPaths(process.cwd());
      this.addWatchFile?.(state.pagesDir);
      await state.regen();
    },

    async watchChange(file) {
      await regenFromPagesChange(state, file, (f) => state.shouldRegenOnChange(f));
    },

    resolveId(id, importer) {
      return resolvePagesId(state, id, importer);
    },

    load(id) {
      return loadPagesModule(state, id);
    },

    vite: {
      config(userConfig) {
        const root = userConfig.root ? resolve(userConfig.root) : process.cwd();
        const singletonPeers = [
          "ilha",
          "@ilha/store",
          "@ilha/router",
          "alien-signals",
          // Auto-detected app deps that bridge ilha (e.g. `areia`) — they must
          // share the single ilha instance, so the app never has to hand-write
          // `ssr.noExternal`/`resolve.dedupe` for its UI lib.
          ...detectIlhaConsumers(root),
        ];
        // For SSR, externalized deps are loaded via the runtime's own resolver,
        // so a dep that imports `ilha` as a peer (e.g. a UI lib) ends up with a
        // *separate* ilha instance from the Vite-processed app code. Two ilha
        // instances mean two render-context stacks, so `bind:*` directives in
        // those components render outside any context and silently drop their
        // `data-ilha-bind` sentinels — breaking hydration. Bundling the ilha
        // singletons into the SSR graph keeps a single instance. Apps that use
        // a UI lib bridging ilha (e.g. `areia`) must add it to `ssr.noExternal`
        // too, since it also imports the shared singletons.
        const existingNoExternal = userConfig.ssr?.noExternal;
        const noExternal =
          existingNoExternal === true
            ? true
            : [
                ...new Set([
                  ...(Array.isArray(existingNoExternal)
                    ? existingNoExternal
                    : existingNoExternal != null
                      ? [existingNoExternal]
                      : []),
                  ...singletonPeers,
                ]),
              ];
        return {
          resolve: {
            dedupe: [...new Set([...(userConfig.resolve?.dedupe ?? []), ...singletonPeers])],
          },
          ssr: { noExternal },
          optimizeDeps: {
            ...userConfig.optimizeDeps,
            include: [
              ...new Set([
                ...(userConfig.optimizeDeps?.include ?? []),
                "ilha",
                "ilha/jsx-runtime",
                // Dev JSX uses jsxDEV (`react-jsx` → jsx-dev-runtime). Without this
                // it is served raw and chains through relative imports to a SECOND
                // raw `ilha` instance — a separate renderCtxStack — so islands
                // render their JSX in one ilha and mount via another, and nothing
                // hydrates. Pre-bundling it pins it to the shared `ilha` chunk.
                "ilha/jsx-dev-runtime",
                "@ilha/store",
                "alien-signals",
              ]),
            ],
          },
        };
      },

      configResolved(config) {
        state.setPaths(config.root);
      },

      configureServer(server) {
        server.watcher.add(state.pagesDir);

        const structuralInvalidate = createStructuralInvalidate(state, async () => {
          for (const id of RESOLVED_VIRTUAL_IDS) {
            const mod = server.moduleGraph.getModuleById(id);
            if (mod) server.moduleGraph.invalidateModule(mod);
          }
          server.hot.send({ type: "full-reload" });
        });

        server.watcher.on("add", structuralInvalidate);
        server.watcher.on("addDir", structuralInvalidate);
        server.watcher.on("unlink", structuralInvalidate);

        server.watcher.on("change", async (file: string) => {
          if (state.shouldRegenOnChange(file)) await structuralInvalidate(file);
        });
      },
    },

    rspack(compiler) {
      state.setPaths(compiler.options.context ?? process.cwd());

      const structuralInvalidate = createStructuralInvalidate(state, () => {
        if (!compiler.watching) return;
        (compiler as unknown as { invalidate: () => void }).invalidate();
      });

      let closeWatcher: (() => void) | undefined;
      compiler.hooks.watchRun.tap("ilha:pages", () => {
        closeWatcher?.();
        closeWatcher = setupRspackPagesWatcher(state, structuralInvalidate);
      });
      compiler.hooks.shutdown.tap("ilha:pages", () => closeWatcher?.());
    },
  };
};

export const ilhaPages = /* #__PURE__ */ createUnplugin(pagesFactory);
