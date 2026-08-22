import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/**
 * Build-time support for server-defined islands. The plugin scans
 * `*.server.ts(x)` modules for island exports (`export const X = ilha…`),
 * generates a client virtual module per file that re-creates those exports as
 * proxies wired to tacho stubs, and rewrites client-graph import sites so
 * island bindings resolve to the proxy while everything else keeps flowing
 * through oxidejs's tacho stub replacement.
 */

export interface ScannedServerIsland {
  /** Export binding name, or `"default"` for `export default ilha…`. */
  name: string;
  /** Slot tag from `.as()` — must match what SSR emits. */
  as: string;
  /** Stream key → referenced module export used as its transport. */
  streams: Record<string, string>;
  /** Action key → referenced module export used as its transport. */
  actions: Record<string, string>;
}

export interface ClientIslandRef {
  id: string;
  local: string;
  imported: string;
  spec: string;
}

export interface ServerModuleScan {
  islands: ScannedServerIsland[];
  /** All value-export names of the module (transport candidates). */
  exports: string[];
  /** Imported JSX components that must hydrate inside the server island. */
  clientRefs: ClientIslandRef[];
  /** True when the module declares `export const load = loader.client(…)` —
   * the proxy wires it as an RPC call invoked when the view hydrates. */
  clientLoader?: boolean;
}

const EXPORT_RE =
  /(?:^|\n)\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
const ISLAND_EXPORT_RE = /(?:^|\n)\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*ilha\b/g;
const DEFAULT_ISLAND_RE = /export\s+default\s+ilha\b/;
const AS_RE = /\.as\(\s*["'`]([a-z][a-z0-9-]*)["'`]\s*\)/;

export function clientRefPublicId(spec: string, imported: string): string {
  return createHash("sha256").update(`${spec}#${imported}`).digest("base64url");
}

function scanClientRefs(source: string): ClientIslandRef[] {
  const used = new Set(Array.from(source.matchAll(/<([A-Z][\w$]*)\b/g), (match) => match[1]!));
  const refs: ClientIslandRef[] = [];
  const IMPORT_RE = /(?:^|\n)\s*import\s+(?!type\b)([^'"\n]+?)\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(IMPORT_RE)) {
    const clause = match[1]!.trim();
    const spec = match[2]!;
    const brace = clause.match(/\{([^}]+)\}/)?.[1];
    if (brace) {
      for (const part of brace.split(",")) {
        const binding = part.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!binding) continue;
        const imported = binding[1]!;
        const local = binding[2] ?? imported;
        if (used.has(local))
          refs.push({ id: clientRefPublicId(spec, imported), local, imported, spec });
      }
    }
    const defaultLocal = clause.split(",", 1)[0]!.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(defaultLocal) && used.has(defaultLocal)) {
      refs.push({
        id: clientRefPublicId(spec, "default"),
        local: defaultLocal,
        imported: "default",
        spec,
      });
    }
  }
  return refs;
}

/** Extract the balanced-paren argument list starting at the "(" following
 * `from` index. String literals are skipped so parens inside them don't count.
 * Returns the inner text, or null when unbalanced within `limit` chars. */
function extractCallArgs(source: string, openParen: number, limit = 4000): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParen; i < Math.min(source.length, openParen + limit); i++) {
    const ch = source[i]!;
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  return null;
}

/** First callback body inside an args list: everything after the first top-level
 * comma. Used to scan which module exports a stream/action closure references. */
function callbackBody(args: string): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!;
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) return args.slice(i + 1);
  }
  return "";
}

/** Identifiers in `body` that are members of `candidates`, excluding keywords. */
function referencedExports(body: string, candidates: Set<string>): string | undefined {
  const WORD_RE = /[A-Za-z_$][\w$]*/g;
  for (const match of body.matchAll(WORD_RE)) {
    if (candidates.has(match[0]!)) return match[0];
  }
  return undefined;
}

/** Scan a `*.server.ts(x)` module source for island exports and their
 * declarative wiring. Convention: islands start with `ilha` — both builder
 * chains (`ilha.state()…render()`) and direct factories (`ilha(() => …)`). */
