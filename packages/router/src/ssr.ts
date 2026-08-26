/**
 * Production SSR endpoints for server-owned islands and regular-page loads.
 *
 * Default export is an oxidejs-style fetch middleware:
 * `(request) => Response | undefined`. Returns `undefined` for any request it
 * does not own, so hosts can chain it ahead of their own handler:
 *
 * ```ts
 * oxide({ middleware: ["@ilha/router/ssr"] });
 * ```
 *
 * Serves:
 * - `POST /__ilha/frame` — re-renders a server island (JSON `{ id, path }` in,
 *   `{ html }` out). Renderers come from the process-global registry
 *   populated by self-registration code appended to `.server` modules.
 * - `GET /__ilha/loader?path=…` — regular-page server loads via the loader
 *   runner (`setFrameLoaderRunner`, wired by the generated server module).
 */

import "ilha";
import { bindServerAction, setServerManifestSerializer, type ServerAction } from "ilha/internal";

import type { HeadInput } from "./head";
import { resolveRedirectTarget } from "./index";
import { runWithIslandRequest } from "./request-scope";
import { matchSegments, parsePattern, safeDecode } from "./route-match";

/**
 * Server-frame state shared by the dev middleware and the production
 * `@ilha/router/ssr` handler: the renderers registry (keyed by the public
 * island id, `sha256(file#name)`, see `serverIslandPublicId`), frame/loader
 * guards and auth policy, and the loader runner. Lives on `globalThis` so
 * every module copy (plugin bundle, SSR graph, frame entry) shares one
 * instance — same pattern as `request-scope.ts`.
 *
 * `.server` modules self-register when the plugin appends registration code
 * to their server-graph copy; the `/__ilha/frame` handler below consumes the
 * registry to re-render an island from a client state snapshot. Server pages
 * additionally register their `load` and route pattern so frame handlers can
 * run the loader with matched params.
 */

/** Loader context for server-page `load` — mirrors the router's shape. */
export interface FrameLoaderContext {
  params: Record<string, string>;
  request: Request;
  url: URL;
  signal: AbortSignal;
  /** Contribute `<head>` data for this route. Safe to call multiple times. */
  head: (input: HeadInput) => void;
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

/** @internal Brand an exported server action with its generated RPC transport key. */
export function __ilhaServerAction<A extends unknown[], R>(
  key: string,
  fn: (...args: A) => R,
): ServerAction<A, R> {
  return bindServerAction(fn, key);
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
  onHead?: (entries: HeadInput[]) => void,
  incomingProps?: Record<string, unknown>,
): Promise<string> {
  const entry = registry().get(id);
  if (!entry) throw new FrameError(400, "unknown island");
  let props: unknown = incomingProps;
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
      const headEntries: HeadInput[] = [];
      const result = await entry.load({
        params,
        request,
        url,
        signal: request.signal,
        head: (input) => headEntries.push(input),
      });
      if (headEntries.length > 0) onHead?.(headEntries);
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

// ─── Endpoints ───────────────────────────────────────────────────────────

export const FRAME_ENDPOINT = "/__ilha/frame";
/** Regular-page server loads: served through the loader-runner slot. */
export const LOADER_ENDPOINT = "/__ilha/loader";

/** Max request body size — matches the dev middleware cap. */
export const MAX_BODY = 16 * 1024;

/** Parent-island props on a frame POST. Missing is fine; anything else is 400. */
export function parseFrameProps(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new FrameError(400, "frame failed");
  return value as Record<string, unknown>;
}

export function json(status: number, body: Record<string, unknown>): Response {
  const env = frameEnvelope(status, body);
  return new Response(env.body, { status: env.status, headers: env.headers });
}

/**
 * Read a request body as UTF-8, streaming it with a hard byte cap. Returns
 * `null` when the body exceeds `maxBytes` (the reader is cancelled before the
 * cap is far exceeded) or when decoding fails.
 */
export async function readBodyBounded(request: Request, maxBytes: number): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value?.byteLength ?? 0;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value as Uint8Array);
  }
  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();
}

