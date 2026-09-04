import { existsSync, readFileSync, statSync, watch } from "node:fs";
import path from "node:path";

import * as Result from "effect/Result";
import { createUnplugin } from "unplugin";
import type { UnpluginFactory } from "unplugin";
import type { ViteDevServer } from "vite";

import { generate, resolveGeneratedPaths } from "./codegen";
import type { PagesMode } from "./codegen";
import { runWithIslandRequest } from "./request-scope";
import {
  generateServerIslandModule,
  rewriteServerActions,
  loadServerModuleScan,
  SERVER_ISLAND_PREFIX,
  serverIslandPublicId,
  serverIslandVirtualSpec,
  splitServerImports,
} from "./server-islands";
import type { ServerModuleScan } from "./server-islands";
import {
  authorizeFrameRequest,
  frameEnvelope,
  FrameError,
  getFrameGuard,
  isSafeFramePath,
  parseFrameProps,
  renderServerIslandResult,
  frameScopedUrl,
  setFrameAuth,
  setFrameGuard,
} from "./ssr";

const objectTag = <T>(value: T): string =>
  Object.prototype.toString.call(value);

const isString = <T>(value: T): value is Extract<T, string> =>
  objectTag(value) === "[object String]";

const isNumber = <T>(value: T): value is Extract<T, number> =>
  objectTag(value) === "[object Number]";

const hostnameFromHost = (host: boolean | string | undefined): string => {
  if (host === true || host === undefined || host === "") {
    return "localhost";
  }
  if (host === false) {
    return "localhost";
  }
  return String(host);
};

const portFromConfig = (port: number | string | undefined): number => {
  if (isNumber(port)) {
    return port;
  }
  if (port) {
    return Number(port);
  }
  return 5173;
};

const devServerOrigin = (server: ViteDevServer): string => {
  const configured = server.config.server.origin;
  if (configured) {
    const value = isString(configured) ? configured : String(configured);
    return new URL(value).origin;
  }
  const local = server.resolvedUrls?.local?.[0];
  if (local) {
    return new URL(local).origin;
  }
  const { host, port, https } = server.config.server;
  const hostname = hostnameFromHost(host);
  const protocol = https ? "https" : "http";
  const numericPort = portFromConfig(port);
  return `${protocol}://${hostname}:${numericPort}`;
};

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

const decodeServerIslandId = (id: string): string | null => {
  if (!id.startsWith(SERVER_ISLAND_PREFIX)) {
    return null;
  }
  try {
    return Buffer.from(
      id.slice(SERVER_ISLAND_PREFIX.length),
      "base64url"
    ).toString();
  } catch {
    return null;
  }
};

const SERVER_FILE_RE = /\.server\.(?:ts|tsx|js|jsx)$/u;
/** Cheap prefilter — most modules never mention a server import. Extension
 * optional: aliases like `$lib/tasks.server` resolve to `.server.tsx` later. */
const SERVER_SPEC_HINT_RE = /["'][^"']*\.server(?:\.[cm]?[jt]sx?)?["']/u;

/** mtime-keyed scan cache so repeated transforms don't re-read/re-parse. */
const scanCache = new Map<
  string,
  { mtimeMs: number; scan: ServerModuleScan }
>();

const scanFor = (filePath: string): ServerModuleScan | null => {
  try {
    const { mtimeMs } = statSync(filePath);
    const cached = scanCache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.scan;
    }
    const scan = loadServerModuleScan(filePath);
    if (scan.islands.length === 0) {
      return null;
    }
    scanCache.set(filePath, { mtimeMs, scan });
    return scan;
  } catch {
    return null;
  }
};

