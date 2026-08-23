import { afterEach, describe, expect, test } from "bun:test";

afterEach(() => {
  for (const key of [
    Symbol.for("ilha.frameGuard"),
    Symbol.for("ilha.frameLoaderRunner"),
    Symbol.for("oxidejs.runWithRequest"),
  ]) {
    delete (globalThis as unknown as Record<symbol, unknown>)[key];
  }
});

import {
  getServerIslandRenderer,
  registerServerIsland,
  setFrameGuard,
  setFrameLoaderRunner,
} from "./server-island-registry";
import handleFrame from "./ssr";

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

  test("renders a registered island and rejects unknown ids", async () => {
    registerServerIsland("test-island-id", () => () => "<p>hello</p>");
    const res = await handleFrame(post(JSON.stringify({ id: "test-island-id" })));
    expect(res?.status).toBe(200);
    expect((await res!.json()).html).toContain("hello");

    const miss = await handleFrame(post(JSON.stringify({ id: "nope" })));
    expect(miss?.status).toBe(400);
    expect(((await miss!.json()) as { error: string }).error).toBe("frame failed");
  });

  test("forwards global framework symbols without copying request internals", async () => {
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

  test("guard can reject a frame request", async () => {
    setFrameGuard((request) => {
      if (request.headers.get("x-test") === "deny") return new Response("denied", { status: 403 });
    });
    const denied = await handleFrame(post(JSON.stringify({ id: "x" }), { "x-test": "deny" }));
    expect(denied?.status).toBe(403);

    const allowed = await handleFrame(post(JSON.stringify({ id: "x" }), { "x-test": "allow" }));
    expect(allowed?.status).not.toBe(403);
  });

  test("registry lookup round-trips", () => {
    expect(getServerIslandRenderer("missing")).toBeUndefined();
    const entry = getServerIslandRenderer("test-island-id");
    expect(typeof entry?.render).toBe("function");
  });
});