/**
 * Shared frame-request authorization used by both the production handler
 * below and the Vite/Rsbuild dev middleware: same-origin check against the
 * frame-auth policy, the registered frame guard, and the optional CSRF
 * verifier. `defaultAction` selects the deny-by-default production posture or
 * the permissive development one.
 *
 * Returns the forwarded identity headers on success so callers render frames
 * with cookie/auth/UA context, or the HTTP status to reject with.
 */
export async function authorizeFrameRequest(
  request: Request,
  options: { defaultAction: "open" | "deny"; onGuardError?: (error: unknown) => void },
): Promise<{ ok: true; identityHeaders: Headers } | { ok: false; status: number }> {
  const auth = getFrameAuth();
  if (!isTrustedOrigin(request, auth)) return { ok: false, status: 403 };

  const guard = getFrameGuard();
  if (!guard && (auth?.defaultAction ?? "deny") === "deny") {
    return { ok: false, status: 403 };
  }
  try {
    const denied = await guard?.(request);
    if (denied) return { ok: false, status: denied.status };
  } catch (error) {
    options.onGuardError?.(error);
    return { ok: false, status: 403 };
  }
  if (auth?.csrf) {
    try {
      const ok = await auth.csrf(request);
      if (!ok) return { ok: false, status: 403 };
    } catch {
      return { ok: false, status: 403 };
    }
  }
  return { ok: true, identityHeaders: forwardIdentityHeaders(request.headers) };
}