interface PackageJsonFields {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Read & parse a package.json, returning null on any error. */
const readJson = (filePath: string): PackageJsonFields | null => {
  try {
    // SAFETY: package.json is trusted build-time input; we only read known
    // dependency maps from the parsed object.
    return JSON.parse(readFileSync(filePath, "utf-8")) as PackageJsonFields;
  } catch {
    return null;
  }
};

/** Resolve a dependency's package.json by walking up node_modules from `root`. */
const readDepPackageJson = (
  root: string,
  name: string
): PackageJsonFields | null => {
  let dir = root;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) {
      return readJson(candidate);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
};

/**
 * Find app dependencies that bridge ilha primitives — i.e. declare `ilha` as a
 * peer or dependency (e.g. a UI library like `areia`). They render islands with
 * `bind:*`/slot directives, so they MUST share the app's single ilha instance.
 * Returned here so the plugin can give them the same `dedupe` + `ssr.noExternal`
 * treatment as the framework singletons; otherwise SSR externalizes them with
 * their own ilha copy (a second renderCtxStack) and hydration silently breaks.
 * Keeps app vite configs minimal — no manual `noExternal: ["areia"]` needed.
 */
const detectIlhaConsumers = (root: string): string[] => {
  const appPkg = readJson(path.join(root, "package.json"));
  if (!appPkg) {
    return [];
  }
  const deps = {
    ...appPkg.dependencies,
    ...appPkg.devDependencies,
  };
  const found: string[] = [];
  for (const name of Object.keys(deps)) {
    if (name === "ilha") {
      continue;
    }
    const pkg = readDepPackageJson(root, name);
    if (!pkg) {
      continue;
    }
    const peers = pkg.peerDependencies ?? {};
    const directDeps = pkg.dependencies ?? {};
    if ("ilha" in peers || "ilha" in directDeps) {
      found.push(name);
    }
  }
  return found;
};

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
   * Guard consulted on every `/__ilha/frame` request before a render runs.
   * Return a `Response` to reject; return nothing to allow. Island state is
   * world-readable through frames unless gated — install a session check here
   * when islands serve private data. Production equivalents register via
   * `setFrameGuard()` from `@ilha/router/ssr`.
   */
  frameGuard?: (
    request: Request
  ) => Response | undefined | Promise<Response | undefined>;
  /**
   * Explicit trusted origins for frame/loader requests (e.g. a `.vercel.app`
   * or custom domain). When unset, origin checks compare the `Origin` header
   * against the request's own `Host`. Mirrors `setFrameAuth({ trustedOrigins })`.
   */
  trustedOrigins?: string[];
  /**
   * Optional CSRF verifier for the state-changing `/__ilha/frame` POST.
   * Mirrors `setFrameAuth({ csrf })`.
   */
  csrf?: (request: Request) => boolean | Promise<boolean>;
  /**
   * Fail codegen on duplicate route patterns / registry name collisions
   * instead of warning. Recommended for CI/production builds. Default: `false`.
   */
  strict?: boolean;
}

export const resolvePluginPaths = (root: string, options: IlhaPagesOptions) => {
  const pagesDir = path.resolve(root, options.dir ?? "src/pages");
  const outDir = path.resolve(root, options.outDir ?? ".ilha");
  const { serverFile, clientFile } = resolveGeneratedPaths(outDir);
  return { clientFile, outDir, pagesDir, serverFile };
};

export interface PagesPluginState {
  pagesDir: string;
  outDir: string;
  serverFile: string;
  clientFile: string;
  setPaths: (root: string) => void;
  regen: () => Promise<void>;
  shouldRegenOnChange: (file: string) => boolean;
  isUnderPagesDir: (file: string) => boolean;
}

export const createPagesPluginState = (
  options: IlhaPagesOptions
): PagesPluginState => {
  let pagesDir = "";
  let outDir = "";
  let serverFile = "";
  let clientFile = "";

  const setPaths = (root: string) => {
    ({ pagesDir, outDir, serverFile, clientFile } = resolvePluginPaths(
      root,
      options
    ));
  };

  const regen = async () => {
    try {
      await generate(pagesDir, outDir, {
        interceptLinks: options.interceptLinks,
        mode: options.mode,
        strict: options.strict,
      });
    } catch (error) {
      console.error("[ilha:pages] codegen failed:", error);
      if (options.strict) {
        throw error;
      }
    }
  };

  const isUnderPagesDir = (file: string) =>
    file === pagesDir || file.startsWith(pagesDir + path.sep);

  const shouldRegenOnChange = (file: string) => {
    if (!isUnderPagesDir(file)) {
      return false;
    }
    const base = path.basename(file);
    return base.startsWith("+") || /\.(?:ts|tsx)$/u.test(base);
  };

  return {
    get clientFile() {
      return clientFile;
    },
    isUnderPagesDir,
    get outDir() {
      return outDir;
    },
    get pagesDir() {
      return pagesDir;
    },
    regen,
    get serverFile() {
      return serverFile;
    },
    setPaths,
    shouldRegenOnChange,
  };
};

