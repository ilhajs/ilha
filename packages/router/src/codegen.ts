import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative, dirname, basename, extname } from "node:path";

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

// ─────────────────────────────────────────────
// Codegen — types
// ─────────────────────────────────────────────

interface PageEntry {
  file: string;
  pattern: string;
  name: string;
  layouts: string[];
  errors: string[];
  /** True if the page module declares `export const load` / `export … function load`. */
  hasLoader: boolean;
  /** Subset of `layouts` whose modules declare a `load` export. */
  loaderLayouts: string[];
  /** True if the page module declares a `clientLoad` export (browser-executed loader). */
  hasClientLoader: boolean;
  /** Subset of `layouts` whose modules declare a `clientLoad` export. */
  clientLoaderLayouts: string[];
}

// ─────────────────────────────────────────────
// Codegen — excluded filename patterns
// ─────────────────────────────────────────────

/** Files that should never be treated as pages even if they match the ts/tsx extension. */
const EXCLUDED_RE = /\.(test|spec|d)\.(ts|tsx)$/;

// ─────────────────────────────────────────────
// Codegen — loader export detection
// ─────────────────────────────────────────────

/**
 * Match a top-of-statement `export const load`, `export let load`,
 * `export function load`, or `export async function load`. Intentionally
 * conservative: `export { load } from "./x"` re-exports are NOT detected
 * in v1. Declare `load` directly in the file to be picked up.
 */
const LOADER_EXPORT_RE = /^\s*export\s+(?:const|let|var|async\s+function|function)\s+load\b/m;

/** Same shape for `clientLoad` — a loader executed in the browser on client navigations. */
const CLIENT_LOADER_EXPORT_RE =
  /^\s*export\s+(?:const|let|var|async\s+function|function)\s+clientLoad\b/m;

interface LoaderExports {
  load: boolean;
  clientLoad: boolean;
}

async function detectLoaderExports(file: string): Promise<LoaderExports> {
  try {
    const src = await readFile(file, "utf8");
    // Strip single-line comments at the start of lines to avoid matching
    // commented-out loaders. Block comments are rare enough to skip.
    const stripped = src.replace(/^\s*\/\/.*$/gm, "");
    return {
      load: LOADER_EXPORT_RE.test(stripped),
      clientLoad: CLIENT_LOADER_EXPORT_RE.test(stripped),
    };
  } catch {
    return { load: false, clientLoad: false };
  }
}

// ─────────────────────────────────────────────
// Codegen — filename → rou3 pattern
// ─────────────────────────────────────────────

function fileToSegment(name: string): string {
  if (name.startsWith("[...") && name.endsWith("]")) return `**:${name.slice(4, -1)}`;
  if (name.startsWith("[") && name.endsWith("]")) return `:${name.slice(1, -1)}`;
  return name;
}

/** Route-group directories like "(auth)" are transparent to the URL. */
function dirToSegment(name: string): string {
  if (name.startsWith("(") && name.endsWith(")")) return "";
  return fileToSegment(name);
}

function fileToPattern(pagesDir: string, file: string): string {
  const rel = toPosix(relative(pagesDir, file));
  const noExt = rel.slice(0, -extname(rel).length);
  const parts = noExt.split("/");

  const segments = [...parts.slice(0, -1).map(dirToSegment), fileToSegment(parts.at(-1)!)];

  if (segments.at(-1) === "index") segments.pop();
  return "/" + segments.filter(Boolean).join("/") || "/";
}

// ─────────────────────────────────────────────
// Codegen — pattern → registry name
// ─────────────────────────────────────────────

