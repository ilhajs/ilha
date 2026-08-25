import type { Island } from "ilha";

import { httpResponse, loader, router, serializeHead } from "./index";
import type { RenderResponse } from "./index";

declare const anIsland: Island;

/**
 * Compile-time type anchors for the router API. Every imperative call lives
 * inside this never-invoked function so module scope has NO side effects:
 * `router()` resets the module-global route registry, which must not happen
 * at import time (tsconfig.build emits declarations for these anchors only).
 */
export function typecheckRouterApi(): void {
  // Request-first SSR overloads accept a bare Request or a URL string.
  const Ro = router().route("/", anIsland);
  const respFromRequest: Promise<RenderResponse> = Ro.renderResponse(
    new Request("http://localhost/"),
    { index: anIsland },
  );
  const respFromUrl: Promise<RenderResponse> = Ro.renderResponse("http://localhost/", {
    index: anIsland,
  });
  const loaded = Ro.runLoader(new Request("http://localhost/"));

  // httpResponse builds a native Response with typed security-header options.
  const resp: Response = httpResponse("<p>hi</p>", { status: 200, cspNonce: "abc123" });

  // loader() keeps its typed context ({ params, request, url, signal, head }).
  const load = loader(async ({ params, url }) => ({ path: url.pathname, id: params.id }));

  // serializeHead accepts the serializable HeadInput entries.
  const head = serializeHead([{ title: "Title", link: [{ rel: "stylesheet", href: "/app.css" }] }]);
  const headTags: string = head.headTags;

  void respFromRequest;
  void respFromUrl;
  void loaded;
  void resp.status;
  void load;
  void headTags;
}

// ─── Runtime smoke (this file also runs under bun test) ──────────────────
import { describe, expect, it } from "bun:test";

describe("types.test anchors", () => {
  it("exposes callable public surface", () => {
    expect(typeof httpResponse).toBe("function");
    expect(typeof serializeHead).toBe("function");
  });
});
