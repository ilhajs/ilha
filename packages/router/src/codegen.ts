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

async function hasLoaderExport(file: string): Promise<boolean> {
  try {
    const src = await readFile(file, "utf8");
    // Strip single-line comments at the start of lines to avoid matching
    // commented-out loaders. Block comments are rare enough to skip.
    const stripped = src.replace(/^\s*\/\/.*$/gm, "");
    return LOADER_EXPORT_RE.test(stripped);
  } catch {
    return false;
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
    // Within the same specificity tier, more segments = more specific
    const segDiff = b.pattern.split("/").length - a.pattern.split("/").length;
    if (segDiff !== 0) return segDiff;
    // Final tiebreaker: alphabetical for determinism across filesystems
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

  // Detect loader exports on pages and on +layout.ts files in parallel. Error
  // sentinels don't carry loaders so we skip them. Cache layout results since
  // the same layout can apply to many pages.
  const layoutLoaderCache = new Map<string, Promise<boolean>>();
  const getLayoutHasLoader = (file: string): Promise<boolean> => {
    let cached = layoutLoaderCache.get(file);
    if (!cached) {
      cached = hasLoaderExport(file);
      layoutLoaderCache.set(file, cached);
    }
    return cached;
  };

  return Promise.all(
    pages.map(async (file) => {
      const pattern = fileToPattern(pagesDir, file);
      const layouts = chainForFile(pagesDir, file, allSet, "+layout");
      const errors = chainForFile(pagesDir, file, allSet, "+error");
      const [pageHasLoader, ...layoutFlags] = await Promise.all([
        hasLoaderExport(file),
        ...layouts.map(getLayoutHasLoader),
      ]);
      const loaderLayouts = layouts.filter((_, i) => layoutFlags[i]);
      return {
        file,
        pattern,
        name: patternToName(pattern),
        layouts,
        errors,
        hasLoader: pageHasLoader,
        loaderLayouts,
      };
    }),
  );
}

// ─────────────────────────────────────────────
// Codegen — validation
// ─────────────────────────────────────────────

function validateEntries(entries: PageEntry[], pagesDir: string): void {
  if (entries.length === 0) {
    console.warn(`[ilha:pages] No pages found in ${pagesDir}`);
    return;
  }

  const seenPatterns = new Map<string, string>();
  const seenNames = new Map<string, string>();

  for (const entry of entries) {
    const existingPattern = seenPatterns.get(entry.pattern);
    if (existingPattern) {
      console.warn(
        `[ilha:pages] Duplicate route pattern "${entry.pattern}"\n` +
          `  first:  ${existingPattern}\n` +
          `  second: ${entry.file}\n` +
          `  The first match wins — the second page will never be reached.`,
      );
    } else {
      seenPatterns.set(entry.pattern, entry.file);
    }

    const existingName = seenNames.get(entry.name);
    if (existingName) {
      console.warn(
        `[ilha:pages] Registry name collision: "${entry.name}" is used by both\n` +
          `  ${existingName}\n` +
          `  ${entry.file}\n` +
          `  Hydration may not work correctly for one of these routes.`,
      );
    } else {
      seenNames.set(entry.name, entry.file);
    }
  }
}

// ─────────────────────────────────────────────
// Codegen — emit generated file
// ─────────────────────────────────────────────

export type PagesMode = "spa" | "mpa";

export interface GenerateOptions {
  /** Generated page router navigation mode. Default: `spa`. */
  mode?: PagesMode;
}

export async function generate(
  pagesDir: string,
  outFile: string,
  options: GenerateOptions = {},
): Promise<void> {
  const mode = options.mode ?? "spa";
  const raw = await scanPages(pagesDir);
  const entries = sortEntries(raw);

  validateEntries(entries, pagesDir);

  const rel = (abs: string) => {
    const r = toPosix(relative(dirname(outFile), abs));
    return r.startsWith(".") ? r : `./${r}`;
  };

  // ─── Client-safe routes file ────────────────────────────────────────────
  const imports: string[] = [
    `import { router, wrapLayout, wrapError } from "@ilha/router";`,
    `import type { Island } from "ilha";`,
  ];

  const wrappedIslandLines: string[] = [];
  const registryLines: string[] = [];
  const routeLines: string[] = [];

  // The `?client` query suffix resolves (via the plugin) to a virtual module
  // that re-exports only the default. This strips `load` and any symbol only
  // reachable from `load`, keeping server-only code out of the client bundle.
  const clientImport = (abs: string) => `${rel(abs)}?client`;

  for (const [i, entry] of entries.entries()) {
    const pageId = `_page${i}`;
    imports.push(
      `import { default as ${pageId} } from ${JSON.stringify(clientImport(entry.file))};`,
    );

    for (const [j, l] of entry.layouts.entries())
      imports.push(
        `import { default as _layout${i}_${j} } from ${JSON.stringify(clientImport(l))};`,
      );

    for (const [j, e] of entry.errors.entries())
      imports.push(
        `import { default as _error${i}_${j} } from ${JSON.stringify(clientImport(e))};`,
      );

    let expr = pageId;
    for (let j = entry.errors.length - 1; j >= 0; j--) expr = `wrapError(_error${i}_${j}, ${expr})`;
    for (let j = entry.layouts.length - 1; j >= 0; j--)
      expr = `wrapLayout(_layout${i}_${j}, ${expr})`;

    // Store wrapped island in a variable so registry and route use the SAME instance
    // This is required for renderHydratable to find the island by identity
    const wrappedId = `_wrapped${i}`;
    wrappedIslandLines.push(`const ${wrappedId} = ${expr};`);
    registryLines.push(
      `  ${JSON.stringify(entry.name)}: ${wrappedId}` + (i < entries.length - 1 ? "," : ""),
    );
    routeLines.push(`  .route(${JSON.stringify(entry.pattern)}, ${wrappedId})`);
  }

  const code = [
    `// @generated by @ilha/router — do not edit`,
    ``,
    ...imports,
    ``,
    ...wrappedIslandLines,
    ``,
    `export const registry: Record<string, Island<any, any>> = {`,
    ...registryLines,
    `};`,
    ``,
    `export const pageRouter = router(${mode === "mpa" ? `{ mode: "mpa" }` : ""})`,
    ...routeLines,
    `  ;`,
  ].join("\n");

  // Only write if content actually changed — avoids unnecessary HMR invalidation
  await mkdir(dirname(outFile), { recursive: true });
  const routesChanged = await writeIfChanged(outFile, code);

  // ─── Server-only loaders file ───────────────────────────────────────────
  const loadersFile = join(dirname(outFile), "loaders.ts");
  const loadersCode = buildLoadersFile(entries, loadersFile, outFile);
  const loadersChanged = await writeIfChanged(loadersFile, loadersCode);

  if (routesChanged || loadersChanged) {
    await generateTypes(outFile);
  }
}

// ─────────────────────────────────────────────
// Codegen — build the server-only loaders file
// ─────────────────────────────────────────────

function buildLoadersFile(entries: PageEntry[], loadersFile: string, routesFile: string): string {
  const relFromLoaders = (abs: string) => {
    const r = toPosix(relative(dirname(loadersFile), abs));
    return r.startsWith(".") ? r : `./${r}`;
  };

  // Only include pages that have at least one loader in their chain (page or
  // any layout). Pages without any loaders don't need an attachLoader call.
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

  const routesRel = relFromLoaders(routesFile).replace(/\.tsx?$/, "");

  const imports: string[] = [`import { pageRouter } from ${JSON.stringify(routesRel)};`];
  let needsComposeLoaders = false;

  const attachLines: string[] = [];

  for (const [i, entry] of withLoaders.entries()) {
    // Unique local names per page index to avoid collisions when the same
    // layout file is imported by many pages (we import it once per page for
    // clarity — Vite dedupes the underlying module anyway).
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

  // Only import composeLoaders if at least one page needs it (multiple loaders)
  if (needsComposeLoaders) {
    imports.unshift(`import { composeLoaders } from "@ilha/router";`);
  }

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
    // File doesn't exist yet — that's fine, proceed to write
  }
  await writeFile(file, content, "utf8");
  return true;
}

// ─────────────────────────────────────────────
// Type declarations for virtual modules
// ─────────────────────────────────────────────

async function generateTypes(outFile: string): Promise<void> {
  const dtsFile = outFile.replace(/\.tsx?$/, ".d.ts");

  const types = [
    `// @generated by @ilha/router — do not edit`,
    ``,
    `declare module "ilha:pages" {`,
    `  import type { RouterBuilder } from "@ilha/router";`,
    `  export const pageRouter: RouterBuilder;`,
    `}`,
    ``,
    `declare module "ilha:registry" {`,
    `  import type { Island } from "ilha";`,
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
