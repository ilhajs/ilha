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
 *
 * Frame helpers live in `./frame` (no oxidejs). `__ilhaServerAction` lives in
 * `./oxide-action` so `@ilha/router/vite` can load the pages plugin without
 * the optional oxide peer.
 */

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import {
  FRAME_ENDPOINT,
  FrameError,
  authorizeFrameRequest,
  forwardIdentityHeaders,
  frameScopedUrl,
  getFrameAuth,
  isSafeFramePath,
  isTrustedOrigin,
  json,
  MAX_BODY,
  parseFrameProps,
  readBodyBounded,
  renderServerIsland,
} from "./frame";
import { runWithIslandRequest } from "./request-scope";
import type { SnapshotObject, SnapshotValue } from "./snapshot";

export {
  FRAME_ENDPOINT,
  FrameError,
  MAX_BODY,
  authorizeFrameRequest,
  forwardIdentityHeaders,
  frameEnvelope,
  frameScopedUrl,
  getFrameAuth,
  getFrameGuard,
  getServerIslandEntry,
  isSafeFramePath,
  isTrustedOrigin,
  json,
  parseFrameProps,
  readBodyBounded,
  registerServerIsland,
  renderServerIsland,
  renderServerIslandResult,
  setFrameAuth,
  setFrameGuard,
} from "./frame";
export type {
  FrameAuthPolicy,
  FrameEnvelope,
  FrameGuard,
  FrameJsonObject,
  FrameJsonValue,
  ServerIslandEntry,
  ServerIslandRenderFn,
} from "./frame";

export { __ilhaServerAction } from "./oxide-action";

const objectTag = <T>(value: T): string =>
  Object.prototype.toString.call(value);

const isString = <T>(value: T): value is Extract<T, string> =>
  objectTag(value) === "[object String]";

interface FrameRequestBody {
  id?: SnapshotValue;
  path?: SnapshotValue;
  props?: SnapshotValue;
}

const copyFrameworkSymbols = (from: Request, to: Request): void => {
  // Forward framework request context (symbol-keyed expandos, e.g.
  // oxidejs's env/fetch-ctx marker) to the scoped request.
  // SAFETY: only registered (Symbol.keyFor) symbols are copied; arbitrary
  // private-symbol internals never leak onto the scoped request.
  for (const sym of Object.getOwnPropertySymbols(from)) {
    if (Symbol.keyFor(sym) === undefined) {
      continue;
    }
    const desc = Object.getOwnPropertyDescriptor(from, sym);
    if (!desc) {
      continue;
    }
    try {
      Object.defineProperty(to, sym, desc);
    } catch {
      // non-writable expando - skip
    }
  }
};

const frameFail = (status: number, message?: string): FrameError =>
  new FrameError({ message: message ?? "frame failed", status });

const ssr = async (request: Request): Promise<Response | undefined> => {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return json(400, { error: "frame failed" });
  }
  if (url.pathname !== FRAME_ENDPOINT) {
    return undefined;
  }

  const program: Effect.Effect<Response, FrameError> = Effect.gen(
    function* handleFrame() {
      const auth = getFrameAuth();
      // Same-origin defense for every owned endpoint. Browsers always send
      // `Origin` on POST/GET-over-fetch; a missing header implies a non-browser
      // caller, which is gated by the guards below / the CSRF check for frames.
      if (!isTrustedOrigin(request, auth)) {
        return yield* Effect.fail(frameFail(403));
      }

      // ── Frame endpoint: re-render a server island ──────────────────────────
      if (request.method !== "POST") {
        return yield* Effect.fail(frameFail(405));
      }
      if (
        !(request.headers.get("content-type") ?? "").startsWith(
          "application/json"
        )
      ) {
        return yield* Effect.fail(frameFail(415));
      }

      // Guard hook (see setFrameGuard) + CSRF, shared with the dev middleware.
      const authorized = yield* Effect.tryPromise({
        catch: () => frameFail(403),
        try: () =>
          authorizeFrameRequest(request, {
            defaultAction: auth?.defaultAction ?? "deny",
            onGuardError: (error) =>
              console.error("[ilha-router] frame guard failed:", error),
          }),
      });
      if (!authorized.ok) {
        return yield* Effect.fail(frameFail(authorized.status));
      }

      let id: string;
      let framePath = "/";
      let incomingProps: SnapshotObject | undefined;
      {
        const text = yield* Effect.tryPromise({
          catch: () => frameFail(400),
          try: () => readBodyBounded(request, MAX_BODY),
        });
        if (text === null) {
          return yield* Effect.fail(frameFail(413));
        }
        try {
          // SAFETY: frame POST body is JSON; fields validated below.
          const body = JSON.parse(text) as FrameRequestBody;
          id = String(body.id ?? "");
          incomingProps = parseFrameProps(body.props);
          // Route context: the frame renders as if requested at the client's
          // current URL. Only path+search are honored — never a full foreign
          // origin. Backslash is rejected too: WHATWG URLs treat `\\` as `/`
          // for http(s), so a `\\evil.com` prefix would smuggle a new
          // authority past the plain `//` check. A supplied-but-invalid path
          // fails closed (400) instead of silently re-rendering at "/".
          if (isString(body.path)) {
            if (!isSafeFramePath(body.path)) {
              return yield* Effect.fail(frameFail(400));
            }
            framePath = body.path;
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
      const scoped = new Request(frameScopedUrl(url.href, framePath), {
        headers: forwardIdentityHeaders(request.headers),
        method: "POST",
      });
      copyFrameworkSymbols(request, scoped);

      const html = yield* renderServerIsland(
        id,
        scoped,
        (scopedRequest, fn) =>
          Promise.resolve(runWithIslandRequest(scopedRequest, fn)),
        incomingProps
      );
      return json(200, { html });
    }
  );

  return await Effect.runPromise(
    Effect.map(
      Effect.result(program),
      Result.match({
        onFailure: (error) => {
          if (error.redirect) {
            return json(error.status, { redirect: error.redirect });
          }
          if (error.status >= 500) {
            console.error("[ilha-router] frame render failed:", error);
          }
          return json(error.status, { error: "frame failed" });
        },
        onSuccess: (response) => response,
      })
    )
  );
};

/** Side-effect imports required alongside this handler. */
interface SsrMiddleware {
  (request: Request): Promise<Response | undefined>;
  imports: string[];
}

// SAFETY: oxidejs middleware loader reads `.imports` on the default export
// to pull generated pages modules into the SSR graph alongside this file.
const ssrWithImports: SsrMiddleware = Object.assign(ssr, {
  imports: ["ilha:pages/server"],
});

export default ssrWithImports;
