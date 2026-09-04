import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  loadServerModuleScan,
  serverIslandVirtualSpec,
} from "./server-islands";

const toPosix = (p: string): string => p.replaceAll("\\", "/");

// ─────────────────────────────────────────────
// Codegen — types
// ─────────────────────────────────────────────

interface PageEntry {
  file: string;
  pattern: string;
  name: string;
  layouts: string[];
  errors: string[];
  /** True for `foo.server.tsx` pages — rendered server-side via the frame protocol. */
  server: boolean;
}

// ─────────────────────────────────────────────
// Codegen — excluded filename patterns
// ─────────────────────────────────────────────

/** Files that should never be treated as pages even if they match the ts/tsx extension. */
const EXCLUDED_RE = /\.(?:test|spec|d)\.(?:ts|tsx)$/u;

/** Server pages: `foo.server.tsx` routes `/foo`, rendered through the frame protocol. */
export const SERVER_PAGE_RE = /\.server\.(?:ts|tsx)$/u;

const PAGE_EXT_RE = /\.(?:ts|tsx)$/u;

// ─────────────────────────────────────────────
// Codegen — filename → rou3 pattern
// ─────────────────────────────────────────────

const fileToSegment = (name: string): string => {
  if (name.startsWith("[...") && name.endsWith("]")) {
    return `**:${name.slice(4, -1)}`;
  }
  if (name.startsWith("[") && name.endsWith("]")) {
    return `:${name.slice(1, -1)}`;
  }
  return name;
};

/** Route-group directories like "(auth)" are transparent to the URL. */
const dirToSegment = (name: string): string => {
  if (name.startsWith("(") && name.endsWith(")")) {
    return "";
  }
  return fileToSegment(name);
};

export const fileToPattern = (pagesDir: string, file: string): string => {
  const rel = toPosix(path.relative(pagesDir, file));
  let noExt = rel.slice(0, -path.extname(rel).length);
  // `foo.server.tsx` routes the same pattern as a plain page module.
  if (SERVER_PAGE_RE.test(rel)) {
    noExt = noExt.replace(/\.server$/u, "");
  }
  const parts = noExt.split("/");
  const leaf = parts.at(-1);
  const segments = [
    ...parts.slice(0, -1).map(dirToSegment),
    fileToSegment(leaf ?? ""),
  ];

  if (segments.at(-1) === "index") {
    segments.pop();
  }
  const joined = segments.filter(Boolean).join("/");
  return joined === "" ? "/" : `/${joined}`;
};

// ─────────────────────────────────────────────
// Codegen — pattern → registry name
// ─────────────────────────────────────────────