export const regenFromPagesChange = async (
  state: PagesPluginState,
  file: string,
  shouldRegen: (file: string) => boolean
) => {
  if (!shouldRegen(file)) {
    return;
  }
  await state.regen();
};

export const resolvePagesId = (
  state: PagesPluginState,
  id: string,
  importer?: string
) => {
  if (id === VIRTUAL_PAGES_SERVER) {
    return RESOLVED_PAGES_SERVER;
  }
  if (id === VIRTUAL_PAGES_CLIENT) {
    return RESOLVED_PAGES_CLIENT;
  }
  if (id === VIRTUAL_LOADERS) {
    return RESOLVED_LOADERS;
  }

  for (const query of [CLIENT_QUERY]) {
    if (!id.endsWith(query)) {
      continue;
    }
    const bare = id.slice(0, -query.length);
    const resolved = importer
      ? path.resolve(importer.replace(/\?.*$/u, ""), "..", bare)
      : path.resolve(bare);
    // Only page-dir modules may be re-exported through the shim — without
    // this check any absolute path could be pulled into the module graph via
    // a crafted `…?client` / `…?client-loader` import.
    // Fail closed when pagesDir isn't configured yet — containment can't be
    // checked, so nothing may pass through the shim.
    if (!state.pagesDir || !state.isUnderPagesDir(resolved)) {
      return;
    }
    return resolved + query;
  }
};

export const loadPagesModule = (state: PagesPluginState, id: string) => {
  if (id === RESOLVED_PAGES_SERVER) {
    const spec = state.serverFile.replace(/\.tsx?$/u, "");
    return `export { pageRouter, registry } from ${JSON.stringify(spec)};`;
  }
  if (id === RESOLVED_PAGES_CLIENT) {
    const spec = state.clientFile.replace(/\.tsx?$/u, "");
    return `export { pageRouter, registry } from ${JSON.stringify(spec)};`;
  }
  if (id === RESOLVED_LOADERS) {
    return `// @generated by @ilha/router — do not edit\nexport {};\n`;
  }
  if (id.endsWith(CLIENT_QUERY)) {
    const bare = id.slice(0, -CLIENT_QUERY.length);
    return `export { default } from ${JSON.stringify(bare)};`;
  }
};

type InvalidateModules = () => Promise<void>;

export const createStructuralInvalidate =
  (state: PagesPluginState, invalidate: InvalidateModules) =>
  async (file: string) => {
    if (!state.isUnderPagesDir(file)) {
      return;
    }
    await state.regen();
    await invalidate();
  };

interface RspackWatchingCompiler {
  invalidate: () => void;
}

export const setupRspackPagesWatcher = (
  state: PagesPluginState,
  structuralInvalidate: (file: string) => Promise<void>
) => {
  let watcher: ReturnType<typeof watch> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const attach = () => {
    watcher = watch(state.pagesDir, { recursive: true }, (_event, filename) => {
      if (!filename) {
        return;
      }
      const changed = path.join(state.pagesDir, filename);
      void structuralInvalidate(changed);
    });
  };

  // fs.watch throws ENOENT when the pages dir doesn't exist yet — poll until
  // it appears, then attach, so watching recovers if the dir is created later.
  if (existsSync(state.pagesDir)) {
    attach();
  } else {
    poll = setInterval(() => {
      if (closed || !existsSync(state.pagesDir)) {
        return;
      }
      if (poll !== null) {
        clearInterval(poll);
      }
      poll = null;
      attach();
      // The dir appeared after startup — regenerate for its current contents.
      void structuralInvalidate(path.join(state.pagesDir, "."));
    }, 1000);
    poll.unref?.();
  }

  return () => {
    closed = true;
    if (poll) {
      clearInterval(poll);
    }
    watcher?.close();
  };
};

const normalizeNoExternal = (
  existingNoExternal: true | string | RegExp | (string | RegExp)[] | undefined,
  singletonPeers: string[]
): true | (string | RegExp)[] => {
  if (existingNoExternal === true) {
    return true;
  }
  let existing: (string | RegExp)[];
  if (Array.isArray(existingNoExternal)) {
    existing = existingNoExternal;
  } else if (existingNoExternal === undefined || existingNoExternal === null) {
    existing = [];
  } else {
    existing = [existingNoExternal];
  }
  return [...new Set([...existing, ...singletonPeers])];
};

