import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Build-time support for server-defined islands. The plugin scans
 * `*.server.ts(x)` modules for island exports (`export const X = ilha…`),
 * generates a client virtual module per file that re-creates those exports as
 * proxies wired to tacho stubs, and rewrites client-graph import sites so
 * island bindings resolve to the proxy while everything else keeps flowing
 * through oxidejs's tacho stub replacement.
 */

/** Oxide RPC client key — basename without `.server.*` (oxide indexes by module name). */
export const serverModuleRpcKey = (spec: string): string =>
  path.basename(spec).replace(/\.server\.(?:[jt]sx?)$/iu, "");

/** Client repaint group key — full normalized path so same-basename files stay distinct. */
export const serverModuleRepaintKey = (spec: string): string =>
  spec.replaceAll("\\", "/").replace(/\.server\.(?:[jt]sx?)$/iu, "");

export interface ScannedServerIsland {
  /** Export binding name, or `"default"` for `export default ilha…`. */
  name: string;
  /** Slot tag from the `{ as }` option — must match what SSR emits. */
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

/**
 * Replace identity `action(` wrappers of exported server actions with the
 * capture-aware shim on ALREADY-COMPILED module code. Must run inside the
 * SSR transform so upstream JSX/TS output is preserved.
 */
export const rewriteServerActions = (
  code: string,
  rpcActions: Record<string, string>
): string => {
  const names = Object.keys(rpcActions);
  if (names.length === 0) {
    return code;
  }
  const re = new RegExp(
    `(?<head>export\\s+(?:const|let|var)\\s+(?<name>${names.join("|")})\\b\\s*=\\s*)action\\s*\\(`,
    "gu"
  );
  return code.replace(re, (_match, ...args) => {
    // SAFETY: String.replace with a named-group regex puts groups on the last arg.
    const groups = args.at(-1) as { head?: string; name?: string } | undefined;
    const name = groups?.name;
    const head = groups?.head;
    if (name === undefined || head === undefined) {
      return _match;
    }
    const key = rpcActions[name];
    if (key === undefined) {
      return _match;
    }
    return `${head}__ilhaServerAction(${JSON.stringify(key)}, `;
  });
};

export interface ServerModuleScan {
  islands: ScannedServerIsland[];
  /** All value-export names of the module (transport candidates). */
  exports: string[];
  /**
   * Exported server actions rewritten to capture-aware shims: name → the
   * `x:<name>` manifest key the client proxy wires an RPC transport for.
   * Event closures may call these directly without wrapping in ilha's
   * action() — during hydration-manifest rendering the call is recorded,
   * not executed.
   */
  rpcActions: Record<string, string>;
  /** Imported JSX components that must hydrate inside the server island. */
  clientRefs: ClientIslandRef[];
}

const EXPORT_RE =
  /(?:^|\n)\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+(?<name>[A-Za-z_$][\w$]*)/gu;
const ISLAND_EXPORT_RE =
  /(?:^|\n)\s*export\s+(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function(?:\s*\*)?/gu;
const DEFAULT_ISLAND_RE = /export\s+default\s+(?:async\s+)?function(?:\s*\*)?/u;
const EXPORT_LIST_RE = /export\s*\{(?<body>[^}]*)\}/gu;
const ACTION_EXPORT_RE =
  /export\s+(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*action\s*\(/gu;
const JSX_TAG_RE = /<(?<tag>[A-Z][\w$]*)\b/gu;
const IMPORT_STMT_RE =
  /(?:^|\n)\s*import\s+(?!type\b)(?<clause>[^'"\n]+?)\s+from\s+["'](?<spec>[^"']+)["']/gu;
const NAMED_BINDING_RE =
  /^(?<imported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<local>[A-Za-z_$][\w$]*))?$/u;
const FROM_ASYNC_RE =
  /fromAsyncIterable\(\s*(?<target>[A-Za-z_$][\w$]*)\s*\(/gu;
const CALL_IDENT_RE = /(?<ident>[A-Za-z_$][\w$]*)\s*\(/gu;

export const clientRefPublicId = (spec: string, imported: string): string =>
  createHash("sha256").update(`${spec}#${imported}`).digest("base64url");

const collectNamedImportRefs = (
  clause: string,
  spec: string,
  used: Set<string>,
  refs: ClientIslandRef[]
): void => {
  const brace = clause.match(/\{(?<inner>[^}]+)\}/u)?.groups?.inner;
  if (!brace) {
    return;
  }
  for (const part of brace.split(",")) {
    const binding = part.trim().match(NAMED_BINDING_RE);
    const imported = binding?.groups?.imported;
    if (imported === undefined) {
      continue;
    }
    const local = binding?.groups?.local ?? imported;
    if (used.has(local)) {
      refs.push({
        id: clientRefPublicId(spec, imported),
        imported,
        local,
        spec,
      });
    }
  }
};

const collectDefaultImportRef = (
  clause: string,
  spec: string,
  used: Set<string>,
  refs: ClientIslandRef[]
): void => {
  const [defaultPart] = clause.split(",", 1);
  const defaultLocal = defaultPart?.trim() ?? "";
  if (/^[A-Za-z_$][\w$]*$/u.test(defaultLocal) && used.has(defaultLocal)) {
    refs.push({
      id: clientRefPublicId(spec, "default"),
      imported: "default",
      local: defaultLocal,
      spec,
    });
  }
};

const scanClientRefs = (source: string): ClientIslandRef[] => {
  const used = new Set<string>();
  for (const match of source.matchAll(JSX_TAG_RE)) {
    const tag = match.groups?.tag;
    if (tag !== undefined) {
      used.add(tag);
    }
  }
  const refs: ClientIslandRef[] = [];
  for (const match of source.matchAll(IMPORT_STMT_RE)) {
    const clause = match.groups?.clause?.trim();
    const spec = match.groups?.spec;
    if (clause === undefined || spec === undefined) {
      continue;
    }
    collectNamedImportRefs(clause, spec, used, refs);
    collectDefaultImportRef(clause, spec, used, refs);
  }
  return refs;
};

/** Extract the balanced-paren argument list starting at the "(" following
 * `from` index. String literals are skipped so parens inside them don't count.
 * Returns the inner text, or null when unbalanced within `limit` chars. */
const extractCallArgs = (
  source: string,
  openParen: number,
  limit = 4000
): string | null => {
  let depth = 0;
  let quote: string | null = null;
  for (
    let i = openParen;
    i < Math.min(source.length, openParen + limit);
    i += 1
  ) {
    const ch = source[i];
    if (ch === undefined) {
      break;
    }
    if (quote !== null) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openParen + 1, i);
      }
    }
  }
  console.warn(
    "[ilha-router] scanServerIslands: argument list exceeded the scan limit — call skipped."
  );
  return null;
};

const referencedExports = (
  body: string,
  candidates: Set<string>
): string | undefined => {
  // Only exported identifiers INVOKED as functions count as transports.
  for (const match of body.matchAll(CALL_IDENT_RE)) {
    const ident = match.groups?.ident;
    if (ident !== undefined && candidates.has(ident)) {
      return ident;
    }
  }
  return undefined;
};

const collectIslandWiring = (
  source: string,
  name: string,
  start: number,
  sliceEnd: number,
  candidates: Set<string>,
  islands: ScannedServerIsland[]
): void => {
  const slice = source.slice(start, sliceEnd);
  const as = "div";
  const streams: Record<string, string> = {};
  const actions: Record<string, string> = {};
  let actionOrder = 0;
  let streamOrder = 0;
  // Actions may be imported under an alias to avoid collisions (e.g.
  // `islandAction(...)`), so accept any identifier ending in "action".
  for (const match of slice.matchAll(/[A-Za-z0-9_$]*[Aa]ction\s*\(/gu)) {
    if (match.index === undefined) {
      continue;
    }
    const openParen = match.index + match[0].indexOf("(");
    const args = extractCallArgs(slice, openParen);
    if (!args) {
      continue;
    }
    // The full args ARE the callback body in the `action((payload) => ...)`
    // syntax. Scan invoked exports for the transport.
    const target = referencedExports(args, candidates);
    actions[`a${actionOrder}`] = target ?? "";
    actionOrder += 1;
  }
  for (const match of slice.matchAll(FROM_ASYNC_RE)) {
    const target = match.groups?.target;
    if (
      target !== undefined &&
      candidates.has(target) &&
      !Object.values(streams).includes(target)
    ) {
      streams[`d${streamOrder}`] = target;
      streamOrder += 1;
    }
  }
  islands.push({ actions, as, name, streams });
};

const collectModuleExports = (source: string): string[] => {
  const exports: string[] = [];
  for (const match of source.matchAll(EXPORT_RE)) {
    const name = match.groups?.name;
    if (name !== undefined) {
      exports.push(name);
    }
  }
  for (const match of source.matchAll(EXPORT_LIST_RE)) {
    const body = match.groups?.body;
    if (body === undefined) {
      continue;
    }
    for (const part of body.split(",")) {
      const parts2 = part.trim().split(/\s+as\s+/u);
      const [first, second] = parts2;
      const name = (parts2.length === 2 ? second : first)?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/u.test(name) && !exports.includes(name)) {
        exports.push(name);
      }
    }
  }
  return exports;
};

const collectRpcActions = (source: string) => {
  // SAFETY: keys are export names scanned from source; values are `x:<name>` ids.
  const rpcActions = {} as Record<string, string>;
  for (const match of source.matchAll(ACTION_EXPORT_RE)) {
    const name = match.groups?.name;
    if (name !== undefined) {
      rpcActions[name] = `x:${name}`;
    }
  }
  return rpcActions;
};

const collectNamedIslands = (
  source: string,
  candidates: Set<string>,
  islands: ScannedServerIsland[]
): void => {
  for (const match of source.matchAll(ISLAND_EXPORT_RE)) {
    const name = match.groups?.name;
    if (name === undefined || match.index === undefined) {
      continue;
    }
    const rest = source.slice(match.index + match[0].length);
    const nextExport = rest.search(/\nexport\b/u);
    collectIslandWiring(
      source,
      name,
      match.index,
      match.index +
        match[0].length +
        (nextExport === -1 ? rest.length : nextExport),
      candidates,
      islands
    );
  }
};

const collectDefaultIsland = (
  source: string,
  candidates: Set<string>,
  islands: ScannedServerIsland[]
): void => {
  const defaultMatch = source.match(DEFAULT_ISLAND_RE);
  if (!defaultMatch || defaultMatch.index === undefined) {
    return;
  }
  const rest = source.slice(defaultMatch.index + defaultMatch[0].length);
  const nextExport = rest.search(/\nexport\b/u);
  collectIslandWiring(
    source,
    "default",
    defaultMatch.index,
    defaultMatch.index +
      defaultMatch[0].length +
      (nextExport === -1 ? rest.length : nextExport),
    candidates,
    islands
  );
};

/** Scan a `*.server.ts(x)` module source for island exports and their
 * declarative wiring. Islands are `export const Name = [async] function[*]`
 * (and the `export default` form); stream/action transports are discovered
 * from calls inside each island body. */
export const scanServerIslands = (source: string): ServerModuleScan => {
  const exports = collectModuleExports(source);
  const candidates = new Set(exports);
  const rpcActions = collectRpcActions(source);
  const islands: ScannedServerIsland[] = [];
  collectNamedIslands(source, candidates, islands);
  collectDefaultIsland(source, candidates, islands);
  return {
    clientRefs: scanClientRefs(source),
    exports,
    islands,
    rpcActions,
  };
};

export const loadServerModuleScan = (filePath: string): ServerModuleScan =>
  scanServerIslands(readFileSync(filePath, "utf-8"));

/** Virtual-module id prefix for generated client proxies of server islands.
 * The file path rides base64url-encoded: a raw suffix like
 * `\0…:…/tasks.server.tsx` would end in `.server.*` and oxidejs's client-stub
 * loader would claim the virtual module before us. */
export const SERVER_ISLAND_PREFIX = "\0ilha:server-island:";

/** Virtual-module specifier serving the client proxy for one server island file. */
export const serverIslandVirtualSpec = (file: string): string =>
  SERVER_ISLAND_PREFIX + Buffer.from(file).toString("base64url");

/** Emit the client virtual module for one scanned server file. Plain JS —
 * `\0` virtual modules bypass Vite's built-in TS transform, so type-only
 * constructs here would reach the browser unparsed. Editor types are
 * unaffected: TS resolves the ORIGINAL specifier (the real server module);
 * this module exists only inside the client bundle. Frames are fetched from
 * the plugin's `/__ilha/frame` dev middleware. */
export const serverIslandPublicId = (spec: string, name: string): string =>
  createHash("sha256").update(`${spec}#${name}`).digest("base64url");

export const generateServerIslandModule = (
  spec: string,
  scan: ServerModuleScan
): string => {
  const rpcKey = serverModuleRpcKey(spec);
  const repaintKey = serverModuleRepaintKey(spec);
  const lines: string[] = [
    `import { client as $$rpc } from "virtual:oxide/client";`,
    `import { __ilhaApplyHead, __ilhaServerIsland } from "@ilha/router/server-island";`,
    `const $$call = (method, args) => { const opts = args.at(-1); return opts && typeof opts === "object" && opts.signal instanceof AbortSignal && Object.keys(opts).length === 1 ? $$rpc[${JSON.stringify(rpcKey)}][method](...args.slice(0, -1), opts) : $$rpc[${JSON.stringify(rpcKey)}][method](...args); };`,
    ...scan.clientRefs.map((ref, index) =>
      ref.imported === "default"
        ? `import $$child${index} from ${JSON.stringify(ref.spec)};`
        : `import { ${ref.imported} as $$child${index} } from ${JSON.stringify(ref.spec)};`
    ),
  ];

  for (const name of scan.exports) {
    if (!scan.islands.some((island) => island.name === name)) {
      lines.push(
        `export const ${name} = (...args) => $$call(${JSON.stringify(name)}, args);`
      );
    }
  }

  for (const island of scan.islands) {
    const wiring: string[] = [];
    const streams = Object.entries(island.streams).map(
      ([key, target]) =>
        `${JSON.stringify(key)}: (signal) => $$call(${JSON.stringify(target)}, [{ signal }])`
    );
    // Directly-referenced exported actions (x:<name>) share the island's
    // transports so event closures can call them without ilha action().
    const rpcEntries = Object.entries(scan.rpcActions).map(
      ([name, key]) =>
        // SAFETY: Object.entries of Record<string, string> yields string pairs.
        [key, name] as [string, string]
    );
    const actions = Object.entries({
      ...island.actions,
      ...Object.fromEntries(rpcEntries),
    }).map(
      ([key, target]) =>
        `${JSON.stringify(key)}: (...args) => $$call(${JSON.stringify(target)}, args)`
    );
    if (streams.length) {
      wiring.push(`streams: { ${streams.join(", ")} }`);
    }
    if (actions.length) {
      wiring.push(`actions: { ${actions.join(", ")} }`);
    }
    if (scan.clientRefs.length) {
      wiring.push(
        `children: { ${scan.clientRefs.map((ref, index) => `${JSON.stringify(ref.id)}: $$child${index}`).join(", ")} }`
      );
    }
    const id = serverIslandPublicId(spec, island.name);
    wiring.push(
      `frame: (props) => fetch("/__ilha/frame", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ${JSON.stringify(id)}, path: location.pathname + location.search, props }) }).then((r) => { if (!r.ok) throw new Error("frame failed"); return r.json(); }).then((j) => { if (j.redirect) { try { const u = new URL(j.redirect, location.href); if (u.origin === location.origin) location.assign(u.pathname + u.search + u.hash); } catch {} throw new Error("frame redirected"); } __ilhaApplyHead(j.head); return j.html; })`
    );

    const call = `__ilhaServerIsland(${JSON.stringify(id)}, ${JSON.stringify(island.as)}, { ${wiring.join(", ")} }, ${JSON.stringify(repaintKey)})`;
    if (island.name === "default") {
      lines.push(`export default ${call};`);
    } else {
      lines.push(`export const ${island.name} = ${call};`);
    }
  }

  return lines.join("\n");
};

/** Parse one import statement's clause into its bindings. */
interface ImportBinding {
  imported: string;
  local: string;
}

interface ParsedImportClause {
  defaultLocal?: string;
  namespace?: string;
  named: ImportBinding[];
}

const parseImportClause = (clause: string): ParsedImportClause => {
  const result: ParsedImportClause = {
    named: [],
  };
  let rest = clause.trim();

  const nsMatch = rest.match(/\*\s+as\s+(?<ns>[A-Za-z_$][\w$]*)/u);
  if (nsMatch) {
    const [full] = nsMatch;
    result.namespace = nsMatch.groups?.ns;
    rest = rest.replace(full, "").replaceAll(",", "").trim();
  }

  const braceStart = rest.indexOf("{");
  if (braceStart !== -1) {
    const before = rest.slice(0, braceStart).replaceAll(",", "").trim();
    if (before) {
      result.defaultLocal = before;
    }
    const inner = rest.slice(braceStart + 1, rest.lastIndexOf("}"));
    for (const item of inner.split(",")) {
      const trimmed = item.trim();
      if (!trimmed || trimmed.startsWith("type ")) {
        continue;
      }
      const asMatch = trimmed.match(NAMED_BINDING_RE);
      const imported = asMatch?.groups?.imported;
      if (imported !== undefined) {
        result.named.push({
          imported,
          local: asMatch?.groups?.local ?? imported,
        });
      }
    }
  } else if (rest && !result.namespace) {
    result.defaultLocal = rest.replaceAll(",", "").trim();
  }

  return result;
};

export interface SplitContext {
  /** Resolved absolute path of the imported specifier, when it's a scanned
   * server module carrying islands; null otherwise. */
  islandNamesFor: (
    spec: string
  ) => { islands: Set<string>; hasDefault: boolean } | null;
  /** Virtual module specifier that provides the island bindings. */
  virtualSpecFor: (spec: string) => string;
}

/**
 * Rewrite import sites whose specifier targets a server module containing
 * island exports. Island bindings move to the virtual proxy module; all other
 * bindings stay on the original specifier (oxidejs replaces them with tacho
 * stubs). Returns null when no statement needed rewriting.
 */
export const splitServerImports = (
  code: string,
  ctx: SplitContext
): string | null => {
  const IMPORT_RE =
    /(?<lead>^|\n)import\s+(?!type\b)(?<clause>[^'"\n]+?)\s*from\s*(?<quote>["'])(?<spec>[^"'\n]+)\k<quote>;?/gu;
  let changed = false;
  const out = code.replace(IMPORT_RE, (statement, ...args) => {
    // SAFETY: String.replace with a named-group regex puts groups on the last arg.
    const groups = args.at(-1) as
      | {
          lead?: string;
          clause?: string;
          quote?: string;
          spec?: string;
        }
      | undefined;
    const lead = groups?.lead ?? "";
    const clause = groups?.clause;
    const spec = groups?.spec;
    if (clause === undefined || spec === undefined) {
      return statement;
    }
    const info = ctx.islandNamesFor(spec);
    if (!info) {
      return statement;
    }

    const parsed = parseImportClause(clause);
    const routed: ImportBinding[] = [];
    const kept: ImportBinding[] = [];
    for (const binding of parsed.named) {
      routed.push(binding);
    }
    const routeDefault = parsed.defaultLocal !== undefined && info.hasDefault;
    if (routed.length === 0 && !routeDefault) {
      return statement;
    }
    changed = true;

    const parts: string[] = [];
    const keptBits: string[] = [];
    if (!routeDefault && parsed.defaultLocal) {
      keptBits.push(parsed.defaultLocal);
    }
    if (kept.length) {
      keptBits.push(
        `{ ${kept.map((b) => (b.local === b.imported ? b.imported : `${b.imported} as ${b.local}`)).join(", ")} }`
      );
    }
    if (keptBits.length) {
      parts.push(`import ${keptBits.join(", ")} from ${JSON.stringify(spec)};`);
    }
    if (parsed.namespace) {
      parts.push(
        `import * as ${parsed.namespace} from ${JSON.stringify(spec)};`
      );
    }

    const routedBits: string[] = [];
    if (routeDefault && parsed.defaultLocal !== undefined) {
      routedBits.push(parsed.defaultLocal);
    }
    if (routed.length) {
      routedBits.push(
        `{ ${routed.map((b) => (b.local === b.imported ? b.imported : `${b.imported} as ${b.local}`)).join(", ")} }`
      );
    }
    parts.push(
      `import ${routedBits.join(", ")} from ${JSON.stringify(ctx.virtualSpecFor(spec))};`
    );

    return lead + parts.join("\n");
  });

  return changed ? out : null;
};
