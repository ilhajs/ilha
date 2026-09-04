import { afterEach, describe, expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import handleFrame, {
  frameScopedUrl,
  getServerIslandEntry,
  isTrustedOrigin,
  registerServerIsland,
  parseFrameProps,
  renderServerIsland,
  setFrameAuth,
  setFrameGuard,
} from "./ssr";
import type { FrameAuthPolicy, FrameGuard } from "./ssr";

const FRAME_GUARD = Symbol.for("ilha.frameGuard");
const FRAME_AUTH = Symbol.for("ilha.frameAuth");
const OXIDE_RUN_WITH_REQUEST = Symbol.for("oxidejs.runWithRequest");
const FRAMEWORK_CTX = Symbol.for("test.requestContext");
const INTERNAL_CTX = Symbol("internal");

type RunWithRequest = <T>(request: Request, fn: () => T) => T;

interface SsrTestGlobal {
  [FRAME_GUARD]?: FrameGuard;
  [FRAME_AUTH]?: FrameAuthPolicy;
  [OXIDE_RUN_WITH_REQUEST]?: RunWithRequest;
}

interface TaggedRequest {
  [FRAMEWORK_CTX]?: { env: boolean };
  [INTERNAL_CTX]?: string;
}

interface Nested {
  nested: Nested | { ok: true };
}

interface FrameJson {
  html?: string;
  error?: string;
}

interface PollutionProbe {
  polluted?: number;
}

const testGlobal = (): SsrTestGlobal => {
  // SAFETY: tests clear/install frame guard, auth, and oxide hook slots on globalThis.
  const g = globalThis as SsrTestGlobal;
  return g;
};

const asRequest = <T>(value: T): Request => {
  // SAFETY: happy-dom strips Origin; stub only exposes headers.get for isTrustedOrigin.
  const request = value as Request;
  return request;
};

const tagRequest = <T>(request: T): T & TaggedRequest => {
  // SAFETY: test attaches only framework/internal symbol slots onto the Request.
  const tagged = request as T & TaggedRequest;
  return tagged;
};

afterEach(() => {
  const g = testGlobal();
  g[FRAME_GUARD] = undefined;
  g[FRAME_AUTH] = undefined;
  g[OXIDE_RUN_WITH_REQUEST] = undefined;
});

/** Opt out of the production deny-by-default for tests that render unauth'd. */
const openFrames = (): void => setFrameAuth({ defaultAction: "open" });

// happy-dom strips forbidden headers (Origin, Cookie) from `new Request()`,
// so origin checks are unit-tested against a minimal request stub.
const stubRequest = (origin?: string, host = "localhost"): Request =>
  asRequest({
    headers: {
      get: (k: string) => (k === "origin" ? (origin ?? null) : host),
    },
  });

const post = (body: string, headers: Record<string, string> = {}): Request =>
  new Request("http://localhost/__ilha/frame", {
    body,
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });

const readFrameJson = async (res: Response | undefined): Promise<FrameJson> => {
  expect(res).toBeDefined();
  if (res === undefined) {
    return {};
  }
  // SAFETY: frame endpoint JSON is { html?, error? } in these tests.
  return (await res.json()) as FrameJson;
};

describe("@ilha/router/ssr", () => {
  test("ignores unrelated paths; POST-only frame endpoint", async () => {
    expect(
      await handleFrame(
        new Request("http://localhost/other", { method: "POST" })
      )
    ).toBeUndefined();
    const res = await handleFrame(
      new Request("http://localhost/__ilha/frame", { method: "GET" })
    );
    expect(res?.status).toBe(405);
  });

  test("rejects backslash frame paths that would smuggle a foreign origin", async () => {
    openFrames();
    registerServerIsland("smuggle", () => () => "<p>ok</p>");
    const res = await handleFrame(
      post(JSON.stringify({ id: "smuggle", path: "/\\evil.com" }))
    );
    expect(res?.status).toBe(400);
  });

  test("denies frames by default in production when no guard is registered", async () => {
    registerServerIsland("test-island-id", () => () => "<p>hello</p>");
    const res = await handleFrame(
      post(JSON.stringify({ id: "test-island-id" }))
    );
    expect(res?.status).toBe(403);
  });

  test("renders a registered island and rejects unknown ids", async () => {
    openFrames();
    registerServerIsland("test-island-id", () => () => "<p>hello</p>");
    const res = await handleFrame(
      post(JSON.stringify({ id: "test-island-id" }))
    );
    expect(res?.status).toBe(200);
    const okBody = await readFrameJson(res);
    expect(okBody.html).toContain("hello");

    const miss = await handleFrame(post(JSON.stringify({ id: "nope" })));
    expect(miss?.status).toBe(400);
    const missBody = await readFrameJson(miss);
    expect(missBody.error).toBe("frame failed");
  });

  test("isTrustedOrigin rejects a cross-origin Origin and allows absent/matching", () => {
    const policy = { defaultAction: "open" as const };
    expect(isTrustedOrigin(stubRequest("https://evil.example"), policy)).toBe(
      false
    );
    expect(isTrustedOrigin(stubRequest(), policy)).toBe(true);
    expect(isTrustedOrigin(stubRequest("https://localhost"), policy)).toBe(
      true
    );
    expect(isTrustedOrigin(stubRequest("not a url"), policy)).toBe(false);
  });

  test("isTrustedOrigin honors an explicit trustedOrigins allowlist", () => {
    const policy = {
      defaultAction: "open" as const,
      trustedOrigins: ["https://app.example.com"],
    };
    expect(
      isTrustedOrigin(stubRequest("https://app.example.com"), policy)
    ).toBe(true);
    expect(isTrustedOrigin(stubRequest("https://other.example"), policy)).toBe(
      false
    );
  });

  test("bounded body read rejects oversized frame bodies with 413", async () => {
    openFrames();
    const big = JSON.stringify({ id: "x", pad: "a".repeat(20 * 1024) });
    const res = await handleFrame(post(big));
    expect(res?.status).toBe(413);
  });

  test("forwards global framework symbols without copying request internals", async () => {
    openFrames();
    let scoped: (Request & TaggedRequest) | undefined;
    testGlobal()[OXIDE_RUN_WITH_REQUEST] = <T>(
      request: Request,
      fn: () => T
    ) => {
      scoped = tagRequest(request);
      return fn();
    };
    registerServerIsland("context-island", () => () => "<p>ok</p>");
    const request = tagRequest(
      post(JSON.stringify({ id: "context-island", path: "/tasks" }))
    );
    request[FRAMEWORK_CTX] = { env: true };
    request[INTERNAL_CTX] = "private";

    const framed = await handleFrame(request);
    expect(framed?.status).toBe(200);
    expect(scoped?.[FRAMEWORK_CTX]).toEqual({ env: true });
    expect(scoped?.[INTERNAL_CTX]).toBeUndefined();
    expect(scoped).toBeDefined();
    if (scoped === undefined) {
      return;
    }
    expect(new URL(scoped.url).pathname).toBe("/tasks");
  });

  test("does not forward client-supplied x-forwarded-for to the scoped request", async () => {
    openFrames();
    let scoped: Request | undefined;
    testGlobal()[OXIDE_RUN_WITH_REQUEST] = <T>(
      request: Request,
      fn: () => T
    ) => {
      scoped = request;
      return fn();
    };
    registerServerIsland("ctx", () => () => "<p>ok</p>");
    const request = post(JSON.stringify({ id: "ctx" }), {
      authorization: "Bearer x",
      "x-forwarded-for": "203.0.113.9",
    });
    const framed = await handleFrame(request);
    expect(framed?.status).toBe(200);
    expect(scoped?.headers.get("authorization")).toBe("Bearer x");
    expect(scoped?.headers.has("x-forwarded-for")).toBe(false);
  });

  test("guard can reject a frame request", async () => {
    setFrameGuard((request) => {
      if (request.headers.get("x-test") === "deny") {
        return new Response("denied", { status: 403 });
      }
    });
    const denied = await handleFrame(
      post(JSON.stringify({ id: "x" }), { "x-test": "deny" })
    );
    expect(denied?.status).toBe(403);

    const allowed = await handleFrame(
      post(JSON.stringify({ id: "x" }), { "x-test": "allow" })
    );
    expect(allowed?.status).not.toBe(403);
  });

  test("the optional CSRF verifier can reject a frame", async () => {
    setFrameAuth({
      csrf: (request) => request.headers.get("x-csrf") === "valid-token",
      defaultAction: "open",
    });
    const rejected = await handleFrame(post(JSON.stringify({ id: "x" })));
    expect(rejected?.status).toBe(403);
    const allowed = await handleFrame(
      post(JSON.stringify({ id: "x" }), { "x-csrf": "valid-token" })
    );
    expect(allowed?.status).not.toBe(403);
  });

  test("nested island frames render with parent props", async () => {
    registerServerIsland(
      "greet",
      () => (props?: { name?: string }) => `Hello, ${props?.name ?? ""}!`
    );
    const result = await Effect.runPromise(
      Effect.result(
        renderServerIsland(
          "greet",
          new Request("http://localhost/"),
          (_r, fn) => fn(),
          {
            name: "Ada",
          }
        )
      )
    );
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) {
      return;
    }
    expect(result.success).toBe("Hello, Ada!");
  });

  test("frame POST applies parent props", async () => {
    openFrames();
    registerServerIsland(
      "greet-http",
      () => (props?: { name?: string }) => `Hello, ${props?.name ?? ""}!`
    );
    const res = await handleFrame(
      post(JSON.stringify({ id: "greet-http", props: { name: "Ada" } }))
    );
    expect(res?.status).toBe(200);
    const body = await readFrameJson(res);
    expect(body.html).toBe("Hello, Ada!");
  });

  test("parseFrameProps rejects non-objects", () => {
    expect(parseFrameProps()).toBeUndefined();
    expect(parseFrameProps(null)).toBeUndefined();
    expect(() => parseFrameProps([])).toThrow();
    expect(() => parseFrameProps("x")).toThrow();
  });

  test("parseFrameProps strips prototype pollution keys", () => {
    const props = parseFrameProps(
      JSON.parse(
        '{"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}},"safe":"ok"}'
      )
    );
    expect(props?.safe).toBe("ok");
    expect(Object.hasOwn(props ?? {}, "__proto__")).toBe(false);
    expect(Object.hasOwn(props ?? {}, "constructor")).toBe(false);
    const probe: PollutionProbe = {};
    expect(probe.polluted).toBeUndefined();
  });

  test("parseFrameProps rejects deeply nested props", () => {
    let deep: Nested | { ok: true } = { ok: true };
    for (let i = 0; i < 64; i += 1) {
      deep = { nested: deep };
    }
    expect(() => parseFrameProps({ nested: deep })).toThrow();
  });

  test("registry lookup round-trips", () => {
    expect(getServerIslandEntry("missing")).toBeUndefined();
    const entry = getServerIslandEntry("test-island-id");
    expect(Object.prototype.toString.call(entry?.render)).toBe(
      "[object Function]"
    );
  });

  test("frameScopedUrl uses absolute incoming origins", () => {
    expect(
      frameScopedUrl("http://app.example.com/__ilha/frame", "/tasks")
    ).toBe("http://app.example.com/tasks");
    expect(
      frameScopedUrl(
        "http://app.example.com/__ilha/frame",
        "/tasks",
        "http://evil.com"
      )
    ).toBe("http://app.example.com/tasks");
  });

  test("frameScopedUrl resolves relative incoming URLs against serverOrigin", () => {
    expect(
      frameScopedUrl("/__ilha/frame", "/tasks", "http://localhost:5173")
    ).toBe("http://localhost:5173/tasks");
  });

  test("frameScopedUrl rejects host-only serverOrigin fallbacks", () => {
    expect(() => frameScopedUrl("/__ilha/frame", "/tasks", "evil.com")).toThrow(
      /serverOrigin must be an absolute URL/u
    );
  });

  test("scoped request URL derives from the request origin, not the Host header", async () => {
    openFrames();
    let scopedUrl: string | undefined;
    testGlobal()[OXIDE_RUN_WITH_REQUEST] = <T>(
      request: Request,
      fn: () => T
    ) => {
      scopedUrl = request.url;
      return fn();
    };
    registerServerIsland("origin-check", () => () => "<p>ok</p>");
    const request = new Request("http://app.example.com/__ilha/frame", {
      body: JSON.stringify({ id: "origin-check", path: "/tasks" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const framed = await handleFrame(request);
    expect(framed?.status).toBe(200);
    expect(scopedUrl).toBe("http://app.example.com/tasks");
  });
});