interface FrameBody {
  id?: string;
  path?: string;
  props?: SnapshotPropsValue;
}

type SnapshotPropsValue =
  | string
  | number
  | boolean
  | null
  | SnapshotPropsValue[]
  | { readonly [key: string]: SnapshotPropsValue | undefined };

interface IncomingMessageLike {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  [Symbol.asyncIterator]: () => AsyncIterator<Buffer | string>;
}

interface ServerResponseLike {
  statusCode: number;
  setHeader: (k: string, v: string) => void;
  end: (body?: string) => void;
}

const writeFrameEnvelope = (
  res: ServerResponseLike,
  env: { status: number; headers: Record<string, string>; body: string }
): void => {
  res.statusCode = env.status;
  for (const [k, v] of Object.entries(env.headers)) {
    res.setHeader(k, v);
  }
  res.end(env.body);
};

const readFrameBody = async (
  req: IncomingMessageLike,
  res: ServerResponseLike
): Promise<Buffer | null> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    // SAFETY: Node IncomingMessage yields Buffer | string chunks.
    const buf = isString(chunk) ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > 16 * 1024) {
      res.statusCode = 413;
      res.end();
      return null;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
};

const rejectNonFrame = (
  req: IncomingMessageLike,
  res: ServerResponseLike,
  next: (err?: Error) => void
): boolean => {
  if ((req.url ?? "").split("?")[0] !== "/__ilha/frame") {
    next();
    return true;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end();
    return true;
  }
  const contentTypeHeader = req.headers["content-type"];
  const contentType = Array.isArray(contentTypeHeader)
    ? (contentTypeHeader[0] ?? "")
    : (contentTypeHeader ?? "");
  if (!contentType.startsWith("application/json")) {
    res.statusCode = 415;
    res.end();
    return true;
  }
  return false;
};

const renderAuthorizedFrame = async (
  req: IncomingMessageLike,
  res: ServerResponseLike,
  ctx: {
    server: ViteDevServer;
    serverIslands: Map<string, { file: string; name: string }>;
  },
  raw: Buffer,
  serverOrigin: string,
  identityHeaders: Headers
): Promise<void> => {
  // SAFETY: frame POST body is JSON; fields are validated below / by helpers.
  const body = JSON.parse(raw.toString("utf-8")) as FrameBody;
  const incomingProps = parseFrameProps(body.props);
  const target = ctx.serverIslands.get(body.id ?? "");
  if (!target) {
    throw new Error("unknown island");
  }
  let framePath = "/";
  if (isString(body.path)) {
    if (!isSafeFramePath(body.path)) {
      writeFrameEnvelope(res, frameEnvelope(400, { error: "frame failed" }));
      return;
    }
    framePath = body.path;
  }
  await ctx.server.ssrLoadModule(VIRTUAL_PAGES_SERVER);
  await ctx.server.ssrLoadModule(target.file);
  const request = new Request(
    frameScopedUrl(req.url ?? "/", framePath, serverOrigin),
    {
      headers: identityHeaders,
      method: "POST",
    }
  );
  const result = await renderServerIslandResult(
    body.id ?? "",
    request,
    (r, fn) => runWithIslandRequest(r, fn),
    incomingProps
  );
  if (Result.isFailure(result)) {
    const err = result.failure;
    if (err.redirect) {
      writeFrameEnvelope(
        res,
        frameEnvelope(err.status, { redirect: err.redirect })
      );
      return;
    }
    const { status } = err;
    if (status >= 500) {
      console.error("[ilha-router] frame render failed:", err);
    }
    writeFrameEnvelope(res, frameEnvelope(status, { error: "frame failed" }));
    return;
  }
  writeFrameEnvelope(res, frameEnvelope(200, { html: result.success }));
};

