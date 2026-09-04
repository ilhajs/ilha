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

import { withHeadStore } from "./head";
import { runWithIslandRequest } from "./request-scope";
import { sanitizeSnapshotObject } from "./snapshot";
import type { SnapshotObject, SnapshotValue } from "./snapshot";

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

const objectTag = <T>(value: T): string =>
  Object.prototype.toString.call(value);

type AnyFn = (...args: never[]) => void;

const isString = <T>(value: T): value is Extract<T, string> =>
  objectTag(value) === "[object String]";

const isFunction = <T>(value: T): value is Extract<T, AnyFn> => {
  const tag = objectTag(value);
  return (
    tag === "[object Function]" ||
    tag === "[object AsyncFunction]" ||
    tag === "[object GeneratorFunction]"
  );
};

const isObject = <T>(value: T): value is Extract<T, object> =>
  value !== null && objectTag(value) === "[object Object]";

/** JSON payload for frame envelopes. */
export type FrameJsonValue =
  | string
  | number
  | boolean
  | null
  | FrameJsonValue[]
  | FrameJsonObject;

export interface FrameJsonObject {
  readonly [key: string]: FrameJsonValue | undefined;
}

/** A frame render: optionally preceded by running the page's `load`. */
export interface ServerIslandEntry {
  /** Returns the renderState fn (`Symbol.for("ilha.renderState")` getter). */
  render: () => ServerIslandRenderFn;
}

export type ServerIslandRenderFn = (
  props?: SnapshotObject
) => string | Promise<string> | object;

export type FrameGuard = (
  request: Request
) => Response | undefined | Promise<Response | undefined>;

type GlobalSymbolSlots = Record<
  symbol,
  Map<string, ServerIslandEntry> | FrameGuard | FrameAuthPolicy | undefined
>;

const REGISTRY_KEY = Symbol.for("ilha.serverIslandRenderers");

const registry = (): Map<string, ServerIslandEntry> => {
  // SAFETY: the registry lives on a global symbol so every module copy
  // (plugin bundle, SSR graph, frame handler) shares one instance.
  const g = globalThis as GlobalSymbolSlots;
  const existing = g[REGISTRY_KEY];
  if (existing instanceof Map) {
    return existing;
  }
  const map = new Map<string, ServerIslandEntry>();
  g[REGISTRY_KEY] = map;
  return map;
};

const GUARD_KEY = Symbol.for("ilha.frameGuard");

/**
 * Install a guard consulted by every `/__ilha/frame` request (dev middleware
 * and the production `@ilha/router/ssr` handler share this slot — both read
 * it from `globalThis`). Return a `Response` to reject; return nothing to
 * allow. Island state is world-readable through frames unless you gate them,
 * so apps serving private data should install a session check here.
 */
export const setFrameGuard = (guard: FrameGuard): void => {
  // SAFETY: global symbol slot shared across module copies; undefined means
  // "no guard registered" and the production handler denies frames.
  const g = globalThis as GlobalSymbolSlots;
  g[GUARD_KEY] = guard;
};

export const getFrameGuard = (): FrameGuard | undefined => {
  // SAFETY: mirrors the setter's symbol slot contract.
  const g = globalThis as GlobalSymbolSlots;
  const slot = g[GUARD_KEY];
  if (!isFunction(slot)) {
    return undefined;
  }
  // SAFETY: GUARD_KEY is only written by setFrameGuard with a FrameGuard.
  return slot as FrameGuard;
};

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
export const setFrameAuth = (policy: FrameAuthPolicy): void => {
  // SAFETY: global symbol slot shared across module copies; undefined means
  // frame-auth defaults apply (deny when no guard is registered).
  const g = globalThis as GlobalSymbolSlots;
  g[AUTH_KEY] = policy;
};

export const getFrameAuth = (): FrameAuthPolicy | undefined => {
  // SAFETY: mirrors the setter's symbol slot contract.
  const g = globalThis as GlobalSymbolSlots;
  const slot = g[AUTH_KEY];
  // SAFETY: AUTH_KEY only stores FrameAuthPolicy objects written by setFrameAuth.
  return isObject(slot) ? (slot as FrameAuthPolicy) : undefined;
};

const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/**
 * Same-origin check for frame/loader requests. Browsers always send `Origin`
 * on cross-origin and same-origin `POST`; its absence implies a non-browser
 * caller (allowed — gate those via a guard or `csrf`). When `Origin` is
 * present it must match the configured trusted origins, else the request's
 * own `Host`.
 */
