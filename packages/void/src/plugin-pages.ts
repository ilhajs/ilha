import { existsSync, readdirSync } from "node:fs";

import { normalizePath } from "vite";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import {
  generateComponentManifest,
  resolveStaticPageDataBuildOptions,
  scanPages,
} from "void/pages";
import type { PageScanResult, StaticPageDataBuildOptions } from "void/pages";

const RENDERER_ID = "virtual:void-pages-renderer";
const CLIENT_ENTRY_ID = "virtual:void-pages-client";
const VIRTUAL_ID_RE = /^virtual:void-pages-(?:renderer|client)$/u;
// oxlint-disable-next-line no-control-regex -- Vite virtual module null-byte prefix
const RESOLVED_ID_RE = /^\0virtual:void-pages-(?:renderer|client)$/u;
const PAGE_COMPONENT_RE = /\.(?:tsx|jsx)$/u;
const DEFAULT_HOVER_DELAY = 75;
const DEFAULT_CACHE_FOR = "30s";

export interface PrefetchConfig {
  /** Milliseconds a pointer rests on a link before hover prefetch. Default: 75. */
  hoverDelay?: number;
  /** How long prefetched page data stays fresh. Default: `"30s"`. */
  cacheFor?: number | string | [string, string];
}

export interface PagesPluginOptions {
  root: string;
  viewTransitions?: boolean;
  prefetch?: PrefetchConfig;
}

/** True when `dir` holds a regular page, so the pages client must be built. */
const hasRegularPages = (dir: string): boolean => {
  try {
    for (const entry of readdirSync(dir, {
      recursive: true,
      withFileTypes: true,
    })) {
      const { name } = entry;
      if (
        entry.isFile() &&
        !name.startsWith("_") &&
        !name.startsWith("layout.") &&
        PAGE_COMPONENT_RE.test(name) &&
        !name.includes(".island.")
      ) {
        return true;
      }
    }
  } catch {
    // An unreadable pages dir has no regular pages to build.
  }
  return false;
};

export const generateRendererModule = (
  scan: PageScanResult,
  pagesDir: string
): string => `import { createPageRenderer } from "@ilha/void/server";

${generateComponentManifest(scan, pagesDir)}

export const renderPage = createPageRenderer({ components, layoutTree });
`;

export interface ClientEntryOptions {
  viewTransitions?: boolean;
  prefetch?: PrefetchConfig;
  staticPageData?: StaticPageDataBuildOptions;
}

export const generateClientEntry = (
  scan: PageScanResult,
  pagesDir: string,
  { prefetch, staticPageData, viewTransitions }: ClientEntryOptions
): string => `import { startPages } from "@ilha/void/client";
import { parseCacheFor } from "void/pages-prefetch";

${generateComponentManifest(scan, pagesDir)}

export const router = await startPages({
  components,
  layoutTree,
  matchRoute,
  prefetchDefaultCacheFor: parseCacheFor(${JSON.stringify(prefetch?.cacheFor ?? DEFAULT_CACHE_FOR)}),
  prefetchHoverDelay: ${String(prefetch?.hoverDelay ?? DEFAULT_HOVER_DELAY)},
  routeMeta,
  staticPageData: ${String(staticPageData?.enabled === true)},
  staticPageDataFastPath: ${String(staticPageData?.fastPath === true)},
  viewTransitions: ${String(viewTransitions === true)},
});
`;

const invalidatePageModules = (server: ViteDevServer): void => {
  for (const environment of Object.values(server.environments)) {
    for (const id of [`\0${RENDERER_ID}`, `\0${CLIENT_ENTRY_ID}`]) {
      const mod = environment.moduleGraph.getModuleById(id);
      if (mod) {
        environment.moduleGraph.invalidateModule(mod);
      }
    }
  }
};

/** Serve Void's pages renderer and client entry for Ilha components. */
export const pagesPlugin = (
  pagesDir: string,
  options: PagesPluginOptions
): Plugin => {
  let scan: PageScanResult | null = null;
  let pendingScan: Promise<void> | null = null;
  let isDev = false;
  let viteConfig: ResolvedConfig | undefined;
  const normalizedPagesDir = normalizePath(pagesDir);

  const scanNow = async (): Promise<void> => {
    try {
      scan = existsSync(pagesDir)
        ? await scanPages(options.root, { pagesDir })
        : null;
    } finally {
      pendingScan = null;
    }
  };
  /** Rescan the pages dir, sharing one scan between concurrent callers. */
  const rescan = (): Promise<void> => {
    pendingScan ??= scanNow();
    return pendingScan;
  };

  return {
    async buildStart() {
      await rescan();
    },

    config(_, env) {
      if (!existsSync(pagesDir)) {
        return;
      }
      if (env.command === "serve") {
        isDev = true;
        return;
      }
      // An app made only of island pages ships no pages client.
      if (!hasRegularPages(pagesDir)) {
        return;
      }
      return {
        build: {
          manifest: true,
          rollupOptions: { input: { "pages-client": CLIENT_ENTRY_ID } },
        },
      };
    },

    configResolved(config) {
      viteConfig = config;
    },

    configureServer(server) {
      const onChange = async (
        file: string,
        event: "add" | "change" | "unlink"
      ): Promise<void> => {
        const normalized = normalizePath(file);
        if (
          normalized !== normalizedPagesDir &&
          !normalized.startsWith(`${normalizedPagesDir}/`)
        ) {
          return;
        }
        // Edits inside a component don't change the route table.
        if (event === "change" && !normalized.endsWith(".md")) {
          return;
        }
        await rescan();
        invalidatePageModules(server);
      };
      server.watcher.on("add", (file) => onChange(file, "add"));
      server.watcher.on("change", (file) => onChange(file, "change"));
      server.watcher.on("unlink", (file) => onChange(file, "unlink"));
    },

    load: {
      filter: { id: RESOLVED_ID_RE },
      async handler(id) {
        if (isDev && pendingScan) {
          await pendingScan;
        }
        if (!scan && existsSync(pagesDir)) {
          await rescan();
        }
        if (id === `\0${RENDERER_ID}`) {
          return scan
            ? generateRendererModule(scan, pagesDir)
            : "export function renderPage() { throw new Error('@ilha/void: no pages found.'); }";
        }
        if (!scan) {
          return "";
        }
        return generateClientEntry(scan, pagesDir, {
          prefetch: options.prefetch,
          staticPageData: resolveStaticPageDataBuildOptions(options.root, {
            publicDir: viteConfig?.publicDir,
          }),
          viewTransitions: options.viewTransitions,
        });
      },
    },

    name: "@ilha/void:pages",

    resolveId: {
      filter: { id: VIRTUAL_ID_RE },
      handler: (id) => `\0${id}`,
    },
  };
};