const handleDevFrame = async (
  req: IncomingMessageLike,
  res: ServerResponseLike,
  next: (err?: Error) => void,
  ctx: {
    server: ViteDevServer;
    serverIslands: Map<string, { file: string; name: string }>;
  }
): Promise<void> => {
  if (rejectNonFrame(req, res, next)) {
    return;
  }
  const serverOrigin = devServerOrigin(ctx.server);
  const frameUrl = `${serverOrigin}${req.url ?? "/"}`;
  // SAFETY: Node IncomingMessage headers are string | string[]; Headers accepts
  // the Record form used by the fetch Request constructor here.
  const authorized = await authorizeFrameRequest(
    new Request(frameUrl, {
      headers: new Headers(req.headers as Record<string, string>),
      method: req.method,
    }),
    {
      defaultAction: "open",
      onGuardError: () => {
        void 0;
      },
    }
  );
  if (!authorized.ok) {
    if (authorized.status === 403 && !getFrameGuard()) {
      console.warn(
        `[ilha-router] dev frame request rejected: Origin ${String(req.headers.origin)} is not trusted (host: ${String(req.headers.host ?? "localhost")}). Configure trustedOrigins via IlhaPagesOptions if this origin is expected.`
      );
    }
    res.statusCode = authorized.status;
    res.end();
    return;
  }
  const raw = await readFrameBody(req, res);
  if (raw === null) {
    return;
  }
  try {
    await renderAuthorizedFrame(
      req,
      res,
      ctx,
      raw,
      serverOrigin,
      authorized.identityHeaders
    );
  } catch (error) {
    if (error instanceof FrameError && error.redirect) {
      writeFrameEnvelope(
        res,
        frameEnvelope(error.status, { redirect: error.redirect })
      );
      return;
    }
    const status = error instanceof FrameError ? error.status : 400;
    if (!(error instanceof FrameError) || error.status >= 500) {
      console.error("[ilha-router] frame render failed:", error);
    }
    writeFrameEnvelope(res, frameEnvelope(status, { error: "frame failed" }));
  }
};

interface ModuleGraphWithForEach {
  forEachModule?: (fn: (mod: { id: string }) => void) => void;
}

interface ResolveResult {
  id?: string;
  path?: string;
}

const transformSsrServerFile = (code: string, file: string): string | null => {
  // Earlier JSX transforms may already have erased `<Checkbox>` tags.
  // Always scan the source file, not the transformed hook input.
  const scan = scanFor(file);
  const lines: string[] = [];
  // Stamp client refs so hydration can find the client-side children.
  for (const ref of scan?.clientRefs ?? []) {
    lines.push(
      `if (${ref.local}?.[Symbol.for("ilha.island")]) ${ref.local}[Symbol.for("ilha.clientRef")] = ${JSON.stringify(ref.id)};`
    );
  }
  // Self-register island renderers for the production frame endpoint
  // (the `@ilha/router/ssr` handler). The self-import is a live binding —
  // bundlers dedupe it to the same module — so this also covers
  // default-export islands. Skipped for client stubs (browser graph).
  if (
    scan &&
    scan.islands.length > 0 &&
    !code.startsWith("// oxidejs:client-stub")
  ) {
    if (Object.keys(scan.rpcActions).length > 0) {
      lines.unshift(`import { __ilhaServerAction } from "@ilha/router/ssr";`);
    }
    lines.unshift(
      `import { registerServerIsland } from "@ilha/router/ssr";`,
      `import * as __ilhaSelf from ${JSON.stringify(file)};`
    );
    for (const island of scan.islands) {
      lines.push(
        `registerServerIsland(${JSON.stringify(serverIslandPublicId(file, island.name))}, () => __ilhaSelf[${JSON.stringify(island.name)}]);`
      );
    }
  }
  const base = rewriteServerActions(code, scan?.rpcActions ?? {});
  if (base === code && lines.length === 0) {
    return null;
  }
  if (lines.length === 0) {
    return base;
  }
  return `${base}\n${lines.join("\n")}`;
};

