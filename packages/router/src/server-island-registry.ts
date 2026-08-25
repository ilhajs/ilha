/**
 * Process-global registry of server-island renderers, keyed by the public
 * island id (`sha256(file#name)`, see `serverIslandPublicId`). Lives on
 * `globalThis` so every module copy (plugin bundle, SSR graph, frame entry)
 * shares one instance — same pattern as `request-scope.ts`.
 *
 * `.server` modules self-register when the plugin appends registration code
 * to their server-graph copy; the production `/__ilha/frame` handler (the
 * `@ilha/router/ssr` default export) consumes the registry to re-render an
 * island from a client state snapshot. Server pages additionally register
 * their `load` and route pattern so frame handlers can run the loader with
 * matched params.
 */

import { setServerManifestSerializer } from "ilha/internal";

import { resolveRedirectTarget } from "./index";
import { matchSegments, parsePattern, safeDecode } from "./route-match";

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
  // SAFETY: the registry lives on a global symbol so every module copy
  // (plugin bundle, SSR graph, frame handler) shares one instance.
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
 * and the production `@ilha/router/ssr` handler share this slot — both read
 * it from `globalThis`). Return a `Response` to reject; return nothing to
 * allow. Island state is world-readable through frames unless you gate them,
 * so apps serving private data should install a session check here.
 */
export function setFrameGuard(guard: FrameGuard): void {
  // SAFETY: global symbol slot shared across module copies; undefined means
  // "no guard registered" and the production handler denies frames.
  const g = globalThis as unknown as Record<symbol, FrameGuard | undefined>;
  g[GUARD_KEY] = guard;
}

export function getFrameGuard(): FrameGuard | undefined {
  // SAFETY: mirrors the setter's symbol slot contract.
  return (globalThis as unknown as Record<symbol, FrameGuard | undefined>)[GUARD_KEY];
}

const LOADER_GUARD_KEY = Symbol.for("ilha.loaderGuard");

/**
 * Install a guard consulted only by `GET /__ilha/loader`. When absent, the
 * loader endpoint falls back to `getFrameGuard()` for backwards compatibility.
 * Prefer a dedicated loader guard so gating the loader endpoint is independent
 * of frame rendering.
 */
export function setLoaderGuard(guard: FrameGuard): void {
  // SAFETY: global symbol slot shared across module copies; undefined means
  // the loader endpoint falls back to the frame guard.
  const g = globalThis as unknown as Record<symbol, FrameGuard | undefined>;
  g[LOADER_GUARD_KEY] = guard;
}

export function getLoaderGuard(): FrameGuard | undefined {
  // SAFETY: mirrors the setter's symbol slot contract.
  return (globalThis as unknown as Record<symbol, FrameGuard | undefined>)[LOADER_GUARD_KEY];
}

/** Frame-authorization policy, installed via {@link setFrameAuth}. */
export interface FrameAuthPolicy {
  /**
   * Action taken when no frame guard is registered. `"deny"` (default in the
   * production handler) rejects every `/__ilha/frame` request with 403;
   * `"open"` preserves the legacy unauthenticated behavior. The dev
   * middleware stays permissive unless a guard is registered.
   */
  defaultAction?: "open" | "deny";
  /**
   * Explicit trusted origins (e.g. `"https://app.example.com"`). When set,
   * origin checks accept only these; otherwise the check compares the `Origin`
   * header against `https://{host}` / `http://{host}`.
   */
  trustedOrigins?: string[];
  /**
   * Optional CSRF verifier for the state-changing frame POST. Receives the
   * original `Request`; returning falsy rejects the request. Use this for
   * server-to-server frame callers that have no browser `Origin`.
   */
  csrf?: (request: Request) => boolean | Promise<boolean>;
}

const AUTH_KEY = Symbol.for("ilha.frameAuth");

/**
 * Install the frame-authorization policy consumed by the production
 * `@ilha/router/ssr` handler. `trustedOrigins` and `csrf` are also applied by
 * the dev middleware (via `IlhaPagesOptions`).
 */
export function setFrameAuth(policy: FrameAuthPolicy): void {
  // SAFETY: global symbol slot shared across module copies; undefined means
  // frame-auth defaults apply (deny when no guard is registered).
  const g = globalThis as unknown as Record<symbol, FrameAuthPolicy | undefined>;
  g[AUTH_KEY] = policy;
}

