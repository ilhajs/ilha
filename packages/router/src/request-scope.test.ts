import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

import { runWithIslandRequest, REQUEST_ALS_KEY } from "./request-scope";

const OXIDE_RUN_WITH_REQUEST = Symbol.for("oxidejs.runWithRequest");

interface TestGlobalScope {
  [OXIDE_RUN_WITH_REQUEST]?: <T>(req: Request, fn: () => T) => T;
  [REQUEST_ALS_KEY]?: AsyncLocalStorage<Request>;
}

const testGlobal = (): TestGlobalScope => {
  // SAFETY: tests only touch the oxidejs hook and ilha ALS slots on globalThis.
  const g = globalThis as TestGlobalScope;
  return g;
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
});
