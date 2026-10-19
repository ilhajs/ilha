import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { normalizePath } from "vite";
import type { Plugin, ResolvedConfig } from "vite";
import {
  resolveEffectiveLayoutChain,
  scanPages,
  generateComponentManifest,
} from "void/pages";
import type { PageScanResult } from "void/pages";
import {
  computePagesNeedingClientJS,
  editIslandSource,
  findIslandImports,
  findStaticCssImports,
  hasIslandPages,
  ISLANDS_CLIENT_ENTRY_ID,
  ISLANDS_RENDERER_ID,
  resolveSpecifier,
  rewriteCssImportForVirtualModule,
  watchPagesForRescan,
} from "void/pages-islands-plugin";
import type { IslandEntry, IslandSourceEdit } from "void/pages-islands-plugin";

const COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];
/** Island wrapper modules. Plain JS: wrappers call `createIsland`, no JSX. */
const WRAPPER_PREFIX = "/@ilha-void-island/";
const ISLAND_PAGE_RE = /\.island\.(?:tsx|jsx)$/u;
const PAGE_COMPONENT_RE = /\.(?:tsx|jsx)$/u;
const EXTENSION_RE = /\.[^.]+$/u;
const VIRTUAL_ID_RE =
  /^(?:virtual:void-islands-(?:renderer|client)$|\/@ilha-void-island\/)/u;
const RESOLVED_ID_RE =
  // oxlint-disable-next-line no-control-regex -- Vite virtual module null-byte prefix
  /^(?:\0virtual:void-islands-(?:renderer|client)$|\/@ilha-void-island\/)/u;
const USE_FORM_IMPORT_RE = /import\s+\{[^}]*\buseForm\b/u;

interface WrapperMeta {
  src: string;
  islandId: string;
  hydrate: string;
}

interface RegisteredIsland {
  absPath: string | null;
  islandId: string;
}

interface MarkdownPluginApi {
  getClientScripts?: () => Map<string, unknown>;
}

export const generateWrapperModule = ({
  hydrate,
  islandId,
  src,
}: WrapperMeta): string => `import Component from ${JSON.stringify(src)};
import { createIsland } from "@ilha/void/server";

export default createIsland(Component, { hydrate: ${JSON.stringify(hydrate)}, id: ${JSON.stringify(islandId)} });
`;

export interface IslandRendererOptions {
  markdownScriptIds: ReadonlySet<string>;
  pagesNeedingClientJS: ReadonlySet<string>;
}

export const generateIslandRendererModule = (
  scan: PageScanResult,
  pagesDir: string,
  { markdownScriptIds, pagesNeedingClientJS }: IslandRendererOptions
): string => `import { createIslandPageRenderer } from "@ilha/void/server";

${generateComponentManifest(scan, pagesDir)}

export const renderIslandPage = createIslandPageRenderer({
  components,
  layoutTree,
  markdownScriptIds: new Set(${JSON.stringify([...markdownScriptIds])}),
  pagesNeedingClientJS: new Set(${JSON.stringify([...pagesNeedingClientJS])}),
});
`;

export interface IslandClientOptions {
  /** Static CSS imports from island pages and layouts, as import lines. */
  cssImports: readonly string[];
}

export const generateIslandClientEntry = (
  manifest: ReadonlyMap<string, IslandEntry>,
  { cssImports }: IslandClientOptions
): string => {
  const islands = new Map<string, string>();
  for (const entry of manifest.values()) {
    islands.set(entry.islandId, entry.componentPath);
  }
  const loaders = [...islands]
    .map(
      ([id, file]) =>
        `  ${JSON.stringify(id)}: () => import(${JSON.stringify(file)}),`
    )
    .join("\n");
  return `import { mountIsland } from "@ilha/void/islands";
import { initIslands } from "void/pages-client";
${cssImports.join("\n")}

const islands = {
${loaders}
};

initIslands(islands, mountIsland);
`;
};

/**
 * Turn `with { island }` imports in `.island` pages into SSR wrappers and
 * serve Void's island renderer and client entry.
 */
