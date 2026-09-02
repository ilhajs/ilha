/**
 * Production SSR endpoint for server-owned islands.
 *
 * Default export is an oxidejs-style fetch middleware:
 * `(request) => Response | undefined`. Returns `undefined` for any request it
 * does not own, so hosts can chain it ahead of their own handler:
 *
 * ```ts
 * oxide({ middleware: ["@ilha/router/ssr"] });
 * ```
 *
 * Serves `POST /__ilha/frame` — re-renders a server island (JSON `{ id, path }`
 * in, `{ html }` out). Renderers come from the process-global registry
 * populated by self-registration code appended to `.server` modules.
 */

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { renderToString } from "ilha";
import { action, brandServerAction } from "oxidejs";

import { runWithIslandRequest } from "./request-scope";
import { sanitizeSnapshotObject } from "./snapshot";

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

/** A frame render: optionally preceded by running the page's `load`. */
export interface ServerIslandEntry {
  /** Returns the renderState fn (`Symbol.for("ilha.renderState")` getter). */
  render: () => unknown;
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

/**
 * Build the scoped frame render URL from the incoming request URL and frame
 * path. Absolute `incomingUrl` values supply the origin. Relative values (for
 * example Vite's `req.url`) require an explicit trusted `serverOrigin` — never
 * a client `Host` header.
 */
export function frameScopedUrl(
  incomingUrl: string,
  framePath: string,
  serverOrigin?: string,
): string {
  let origin: string;
  try {
    const incoming = new URL(incomingUrl);
    if (incoming.protocol !== "http:" && incoming.protocol !== "https:") {
      throw new TypeError("unsupported protocol");
    }
    origin = incoming.origin;
  } catch {
    if (serverOrigin == null) {
      throw new Error("frameScopedUrl: relative incomingUrl requires serverOrigin");
    }
    origin = parseServerOrigin(serverOrigin);
  }
  return new URL(framePath, origin).href;
}

function parseServerOrigin(value: string): string {
  if (!value.includes("://")) {
    throw new Error("frameScopedUrl: serverOrigin must be an absolute URL");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("frameScopedUrl: serverOrigin must be http(s)");
  }
  return parsed.origin;
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

/** @internal Brand an exported server action with its generated RPC transport key. */
export function __ilhaServerAction<A extends unknown[], R>(
  key: string,
  fn: (...args: A) => R | Promise<R>,
) {
  const handle =
    typeof fn === "function" && (fn as { $$atom?: number }).$$atom === 1
      ? (fn as ReturnType<typeof action<A, Awaited<R>>>)
      : action(fn as (...args: A) => Awaited<R>);
  return brandServerAction(key, handle);
}

export function registerServerIsland(id: string, render: () => unknown): void {
  registry().set(id, { render });
}

export function getServerIslandEntry(id: string): ServerIslandEntry | undefined {
  return registry().get(id);
}

/** Client-facing frame failure. `redirect` carries a same-origin redirect target. */
export class FrameError extends Data.TaggedError("FrameError")<{
  status: number;
  message?: string;
  redirect?: string;
}> {}

/**
 * Shared tail of every frame request: run the page's `load` when registered
 * (params matched from the frame path), then invoke the renderer inside the
 * caller's scope. Throws `FrameError` with an HTTP status for client-facing
 * failures; loader redirects surface via `FrameError.redirect`.
 */
const frameFail = (status: number, message?: string): FrameError =>
  new FrameError({ status, message: message ?? "frame failed" });

/**
 * Render a registered server island. Typed error channel: the only failure is
 * `FrameError`; everything else is a defect surfaced as a 400 to the client.
 */
export function renderServerIsland(
  id: string,
  request: Request,
  runWithScope: <T>(request: Request, fn: () => T) => T | Promise<T>,
  incomingProps?: Record<string, unknown>,
): Effect.Effect<string, FrameError> {
  return Effect.gen(function* () {
    const entry = registry().get(id);
    if (!entry) return yield* Effect.fail(frameFail(400, "unknown island"));
    const render = entry.render();
    if (typeof render !== "function") {
      return yield* Effect.fail(frameFail(400, "unknown island"));
    }
    return yield* Effect.tryPromise({
      try: async () => {
        const out = (await runWithScope(request, () =>
          renderToStringOf(render, incomingProps),
        )) as string;
        return out;
      },
      catch: (error): FrameError =>
        error instanceof FrameError
          ? error
          : frameFail(400, error instanceof Error ? error.message : undefined),
    });
  });
}

/** Convenience for non-Effect callers: run the render and resolve to a Result. */
export function renderServerIslandResult(
  id: string,
  request: Request,
  runWithScope: <T>(request: Request, fn: () => T) => T | Promise<T>,
  incomingProps?: Record<string, unknown>,
): Promise<Result.Result<string, FrameError>> {
  return Effect.runPromise(
    Effect.result(renderServerIsland(id, request, runWithScope, incomingProps)),
  );
}

function renderToStringOf(
  render: unknown,
  props: Record<string, unknown> | undefined,
): Promise<string> {
  const out = (render as (p?: unknown) => unknown)(props);
  return Promise.resolve(out).then((view) =>
    typeof view === "string"
      ? view
      : renderToString(() => view as never, { captureActions: true, markers: false }),
  );
}

// ─── Endpoints ───────────────────────────────────────────────────────────

export const FRAME_ENDPOINT = "/__ilha/frame";
/** Max request body size — matches the dev middleware cap. */
export const MAX_BODY = 16 * 1024;

/** Parent-island props on a frame POST. Missing is fine; anything else is 400. */
export function parseFrameProps(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new FrameError({ status: 400, message: "frame failed" });
  }
  const sanitized = sanitizeSnapshotObject(value);
  if (!sanitized) throw new FrameError({ status: 400, message: "frame failed" });
  return sanitized;
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
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return json(400, { error: "frame failed" });
  }
  if (url.pathname !== FRAME_ENDPOINT) return undefined;