export function getFrameAuth(): FrameAuthPolicy | undefined {
  // SAFETY: mirrors the setter's symbol slot contract.
  return (globalThis as unknown as Record<symbol, FrameAuthPolicy | undefined>)[AUTH_KEY];
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Same-origin check for frame/loader requests. Browsers always send `Origin`
 * on cross-origin and same-origin `POST`; its absence implies a non-browser
 * caller (allowed — gate those via a guard or `csrf`). When `Origin` is
 * present it must match the configured trusted origins, else the request's
 * own `Host`.
 */
export function isTrustedOrigin(request: Request, policy: FrameAuthPolicy | undefined): boolean {
  const originHeader = request.headers.get("origin");
  if (originHeader === null) return true;
  const origin = normalizeOrigin(originHeader);
  if (origin === null) return false;
  const trusted = policy?.trustedOrigins ?? [];
  if (trusted.length > 0) {
    return trusted.some((o) => normalizeOrigin(o) === origin);
  }
  const host = request.headers.get("host");
  if (!host) return false;
  return origin === `https://${host}` || origin === `http://${host}`;
}

/**
 * Path-only route context for frame/loader scoped requests. Leading slash,
 * no `//` or backslash (WHATWG URLs treat `\` as `/` for http(s), so a
 * `\evil.com` prefix would smuggle a foreign authority past a plain `//`
 * check), bounded length. `false` for anything else.
 */
export function isSafeFramePath(path: string): boolean {
  return (
    path.startsWith("/") && !path.includes("//") && !path.includes("\\") && path.length <= 2048
  );
}

/** Identity headers forwarded onto scoped render/loader requests. */
const FORWARD_IDENTITY_HEADERS = ["cookie", "authorization", "user-agent"] as const;

/**
 * Copy identity headers (cookie, authorization, user-agent) onto a fresh
 * `Headers`. Accepts a `Headers` or a Node `IncomingHttpHeaders`-style plain
 * object. Client-supplied `x-forwarded-for` is deliberately NOT forwarded —
 * it is spoofable and must not be trusted by loaders for IP checks.
 */
export function forwardIdentityHeaders(
  source: Headers | Record<string, string | string[] | undefined>,
): Headers {
  const out = new Headers();
  const read = (name: string): string | null | undefined => {
    const s = source as { get?: (n: string) => string | null | undefined };
    if (typeof s.get === "function") return s.get(name);
    const v = (source as Record<string, string | string[] | undefined>)[name];
    return Array.isArray(v) ? v[0] : v;
  };
  for (const name of FORWARD_IDENTITY_HEADERS) {
    const v = read(name);
    if (v !== null && v !== undefined) out.set(name, v);
  }
  return out;
}

/** No-store JSON envelope shared by dev and production frame handlers. */
export interface FrameEnvelope {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export function frameEnvelope(status: number, body: Record<string, unknown>): FrameEnvelope {
  return {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json;charset=utf-8",
    },
    body: JSON.stringify(body),
  };
}

export type FrameLoaderRunner = (
  path: string,
  request?: Request,
) => Promise<{
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
  // SAFETY: global symbol slot shared across module copies; the generated
  // server module installs the runner against pageRouter.runLoader.
  const g = globalThis as unknown as Record<symbol, FrameLoaderRunner | undefined>;
  g[LOADER_RUNNER_KEY] = runner;
}

export function getFrameLoaderRunner(): FrameLoaderRunner | undefined {
  // SAFETY: mirrors the setter's symbol slot contract.
  return (globalThis as unknown as Record<symbol, FrameLoaderRunner | undefined>)[
    LOADER_RUNNER_KEY
  ];
}

// ─── Server-manifest serialization (owned by @ilha/router) ──────────────
// Core only collects event→action manifest data; the markup format is a
// router integration detail. Every `.server` module transform imports this
// module, so registering here covers dev frames, production frames, and
// prerendered server graphs alike.
setServerManifestSerializer({
  template(manifest) {
    // Escape for a single-quoted attribute (& first — mirrors core's escapeHtml).
    const json = JSON.stringify(Object.fromEntries(manifest))
      .replace(/&/g, "&amp;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;");
    return `<template data-ilha-actions='${json}'></template>`;
  },
});

/** Register `id` → entry. Later registrations win (id encodes file + name). */
/**
 * Wrap an exported server action so ilha's hydration-manifest capture can
 * intercept it. During normal execution this is a transparent passthrough.
 * While ilha capture-invokes an event closure (manifest rendering for server
 * islands), calling the wrapper records `{ k, a }` in the active capture
 * frame instead of executing — the client replays it over RPC.
 */
export function __ilhaServerAction<A extends unknown[], R>(
  key: string,
  fn: (...args: A) => R,
): (...args: A) => R | undefined {
  if (typeof fn !== "function") return fn;
  const CAPTURE_FRAME = Symbol.for("ilha.eventCaptureFrame");
  const wrapper = (...args: A): R | undefined => {
    const g = globalThis as Record<symbol, unknown>;
    const frame = g[CAPTURE_FRAME] as Array<{ k: string; a: unknown[] }> | undefined;
    if (Array.isArray(frame)) {
      if (!frame.some((entry) => entry.k === key)) frame.push({ k: key, a: args });
      return undefined;
    }
    return fn(...args);
  };
  return wrapper;
}

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
 * Returns decoded params, or null when the path doesn't match. Shares the
 * router's matcher semantics via `route-match.ts`. */
function matchPatternParams(pattern: string, pathname: string): Record<string, string> | null {
  const raw = matchSegments(parsePattern(pattern).segments, pathname);
  if (!raw) return null;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) params[k] = safeDecode(v);
  return params;
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
      const result = await entry.load({
        params,
        request,
        url,
        signal: request.signal,
      });
      // Same load envelope as client loaders and regular-page loads.
      props = {
        load: { loading: false, value: result ?? {}, error: undefined },
      };
    } catch (error) {
      const marker = error as { __ilhaRedirect?: boolean; __ilhaLoaderError?: boolean };
      if (marker.__ilhaRedirect === true) {
        const r = error as { to: string; status: number };
        // Gate the frame redirect target like the loader path does — only
        // same-origin targets are allowed (frames have no per-router
        // `allowExternalRedirects`). Unsafe targets surface as a 500, never
        // an open redirect to a foreign origin.
        const safe = resolveRedirectTarget(r.to, url, false);
        if (!safe.ok) throw new FrameError(500, "unsafe redirect target");
        throw new FrameError(r.status || 302, "frame failed", safe.to);
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
