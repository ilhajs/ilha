import { afterEach, describe, expect, test } from "bun:test";

const SLOTS = [
  Symbol.for("ilha.frameGuard"),
  Symbol.for("ilha.loaderGuard"),
  Symbol.for("ilha.frameAuth"),
  Symbol.for("ilha.frameLoaderRunner"),
  Symbol.for("oxidejs.runWithRequest"),
];

afterEach(() => {
  for (const key of SLOTS) {
    delete (globalThis as unknown as Record<symbol, unknown>)[key];
  }
});

import {
  getServerIslandEntry,
  isTrustedOrigin,
  registerServerIsland,
  parseFrameProps,
  renderServerIsland,
  setFrameAuth,
  setFrameGuard,
  setFrameLoaderRunner,
  setLoaderGuard,
} from "./ssr";
import handleFrame from "./ssr";

/** Opt out of the production deny-by-default for tests that render unauth'd. */
const openFrames = (): void => setFrameAuth({ defaultAction: "open" });

// happy-dom strips forbidden headers (Origin, Cookie) from `new Request()`,
// so origin checks are unit-tested against a minimal request stub.
const stubRequest = (origin: string | undefined, host = "localhost"): Request =>
  ({
    headers: { get: (k: string) => (k === "origin" ? (origin ?? null) : host) },
  }) as unknown as Request;

