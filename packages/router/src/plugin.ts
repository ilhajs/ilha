import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

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

function devServerOrigin(server: ViteDevServer): string {
  const configured = server.config.server.origin;
  if (configured) {
    const value = typeof configured === "string" ? configured : String(configured);
    return new URL(value).origin;
  }
  const local = server.resolvedUrls?.local?.[0];
  if (local) return new URL(local).origin;
  const { host, port, https } = server.config.server;
  const hostname =
    host === true || host === undefined || host === ""
      ? "localhost"
      : host === false
        ? "localhost"
        : String(host);
  const protocol = https ? "https" : "http";
  const numericPort = typeof port === "number" ? port : port ? Number(port) : 5173;
  return `${protocol}://${hostname}:${numericPort}`;
}

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

function decodeServerIslandId(id: string): string | null {
  if (!id.startsWith(SERVER_ISLAND_PREFIX)) return null;
  try {
    return Buffer.from(id.slice(SERVER_ISLAND_PREFIX.length), "base64url").toString();
  } catch {
    return null;
  }
}

const SERVER_FILE_RE = /\.server\.(ts|tsx|js|jsx)$/;
/** Cheap prefilter — most modules never mention a server import. Extension
 * optional: aliases like `$lib/tasks.server` resolve to `.server.tsx` later. */
const SERVER_SPEC_HINT_RE = /["'][^"']*\.server(\.[cm]?[jt]sx?)?["']/;

/** mtime-keyed scan cache so repeated transforms don't re-read/re-parse. */
const scanCache = new Map<string, { mtimeMs: number; scan: ServerModuleScan }>();

function scanFor(path: string): ServerModuleScan | null {
  try {
    const mtimeMs = statSync(path).mtimeMs;
    const cached = scanCache.get(path);
    if (cached && cached.mtimeMs === mtimeMs) return cached.scan;
    const scan = loadServerModuleScan(path);
    if (scan.islands.length === 0) return null;
    scanCache.set(path, { mtimeMs, scan });
    return scan;
  } catch {
    return null;
  }
}

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
    ...(appPkg.dependencies as Record<string, string>),
    ...(appPkg.devDependencies as Record<string, string>),
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
   * Guard consulted on every `/__ilha/frame` request before a render runs.
   * Return a `Response` to reject; return nothing to allow. Island state is
   * world-readable through frames unless gated — install a session check here
   * when islands serve private data. Production equivalents register via
   * `setFrameGuard()` from `@ilha/router/ssr`.
   */
  frameGuard?: (request: Request) => Response | void | Promise<Response | void>;
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

export function resolvePluginPaths(root: string, options: IlhaPagesOptions) {
  const pagesDir = resolve(root, options.dir ?? "src/pages");
  const outDir = resolve(root, options.outDir ?? ".ilha");
  const { serverFile, clientFile } = resolveGeneratedPaths(outDir);
  return { pagesDir, outDir, serverFile, clientFile };
}

export interface PagesPluginState {
  pagesDir: string;
  outDir: string;
  serverFile: string;
  clientFile: string;
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

