import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  __setAlsBypassForTests,
  __setInWebcontainerForTests,
  runWithIslandRequest,
  REQUEST_ALS_KEY,
} from "./request-scope";

const OXIDE_RUN_WITH_REQUEST = Symbol.for("oxidejs.runWithRequest");

interface TestGlobalScope {
  [OXIDE_RUN_WITH_REQUEST]?: <T>(req: Request, fn: () => T) => T;
  [REQUEST_ALS_KEY]?: { getStore: () => Request | undefined };
}

const testGlobal = (): TestGlobalScope => {
  // SAFETY: tests only touch the oxidejs hook and ilha ALS slots on globalThis.
  const g = globalThis as TestGlobalScope;
  return g;
};

const requestPath = (request: Request | undefined): string | undefined => {
  if (!request) {
    return undefined;
  }
  return new URL(request.url).pathname;
};

describe("runWithIslandRequest", () => {
  test("enters a host request scope when the oxidejs hook is installed", () => {
    // Simulate oxidejs having loaded and installed its hook: it runs `fn`
    // inside its own AsyncLocalStorage so useRequest() can resolve.
    const g = testGlobal();
    const hostAls = new AsyncLocalStorage<Request>();
    let entered = 0;
    g[OXIDE_RUN_WITH_REQUEST] = (req, fn) =>
      hostAls.run(req, () => {
        entered += 1;
        return fn();
      });

    const request = new Request("https://example.com/");
    runWithIslandRequest(request, () => {
      const ilhaScope = g[REQUEST_ALS_KEY]?.getStore();
      expect(ilhaScope).toBe(request);
      expect(hostAls.getStore()).toBe(request);
    });
    expect(entered).toBe(1);

    g[OXIDE_RUN_WITH_REQUEST] = undefined;
  });

  test("runs without the hook installed", () => {
    const g = testGlobal();
    const saved = g[OXIDE_RUN_WITH_REQUEST];
    g[OXIDE_RUN_WITH_REQUEST] = undefined;

    const request = new Request("https://example.com/");
    let ran = false;
    runWithIslandRequest(request, () => {
      ran = true;
    });
    expect(ran).toBe(true);

    if (saved) {
      g[OXIDE_RUN_WITH_REQUEST] = saved;
    }
  });

  test("isolates interleaved async requests via a single ALS scope", async () => {
    const captured: string[] = [];
    const g = testGlobal();
    const run = (label: string, delay: number) =>
      runWithIslandRequest(
        new Request(`https://example.com/${label}`),
        async () => {
          await Bun.sleep(delay);
          const store = g[REQUEST_ALS_KEY]?.getStore();
          // Each interleaved await must resolve back to ITS OWN request — never
          // a sibling's — proving no cross-request contamination.
          captured.push(store?.url ?? "none");
        }
      );
    await Promise.all([run("a", 30), run("b", 5)]);
    expect(captured).toContain("https://example.com/a");
    expect(captured).toContain("https://example.com/b");
  });

  test("WebContainer sync store keeps useContext request after await", async () => {
    __setInWebcontainerForTests(true);
    __setAlsBypassForTests(true);
    const g = testGlobal();
    try {
      const request = new Request("https://example.com/wc");
      const url = await runWithIslandRequest(request, async () => {
        await Promise.resolve();
        // ALS bypassed: only syncStore can answer.
        return g[REQUEST_ALS_KEY]?.getStore()?.url;
      });
      expect(url).toBe("https://example.com/wc");
      expect(g[REQUEST_ALS_KEY]?.getStore()).toBeUndefined();
    } finally {
      __setAlsBypassForTests(false);
      __setInWebcontainerForTests(null);
    }
  });

  test("WebContainer fallback serializes out-of-order concurrent entries", async () => {
    __setInWebcontainerForTests(true);
    __setAlsBypassForTests(true);
    const g = testGlobal();
    try {
      const gateA = Promise.withResolvers<null>();
      const seen: string[] = [];

      const first = runWithIslandRequest(
        new Request("https://example.com/first"),
        async () => {
          seen.push(`enter:${requestPath(g[REQUEST_ALS_KEY]?.getStore())}`);
          await gateA.promise;
          seen.push(`leave:${requestPath(g[REQUEST_ALS_KEY]?.getStore())}`);
          return requestPath(g[REQUEST_ALS_KEY]?.getStore());
        }
      );

      // Start second while first is still pending — must not run until first cleans up.
      const second = runWithIslandRequest(
        new Request("https://example.com/second"),
        async () => {
          seen.push(`enter:${requestPath(g[REQUEST_ALS_KEY]?.getStore())}`);
          await Promise.resolve();
          seen.push(`leave:${requestPath(g[REQUEST_ALS_KEY]?.getStore())}`);
          return requestPath(g[REQUEST_ALS_KEY]?.getStore());
        }
      );

      gateA.resolve(null);
      expect(await first).toBe("/first");
      expect(await second).toBe("/second");
      expect(seen).toEqual([
        "enter:/first",
        "leave:/first",
        "enter:/second",
        "leave:/second",
      ]);
      expect(g[REQUEST_ALS_KEY]?.getStore()).toBeUndefined();
    } finally {
      __setAlsBypassForTests(false);
      __setInWebcontainerForTests(null);
    }
  });
});