async function ssr(request: Request): Promise<Response | undefined> {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return json(400, { error: "frame failed" });
  }
  if (pathname !== FRAME_ENDPOINT && pathname !== LOADER_ENDPOINT) return;

  // Same-origin defense for every owned endpoint. Browsers always send
  // `Origin` on POST/GET-over-fetch; a missing header implies a non-browser
  // caller, which is gated by the guards below / the CSRF check for frames.
  const auth = getFrameAuth();
  if (!isTrustedOrigin(request, auth)) {
    return json(403, { error: "frame failed" });
  }

  // ── Loader endpoint: regular-page server loads via pageRouter.runLoader ──
  if (pathname === LOADER_ENDPOINT) {
    if (request.method !== "GET") return json(405, { error: "method not allowed" });
    // Deny by default when no guard is registered — mirrors the frame
    // endpoint. Loader output is served to any caller that reaches the
    // endpoint; gating it keeps client-navigation data behind app auth.
    const guard = getLoaderGuard() ?? getFrameGuard();
    if (!guard && (auth?.defaultAction ?? "deny") === "deny") {
      return json(403, { error: "loader failed" });
    }
    try {
      // Loader guard is preferred; fall back to the legacy frame guard so
      // apps already gating loader data keep working.
      const denied = await guard?.(request);
      if (denied) return denied;
    } catch {
      return json(403, { error: "loader failed" });
    }
    const runner = getFrameLoaderRunner();
    if (!runner) return json(404, { kind: "error", status: 404, message: "not found" });
    const cl = request.headers.get("content-length");
    if (cl && Number(cl) > MAX_BODY) return json(413, { error: "frame failed" });
    let target = "/";
    try {
      target = new URL(request.url).searchParams.get("path") ?? "/";
    } catch {
      return json(400, { kind: "error", status: 400, message: "bad request" });
    }
    // Path-only: leading slash, no `//` or backslash (a WHATWG URL turns
    // `\` into `/`, which would smuggle a foreign authority), bounded length.
    if (!isSafeFramePath(target)) {
      return json(400, { kind: "error", status: 400, message: "bad request" });
    }
    try {
      // Forward the originating request so client-navigation loaders keep
      // cookies/identity and observe the real request's abort signal, and
      // seed the island-request scope (useContext().request) like frames do.
      const result = await runWithIslandRequest(request, () => runner(target, request));
      if (result.kind === "redirect") {
        return json(result.status || 302, {
          kind: "redirect",
          to: result.to,
          status: result.status,
        });
      }
      if (result.kind !== "data") {
        // Preserve runner outcomes (not-found, error) with their status.
        const status = result.status || 500;
        return json(status, { kind: result.kind, status, message: result.message });
      }
      return json(200, result);
    } catch (error) {
      console.error("[ilha-router] loader endpoint failed:", error);
      return json(500, { kind: "error", status: 500, message: "loader failed" });
    }
  }

  // ── Frame endpoint: re-render a server island ─────────────────────────────
  if (request.method !== "POST") return json(405, { error: "frame failed" });
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return json(415, { error: "frame failed" });
  }

  // Guard hook (see setFrameGuard) + CSRF, shared with the dev middleware.
  const authorized = await authorizeFrameRequest(request, {
    defaultAction: auth?.defaultAction ?? "deny",
    onGuardError: (error) => console.error("[ilha-router] frame guard failed:", error),
  });
  if (!authorized.ok) return json(authorized.status, { error: "frame failed" });

  let id: string;
  let path = "/";
  let incomingProps: Record<string, unknown> | undefined;
  try {
    const text = await readBodyBounded(request, MAX_BODY);
    if (text === null) return json(413, { error: "frame failed" });
    const body = JSON.parse(text) as { id?: unknown; path?: unknown; props?: unknown };
    id = String(body.id ?? "");
    incomingProps = parseFrameProps(body.props);
    // Route context for server pages: the frame renders as if requested at
    // the client's current URL. Only path+search are honored — never a full
    // foreign origin. Backslash is rejected too: WHATWG URLs treat `\` as
    // `/` for http(s), so a `\evil.com` prefix would smuggle a new authority
    // past the plain `//` check. A supplied-but-invalid path fails closed
    // (400) instead of silently re-rendering at "/".
    if (typeof body.path === "string") {
      if (!isSafeFramePath(body.path)) {
        return json(400, { error: "frame failed" });
      }
      path = body.path;
    }
  } catch {
    return json(400, { error: "frame failed" });
  }

  try {
    // Base the scoped request on the request's own URL origin — never the raw
    // `Host` header, which an Origin-less (server-to-server) caller can set to
    // an arbitrary host. Deriving from request.url keeps the scoped URL
    // same-origin with what the platform actually received.
    let origin: string;
    try {
      origin = new URL(request.url).origin;
    } catch {
      return json(400, { error: "frame failed" });
    }
    // Synthesize a Request for the render/loader scope: the frame's route
    // path with identity headers (cookie, auth, UA) forwarded. Client-supplied
    // `x-forwarded-for` is NOT forwarded — it is spoofable and must not be
    // trusted by loaders for IP checks.
    const headers = forwardIdentityHeaders(request.headers);
    const scoped = new Request(new URL(path, origin), {
      method: "POST",
      headers,
    });
    // Forward framework request context (symbol-keyed expandos, e.g.
    // oxidejs's env/fetch-ctx marker) to the scoped request.
    // SAFETY: only registered (Symbol.keyFor) symbols are copied; arbitrary
    // private-symbol internals never leak onto the scoped request.
    for (const sym of Object.getOwnPropertySymbols(request)) {
      if (Symbol.keyFor(sym) === undefined) continue;
      try {
        // SAFETY: scoped is a fresh synthetic Request; the record cast lets
        // registered framework symbols ride along without copying internals.
        (scoped as unknown as Record<symbol, unknown>)[sym] = (
          request as unknown as Record<symbol, unknown>
        )[sym];
      } catch {
        // non-writable expando — skip
      }
    }
    let head: HeadInput[] | undefined;
    const html = await renderServerIsland(
      id,
      scoped,
      (scopedRequest, fn) => Promise.resolve(runWithIslandRequest(scopedRequest, fn)),
      (entries) => (head = entries),
      incomingProps,
    );
    return json(200, { html, head });
  } catch (error) {
    if (error instanceof FrameError) {
      if (error.redirect) return json(error.status, { redirect: error.redirect });
      if (error.status >= 500) console.error("[ilha-router] frame render failed:", error);
      return json(error.status, { error: "frame failed" });
    }
    console.error("[ilha-router] frame render failed:", error);
    return json(400, { error: "frame failed" });
  }
}

/** Side-effect imports required alongside this handler. */
// SAFETY: the imports array is read by the oxidejs middleware loader to pull
// the generated pages/loaders modules into the SSR graph alongside this file.
(ssr as unknown as { imports: string[] }).imports = ["ilha:pages/server", "ilha:loaders"];

export default ssr;
