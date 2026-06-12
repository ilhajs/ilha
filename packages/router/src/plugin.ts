import { watch } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

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
      });
    } catch (e) {
      console.error("[ilha:pages] codegen failed:", e);
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

export function resolvePagesId(_state: PagesPluginState, id: string, importer?: string) {
  if (id === VIRTUAL_PAGES_SERVER) return RESOLVED_PAGES_SERVER;
  if (id === VIRTUAL_PAGES_CLIENT) return RESOLVED_PAGES_CLIENT;
  if (id === VIRTUAL_LOADERS) return RESOLVED_LOADERS;

  if (id.endsWith(CLIENT_QUERY)) {
    const bare = id.slice(0, -CLIENT_QUERY.length);
    const resolved = importer ? resolve(importer.replace(/\?.*$/, ""), "..", bare) : resolve(bare);
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
  const watcher = watch(state.pagesDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const file = join(state.pagesDir, filename);
    void structuralInvalidate(file);
  });
  return () => watcher.close();
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
