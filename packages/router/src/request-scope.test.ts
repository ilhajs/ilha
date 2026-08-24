import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

import { runWithIslandRequest, REQUEST_ALS_KEY } from "./request-scope";

describe("runWithIslandRequest", () => {
  test("enters a host request scope when the oxidejs hook is installed", () => {
    // Simulate oxidejs having loaded and installed its hook: it runs `fn`
    // inside its own AsyncLocalStorage so useRequest() can resolve.
    const g = globalThis as unknown as Record<symbol, unknown>;
    const hostAls = new AsyncLocalStorage<Request>();
    let entered = 0;
    g[Symbol.for("oxidejs.runWithRequest")] = (req: Request, fn: () => void) =>
      hostAls.run(req, () => {
        entered++;
        return fn();
      });

    const request = new Request("https://example.com/");
    runWithIslandRequest(request, () => {
      const ilhaScope = (
        globalThis as unknown as Record<symbol, AsyncLocalStorage<Request> | undefined>
      )[REQUEST_ALS_KEY]!.getStore();
      expect(ilhaScope).toBe(request);
      expect(hostAls.getStore()).toBe(request);
    });
    expect(entered).toBe(1);

    delete g[Symbol.for("oxidejs.runWithRequest")];
  });

  test("runs without the hook installed", () => {
    const g = globalThis as unknown as Record<symbol, unknown>;
    const saved = g[Symbol.for("oxidejs.runWithRequest")];
    delete g[Symbol.for("oxidejs.runWithRequest")];

    const request = new Request("https://example.com/");
    let ran = false;
    runWithIslandRequest(request, () => {
      ran = true;
    });
    expect(ran).toBe(true);

    if (saved) g[Symbol.for("oxidejs.runWithRequest")] = saved;
  });

  test("isolates interleaved async requests via a single ALS scope", async () => {
    const captured: string[] = [];
    const run = (label: string, delay: number) =>
      new Promise<void>((resolve) => {
        runWithIslandRequest(new Request(`https://example.com/${label}`), async () => {
          await new Promise((r) => setTimeout(r, delay));
          const store = (
            globalThis as unknown as Record<symbol, AsyncLocalStorage<Request> | undefined>
          )[REQUEST_ALS_KEY]!.getStore();
          // Each interleaved await must resolve back to ITS OWN request — never
          // a sibling's — proving no cross-request contamination.
          captured.push(store?.url ?? "none");
          resolve();
        });
      });
    await Promise.all([run("a", 30), run("b", 5)]);
    expect(captured).toContain("https://example.com/a");
    expect(captured).toContain("https://example.com/b");
  });
});