export function scanServerIslands(source: string): ServerModuleScan {
  const exports: string[] = [];
  for (const match of source.matchAll(EXPORT_RE)) exports.push(match[1]!);
  const candidates = new Set(exports);

  const islands: ScannedServerIsland[] = [];

  const collect = (name: string, start: number, sliceEnd: number): void => {
    const slice = source.slice(start, sliceEnd);
    const as = slice.match(AS_RE)?.[1] ?? "div";
    const streams: Record<string, string> = {};
    const actions: Record<string, string> = {};
    for (const kind of ["stream", "action"] as const) {
      const re = new RegExp(`\\.${kind}\\s*\\(\\s*["'\`](\\w+)["'\`]\\s*,`, "g");
      for (const match of slice.matchAll(re)) {
        const key = match[1]!;
        const openParen = (match.index ?? 0) + match[0].indexOf("(");
        const args = extractCallArgs(slice, openParen);
        if (!args) continue;
        const target = referencedExports(callbackBody(args), candidates);
        if (target) (kind === "stream" ? streams : actions)[key] = target;
      }
    }
    islands.push({ name, as, streams, actions });
  };

  for (const match of source.matchAll(ISLAND_EXPORT_RE)) {
    const name = match[1]!;
    const rest = source.slice((match.index ?? 0) + match[0].length);
    const nextExport = rest.search(/\nexport\b/);
    collect(
      name,
      match.index ?? 0,
      (match.index ?? 0) + match[0].length + (nextExport === -1 ? rest.length : nextExport),
    );
  }

  const defaultMatch = source.match(DEFAULT_ISLAND_RE);
  if (defaultMatch && defaultMatch.index !== undefined) {
    const rest = source.slice(defaultMatch.index + defaultMatch[0].length);
    const nextExport = rest.search(/\nexport\b/);
    collect(
      "default",
      defaultMatch.index,
      defaultMatch.index + defaultMatch[0].length + (nextExport === -1 ? rest.length : nextExport),
    );
  }

  return {
    islands,
    exports,
    clientRefs: scanClientRefs(source),
    clientLoader: /(^|\n)\s*export\s+(?:const|let|var)\s+load\b\s*=\s*loader\.client\b/.test(
      source,
    ),
  };
}

export function loadServerModuleScan(path: string): ServerModuleScan {
  return scanServerIslands(readFileSync(path, "utf8"));
}

/** Virtual-module id prefix for generated client proxies of server islands.
 * The file path rides base64url-encoded: a raw suffix like
 * `\0…:…/tasks.server.tsx` would end in `.server.*` and oxidejs's client-stub
 * loader would claim the virtual module before us. */
export const SERVER_ISLAND_PREFIX = "\0ilha:server-island:";

/** Virtual-module specifier serving the client proxy for one server island file. */
export function serverIslandVirtualSpec(file: string): string {
  return SERVER_ISLAND_PREFIX + Buffer.from(file).toString("base64url");
}

/** Emit the client virtual module for one scanned server file. Plain JS —
 * `\0` virtual modules bypass Vite's built-in TS transform, so type-only
 * constructs here would reach the browser unparsed. Editor types are
 * unaffected: TS resolves the ORIGINAL specifier (the real server module);
 * this module exists only inside the client bundle. Frames are fetched from
 * the plugin's `/__ilha/frame` dev middleware. */
export function serverIslandPublicId(spec: string, name: string): string {
  return createHash("sha256").update(`${spec}#${name}`).digest("base64url");
}

export function generateServerIslandModule(spec: string, scan: ServerModuleScan): string {
  const moduleKey = basename(spec).replace(/\.server\.(?:[jt]sx?)$/i, "");
  const lines: string[] = [
    `import { client as $$rpc } from "virtual:oxide/client";`,
    `import { __ilhaServerIsland } from "@ilha/router/server-island";`,
    `const $$call = (method, args) => { const opts = args.at(-1); return opts && typeof opts === "object" && opts.signal instanceof AbortSignal && Object.keys(opts).length === 1 ? $$rpc[${JSON.stringify(moduleKey)}][method](args.slice(0, -1), opts) : $$rpc[${JSON.stringify(moduleKey)}][method](args); };`,
    ...scan.clientRefs.map((ref, index) =>
      ref.imported === "default"
        ? `import $$child${index} from ${JSON.stringify(ref.spec)};`
        : `import { ${ref.imported} as $$child${index} } from ${JSON.stringify(ref.spec)};`,
    ),
  ];

  for (const name of scan.exports) {
    if (!scan.islands.some((island) => island.name === name)) {
      lines.push(`export const ${name} = (...args) => $$call(${JSON.stringify(name)}, args);`);
    }
  }

  for (const island of scan.islands) {
    const wiring: string[] = [];
    const streams = Object.entries(island.streams).map(
      ([key, target]) =>
        `${JSON.stringify(key)}: (signal) => $$call(${JSON.stringify(target)}, [{ signal }])`,
    );
    const actions = Object.entries(island.actions).map(
      ([key, target]) =>
        `${JSON.stringify(key)}: (...args) => $$call(${JSON.stringify(target)}, args)`,
    );
    if (streams.length) wiring.push(`streams: { ${streams.join(", ")} }`);
    if (actions.length) wiring.push(`actions: { ${actions.join(", ")} }`);
    if (scan.clientRefs.length) {
      wiring.push(
        `children: { ${scan.clientRefs.map((ref, index) => `${JSON.stringify(ref.id)}: $$child${index}`).join(", ")} }`,
      );
    }
    const id = serverIslandPublicId(spec, island.name);
    wiring.push(
      `frame: () => fetch("/__ilha/frame", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ${JSON.stringify(id)}, path: location.pathname + location.search }) }).then((r) => { if (!r.ok) throw new Error("frame failed"); return r.json(); }).then((j) => { if (j.redirect) { location.assign(j.redirect); throw new Error("frame redirected"); } return j.html; })`,
    );
    // `loader.client` on server pages executes over RPC when the view
    // hydrates — the module's code never ships to the browser.
    if (scan.clientLoader) {
      wiring.push(`clientLoad: () => $$call("load", [])`);
    }

    const call = `__ilhaServerIsland(${JSON.stringify(id)}, ${JSON.stringify(island.as)}, { ${wiring.join(", ")} })`;
    if (island.name === "default") {
      lines.push(`export default ${call};`);
    } else {
      lines.push(`export const ${island.name} = ${call};`);
    }
  }

  return lines.join("\n");
}

