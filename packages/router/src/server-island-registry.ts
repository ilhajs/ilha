/**
 * Process-global registry of server-island renderers, keyed by the public
 * island id (`sha256(file#name)`, see `serverIslandPublicId`). Lives on
 * `globalThis` so every module copy (plugin bundle, SSR graph, frame entry)
 * shares one instance — same pattern as `request-scope.ts`.
 *
 * `.server` modules self-register when the plugin appends registration code
 * to their server-graph copy; the production `/__ilha/frame` handler (see
 * `@ilha/router/frame`) consumes the registry to re-render an island from a
 * client state snapshot. Server pages additionally register their `load` and
 * route pattern so frame handlers can run the loader with matched params.
 */

/** Loader context for server-page `load` — mirrors the router's shape. */
export interface FrameLoaderContext {
  params: Record<string, string>;
  request: Request;
  url: URL;
  signal: AbortSignal;
}

export type ServerPageLoader = (ctx: FrameLoaderContext) => unknown;

/** A frame render: optionally preceded by running the page's `load`. */
export interface ServerIslandEntry {
  /** Returns the renderState fn (`Symbol.for("ilha.renderState")` getter). */
  render: () => unknown;
  /** The module's `load` export — runs at frame time; its return value
   * becomes the island's render props. */
  load?: ServerPageLoader;
  /** Route pattern for the page (`/user/:id`) — matches params for `load`. */
  pattern?: string;
}

export type FrameGuard = (request: Request) => Response | void | Promise<Response | void>;

const REGISTRY_KEY = Symbol.for("ilha.serverIslandRenderers");

function registry(): Map<string, ServerIslandEntry> {
  const g = globalThis as unknown as Record<symbol, Map<string, ServerIslandEntry> | undefined>;
  let map = g[REGISTRY_KEY];
  if (!map) {
    map = new Map();
    g[REGISTRY_KEY] = map;
  }
  return map;
}

const GUARD_KEY = Symbol.for("ilha.frameGuard");

/**
 * Install a guard consulted by every `/__ilha/frame` request (dev middleware
 * and the production `@ilha/router/frame` handler share this slot — both read
 * it from `globalThis`). Return a `Response` to reject; return nothing to
 * allow. Island state is world-readable through frames unless you gate them,
 * so apps serving private data should install a session check here.
 */
export function setFrameGuard(guard: FrameGuard): void {
  const g = globalThis as unknown as Record<symbol, FrameGuard | undefined>;
  g[GUARD_KEY] = guard;
}

export function getFrameGuard(): FrameGuard | undefined {
  return (globalThis as unknown as Record<symbol, FrameGuard | undefined>)[GUARD_KEY];
}

export type FrameLoaderRunner = (path: string) => Promise<{
  kind: string;
  data?: unknown;
  headEntries?: unknown;
  status?: number;
  to?: string;
  message?: string;
}>;

const LOADER_RUNNER_KEY = Symbol.for("ilha.frameLoaderRunner");

/**
 * Install the handler backing `GET /__ilha/loader` in production. The
 * generated `pages.server.ts` wires this to `pageRouter.runLoader`, so
 * regular-page server loads get full route matching, layout chains, and
 * redirect/error semantics. Dev and prod handlers share the slot.
 */
export function setFrameLoaderRunner(runner: FrameLoaderRunner): void {
  const g = globalThis as unknown as Record<symbol, FrameLoaderRunner | undefined>;
  g[LOADER_RUNNER_KEY] = runner;
}

export function getFrameLoaderRunner(): FrameLoaderRunner | undefined {
  return (globalThis as unknown as Record<symbol, FrameLoaderRunner | undefined>)[
    LOADER_RUNNER_KEY
  ];
}

/** Register `id` → entry. Later registrations win (id encodes file + name). */
export function registerServerIsland(
  id: string,
  render: () => unknown,
  options?: { load?: ServerPageLoader; pattern?: string },
): void {
  registry().set(id, { render, load: options?.load, pattern: options?.pattern });
}

export function getServerIslandEntry(id: string): ServerIslandEntry | undefined {
  return registry().get(id);
}

/** Back-compat alias used by tests. */
export const getServerIslandRenderer = getServerIslandEntry;

/** Client-facing frame failure. `redirect` carries a loader redirect target. */
export class FrameError extends Error {
  status: number;
  redirect?: string;

  constructor(status: number, message: string, redirect?: string) {
    super(message);
    this.status = status;
    this.redirect = redirect;
  }
}

/** Match a route pattern (`/user/:id`, `/docs/**:slug`) against a pathname.
 * Returns raw (still-encoded) params, or null when the path doesn't match.
 * Mirrors the router's matcher semantics in miniature. */
function matchPatternParams(pattern: string, pathname: string): Record<string, string> | null {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  let cursor = 0;
  for (const segment of patternSegments) {
    if (segment.startsWith("*")) {
      const name = segment.slice(2).replace(/^:/, "");
      if (name) params[name] = pathSegments.slice(cursor).join("/");
      cursor = pathSegments.length;
      break;
    }
    const value = pathSegments[cursor];
    if (value === undefined) return null;
    if (segment.startsWith(":")) params[segment.slice(1)] = value;
    else if (value !== segment) return null;
    cursor++;
  }
  return cursor === pathSegments.length ? params : null;
}

/**
 * Shared tail of every frame request: run the page's `load` when registered
 * (params matched from the frame path), then invoke the renderer inside the
 * caller's scope. Throws `FrameError` with an HTTP status for client-facing
 * failures; loader redirects surface via `FrameError.redirect`.
 */
export async function renderServerIsland(
  id: string,
  request: Request,
  runWithScope: <T>(request: Request, fn: () => T) => T | Promise<T>,
): Promise<string> {
  const entry = registry().get(id);
  if (!entry) throw new FrameError(400, "unknown island");
  let props: unknown;
  if (entry.load) {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      throw new FrameError(400, "frame failed");
    }
    const params = entry.pattern ? matchPatternParams(entry.pattern, url.pathname) : {};
    if (!params) throw new FrameError(400, "frame failed");
    try {
      props = await entry.load({
        params,
        request,
        url,
        signal: new AbortController().signal,
      });
    } catch (error) {
      const marker = error as { __ilhaRedirect?: boolean; __ilhaLoaderError?: boolean };
      if (marker.__ilhaRedirect === true) {
        const r = error as { to: string; status: number };
        throw new FrameError(r.status || 302, "frame failed", r.to);
      }
      if (marker.__ilhaLoaderError === true) {
        const e = error as { status: number };
        throw new FrameError(e.status || 500, "frame failed");
      }
      throw error;
    }
  }
  const render = entry.render();
  if (typeof render !== "function") throw new FrameError(400, "unknown island");
  const html = await runWithScope(request, () => render(props));
  return String(html);
}