export const isTrustedOrigin = (
  request: Request,
  policy: FrameAuthPolicy | undefined
): boolean => {
  const originHeader = request.headers.get("origin");
  if (originHeader === null) {
    return true;
  }
  const origin = normalizeOrigin(originHeader);
  if (origin === null) {
    return false;
  }
  const trusted = policy?.trustedOrigins ?? [];
  if (trusted.length > 0) {
    return trusted.some((o) => normalizeOrigin(o) === origin);
  }
  const host = request.headers.get("host");
  if (!host) {
    return false;
  }
  return origin === `https://${host}` || origin === `http://${host}`;
};

/**
 * Path-only route context for frame/loader scoped requests. Leading slash,
 * no `//` or backslash (WHATWG URLs treat `\` as `/` for http(s), so a
 * `\evil.com` prefix would smuggle a foreign authority past a plain `//`
 * check), bounded length. `false` for anything else.
 */
export const isSafeFramePath = (framePath: string): boolean =>
  framePath.startsWith("/") &&
  !framePath.includes("//") &&
  !framePath.includes("\\") &&
  framePath.length <= 2048;

const parseServerOrigin = (value: string): string => {
  if (!value.includes("://")) {
    throw new Error("frameScopedUrl: serverOrigin must be an absolute URL");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("frameScopedUrl: serverOrigin must be http(s)");
  }
  return parsed.origin;
};

/**
 * Build the scoped frame render URL from the incoming request URL and frame
 * path. Absolute `incomingUrl` values supply the origin. Relative values (for
 * example Vite's `req.url`) require an explicit trusted `serverOrigin` — never
 * a client `Host` header.
 */
export const frameScopedUrl = (
  incomingUrl: string,
  framePath: string,
  serverOrigin?: string
): string => {
  let origin: string;
  try {
    const incoming = new URL(incomingUrl);
    if (incoming.protocol !== "http:" && incoming.protocol !== "https:") {
      throw new TypeError("unsupported protocol");
    }
    ({ origin } = incoming);
  } catch {
    if (serverOrigin === null || serverOrigin === undefined) {
      throw new Error(
        "frameScopedUrl: relative incomingUrl requires serverOrigin"
      );
    }
    origin = parseServerOrigin(serverOrigin);
  }
  return new URL(framePath, origin).href;
};

/** Identity headers forwarded onto scoped render/loader requests. */
const FORWARD_IDENTITY_HEADERS = [
  "cookie",
  "authorization",
  "user-agent",
] as const;

type HeaderSource =
  | Headers
  | Readonly<Record<string, string | string[] | undefined>>;

/**
 * Copy identity headers (cookie, authorization, user-agent) onto a fresh
 * `Headers`. Accepts a `Headers` or a Node `IncomingHttpHeaders`-style plain
 * object. Client-supplied `x-forwarded-for` is deliberately NOT forwarded —
 * it is spoofable and must not be trusted by loaders for IP checks.
 */
export const forwardIdentityHeaders = (source: HeaderSource): Headers => {
  const out = new Headers();
  const read = (name: string): string | null | undefined => {
    if (source instanceof Headers) {
      return source.get(name);
    }
    const v = source[name];
    return Array.isArray(v) ? v[0] : v;
  };
  for (const name of FORWARD_IDENTITY_HEADERS) {
    const v = read(name);
    if (v !== null && v !== undefined) {
      out.set(name, v);
    }
  }
  return out;
};