export const islandsPlugin = (
  pagesDir: string,
  { root }: { root: string }
): Plugin => {
  let scan: PageScanResult | null = null;
  let isDev = false;
  let resolvedConfig: ResolvedConfig | null = null;
  const islandManifest = new Map<string, IslandEntry>();
  const cssSourceFiles = new Set<string>();
  const wrappers = new Map<string, WrapperMeta>();
  let wrapperCount = 0;

  const registerIsland = (
    specifier: string,
    importerDir: string,
    hydrate: string
  ): RegisteredIsland => {
    const absPath = resolveSpecifier(
      specifier,
      importerDir,
      COMPONENT_EXTENSIONS
    );
    if (!absPath) {
      return { absPath, islandId: specifier };
    }
    const islandId = normalizePath(path.relative(root, absPath)).replace(
      EXTENSION_RE,
      ""
    );
    islandManifest.set(islandId, {
      componentPath: absPath,
      hydrate,
      islandId,
    });
    return { absPath, islandId };
  };

  /** Read island imports and CSS sources ahead of time for the client build. */
  const prescan = (pages: PageScanResult): void => {
    const files = [
      ...pages.pages.map((page) => ({
        file: page.componentPath,
        island: page.island,
      })),
      ...[...pages.layouts, ...pages.namedLayouts].map((layout) => ({
        file: layout.filePath,
        island: layout.island,
      })),
    ];
    for (const { file, island } of files) {
      if (!island) {
        continue;
      }
      const filePath = path.resolve(pagesDir, file);
      const code = readFileSync(filePath, "utf-8");
      for (const found of findIslandImports(code, filePath)) {
        registerIsland(found.specifier, path.dirname(filePath), found.hydrate);
      }
    }
    for (const page of pages.pages) {
      if (!page.island) {
        continue;
      }
      if (PAGE_COMPONENT_RE.test(page.componentPath)) {
        cssSourceFiles.add(
          normalizePath(path.resolve(pagesDir, page.componentPath))
        );
      }
      for (const layout of resolveEffectiveLayoutChain(
        page,
        pages.layouts,
        pages.namedLayouts
      )) {
        cssSourceFiles.add(
          normalizePath(path.resolve(pagesDir, layout.filePath))
        );
      }
    }
  };

  const cssImports = (): string[] => {
    // In dev, Void's CSS collector serves first-paint CSS; importing it here
    // too would inject it twice.
    if (isDev) {
      return [];
    }
    const lines: string[] = [];
    for (const file of cssSourceFiles) {
      const code = readFileSync(file, "utf-8");
      for (const item of findStaticCssImports(code, file)) {
        lines.push(
          rewriteCssImportForVirtualModule(item.statement, item.specifier, file)
        );
      }
    }
    return lines;
  };

  return {
    async buildStart() {
      if (!existsSync(pagesDir)) {
        return;
      }
      scan = await scanPages(root, { pagesDir });
      // The client build can load the islands entry before any island page
      // transforms, so register islands eagerly.
      prescan(scan);
    },

    async config(_, env) {
      if (
        env.command === "serve" ||
        !existsSync(pagesDir) ||
        !(await hasIslandPages(root, pagesDir))
      ) {
        return;
      }
      return {
        build: {
          manifest: true,
          rollupOptions: {
            input: { "islands-client": ISLANDS_CLIENT_ENTRY_ID },
          },
        },
      };
    },

    configResolved(config) {
      resolvedConfig = config;
      isDev = config.command === "serve";
    },

    configureServer(server) {
      watchPagesForRescan(server, pagesDir, root, (next: PageScanResult) => {
        scan = next;
      });
    },

    enforce: "pre",

    load: {
      filter: { id: RESOLVED_ID_RE },
      handler(id) {
        if (id === `\0${ISLANDS_RENDERER_ID}`) {
          if (!scan) {
            return "export function renderIslandPage() { throw new Error('@ilha/void: no pages found.'); }";
          }
          // SAFETY: `void-md` exposes its client script registry on `api`.
          const markdown = resolvedConfig?.plugins.find(
            (plugin) => plugin.name === "void-md"
          ) as (Plugin & { api?: MarkdownPluginApi }) | undefined;
          return generateIslandRendererModule(scan, pagesDir, {
            markdownScriptIds: new Set(
              markdown?.api?.getClientScripts?.().keys()
            ),
            pagesNeedingClientJS: computePagesNeedingClientJS(
              scan,
              pagesDir,
              resolvedConfig
            ),
          });
        }
        if (id === `\0${ISLANDS_CLIENT_ENTRY_ID}`) {
          return scan
            ? generateIslandClientEntry(islandManifest, {
                cssImports: cssImports(),
              })
            : "";
        }
        const wrapper = wrappers.get(id);
        return wrapper ? generateWrapperModule(wrapper) : undefined;
      },
    },

    name: "@ilha/void:islands",

    resolveId: {
      filter: { id: VIRTUAL_ID_RE },
      handler(source) {
        if (source.startsWith(WRAPPER_PREFIX)) {
          return source;
        }
        return `\0${source}`;
      },
    },

    transform: {
      filter: { id: ISLAND_PAGE_RE },
      handler(code, id) {
        if (USE_FORM_IMPORT_RE.test(code)) {
          this.warn(
            `@ilha/void: useForm cannot be used in island page '${id}'. Use useIslandForm instead.`
          );
        }
        const edits: IslandSourceEdit[] = [];
        for (const found of findIslandImports(code, id)) {
          const { absPath, islandId } = registerIsland(
            found.specifier,
            path.dirname(id),
            found.hydrate
          );
          const wrapperId = `${WRAPPER_PREFIX}island_${String(wrapperCount)}.js`;
          wrapperCount += 1;
          wrappers.set(wrapperId, {
            hydrate: found.hydrate,
            islandId,
            src: absPath ?? found.specifier,
          });
          edits.push({
            end: found.end,
            start: found.start,
            text: `import ${found.importName} from ${JSON.stringify(wrapperId)}`,
          });
        }
        return edits.length > 0 ? editIslandSource(code, edits) : undefined;
      },
    },
  };
};
