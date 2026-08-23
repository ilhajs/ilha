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
});