/** No-store JSON envelope shared by dev and production frame handlers. */
export interface FrameEnvelope {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export const frameEnvelope = (
  status: number,
  body: FrameJsonObject
): FrameEnvelope => ({
  body: JSON.stringify(body),
  headers: {
    "cache-control": "no-store",
    "content-type": "application/json;charset=utf-8",
  },
  status,
});

interface AtomTagged {
  $$atom?: number;
}

/** Brand an exported server action with its generated RPC transport key. */
export const __ilhaServerAction = <A extends SnapshotValue[], R>(
  key: string,
  fn: (...args: A) => R | Promise<R>
) => {
  // SAFETY: oxide action handles carry $$atom === 1; plain functions are wrapped.
  const tagged = fn as AtomTagged & typeof fn;
  // SAFETY: $$atom brand marks an existing oxide action; otherwise wrap with action().
  const handle =
    tagged.$$atom === 1
      ? (fn as ReturnType<typeof action<A, Awaited<R>>>)
      : action(fn as (...args: A) => Awaited<R>);
  return brandServerAction(key, handle);
};

export const registerServerIsland = (
  id: string,
  render: () => ServerIslandRenderFn
): void => {
  registry().set(id, { render });
};

export const getServerIslandEntry = (
  id: string
): ServerIslandEntry | undefined => registry().get(id);

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
  new FrameError({ message: message ?? "frame failed", status });

const renderToStringOf = async (
  render: ServerIslandRenderFn,
  props: SnapshotObject | undefined
): Promise<string> => {
  const out = render(props);
  const view = await Promise.resolve(out);
  if (isString(view)) {
    return view;
  }
  // SAFETY: non-string render output is a View accepted by renderToString.
  return renderToString(() => view as never, {
    captureActions: true,
    markers: false,
  });
};

/**
 * Render a registered server island. Typed error channel: the only failure is
 * `FrameError`; everything else is a defect surfaced as a 400 to the client.
 */
export const renderServerIsland = (
  id: string,
  request: Request,
  runWithScope: <T>(request: Request, fn: () => T) => T | Promise<T>,
  incomingProps?: SnapshotObject
): Effect.Effect<string, FrameError> =>
  Effect.gen(function* renderIsland() {
    const entry = registry().get(id);
    if (!entry) {
      return yield* Effect.fail(frameFail(400, "unknown island"));
    }
    const render = entry.render();
    if (!isFunction(render)) {
      return yield* Effect.fail(frameFail(400, "unknown island"));
    }
    return yield* Effect.tryPromise({
      catch: (error): FrameError =>
        error instanceof FrameError
          ? error
          : frameFail(400, error instanceof Error ? error.message : undefined),
      try: async () =>
        await runWithScope(request, () =>
          withHeadStore({ entries: [] }, () =>
            renderToStringOf(render, incomingProps)
          )
        ),
    });
  });

/** Convenience for non-Effect callers: run the render and resolve to a Result. */
export const renderServerIslandResult = (
  id: string,
  request: Request,
  runWithScope: <T>(request: Request, fn: () => T) => T | Promise<T>,
  incomingProps?: SnapshotObject
): Promise<Result.Result<string, FrameError>> =>
  Effect.runPromise(
    Effect.result(renderServerIsland(id, request, runWithScope, incomingProps))
  );

// ─── Endpoints ───────────────────────────────────────────────────────────

export const FRAME_ENDPOINT = "/__ilha/frame";
/** Max request body size — matches the dev middleware cap. */
export const MAX_BODY = 16 * 1024;

/** Parent-island props on a frame POST. Missing is fine; anything else is 400. */
export const parseFrameProps = <T>(value?: T): SnapshotObject | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!isObject(value) || Array.isArray(value)) {
    throw new FrameError({ message: "frame failed", status: 400 });
  }
  const sanitized = sanitizeSnapshotObject(value);
  if (!sanitized) {
    throw new FrameError({ message: "frame failed", status: 400 });
  }
  return sanitized;
};

export const json = (status: number, body: FrameJsonObject): Response => {
  const env = frameEnvelope(status, body);
  return new Response(env.body, { headers: env.headers, status: env.status });
};

const readChunksBounded = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  chunks: Uint8Array[],
  size: number
): Promise<Uint8Array[] | null> => {
  const { done, value } = await reader.read();
  if (done) {
    return chunks;
  }
  const nextSize = size + (value?.byteLength ?? 0);
  if (nextSize > maxBytes) {
    try {
      await reader.cancel();
    } catch {
      void 0;
    }
    return null;
  }
  if (value) {
    chunks.push(value);
  }
  return readChunksBounded(reader, maxBytes, chunks, nextSize);
};

/**
 * Read a request body as UTF-8, streaming it with a hard byte cap. Returns
 * `null` when the body exceeds `maxBytes` (the reader is cancelled before the
 * cap is far exceeded) or when decoding fails.
 */
export const readBodyBounded = async (
  request: Request,
  maxBytes: number
): Promise<string | null> => {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    return null;
  }
  const reader = request.body?.getReader();
  if (!reader) {
    return "";
  }
  const chunks = await readChunksBounded(reader, maxBytes, [], 0);
  if (chunks === null) {
    return null;
  }
  const decoder = new TextDecoder();
  return (
    chunks.map((c) => decoder.decode(c, { stream: true })).join("") +
    decoder.decode()
  );
};

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
export const authorizeFrameRequest = async (
  request: Request,
  options: {
    defaultAction: "open" | "deny";
    onGuardError?: <E>(error: E) => void;
  }
): Promise<
  { ok: true; identityHeaders: Headers } | { ok: false; status: number }
> => {
  const auth = getFrameAuth();
  if (!isTrustedOrigin(request, auth)) {
    return { ok: false, status: 403 };
  }

  const guard = getFrameGuard();
  if (!guard && (auth?.defaultAction ?? "deny") === "deny") {
    return { ok: false, status: 403 };
  }
  try {
    const denied = await guard?.(request);
    if (denied) {
      return { ok: false, status: denied.status };
    }
  } catch (error) {
    options.onGuardError?.(error);
    return { ok: false, status: 403 };
  }
  if (auth?.csrf) {
    try {
      const ok = await auth.csrf(request);
      if (!ok) {
        return { ok: false, status: 403 };
      }
    } catch {
      return { ok: false, status: 403 };
    }
  }
  return { identityHeaders: forwardIdentityHeaders(request.headers), ok: true };
};

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