  const setPaths = (root: string) => {
    ({ pagesDir, outDir, serverFile, clientFile } = resolvePluginPaths(root, options));
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

  for (const query of [CLIENT_QUERY]) {
    if (!id.endsWith(query)) continue;
    const bare = id.slice(0, -query.length);
    const resolved = importer ? resolve(importer.replace(/\?.*$/, ""), "..", bare) : resolve(bare);
    // Only page-dir modules may be re-exported through the shim — without
    // this check any absolute path could be pulled into the module graph via
    // a crafted `…?client` / `…?client-loader` import.
    // Fail closed when pagesDir isn't configured yet — containment can't be
    // checked, so nothing may pass through the shim.
    if (!state.pagesDir || !state.isUnderPagesDir(resolved)) return;
    return resolved + query;
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
    return `// @generated by @ilha/router — do not edit\nexport {};\n`;
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
  const serverIslands = new Map<string, { file: string; name: string }>();

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
      if (id.startsWith(SERVER_ISLAND_PREFIX)) return id;
      return resolvePagesId(state, id, importer);
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

    vite: {
      config(userConfig) {
        const root = userConfig.root ? resolve(userConfig.root) : process.cwd();
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
        const existingNoExternal = userConfig.ssr?.noExternal;
        const noExternal =
          existingNoExternal === true
            ? true
            : [
                ...new Set([
                  ...(Array.isArray(existingNoExternal)
                    ? existingNoExternal
                    : existingNoExternal == null
                      ? []
                      : [existingNoExternal]),
                  ...singletonPeers,
                ]),
              ];
        // Server pages self-register their `load` + pattern from their own
        // module graph copy, so no extra build input is needed here.
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
              ]),
            ],
          },
        };
      },

      configResolved(config) {
        state.setPaths(config.root);
      },

      async transform(code, id, opts) {
        const file = id.replace(/\?.*$/, "");
        const serverFile = SERVER_FILE_RE.test(file);
        if ((opts as { ssr?: boolean } | undefined)?.ssr) {
          if (!serverFile) return null;
          // Earlier JSX transforms may already have erased `<Checkbox>` tags.
          // Always scan the source file, not the transformed hook input.
          const scan = scanFor(file);
          const lines: string[] = [];
          // Stamp client refs so hydration can find the client-side children.
          for (const ref of scan?.clientRefs ?? []) {
            lines.push(
              `if (${ref.local}?.[Symbol.for("ilha.island")]) ${ref.local}[Symbol.for("ilha.clientRef")] = ${JSON.stringify(ref.id)};`,
            );
          }
          // Self-register island renderers for the production frame endpoint
          // (the `@ilha/router/ssr` handler). The self-import is a live binding —
          // bundlers dedupe it to the same module — so this also covers
          // default-export islands. Skipped for client stubs (browser graph).
          if (scan && scan.islands.length > 0 && !code.startsWith("// oxidejs:client-stub")) {
            if (Object.keys(scan.rpcActions).length > 0) {
              lines.unshift(`import { __ilhaServerAction } from "@ilha/router/ssr";`);
            }
            lines.unshift(`import * as __ilhaSelf from ${JSON.stringify(file)};`);
            lines.unshift(`import { registerServerIsland } from "@ilha/router/ssr";`);
            for (const island of scan.islands) {
              lines.push(
                `registerServerIsland(${JSON.stringify(serverIslandPublicId(file, island.name))}, () => __ilhaSelf[${JSON.stringify(island.name)}]);`,
              );
            }
          }
          const base = rewriteServerActions(code, scan?.rpcActions ?? {});
          if (base === code && lines.length === 0) return null;
          if (lines.length === 0) return base;
          return `${base}\n${lines.join("\n")}`;
        }
        if (id.startsWith("\0") || id.includes("node_modules")) return null;
        if (serverFile) return null;
        if (!SERVER_SPEC_HINT_RE.test(code)) return null;

        const SPEC_RE = /(?:^|\n)\s*import\s+(?:type\s+)?[^'"\n]+?\s*from\s*["']([^"']+)["']/g;
        const specs = new Set<string>();
        for (const match of code.matchAll(SPEC_RE)) specs.add(match[1]!);
        if (specs.size === 0) return null;

        const scanned = new Map<
          string,
          { file: string; islands: Set<string>; hasDefault: boolean }
        >();
        for (const spec of specs) {
          let file: string | undefined;
          try {
            const resolved = await this.resolve?.(spec, id);
            file = (resolved as { path?: string } | undefined)?.path ?? resolved?.id;
          } catch {
            file = undefined;
          }
          if (!file && spec.startsWith("/")) file = spec;
          if (!file || !SERVER_FILE_RE.test(file.replace(/\?.*$/, ""))) continue;
          const scan = scanFor(file);
          if (!scan) continue;
          scanned.set(spec, {
            file,
            islands: new Set(scan.islands.filter((i) => i.name !== "default").map((i) => i.name)),
            hasDefault: scan.islands.some((i) => i.name === "default"),
          });
        }
        if (scanned.size === 0) return null;

        return splitServerImports(code, {
          islandNamesFor: (spec) => {
            const entry = scanned.get(spec);
            return entry ? { islands: entry.islands, hasDefault: entry.hasDefault } : null;
          },
          virtualSpecFor: (spec) => serverIslandVirtualSpec(scanned.get(spec)!.file),
        });
      },

      configureServer(server) {
        server.watcher.add(state.pagesDir);
        if (options.frameGuard) setFrameGuard(options.frameGuard);
        setFrameAuth({
          trustedOrigins: options.trustedOrigins,
          csrf: options.csrf,
          // Dev stays permissive when no guard is registered; only a
          // registered guard or the present csrf/trusted-origin checks gate.
          defaultAction: "open",
        });

        // Server-island frame endpoint: re-renders a proxy island from a
        // state snapshot. Reads through the module graph on every call, so
        // edits to .server files apply without restart. Production serves
        // the same contract via the `@ilha/router/ssr` handler.
        server.middlewares.use(async (req, res, next) => {
          if ((req.url ?? "").split("?")[0] !== "/__ilha/frame") return next();
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end();
            return;
          }
          if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
            res.statusCode = 415;
            res.end();
            return;
          }
          // Same-origin + guard + CSRF defense, shared verbatim with the
          // production `@ilha/router/ssr` handler so dev can never drift from
          // prod semantics. Dev stays permissive when no guard is registered
          // (defaultAction: "open" is installed in configureServer above).
          const serverOrigin = devServerOrigin(server);
          const frameUrl = `${serverOrigin}${req.url ?? "/"}`;
          const authorized = await authorizeFrameRequest(
            new Request(frameUrl, {
              method: req.method,
              headers: new Headers(req.headers as Record<string, string>),
            }),
            {
              defaultAction: "open",
              onGuardError: () => {},
            },
          );
          if (!authorized.ok) {
            if (authorized.status === 403 && !getFrameGuard()) {
              // Dev-only log so proxy/container setups can see WHY the origin
              // was rejected and configure trustedOrigins accordingly.
              console.warn(
                `[ilha-router] dev frame request rejected: Origin ${String(req.headers.origin)} is not trusted (host: ${String(req.headers.host ?? "localhost")}). Configure trustedOrigins via IlhaPagesOptions if this origin is expected.`,
              );
            }
            res.statusCode = authorized.status;
            res.end();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += (chunk as Buffer).length;
            if (size > 16 * 1024) {
              res.statusCode = 413;
              res.end();
              return;
            }
            chunks.push(chunk as Buffer);
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              id?: string;
              path?: string;
              props?: unknown;
            };
            const incomingProps = parseFrameProps(body.props);
            const target = serverIslands.get(body.id ?? "");
            if (!target) throw new Error("unknown island");
            // Route context for server pages: render at the client's current
            // path when provided (path-only, no foreign origin). Backslash is
            // rejected too — WHATWG URLs treat `\` as `/` for http(s), so a
            // `\evil.com` prefix would smuggle a new authority into the
            // scoped request URL past the `//` check. A supplied-but-invalid
            // path fails closed (400), matching the production handler.
            let framePath = "/";
            if (typeof body.path === "string") {
              if (!isSafeFramePath(body.path)) {
                const env = frameEnvelope(400, { error: "frame failed" });
                res.statusCode = env.status;
                for (const [k, v] of Object.entries(env.headers)) res.setHeader(k, v);
                res.end(env.body);
                return;
              }
              framePath = body.path;
            }
            // Warm the module graph so the self-registration code appended to
            // server modules populates the frame renderers registry.
            await server.ssrLoadModule(VIRTUAL_PAGES_SERVER);
            await server.ssrLoadModule(target.file);
            // Synthesize a Request for the render scope: same URL as the
            // page, forwarding identity headers (cookie, auth, UA).
            // Client-supplied `x-forwarded-for` is NOT forwarded — it is
            // spoofable and must not be trusted for IP checks.
            const headers = authorized.identityHeaders;
            const request = new Request(frameScopedUrl(req.url ?? "/", framePath, serverOrigin), {
              method: "POST",
              headers,
            });
            const result = await renderServerIslandResult(
              body.id ?? "",
              request,
              (r, fn) => runWithIslandRequest(r, fn),
              incomingProps,
            );
            if (Result.isFailure(result)) {
              const err = result.failure;
              if (err.redirect) {
                const env = frameEnvelope(err.status, { redirect: err.redirect });
                res.statusCode = env.status;
                for (const [k, v] of Object.entries(env.headers)) res.setHeader(k, v);
                res.end(env.body);
                return;
              }
              const status = err.status;
              if (status >= 500) console.error("[ilha-router] frame render failed:", err);
              const env = frameEnvelope(status, { error: "frame failed" });
              res.statusCode = env.status;
              for (const [k, v] of Object.entries(env.headers)) res.setHeader(k, v);
              res.end(env.body);
              return;
            }
            const env = frameEnvelope(200, { html: result.success });
            res.statusCode = env.status;
            for (const [k, v] of Object.entries(env.headers)) res.setHeader(k, v);
            res.end(env.body);
          } catch (err) {
            if (err instanceof FrameError && err.redirect) {
              const env = frameEnvelope(err.status, { redirect: err.redirect });
              res.statusCode = env.status;
              for (const [k, v] of Object.entries(env.headers)) res.setHeader(k, v);
              res.end(env.body);
              return;
            }
            const status = err instanceof FrameError ? err.status : 400;
            if (!(err instanceof FrameError) || err.status >= 500) {
              console.error("[ilha-router] frame render failed:", err);
            }
            const env = frameEnvelope(status, { error: "frame failed" });
            res.statusCode = env.status;
            for (const [k, v] of Object.entries(env.headers)) res.setHeader(k, v);
            res.end(env.body);
          }
        });

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
          // Server-module edits change island wiring — drop the scan cache,
          // invalidate every proxy virtual module, and reload.
          if (!SERVER_FILE_RE.test(file.replace(/\?.*$/, ""))) return;
          scanCache.delete(file);
          // SAFETY: Vite's ModuleGraph carries forEachModule; the cast only
          // exposes the iterator used to invalidate stale server-island proxies.
          const graph = server.moduleGraph as unknown as {
            forEachModule?: (fn: (mod: { id: string }) => void) => void;
          };
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
          if (touched) server.hot.send({ type: "full-reload" });
        });
      },
    },

    rspack(compiler) {
      state.setPaths(compiler.options.context ?? process.cwd());

      const structuralInvalidate = createStructuralInvalidate(state, () => {
        if (!compiler.watching) return;
        // SAFETY: compiler implements watching via hooks in rspack; the
        // invalidate call is a no-op guard when watching is not active.
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