const transformClientServerImports = async (
  code: string,
  id: string,
  resolve: (
    spec: string,
    importer: string
  ) => Promise<ResolveResult | null | undefined>
): Promise<string | null> => {
  const SPEC_RE =
    /(?:^|\n)\s*import\s+(?:type\s+)?[^'"\n]+?\s*from\s*["'](?<spec>[^"']+)["']/gu;
  const specs = new Set<string>();
  for (const match of code.matchAll(SPEC_RE)) {
    const spec = match.groups?.spec;
    if (spec !== undefined) {
      specs.add(spec);
    }
  }
  if (specs.size === 0) {
    return null;
  }

  const scanned = new Map<
    string,
    { resolvedFile: string; islands: Set<string>; hasDefault: boolean }
  >();

  const resolvedEntries = await Promise.all(
    [...specs].map(async (spec) => {
      let resolvedFile: string | undefined;
      try {
        const resolved = await resolve(spec, id);
        // SAFETY: unplugin resolve returns { id } and optionally { path }.
        resolvedFile = resolved?.path ?? resolved?.id;
      } catch {
        resolvedFile = undefined;
      }
      if (!resolvedFile && spec.startsWith("/")) {
        resolvedFile = spec;
      }
      return { resolvedFile, spec };
    })
  );

  for (const { spec, resolvedFile } of resolvedEntries) {
    if (
      !resolvedFile ||
      !SERVER_FILE_RE.test(resolvedFile.replace(/\?.*$/u, ""))
    ) {
      continue;
    }
    const scan = scanFor(resolvedFile);
    if (!scan) {
      continue;
    }
    scanned.set(spec, {
      hasDefault: scan.islands.some((i) => i.name === "default"),
      islands: new Set(
        scan.islands.filter((i) => i.name !== "default").map((i) => i.name)
      ),
      resolvedFile,
    });
  }
  if (scanned.size === 0) {
    return null;
  }

  return splitServerImports(code, {
    islandNamesFor: (spec) => {
      const entry = scanned.get(spec);
      return entry
        ? { hasDefault: entry.hasDefault, islands: entry.islands }
        : null;
    },
    virtualSpecFor: (spec) => {
      const entry = scanned.get(spec);
      if (entry === undefined) {
        return serverIslandVirtualSpec(spec);
      }
      return serverIslandVirtualSpec(entry.resolvedFile);
    },
  });
};

const pagesFactory: UnpluginFactory<IlhaPagesOptions | undefined> = (
  options = {}
) => {
  const state = createPagesPluginState(options);
  const serverIslands = new Map<string, { file: string; name: string }>();

  return {
    async buildStart() {
      if (!state.pagesDir) {
        state.setPaths(process.cwd());
      }
      this.addWatchFile?.(state.pagesDir);
      await state.regen();
    },

    load(id) {
      const islandFile = decodeServerIslandId(id);
      if (islandFile !== null) {
        const scan = loadServerModuleScan(islandFile);
        for (const island of scan.islands) {
          serverIslands.set(serverIslandPublicId(islandFile, island.name), {
            file: islandFile,
            name: island.name,
          });
        }
        return generateServerIslandModule(islandFile, scan);
      }
      return loadPagesModule(state, id);
    },

    name: "ilha:pages",

    resolveId(id, importer) {
      if (id.startsWith(SERVER_ISLAND_PREFIX)) {
        return id;
      }
      return resolvePagesId(state, id, importer);
    },

    rspack(compiler) {
      state.setPaths(compiler.options.context ?? process.cwd());

      const structuralInvalidate = createStructuralInvalidate(state, () => {
        if (!compiler.watching) {
          return Promise.resolve();
        }
        // SAFETY: compiler implements watching via hooks in rspack; the
        // invalidate call is a no-op guard when watching is not active.
        const watching = compiler as RspackWatchingCompiler;
        watching.invalidate();
        return Promise.resolve();
      });

      let closeWatcher: (() => void) | undefined;
      compiler.hooks.watchRun.tap("ilha:pages", () => {
        closeWatcher?.();
        closeWatcher = setupRspackPagesWatcher(state, structuralInvalidate);
      });
      compiler.hooks.shutdown.tap("ilha:pages", () => closeWatcher?.());
    },

    vite: {
      config(userConfig) {
        const root = userConfig.root
          ? path.resolve(userConfig.root)
          : process.cwd();
        const singletonPeers = [
          "ilha",
          "@ilha/router",
          // Auto-detected app deps that bridge ilha (e.g. a UI lib) — they must
          // share the single ilha instance, so the app never has to hand-write
          // `ssr.noExternal`/`resolve.dedupe` for its UI lib.
          ...detectIlhaConsumers(root),
        ];
        // For SSR, externalized deps are loaded via the runtime's own resolver,
        // so a dep that imports `ilha` as a peer (e.g. a UI lib) ends up with a
        // *separate* ilha instance from the Vite-processed app code. Two ilha
        // instances break hydration. Bundling the ilha singletons into the SSR
        // graph keeps a single instance.
        const noExternal = normalizeNoExternal(
          userConfig.ssr?.noExternal,
          singletonPeers
        );
        // Server pages self-register their `load` + pattern from their own
        // module graph copy, so no extra build input is needed here.
        return {
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
              ]),
            ],
          },
          resolve: {
            dedupe: [
              ...new Set([
                ...(userConfig.resolve?.dedupe ?? []),
                ...singletonPeers,
              ]),
            ],
          },
          ssr: { noExternal },
        };
      },

      configResolved(config) {
        state.setPaths(config.root);
      },

      configureServer(server) {
        server.watcher.add(state.pagesDir);
        if (options.frameGuard) {
          setFrameGuard(options.frameGuard);
        }
        setFrameAuth({
          csrf: options.csrf,
          // Dev stays permissive when no guard is registered; only a
          // registered guard or the present csrf/trusted-origin checks gate.
          defaultAction: "open",
          trustedOrigins: options.trustedOrigins,
        });

        // Server-island frame endpoint: re-renders a proxy island from a
        // state snapshot. Reads through the module graph on every call, so
        // edits to .server files apply without restart. Production serves
        // the same contract via the `@ilha/router/ssr` handler.
        server.middlewares.use((req, res, next) => {
          const run = async () => {
            try {
              // SAFETY: Vite connects IncomingMessage matches our frame handler surface.
              const message = req as IncomingMessageLike;
              // SAFETY: Vite ServerResponse matches our frame handler surface.
              const response = res as ServerResponseLike;
              await handleDevFrame(message, response, next, {
                server,
                serverIslands,
              });
            } catch (error) {
              // SAFETY: connect next() accepts Error | undefined.
              return next(
                error instanceof Error ? error : new Error(String(error))
              );
            }
          };
          void run();
        });

        const structuralInvalidate = createStructuralInvalidate(state, () => {
          for (const resolvedId of RESOLVED_VIRTUAL_IDS) {
            const mod = server.moduleGraph.getModuleById(resolvedId);
            if (mod) {
              server.moduleGraph.invalidateModule(mod);
            }
          }
          server.hot.send({ type: "full-reload" });
          return Promise.resolve();
        });

        server.watcher.on("add", structuralInvalidate);
        server.watcher.on("addDir", structuralInvalidate);
        server.watcher.on("unlink", structuralInvalidate);

        server.watcher.on("change", async (changedFile: string) => {
          if (state.shouldRegenOnChange(changedFile)) {
            await structuralInvalidate(changedFile);
          }
          // Server-module edits change island wiring — drop the scan cache,
          // invalidate every proxy virtual module, and reload.
          if (!SERVER_FILE_RE.test(changedFile.replace(/\?.*$/u, ""))) {
            return;
          }
          scanCache.delete(changedFile);
          // SAFETY: Vite's ModuleGraph carries forEachModule; the cast only
          // exposes the iterator used to invalidate stale server-island proxies.
          const graph = server.moduleGraph as ModuleGraphWithForEach;
          let touched = false;
          graph.forEachModule?.((mod) => {
            if (mod.id.startsWith(SERVER_ISLAND_PREFIX)) {
              const m = server.moduleGraph.getModuleById(mod.id);
              if (m) {
                server.moduleGraph.invalidateModule(m);
                touched = true;
              }
            }
          });
          if (touched) {
            server.hot.send({ type: "full-reload" });
          }
        });
      },

      transform(code, id, opts) {
        const file = id.replace(/\?.*$/u, "");
        const isServerFile = SERVER_FILE_RE.test(file);
        // SAFETY: Vite transform opts may carry an `ssr` flag.
        const isSsr = (opts as { ssr?: boolean } | undefined)?.ssr === true;
        if (isSsr) {
          if (!isServerFile) {
            return null;
          }
          return transformSsrServerFile(code, file);
        }
        if (id.startsWith("\0") || id.includes("node_modules")) {
          return null;
        }
        if (isServerFile) {
          return null;
        }
        if (!SERVER_SPEC_HINT_RE.test(code)) {
          return null;
        }

        return transformClientServerImports(code, id, (spec, importer) =>
          Promise.resolve(this.resolve?.(spec, importer))
        );
      },
    },

    async watchChange(file) {
      await regenFromPagesChange(state, file, (f) =>
        state.shouldRegenOnChange(f)
      );
    },
  };
};

export const ilhaPages = createUnplugin(pagesFactory);