  const program: Effect.Effect<Response, FrameError> = Effect.gen(function* () {
    const auth = getFrameAuth();
    // Same-origin defense for every owned endpoint. Browsers always send
    // `Origin` on POST/GET-over-fetch; a missing header implies a non-browser
    // caller, which is gated by the guards below / the CSRF check for frames.
    if (!isTrustedOrigin(request, auth)) return yield* Effect.fail(frameFail(403));

    // ── Frame endpoint: re-render a server island ──────────────────────────
    if (request.method !== "POST") return yield* Effect.fail(frameFail(405));
    if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
      return yield* Effect.fail(frameFail(415));
    }

    // Guard hook (see setFrameGuard) + CSRF, shared with the dev middleware.
    const authorized = yield* Effect.tryPromise({
      try: () =>
        authorizeFrameRequest(request, {
          defaultAction: auth?.defaultAction ?? "deny",
          onGuardError: (error) => console.error("[ilha-router] frame guard failed:", error),
        }),
      catch: () => frameFail(403),
    });
    if (!authorized.ok) return yield* Effect.fail(frameFail(authorized.status));

    let id: string;
    let path = "/";
    let incomingProps: Record<string, unknown> | undefined;
    {
      const text = yield* Effect.tryPromise({
        try: () => readBodyBounded(request, MAX_BODY),
        catch: () => frameFail(400),
      });
      if (text === null) return yield* Effect.fail(frameFail(413));
      try {
        const body = JSON.parse(text) as { id?: unknown; path?: unknown; props?: unknown };
        id = String(body.id ?? "");
        incomingProps = parseFrameProps(body.props);
        // Route context: the frame renders as if requested at the client's
        // current URL. Only path+search are honored — never a full foreign
        // origin. Backslash is rejected too: WHATWG URLs treat `\\` as `/`
        // for http(s), so a `\\evil.com` prefix would smuggle a new
        // authority past the plain `//` check. A supplied-but-invalid path
        // fails closed (400) instead of silently re-rendering at "/".
        if (typeof body.path === "string") {
          if (!isSafeFramePath(body.path)) return yield* Effect.fail(frameFail(400));
          path = body.path;
        }
      } catch {
        return yield* Effect.fail(frameFail(400));
      }
    }

    // Base the scoped request on the request's own URL origin — never the raw
    // `Host` header, which an Origin-less (server-to-server) caller can set to
    // an arbitrary host. Synthesize a Request for the render scope: the
    // frame's route path with identity headers (cookie, auth, UA) forwarded.
    // Client-supplied `x-forwarded-for` is NOT forwarded — it is spoofable
    // and must not be trusted for IP checks.
    const scoped = new Request(frameScopedUrl(url.href, path), {
      method: "POST",
      headers: forwardIdentityHeaders(request.headers),
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

    const html = yield* renderServerIsland(
      id,
      scoped,
      (scopedRequest, fn) => Promise.resolve(runWithIslandRequest(scopedRequest, fn)),
      incomingProps,
    );
    return json(200, { html });
  });

  return Effect.runPromise(
    Effect.map(
      Effect.result(program),
      Result.match({
        onFailure: (error) => {
          if (error.redirect) return json(error.status, { redirect: error.redirect });
          if (error.status >= 500) console.error("[ilha-router] frame render failed:", error);
          return json(error.status, { error: "frame failed" });
        },
        onSuccess: (response) => response,
      }),
    ),
  );
}

/** Side-effect imports required alongside this handler. */
// SAFETY: the imports array is read by the oxidejs middleware loader to pull
// the generated pages/loaders modules into the SSR graph alongside this file.
(ssr as unknown as { imports: string[] }).imports = ["ilha:pages/server"];

export default ssr;
