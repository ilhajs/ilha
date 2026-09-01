import { afterEach, describe, expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

const SLOTS = [
  Symbol.for("ilha.frameGuard"),
  Symbol.for("ilha.frameAuth"),
  Symbol.for("oxidejs.runWithRequest"),
];

afterEach(() => {
  for (const key of SLOTS) {
    delete (globalThis as unknown as Record<symbol, unknown>)[key];
  }
});

import {
  frameScopedUrl,
  getServerIslandEntry,
  isTrustedOrigin,
  registerServerIsland,
  parseFrameProps,
  renderServerIsland,
  setFrameAuth,
  setFrameGuard,
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

  test("nested island frames render with parent props", async () => {
    registerServerIsland(
      "greet",
      () => (props?: { name?: string }) => `Hello, ${props?.name ?? ""}!`,
    );
    const result = await Effect.runPromise(
      Effect.result(
        renderServerIsland("greet", new Request("http://localhost/"), (_r, fn) => fn(), {
          name: "Ada",
        }),
      ),
    );
    expect(Result.isSuccess(result)).toBe(true);
    expect((result as { success: string }).success).toBe("Hello, Ada!");
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

  test("parseFrameProps strips prototype pollution keys", () => {
    const props = parseFrameProps(
      JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}},"safe":"ok"}'),
    );
    expect(props?.safe).toBe("ok");
    expect(Object.hasOwn(props ?? {}, "__proto__")).toBe(false);
    expect(Object.hasOwn(props ?? {}, "constructor")).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("parseFrameProps rejects deeply nested props", () => {
    let deep: unknown = { ok: true };
    for (let i = 0; i < 64; i++) deep = { nested: deep };
    expect(() => parseFrameProps({ nested: deep })).toThrow();
  });

  test("registry lookup round-trips", () => {
    expect(getServerIslandEntry("missing")).toBeUndefined();
    const entry = getServerIslandEntry("test-island-id");
    expect(typeof entry?.render).toBe("function");
  });

  test("frameScopedUrl uses absolute incoming origins", () => {
    expect(frameScopedUrl("http://app.example.com/__ilha/frame", "/tasks")).toBe(
      "http://app.example.com/tasks",
    );
    expect(frameScopedUrl("http://app.example.com/__ilha/frame", "/tasks", "http://evil.com")).toBe(
      "http://app.example.com/tasks",
    );
  });

  test("frameScopedUrl resolves relative incoming URLs against serverOrigin", () => {
    expect(frameScopedUrl("/__ilha/frame", "/tasks", "http://localhost:5173")).toBe(
      "http://localhost:5173/tasks",
    );
  });

  test("frameScopedUrl rejects host-only serverOrigin fallbacks", () => {
    expect(() => frameScopedUrl("/__ilha/frame", "/tasks", "evil.com")).toThrow(
      /serverOrigin must be an absolute URL/,
    );
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