const patternToName = (pattern: string): string => {
  if (pattern === "/") {
    return "index";
  }
  return (
    pattern
      .replace(/^\//u, "")
      .replaceAll(/\*\*:[^/]*/gu, (m) =>
        m.length > 3 ? m.slice(3) : "wildcard"
      )
      .replaceAll(":", "")
      .replaceAll("**", "wildcard")
      .replaceAll("/", "-")
      .replaceAll(/[^a-zA-Z0-9-]/gu, "") || "page"
  );
};

// ─────────────────────────────────────────────
// Codegen — specificity score for route sorting
// ─────────────────────────────────────────────

const specificityScore = (pattern: string): number => {
  if (pattern === "/") {
    return 3;
  }
  if (pattern.includes("**")) {
    return 0;
  }
  if (pattern.includes(":")) {
    return 1;
  }
  return 2;
};

/** Deterministic sort: by specificity desc, then by segment count desc, then alphabetical. */
const sortEntries = (entries: PageEntry[]): PageEntry[] =>
  [...entries].toSorted((a, b) => {
    const specDiff = specificityScore(b.pattern) - specificityScore(a.pattern);
    if (specDiff !== 0) {
      return specDiff;
    }
    const segDiff = b.pattern.split("/").length - a.pattern.split("/").length;
    if (segDiff !== 0) {
      return segDiff;
    }
    return a.pattern.localeCompare(b.pattern);
  });

// ─────────────────────────────────────────────
// Codegen — layout / error chain resolution
// ─────────────────────────────────────────────

const chainForFile = (
  pagesDir: string,
  file: string,
  all: Set<string>,
  sentinel: string
): string[] => {
  const relDir = toPosix(path.relative(pagesDir, path.dirname(file)));
  const parts = relDir === "" ? [] : relDir.split("/");
  const dirs = [
    pagesDir,
    ...parts.map((_, i) => path.join(pagesDir, ...parts.slice(0, i + 1))),
  ];
  const candidatesFor = (dir: string) => {
    const tsx = `${path.join(dir, sentinel)}.tsx`;
    if (all.has(tsx)) {
      return [tsx];
    }
    const ts = `${path.join(dir, sentinel)}.ts`;
    if (all.has(ts)) {
      return [ts];
    }
    return [];
  };
  return dirs.flatMap(candidatesFor);
};

// ─────────────────────────────────────────────
// Codegen — file system scan
// ─────────────────────────────────────────────

const MAX_SCAN_DEPTH = 20;

const collectFiles = async (dir: string, depth = 0): Promise<string[]> => {
  if (depth > MAX_SCAN_DEPTH) {
    console.warn(
      `[ilha:pages] Max scan depth (${MAX_SCAN_DEPTH}) reached at ${dir} — skipping`
    );
    return [];
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // SAFETY: Node fs errors expose a string `code`; ENOENT means missing dir.
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(full, depth + 1);
      }
      if (
        entry.isFile() &&
        PAGE_EXT_RE.test(entry.name) &&
        !EXCLUDED_RE.test(entry.name)
      ) {
        return [full];
      }
      const empty: string[] = [];
      return empty;
    })
  );
  return nested.flat();
};

const scanPages = async (pagesDir: string): Promise<PageEntry[]> => {
  const all = await collectFiles(pagesDir);
  const allSet = new Set(all);
  const pages = all.filter((f) => !path.basename(f).startsWith("+"));
  return pages.map((file) => {
    const pattern = fileToPattern(pagesDir, file);
    return {
      errors: chainForFile(pagesDir, file, allSet, "+error"),
      file,
      layouts: chainForFile(pagesDir, file, allSet, "+layout"),
      name: patternToName(pattern),
      pattern,
      server: SERVER_PAGE_RE.test(path.basename(file)),
    };
  });
};

// ─────────────────────────────────────────────
// Codegen — validation
// ─────────────────────────────────────────────

const validateEntries = (
  entries: PageEntry[],
  pagesDir: string,
  strict: boolean
): void => {
  if (entries.length === 0) {
    console.warn(`[ilha:pages] No pages found in ${pagesDir}`);
    return;
  }

  const seenPatterns = new Map<string, string>();
  const seenNames = new Map<string, string>();
  const problems: string[] = [];

  for (const entry of entries) {
    if (entry.server) {
      // Structural errors — always fatal, they silently break the route.
      try {
        const scan = loadServerModuleScan(entry.file);
        if (
          !scan.islands.some((island) => island.name === "default") &&
          !scan.exports.includes("default")
        ) {
          throw new Error(
            `[ilha:pages] Server page ${entry.file} has no default export.`
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("[ilha:pages]")) {
          throw error;
        }
        throw new Error(
          `[ilha:pages] Server page ${entry.file} could not be scanned for island exports.`,
          { cause: error }
        );
      }
    }
    const existingPattern = seenPatterns.get(entry.pattern);
    if (existingPattern) {
      problems.push(
        `Duplicate route pattern "${entry.pattern}"\n` +
          `  first:  ${existingPattern}\n` +
          `  second: ${entry.file}\n` +
          `  The first match wins — the second page will never be reached.`
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
          `  Hydration may not work correctly for one of these routes.`
      );
    } else {
      seenNames.set(entry.name, entry.file);
    }
  }

  if (problems.length === 0) {
    return;
  }
  if (strict) {
    throw new Error(
      `[ilha:pages] Route validation failed:\n\n${problems.join("\n\n")}`
    );
  }
  for (const p of problems) {
    console.warn(`[ilha:pages] ${p}`);
  }
};

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
}