function patternToName(pattern: string): string {
  if (pattern === "/") return "index";
  return (
    pattern
      .replace(/^\//, "")
      .replace(/\*\*:[^/]*/g, (m) => (m.length > 3 ? m.slice(3) : "wildcard"))
      .replace(/:/g, "")
      .replace(/\*\*/g, "wildcard")
      .replace(/\//g, "-")
      .replace(/[^a-zA-Z0-9-]/g, "") || "page"
  );
}

// ─────────────────────────────────────────────
// Codegen — specificity score for route sorting
// ─────────────────────────────────────────────

function specificityScore(pattern: string): number {
  if (pattern === "/") return 3;
  if (pattern.includes("**")) return 0;
  if (pattern.includes(":")) return 1;
  return 2;
}

/** Deterministic sort: by specificity desc, then by segment count desc, then alphabetical. */
function sortEntries(entries: PageEntry[]): PageEntry[] {
  return [...entries].sort((a, b) => {
    const specDiff = specificityScore(b.pattern) - specificityScore(a.pattern);
    if (specDiff !== 0) return specDiff;
    const segDiff = b.pattern.split("/").length - a.pattern.split("/").length;
    if (segDiff !== 0) return segDiff;
    return a.pattern.localeCompare(b.pattern);
  });
}

// ─────────────────────────────────────────────
// Codegen — layout / error chain resolution
// ─────────────────────────────────────────────

function chainForFile(
  pagesDir: string,
  file: string,
  all: Set<string>,
  sentinel: string,
): string[] {
  const relDir = toPosix(relative(pagesDir, dirname(file)));
  const parts = relDir === "" ? [] : relDir.split("/");
  const dirs = [pagesDir, ...parts.map((_, i) => join(pagesDir, ...parts.slice(0, i + 1)))];
  const candidatesFor = (dir: string) => {
    const tsx = `${join(dir, sentinel)}.tsx`;
    if (all.has(tsx)) return [tsx];
    const ts = `${join(dir, sentinel)}.ts`;
    if (all.has(ts)) return [ts];
    return [];
  };
  return dirs.flatMap(candidatesFor);
}

// ─────────────────────────────────────────────
// Codegen — file system scan
// ─────────────────────────────────────────────

const MAX_SCAN_DEPTH = 20;

async function collectFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_SCAN_DEPTH) {
    console.warn(`[ilha:pages] Max scan depth (${MAX_SCAN_DEPTH}) reached at ${dir} — skipping`);
    return [];
  }

  const results: string[] = [];
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await collectFiles(full, depth + 1)));
      } else if (
        entry.isFile() &&
        /\.(ts|tsx)$/.test(entry.name) &&
        !EXCLUDED_RE.test(entry.name)
      ) {
        results.push(full);
      }
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return results;
}

async function scanPages(pagesDir: string): Promise<PageEntry[]> {
  const all = await collectFiles(pagesDir);
  const allSet = new Set(all);
  const pages = all.filter((f) => !basename(f).startsWith("+"));

  const layoutLoaderCache = new Map<string, Promise<LoaderExports>>();
  const getLayoutExports = (file: string): Promise<LoaderExports> => {
    let cached = layoutLoaderCache.get(file);
    if (!cached) {
      cached = detectLoaderExports(file);
      layoutLoaderCache.set(file, cached);
    }
    return cached;
  };

  return Promise.all(
    pages.map(async (file) => {
      const pattern = fileToPattern(pagesDir, file);
      const layouts = chainForFile(pagesDir, file, allSet, "+layout");
      const errors = chainForFile(pagesDir, file, allSet, "+error");
      const [pageExports, ...layoutExports] = await Promise.all([
        detectLoaderExports(file),
        ...layouts.map(getLayoutExports),
      ]);
      const loaderLayouts = layouts.filter((_, i) => layoutExports[i]!.load);
      const clientLoaderLayouts = layouts.filter((_, i) => layoutExports[i]!.clientLoad);
      return {
        file,
        pattern,
        name: patternToName(pattern),
        layouts,
        errors,
        hasLoader: pageExports.load,
        loaderLayouts,
        hasClientLoader: pageExports.clientLoad,
        clientLoaderLayouts,
      };
    }),
  );
}

