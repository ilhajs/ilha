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

import { runWithIslandRequest } from "./request-scope";
import {
  FrameError,
  getFrameAuth,
  getFrameGuard,
  getFrameLoaderRunner,
  getLoaderGuard,
  isTrustedOrigin,
  renderServerIsland,
} from "./server-island-registry";

export const FRAME_ENDPOINT = "/__ilha/frame";
/** Regular-page server loads: served through the loader-runner slot. */
export const LOADER_ENDPOINT = "/__ilha/loader";

/** Max request body size — matches the dev middleware cap. */
export const MAX_BODY = 16 * 1024;

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json;charset=utf-8",
    },
  });
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
    if (
      !target.startsWith("/") ||
      target.includes("//") ||
      target.includes("\\") ||
      target.length > 2048
    ) {
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

  // Guard hook (see setFrameGuard). Deny by default in production when no
  // guard is registered (island state is world-readable through frames), unless
  // the app opts out explicitly via `setFrameAuth({ defaultAction: "open" })`.
  const guard = getFrameGuard();
  if (!guard && (auth?.defaultAction ?? "deny") === "deny") {
    return json(403, { error: "frame failed" });
  }
  try {
    const denied = await guard?.(request);
    if (denied) return denied;
  } catch (error) {
    console.error("[ilha-router] frame guard failed:", error);
    return json(403, { error: "frame failed" });
  }
  // Optional CSRF verifier for the state-changing frame POST — covers
  // non-browser callers that send no `Origin`.
  if (auth?.csrf) {
    try {
      const ok = await auth.csrf(request);
      if (!ok) return json(403, { error: "frame failed" });
    } catch {
      return json(403, { error: "frame failed" });
    }
  }

  let id: string;
  let path = "/";
  try {
    const text = await readBodyBounded(request, MAX_BODY);
    if (text === null) return json(413, { error: "frame failed" });
    const body = JSON.parse(text) as { id?: unknown; path?: unknown };
    id = String(body.id ?? "");
    // Route context for server pages: the frame renders as if requested at
    // the client's current URL. Only path+search are honored — never a full
    // foreign origin. Backslash is rejected too: WHATWG URLs treat `\` as
    // `/` for http(s), so a `\evil.com` prefix would smuggle a new authority
    // past the plain `//` check. A supplied-but-invalid path fails closed
    // (400) instead of silently re-rendering at "/".
    if (typeof body.path === "string") {
      if (
        body.path.startsWith("/") &&
        !body.path.includes("//") &&
        !body.path.includes("\\") &&
        body.path.length <= 2048
      ) {
        path = body.path;
      } else {
        return json(400, { error: "frame failed" });
      }
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
    const headers = new Headers();
    for (const name of ["cookie", "authorization", "user-agent"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
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
    const html = await renderServerIsland(id, scoped, (scopedRequest, fn) =>
      Promise.resolve(runWithIslandRequest(scopedRequest, fn)),
    );
    return json(200, { html });
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