/** Parse one import statement's clause into its bindings. */
interface ImportBinding {
  imported: string;
  local: string;
}

function parseImportClause(clause: string): {
  defaultLocal?: string;
  namespace?: string;
  named: ImportBinding[];
} {
  const result: { defaultLocal?: string; namespace?: string; named: ImportBinding[] } = {
    named: [],
  };
  let rest = clause.trim();

  const nsMatch = rest.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (nsMatch) {
    result.namespace = nsMatch[1];
    rest = rest.replace(nsMatch[0], "").replace(/,/g, "").trim();
  }

  const braceStart = rest.indexOf("{");
  if (braceStart !== -1) {
    const before = rest.slice(0, braceStart).replace(/,/g, "").trim();
    if (before) result.defaultLocal = before;
    const inner = rest.slice(braceStart + 1, rest.lastIndexOf("}"));
    for (const item of inner.split(",")) {
      const trimmed = item.trim();
      if (!trimmed || trimmed.startsWith("type ")) continue;
      const asMatch = trimmed.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (asMatch) result.named.push({ imported: asMatch[1]!, local: asMatch[2] ?? asMatch[1]! });
    }
  } else if (rest && !result.namespace) {
    result.defaultLocal = rest.replace(/,/g, "").trim();
  }

  return result;
}

export interface SplitContext {
  /** Resolved absolute path of the imported specifier, when it's a scanned
   * server module carrying islands; null otherwise. */
  islandNamesFor(spec: string): { islands: Set<string>; hasDefault: boolean } | null;
  /** Virtual module specifier that provides the island bindings. */
  virtualSpecFor(spec: string): string;
}

/**
 * Rewrite import sites whose specifier targets a server module containing
 * island exports. Island bindings move to the virtual proxy module; all other
 * bindings stay on the original specifier (oxidejs replaces them with tacho
 * stubs). Returns null when no statement needed rewriting.
 */
export function splitServerImports(code: string, ctx: SplitContext): string | null {
  const IMPORT_RE = /(^|\n)import\s+(?!type\b)([^'"\n]+?)\s*from\s*(["'])([^"'\n]+)\3;?/g;
  let changed = false;
  const out = code.replace(
    IMPORT_RE,
    (statement, lead: string, clause: string, _q: string, spec: string) => {
      const info = ctx.islandNamesFor(spec);
      if (!info) return statement;

      const parsed = parseImportClause(clause);
      const routed: ImportBinding[] = [];
      const kept: ImportBinding[] = [];
      for (const binding of parsed.named) routed.push(binding);
      const routeDefault = parsed.defaultLocal !== undefined && info.hasDefault;
      if (routed.length === 0 && !routeDefault) return statement;
      changed = true;

      const parts: string[] = [];
      const keptBits: string[] = [];
      if (!routeDefault && parsed.defaultLocal) keptBits.push(parsed.defaultLocal);
      if (kept.length) {
        keptBits.push(
          `{ ${kept.map((b) => (b.local === b.imported ? b.imported : `${b.imported} as ${b.local}`)).join(", ")} }`,
        );
      }
      if (keptBits.length)
        parts.push(`import ${keptBits.join(", ")} from ${JSON.stringify(spec)};`);
      if (parsed.namespace)
        parts.push(`import * as ${parsed.namespace} from ${JSON.stringify(spec)};`);

      const routedBits: string[] = [];
      if (routeDefault) routedBits.push(parsed.defaultLocal!);
      if (routed.length) {
        routedBits.push(
          `{ ${routed.map((b) => (b.local === b.imported ? b.imported : `${b.imported} as ${b.local}`)).join(", ")} }`,
        );
      }
      parts.push(
        `import ${routedBits.join(", ")} from ${JSON.stringify(ctx.virtualSpecFor(spec))};`,
      );

      return lead + parts.join("\n");
    },
  );

  return changed ? out : null;
}