// ─────────────────────────────────────────────
// Codegen — validation
// ─────────────────────────────────────────────

function validateEntries(entries: PageEntry[], pagesDir: string, strict: boolean): void {
  if (entries.length === 0) {
    console.warn(`[ilha:pages] No pages found in ${pagesDir}`);
    return;
  }

  const seenPatterns = new Map<string, string>();
  const seenNames = new Map<string, string>();
  const problems: string[] = [];

  for (const entry of entries) {
    const existingPattern = seenPatterns.get(entry.pattern);
    if (existingPattern) {
      problems.push(
        `Duplicate route pattern "${entry.pattern}"\n` +
          `  first:  ${existingPattern}\n` +
          `  second: ${entry.file}\n` +
          `  The first match wins — the second page will never be reached.`,
      );
    } else {
      seenPatterns.set(entry.pattern, entry.file);
    }

    const existingName = seenNames.get(entry.name);
    if (existingName) {
      problems.push(
        `Registry name collision: "${entry.name}" is used by both\n` +
          `  ${existingName}\n` +
          `  ${entry.file}\n` +
          `  Hydration may not work correctly for one of these routes.`,
      );
    } else {
      seenNames.set(entry.name, entry.file);
    }
  }

  if (problems.length === 0) return;
  if (strict) {
    throw new Error(`[ilha:pages] Route validation failed:\n\n${problems.join("\n\n")}`);
  }
  for (const p of problems) console.warn(`[ilha:pages] ${p}`);
}

// ─────────────────────────────────────────────
// Codegen — emit generated files
// ─────────────────────────────────────────────

export type PagesMode = "spa" | "static";

export interface GenerateOptions {
  /** Client navigation mode. Default: `spa`. */
  mode?: PagesMode;
  /**
   * Whether to install client-side link interception. Only meaningful in `spa`
   * mode. Default: `true`.
   */
  interceptLinks?: boolean;
  /**
   * Fail codegen (instead of warning) on duplicate route patterns or registry
   * name collisions. Recommended for production builds. Default: `false`.
   */
  strict?: boolean;
}

/** Paths for all generated files derived from the base output directory. */
export interface GeneratedPaths {
  /** Server module: raw imports, full route graph. `ilha:pages/server` */
  serverFile: string;
  /** Client module: ?client imports, browser-optimised. `ilha:pages/client` */
  clientFile: string;
  /** Server-only loaders side-effect module. `ilha:loaders` */
  loadersFile: string;
}

export function resolveGeneratedPaths(outDir: string): GeneratedPaths {
  return {
    serverFile: join(outDir, "pages.server.ts"),
    clientFile: join(outDir, "pages.client.ts"),
    loadersFile: join(outDir, "loaders.ts"),
  };
}

export async function generate(
  pagesDir: string,
  outDir: string,
  options: GenerateOptions = {},
): Promise<void> {
  const mode = options.mode ?? "spa";
  const interceptLinks = options.interceptLinks;
  const isStatic = mode === "static";
  const raw = await scanPages(pagesDir);
  const entries = sortEntries(raw);

  validateEntries(entries, pagesDir, options.strict === true);

  await mkdir(outDir, { recursive: true });

  const { serverFile, clientFile, loadersFile } = resolveGeneratedPaths(outDir);

  // ─── Server file: raw imports, full route graph ──────────────────────────
  const serverCode = buildServerFile(entries, serverFile);
  const serverChanged = await writeIfChanged(serverFile, serverCode);

  // ─── Client file: ?client imports, browser bundle ───────────────────────
  const clientCode = buildClientFile(entries, clientFile, {
    isStatic,
    interceptLinks,
  });
  const clientChanged = await writeIfChanged(clientFile, clientCode);

  // ─── Loaders file (server-only, skipped in static mode) ─────────────────
  if (!isStatic) {
    const loadersCode = buildLoadersFile(entries, loadersFile, serverFile);
    await writeIfChanged(loadersFile, loadersCode);
  }

  if (serverChanged || clientChanged) {
    await generateTypes(outDir);
  }
}