export const resolveGeneratedPaths = (outDir: string): GeneratedPaths => ({
  clientFile: path.join(outDir, "pages.client.ts"),
  serverFile: path.join(outDir, "pages.server.ts"),
});

const relFrom = (fromFile: string, abs: string): string => {
  const r = toPosix(path.relative(path.dirname(fromFile), abs));
  return r.startsWith(".") ? r : `./${r}`;
};

const wrapIslandExpr = (
  pageId: string,
  layoutCount: number,
  errorCount: number,
  index: number
): string => {
  let expr = pageId;
  for (let j = errorCount - 1; j >= 0; j -= 1) {
    expr = `wrapError(_error${index}_${j}, ${expr})`;
  }
  for (let j = layoutCount - 1; j >= 0; j -= 1) {
    expr = `wrapLayout(_layout${index}_${j}, ${expr})`;
  }
  return expr;
};

const pushLayoutErrorImports = (
  imports: string[],
  entry: PageEntry,
  index: number,
  importPath: (abs: string) => string
): void => {
  for (const [j, l] of entry.layouts.entries()) {
    imports.push(
      `import { default as _layout${index}_${j} } from ${JSON.stringify(importPath(l))};`
    );
  }
  for (const [j, e] of entry.errors.entries()) {
    imports.push(
      `import { default as _error${index}_${j} } from ${JSON.stringify(importPath(e))};`
    );
  }
};

const pushRegistryAndRoutes = (
  entry: PageEntry,
  index: number,
  entriesLength: number,
  wrappedId: string,
  registryLines: string[],
  routeLines: string[],
  includeRoutes: boolean
): void => {
  registryLines.push(
    `  ${JSON.stringify(entry.name)}: ${wrappedId}${index < entriesLength - 1 ? "," : ""}`
  );
  if (!includeRoutes) {
    return;
  }
  routeLines.push(`  .route(${JSON.stringify(entry.pattern)}, ${wrappedId})`);
  if (entry.errors.length > 0) {
    routeLines.push(
      `  .errorBoundary(${JSON.stringify(entry.pattern)}, _error${index}_${entry.errors.length - 1})`
    );
  }
};

const buildServerFile = (entries: PageEntry[], serverFile: string): string => {
  const rel = (abs: string) => relFrom(serverFile, abs);

  const imports: string[] = [
    `import { router, wrapLayout, wrapError } from "@ilha/router";`,
    `import type { Island } from "ilha";`,
  ];
  const wrappedIslandLines: string[] = [];
  const registryLines: string[] = [];
  const routeLines: string[] = [];

  for (const [i, entry] of entries.entries()) {
    // Raw imports — no ?client — so SSR sees the full module including JSX
    imports.push(
      `import { default as _page${i} } from ${JSON.stringify(rel(entry.file))};`
    );
    pushLayoutErrorImports(imports, entry, i, rel);

    const expr = wrapIslandExpr(
      `_page${i}`,
      entry.layouts.length,
      entry.errors.length,
      i
    );
    const wrappedId = `_wrapped${i}`;
    wrappedIslandLines.push(`const ${wrappedId} = ${expr};`);
    pushRegistryAndRoutes(
      entry,
      i,
      entries.length,
      wrappedId,
      registryLines,
      routeLines,
      true
    );
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
    `export const registry: Record<string, Island<any>> = {`,
    ...registryLines,
    `};`,
    ``,
    `export const pageRouter = router()`,
    ...routeLines,
    `  ;`,
  ].join("\n");
};

