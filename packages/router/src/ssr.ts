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
  getFrameGuard,
  getFrameLoaderRunner,
  renderServerIsland,
} from "./server-island-registry";

export const FRAME_ENDPOINT = "/__ilha/frame";
/** Regular-page server loads: served through the loader-runner slot. */
export const LOADER_ENDPOINT = "/__ilha/loader";

/** Max request body size — matches the dev middleware cap. */
const MAX_BODY = 16 * 1024;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json;charset=utf-8",
    },
  });
}

async function ssr(request: Request): Promise<Response | undefined> {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return json(400, { error: "frame failed" });
  }
  if (pathname !== FRAME_ENDPOINT && pathname !== LOADER_ENDPOINT) return;

  // Same-origin defense, matching the dev middleware.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && origin !== `http://${host}` && origin !== `https://${host}`) {
    return json(403, { error: "frame failed" });
  }

  // ── Loader endpoint: regular-page server loads via pageRouter.runLoader ──
  if (pathname === LOADER_ENDPOINT) {
    if (request.method !== "GET") return json(405, { error: "method not allowed" });
    try {
      const denied = await getFrameGuard()?.(request);
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
    if (!target.startsWith("/") || target.includes("//") || target.length > 2048) {
      return json(400, { kind: "error", status: 400, message: "bad request" });
    }
    try {
      const result = await runner(target);
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

  // Guard hook (see setFrameGuard): island state is world-readable through
  // frames unless the app gates them. A returned Response rejects the request.
  try {
    const denied = await getFrameGuard()?.(request);
    if (denied) return denied;
  } catch (error) {
    console.error("[ilha-router] frame guard failed:", error);
    return json(403, { error: "frame failed" });
  }

  let id: string;
  let path = "/";
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { error: "frame failed" });
    const body = JSON.parse(text) as { id?: unknown; path?: unknown };
    id = String(body.id ?? "");
    // Route context for server pages: the frame renders as if requested at
    // the client's current URL. Only path+search are honored — never a full
    // foreign origin.
    if (
      typeof body.path === "string" &&
      body.path.startsWith("/") &&
      !body.path.includes("//") &&
      body.path.length <= 2048
    ) {
      path = body.path;
    }
  } catch {
    return json(400, { error: "frame failed" });
  }

  try {
    // Synthesize a Request for the render/loader scope: the frame's route
    // path with identity headers (cookie, auth, UA) forwarded.
    const headers = new Headers();
    for (const name of ["cookie", "authorization", "user-agent", "x-forwarded-for"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const scoped = new Request(new URL(path, `http://${host ?? "localhost"}`), {
      method: "POST",
      headers,
    });
    // Forward framework request context (symbol-keyed expandos, e.g.
    // oxidejs's env/fetch-ctx marker) to the scoped request.
    for (const sym of Object.getOwnPropertySymbols(request)) {
      if (Symbol.keyFor(sym) === undefined) continue;
      try {
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
(ssr as unknown as { imports: string[] }).imports = ["ilha:pages/server", "ilha:loaders"];

export default ssr;