// ─────────────────────────────────────────────
// Codegen — server file
// ─────────────────────────────────────────────

function buildServerFile(entries: PageEntry[], serverFile: string): string {
  const rel = (abs: string) => {
    const r = toPosix(relative(dirname(serverFile), abs));
    return r.startsWith(".") ? r : `./${r}`;
  };

  const imports: string[] = [
    `import { router, wrapLayout, wrapError } from "@ilha/router";`,
    `import type { Island } from "ilha";`,
  ];
  const wrappedIslandLines: string[] = [];
  const registryLines: string[] = [];
  const routeLines: string[] = [];

  for (const [i, entry] of entries.entries()) {
    // Raw imports — no ?client — so SSR sees the full module including JSX
    imports.push(`import { default as _page${i} } from ${JSON.stringify(rel(entry.file))};`);
    for (const [j, l] of entry.layouts.entries())
      imports.push(`import { default as _layout${i}_${j} } from ${JSON.stringify(rel(l))};`);
    for (const [j, e] of entry.errors.entries())
      imports.push(`import { default as _error${i}_${j} } from ${JSON.stringify(rel(e))};`);

    let expr = `_page${i}`;
    for (let j = entry.errors.length - 1; j >= 0; j--) expr = `wrapError(_error${i}_${j}, ${expr})`;
    for (let j = entry.layouts.length - 1; j >= 0; j--)
      expr = `wrapLayout(_layout${i}_${j}, ${expr})`;

    const wrappedId = `_wrapped${i}`;
    wrappedIslandLines.push(`const ${wrappedId} = ${expr};`);
    registryLines.push(
      `  ${JSON.stringify(entry.name)}: ${wrappedId}` + (i < entries.length - 1 ? "," : ""),
    );
    routeLines.push(
      `  .route(${JSON.stringify(entry.pattern)}, ${wrappedId})` +
        (entry.hasLoader || entry.loaderLayouts.length > 0
          ? `.markLoader(${JSON.stringify(entry.pattern)})`
          : ""),
    );
    // Nearest +error boundary also handles *loader* errors (render errors are
    // covered by the wrapError chain inside the island).
    if (entry.errors.length > 0) {
      routeLines.push(
        `  .errorBoundary(${JSON.stringify(entry.pattern)}, _error${i}_${entry.errors.length - 1})`,
      );
    }
  }

  return [
    `// @generated by @ilha/router — do not edit`,
    `// Server module. Use for SSR and SSG/prerender.`,
    `// Import via: import { pageRouter, registry } from "ilha:pages/server";`,
    ``,
    ...imports,
    ``,
    ...wrappedIslandLines,
    ``,
    `export const registry: Record<string, Island<any, any>> = {`,
    ...registryLines,
    `};`,
    ``,
    `export const pageRouter = router()`,
    ...routeLines,
    `  ;`,
  ].join("\n");
}

// ─────────────────────────────────────────────
// Codegen — client file
// ─────────────────────────────────────────────