const post = (body: string, headers: Record<string, string> = {}): Request =>
  new Request("http://localhost/__ilha/frame", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

describe("@ilha/router/ssr", () => {
  test("ignores unrelated paths; POST-only frame endpoint", async () => {
    expect(
      await handleFrame(new Request("http://localhost/other", { method: "POST" })),
    ).toBeUndefined();
    const res = await handleFrame(new Request("http://localhost/__ilha/frame", { method: "GET" }));
    expect(res?.status).toBe(405);
  });

  test("serves GET /__ilha/loader through the runner slot", async () => {
    openFrames();
    setFrameLoaderRunner(async (path: string) =>
      path === "/data"
        ? { kind: "data", data: { note: "hi" } }
        : { kind: "error", status: 404, message: "not found" },
    );
    const ok = await handleFrame(new Request("http://localhost/__ilha/loader?path=/data"));
    expect(ok?.status).toBe(200);
    expect((await ok!.json()).data).toEqual({ note: "hi" });

    const miss = await handleFrame(new Request("http://localhost/__ilha/loader?path=/nope"));
    // Runner outcomes forward their original status (not-found → 404).
    expect(miss?.status).toBe(404);
  });

  test("denies the loader endpoint by default when no guard is registered", async () => {
    setFrameLoaderRunner(async () => ({ kind: "data", data: {} }));
    const res = await handleFrame(new Request("http://localhost/__ilha/loader?path=/data"));
    expect(res?.status).toBe(403);
  });

  test("forwards the originating request to the loader runner in request scope", async () => {
    openFrames();
    let received: Request | undefined;
    (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("oxidejs.runWithRequest")] = (
      request: Request,
      fn: () => unknown,
    ) => {
      received = request;
      return fn();
    };
    const runnerCall: { path?: string; request?: Request } = {};
    setFrameLoaderRunner(async (path: string, request?: Request) => {
      runnerCall.path = path;
      runnerCall.request = request;
      return { kind: "data", data: {} };
    });
    const res = await handleFrame(
      new Request("http://localhost/__ilha/loader?path=/data", {
        headers: { authorization: "Bearer x" },
      }),
    );
    expect(res?.status).toBe(200);
    expect(runnerCall.path).toBe("/data");
    expect(runnerCall.request?.headers.get("authorization")).toBe("Bearer x");
    expect(received?.url).toBe("http://localhost/__ilha/loader?path=/data");
  });

  test("rejects backslash and double-slash loader targets", async () => {
    openFrames();
    setFrameLoaderRunner(async () => ({ kind: "data", data: {} }));
    const bs = await handleFrame(new Request("http://localhost/__ilha/loader?path=/\\evil.com"));
    expect(bs?.status).toBe(400);
    const ds = await handleFrame(new Request("http://localhost/__ilha/loader?path=//evil.com"));
    expect(ds?.status).toBe(400);
  });

  test("rejects backslash frame paths that would smuggle a foreign origin", async () => {
    openFrames();
    registerServerIsland("smuggle", () => () => "<p>ok</p>");
    const res = await handleFrame(post(JSON.stringify({ id: "smuggle", path: "/\\evil.com" })));
    expect(res?.status).toBe(400);
  });

  test("denies frames by default in production when no guard is registered", async () => {
    registerServerIsland("test-island-id", () => () => "<p>hello</p>");
    const res = await handleFrame(post(JSON.stringify({ id: "test-island-id" })));
    expect(res?.status).toBe(403);
  });

  test("renders a registered island and rejects unknown ids", async () => {
    openFrames();
    registerServerIsland("test-island-id", () => () => "<p>hello</p>");
    const res = await handleFrame(post(JSON.stringify({ id: "test-island-id" })));
    expect(res?.status).toBe(200);
    expect((await res!.json()).html).toContain("hello");

    const miss = await handleFrame(post(JSON.stringify({ id: "nope" })));
    expect(miss?.status).toBe(400);
    expect(((await miss!.json()) as { error: string }).error).toBe("frame failed");
  });

  test("isTrustedOrigin rejects a cross-origin Origin and allows absent/matching", () => {
    const policy = { defaultAction: "open" as const };
    expect(isTrustedOrigin(stubRequest("https://evil.example"), policy)).toBe(false);
    expect(isTrustedOrigin(stubRequest(undefined), policy)).toBe(true);
    expect(isTrustedOrigin(stubRequest("https://localhost"), policy)).toBe(true);
    expect(isTrustedOrigin(stubRequest("not a url"), policy)).toBe(false);
  });

  test("isTrustedOrigin honors an explicit trustedOrigins allowlist", () => {
    const policy = { defaultAction: "open" as const, trustedOrigins: ["https://app.example.com"] };
    expect(isTrustedOrigin(stubRequest("https://app.example.com"), policy)).toBe(true);
    expect(isTrustedOrigin(stubRequest("https://other.example"), policy)).toBe(false);
  });

  test("bounded body read rejects oversized frame bodies with 413", async () => {
    openFrames();
    const big = JSON.stringify({ id: "x", pad: "a".repeat(20 * 1024) });
    const res = await handleFrame(post(big));
    expect(res?.status).toBe(413);
  });

  test("forwards global framework symbols without copying request internals", async () => {
    openFrames();
    const framework = Symbol.for("test.requestContext");
    const internal = Symbol("internal");
    let scoped: Request | undefined;
    (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("oxidejs.runWithRequest")] = (
      request: Request,
      fn: () => unknown,
    ) => {
      scoped = request;
      return fn();
    };
    registerServerIsland("context-island", () => () => "<p>ok</p>");
    const request = post(JSON.stringify({ id: "context-island", path: "/tasks" }));
    (request as unknown as Record<symbol, unknown>)[framework] = { env: true };
    (request as unknown as Record<symbol, unknown>)[internal] = "private";

    expect((await handleFrame(request))?.status).toBe(200);
    expect((scoped as unknown as Record<symbol, unknown>)[framework]).toEqual({ env: true });
    expect((scoped as unknown as Record<symbol, unknown>)[internal]).toBeUndefined();
    expect(new URL(scoped!.url).pathname).toBe("/tasks");
  });

  test("does not forward client-supplied x-forwarded-for to the scoped request", async () => {
    openFrames();
    let scoped: Request | undefined;
    (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("oxidejs.runWithRequest")] = (
      request: Request,
      fn: () => unknown,
    ) => {
      scoped = request;
      return fn();
    };
    registerServerIsland("ctx", () => () => "<p>ok</p>");
    const request = post(JSON.stringify({ id: "ctx" }), {
      authorization: "Bearer x",
      "x-forwarded-for": "203.0.113.9",
    });
    expect((await handleFrame(request))?.status).toBe(200);
    expect(scoped?.headers.get("authorization")).toBe("Bearer x");
    expect(scoped?.headers.has("x-forwarded-for")).toBe(false);
  });

  test("guard can reject a frame request", async () => {
    setFrameGuard((request) => {
      if (request.headers.get("x-test") === "deny") return new Response("denied", { status: 403 });
    });
    const denied = await handleFrame(post(JSON.stringify({ id: "x" }), { "x-test": "deny" }));
    expect(denied?.status).toBe(403);

    const allowed = await handleFrame(post(JSON.stringify({ id: "x" }), { "x-test": "allow" }));
    expect(allowed?.status).not.toBe(403);
  });

  test("the optional CSRF verifier can reject a frame", async () => {
    setFrameAuth({
      defaultAction: "open",
      csrf: (request) => request.headers.get("x-csrf") === "valid-token",
    });
    const rejected = await handleFrame(post(JSON.stringify({ id: "x" })));
    expect(rejected?.status).toBe(403);
    const allowed = await handleFrame(
      post(JSON.stringify({ id: "x" }), { "x-csrf": "valid-token" }),
    );
    expect(allowed?.status).not.toBe(403);
  });

  test("a dedicated loader guard gates the loader endpoint", async () => {
    const blocked = new Response("blocked", { status: 403 });
    setLoaderGuard(() => blocked);
    setFrameLoaderRunner(async () => ({ kind: "data", data: {} }));
    const res = await handleFrame(new Request("http://localhost/__ilha/loader?path=/data"));
    expect(res?.status).toBe(403);
    // Falling back to the frame guard still gates loader data (compat).
    setLoaderGuard(undefined as never);
    setFrameGuard(() => blocked);
    const res2 = await handleFrame(new Request("http://localhost/__ilha/loader?path=/data"));
    expect(res2?.status).toBe(403);
  });

  test("nested island frames render with parent props", async () => {
    registerServerIsland(
      "greet",
      () => (props?: { name?: string }) => `Hello, ${props?.name ?? ""}!`,
    );
    const html = await renderServerIsland(
      "greet",
      new Request("http://localhost/"),
      (_r, fn) => fn(),
      undefined,
      { name: "Ada" },
    );
    expect(html).toBe("Hello, Ada!");
  });

  test("frame POST applies parent props", async () => {
    openFrames();
    registerServerIsland(
      "greet-http",
      () => (props?: { name?: string }) => `Hello, ${props?.name ?? ""}!`,
    );
    const res = await handleFrame(
      post(JSON.stringify({ id: "greet-http", props: { name: "Ada" } })),
    );
    expect(res?.status).toBe(200);
    expect((await res!.json()).html).toBe("Hello, Ada!");
  });

  test("parseFrameProps rejects non-objects", () => {
    expect(parseFrameProps(undefined)).toBeUndefined();
    expect(parseFrameProps(null)).toBeUndefined();
    expect(() => parseFrameProps([])).toThrow();
    expect(() => parseFrameProps("x")).toThrow();
  });

  test("registry lookup round-trips", () => {
    expect(getServerIslandEntry("missing")).toBeUndefined();
    const entry = getServerIslandEntry("test-island-id");
    expect(typeof entry?.render).toBe("function");
  });

  test("server-page load receives decoded route params", async () => {
    let captured: Record<string, string> | undefined;
    registerServerIsland("decoded-page", () => () => "<p>ok</p>", {
      pattern: "/user/:id",
      load: async ({ params }) => {
        captured = params;
        return {};
      },
    });
    const req = new Request("http://localhost/user/a%20b");
    await renderServerIsland("decoded-page", req, (_r, fn) => fn());
    expect(captured).toEqual({ id: "a b" });
  });

  test("server-page load exposes and returns head contributions", async () => {
    registerServerIsland("head-page", () => () => "<p>ok</p>", {
      load: ({ head }) => head({ title: "Server page" }),
    });
    let entries: unknown;
    await renderServerIsland(
      "head-page",
      new Request("http://localhost/learn"),
      (_request, fn) => fn(),
      (value) => (entries = value),
    );
    expect(entries).toEqual([{ title: "Server page" }]);
  });

  test("same-origin frame load redirects are emitted; cross-origin are blocked", async () => {
    openFrames();
    registerServerIsland("safe-redirect", () => () => "<p>ok</p>", {
      load: async () => {
        throw Object.assign(new Error("redirect"), {
          __ilhaRedirect: true,
          to: "/login",
          status: 302,
        });
      },
    });
    registerServerIsland("unsafe-redirect", () => () => "<p>ok</p>", {
      load: async () => {
        throw Object.assign(new Error("redirect"), {
          __ilhaRedirect: true,
          to: "https://evil.example/phish",
          status: 302,
        });
      },
    });

    const safe = await handleFrame(post(JSON.stringify({ id: "safe-redirect", path: "/" })));
    expect(safe?.status).toBe(302);
    expect(((await safe!.json()) as { redirect: string }).redirect).toBe("/login");

    const unsafe = await handleFrame(post(JSON.stringify({ id: "unsafe-redirect", path: "/" })));
    expect(unsafe?.status).toBe(500);
    expect(((await unsafe!.json()) as { redirect?: string }).redirect).toBeUndefined();
  });

  test("scoped request URL derives from the request origin, not the Host header", async () => {
    openFrames();
    let scopedUrl: string | undefined;
    (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("oxidejs.runWithRequest")] = (
      request: Request,
      fn: () => unknown,
    ) => {
      scopedUrl = request.url;
      return fn();
    };
    registerServerIsland("origin-check", () => () => "<p>ok</p>");
    const request = new Request("http://app.example.com/__ilha/frame", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "origin-check", path: "/tasks" }),
    });
    expect((await handleFrame(request))?.status).toBe(200);
    expect(scopedUrl).toBe("http://app.example.com/tasks");
  });
});