const emitClientEntry = (
  entry: PageEntry,
  index: number,
  entriesLength: number,
  isStatic: boolean,
  clientImport: (abs: string) => string,
  imports: string[],
  wrappedIslandLines: string[],
  registryLines: string[],
  routeLines: string[]
): void => {
  // Server page — the client graph gets the generated proxy island, which
  // mounts an empty host and pulls its first frame (server-rendered HTML)
  // via POST /__ilha/frame with the current path.
  const pageImport = entry.server
    ? `import { default as _page${index} } from ${JSON.stringify(serverIslandVirtualSpec(entry.file))};`
    : `import { default as _page${index} } from ${JSON.stringify(clientImport(entry.file))};`;
  imports.push(pageImport);
  pushLayoutErrorImports(imports, entry, index, clientImport);

  const expr = wrapIslandExpr(
    `_page${index}`,
    entry.layouts.length,
    entry.errors.length,
    index
  );
  const wrappedId = `_wrapped${index}`;
  wrappedIslandLines.push(`const ${wrappedId} = ${expr};`);
  pushRegistryAndRoutes(
    entry,
    index,
    entriesLength,
    wrappedId,
    registryLines,
    routeLines,
    !isStatic
  );
};

const buildClientFile = (
  entries: PageEntry[],
  clientFile: string,
  opts: { isStatic: boolean; interceptLinks?: boolean }
): string => {
  const { isStatic, interceptLinks } = opts;
  const rel = (abs: string) => relFrom(clientFile, abs);
  const clientImport = (abs: string) => `${rel(abs)}?client`;

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
    emitClientEntry(
      entry,
      i,
      entries.length,
      isStatic,
      clientImport,
      imports,
      wrappedIslandLines,
      registryLines,
      routeLines
    );
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
    `export const registry: Record<string, Island<any>> = {`,
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
};

const writeIfChanged = async (
  file: string,
  content: string
): Promise<boolean> => {
  try {
    const existing = await readFile(file, "utf-8");
    if (existing === content) {
      return false;
    }
  } catch {
    // File doesn't exist yet — proceed to write
  }
  await writeFile(file, content, "utf-8");
  return true;
};

const generateTypes = async (outDir: string): Promise<void> => {
  const dtsFile = path.join(outDir, "pages.d.ts");

  const types = [
    `// @generated by @ilha/router — do not edit`,
    ``,
    `declare module "ilha:pages/server" {`,
    `  import type { RouterBuilder } from "@ilha/router";`,
    `  import type { Island } from "ilha";`,
    `  export const pageRouter: RouterBuilder;`,
    `  export const registry: Record<string, Island<any>>;`,
    `}`,
    ``,
    `declare module "ilha:pages/client" {`,
    `  import type { RouterBuilder } from "@ilha/router";`,
    `  import type { Island } from "ilha";`,
    `  export const pageRouter: RouterBuilder;`,
    `  export const registry: Record<string, Island<any>>;`,
    `}`,
    ``,
    `declare module "ilha:loaders" {`,
    `  // Side-effect-only module. oxidejs imports it alongside @ilha/router/ssr.`,
    `}`,
    ``,
  ].join("\n");

  await writeIfChanged(dtsFile, types);
};

export const generate = async (
  pagesDir: string,
  outDir: string,
  options: GenerateOptions = {}
): Promise<void> => {
  const mode = options.mode ?? "spa";
  const { interceptLinks } = options;
  const isStatic = mode === "static";
  const raw = await scanPages(pagesDir);
  const entries = sortEntries(raw);

  validateEntries(entries, pagesDir, options.strict === true);

  await mkdir(outDir, { recursive: true });

  const { serverFile, clientFile } = resolveGeneratedPaths(outDir);

  // ─── Server file: raw imports, full route graph ──────────────────────────
  const serverCode = buildServerFile(entries, serverFile);
  const serverChanged = await writeIfChanged(serverFile, serverCode);

  // ─── Client file: ?client imports, browser bundle ───────────────────────
  const clientCode = buildClientFile(entries, clientFile, {
    interceptLinks,
    isStatic,
  });
  const clientChanged = await writeIfChanged(clientFile, clientCode);

  // ─── Loaders file (server-only, skipped in static mode) ─────────────────

  if (serverChanged || clientChanged) {
    await generateTypes(outDir);
  }
};