function buildClientFile(
  entries: PageEntry[],
  clientFile: string,
  opts: { isStatic: boolean; interceptLinks?: boolean },
): string {
  const { isStatic, interceptLinks } = opts;
  const rel = (abs: string) => {
    const r = toPosix(relative(dirname(clientFile), abs));
    return r.startsWith(".") ? r : `./${r}`;
  };
  const clientImport = (abs: string) => `${rel(abs)}?client`;
  const clientLoaderImport = (abs: string) => `${rel(abs)}?client-loader`;
  let needsComposeLoaders = false;

  const imports: string[] = isStatic
    ? [
        `import { router as _router, wrapLayout, wrapError } from "@ilha/router";`,
        `import type { Island } from "ilha";`,
      ]
    : [
        `import { router, wrapLayout, wrapError } from "@ilha/router";`,
        `import type { Island } from "ilha";`,
      ];

  const wrappedIslandLines: string[] = [];
  const registryLines: string[] = [];
  const routeLines: string[] = [];

  for (const [i, entry] of entries.entries()) {
    imports.push(
      `import { default as _page${i} } from ${JSON.stringify(clientImport(entry.file))};`,
    );
    for (const [j, l] of entry.layouts.entries())
      imports.push(
        `import { default as _layout${i}_${j} } from ${JSON.stringify(clientImport(l))};`,
      );
    for (const [j, e] of entry.errors.entries())
      imports.push(
        `import { default as _error${i}_${j} } from ${JSON.stringify(clientImport(e))};`,
      );

    let expr = `_page${i}`;
    for (let j = entry.errors.length - 1; j >= 0; j--) expr = `wrapError(_error${i}_${j}, ${expr})`;
    for (let j = entry.layouts.length - 1; j >= 0; j--)
      expr = `wrapLayout(_layout${i}_${j}, ${expr})`;

    const wrappedId = `_wrapped${i}`;
    wrappedIslandLines.push(`const ${wrappedId} = ${expr};`);
    registryLines.push(
      `  ${JSON.stringify(entry.name)}: ${wrappedId}` + (i < entries.length - 1 ? "," : ""),
    );
    if (!isStatic) {
      routeLines.push(
        `  .route(${JSON.stringify(entry.pattern)}, ${wrappedId})` +
          (entry.hasLoader || entry.loaderLayouts.length > 0
            ? `.markLoader(${JSON.stringify(entry.pattern)})`
            : ""),
      );

      // Browser-executed loaders (`clientLoad`) — imported via the
      // ?client-loader shim and attached so client navigations run them
      // locally instead of calling the loader endpoint.
      const clientLoaderIds: string[] = [];
      for (const [j, layout] of entry.clientLoaderLayouts.entries()) {
        const id = `_cl${i}_l${j}`;
        imports.push(
          `import { clientLoad as ${id} } from ${JSON.stringify(clientLoaderImport(layout))};`,
        );
        clientLoaderIds.push(id);
      }
      if (entry.hasClientLoader) {
        const id = `_cl${i}`;
        imports.push(
          `import { clientLoad as ${id} } from ${JSON.stringify(clientLoaderImport(entry.file))};`,
        );
        clientLoaderIds.push(id);
      }
      if (clientLoaderIds.length > 0) {
        const expr =
          clientLoaderIds.length === 1
            ? clientLoaderIds[0]
            : `composeLoaders([${clientLoaderIds.join(", ")}])`;
        if (clientLoaderIds.length > 1) needsComposeLoaders = true;
        routeLines.push(`  .clientLoader(${JSON.stringify(entry.pattern)}, ${expr})`);
      }

      // Nearest +error boundary also handles *loader* errors on the client.
      if (entry.errors.length > 0) {
        routeLines.push(
          `  .errorBoundary(${JSON.stringify(entry.pattern)}, _error${i}_${entry.errors.length - 1})`,
        );
      }
    }
  }

  if (needsComposeLoaders) {
    imports[0] = imports[0]!.replace("{ router", "{ composeLoaders, router");
  }

  const routerExpr = isStatic
    ? `_router({ mode: "static" })`
    : `router(${interceptLinks === false ? `{ interceptLinks: false }` : ""})`;

  const lines = [
    `// @generated by @ilha/router — do not edit`,
    `// Client module. Use for browser hydration.`,
    `// Import via: import { pageRouter, registry } from "ilha:pages/client";`,
    ``,
    ...imports,
    ``,
    ...wrappedIslandLines,
    ``,
    `export const registry: Record<string, Island<any, any>> = {`,
    ...registryLines,
    `};`,
    ``,
  ];

  if (isStatic) {
    lines.push(`export const pageRouter = ${routerExpr};`);
  } else {
    lines.push(`export const pageRouter = ${routerExpr}`, ...routeLines, `  ;`);
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────
// Codegen — server-only loaders file
// ─────────────────────────────────────────────

function buildLoadersFile(entries: PageEntry[], loadersFile: string, serverFile: string): string {
  const relFromLoaders = (abs: string) => {
    const r = toPosix(relative(dirname(loadersFile), abs));
    return r.startsWith(".") ? r : `./${r}`;
  };

  const withLoaders = entries.filter((e) => e.hasLoader || e.loaderLayouts.length > 0);

  if (withLoaders.length === 0) {
    return [
      `// @generated by @ilha/router — do not edit`,
      `// This project has no loader exports; this file is intentionally empty.`,
      ``,
      `export {};`,
      ``,
    ].join("\n");
  }

  const serverRel = relFromLoaders(serverFile).replace(/\.tsx?$/, "");
  const imports: string[] = [`import { pageRouter } from ${JSON.stringify(serverRel)};`];
  let needsComposeLoaders = false;
  const attachLines: string[] = [];

  for (const [i, entry] of withLoaders.entries()) {
    const loaderIds: string[] = [];
    for (const [j, layout] of entry.loaderLayouts.entries()) {
      const id = `_p${i}_l${j}`;
      imports.push(`import { load as ${id} } from ${JSON.stringify(relFromLoaders(layout))};`);
      loaderIds.push(id);
    }
    if (entry.hasLoader) {
      const id = `_p${i}`;
      imports.push(`import { load as ${id} } from ${JSON.stringify(relFromLoaders(entry.file))};`);
      loaderIds.push(id);
    }
    const loadersExpr =
      loaderIds.length === 1 ? loaderIds[0] : `composeLoaders([${loaderIds.join(", ")}])`;
    if (loaderIds.length > 1) needsComposeLoaders = true;
    attachLines.push(`pageRouter.attachLoader(${JSON.stringify(entry.pattern)}, ${loadersExpr});`);
  }

  if (needsComposeLoaders) imports.unshift(`import { composeLoaders } from "@ilha/router";`);

  return [
    `// @generated by @ilha/router — do not edit`,
    `// Server-only. Import this module from your SSR entry to wire loaders`,
    `// onto pageRouter. Importing it from the client is a no-op but wastes`,
    `// bundle size — rely on the default build pipeline to keep it out.`,
    ``,
    ...imports,
    ``,
    ...attachLines,
    ``,
  ].join("\n");
}

// ─────────────────────────────────────────────
// Write-if-changed helper
// ─────────────────────────────────────────────

async function writeIfChanged(file: string, content: string): Promise<boolean> {
  try {
    const existing = await readFile(file, "utf8");
    if (existing === content) return false;
  } catch {
    // File doesn't exist yet — proceed to write
  }
  await writeFile(file, content, "utf8");
  return true;
}

// ─────────────────────────────────────────────
// Type declarations for virtual modules
// ─────────────────────────────────────────────

async function generateTypes(outDir: string): Promise<void> {
  const dtsFile = join(outDir, "pages.d.ts");

  const types = [
    `// @generated by @ilha/router — do not edit`,
    ``,
    `declare module "ilha:pages/server" {`,
    `  import type { RouterBuilder } from "@ilha/router";`,
    `  import type { Island } from "ilha";`,
    `  export const pageRouter: RouterBuilder;`,
    `  export const registry: Record<string, Island<any, any>>;`,
    `}`,
    ``,
    `declare module "ilha:pages/client" {`,
    `  import type { RouterBuilder } from "@ilha/router";`,
    `  import type { Island } from "ilha";`,
    `  export const pageRouter: RouterBuilder;`,
    `  export const registry: Record<string, Island<any, any>>;`,
    `}`,
    ``,
    `declare module "ilha:loaders" {`,
    `  // Side-effect-only module. Importing it attaches loaders to pageRouter.`,
    `}`,
    ``,
  ].join("\n");

  await writeIfChanged(dtsFile, types);
}
