import { describe, expect, it } from "bun:test";

import { httpResponse, router, serializeHead } from "./index";
import type { Page, RenderResponse } from "./index";
import { __ilhaServerAction } from "./ssr";

declare const aPage: Page;

const typecheckRouterApi = (): void => {
  const Ro = router().route("/", aPage);
  const respFromRequest: Promise<RenderResponse> = Ro.renderResponse(
    new Request("http://localhost/")
  );
  const respFromUrl: Promise<RenderResponse> =
    Ro.renderResponse("http://localhost/");
  const resp: Response = httpResponse("<p>hi</p>", {
    cspNonce: "abc123",
    status: 200,
  });
  const head = serializeHead([
    { link: [{ href: "/app.css", rel: "stylesheet" }], title: "Title" },
  ]);
  const headTags: string = head.headTags;
  void respFromRequest;
  void respFromUrl;
  void resp.status;
  void headTags;
};

const typecheckServerActionResult = (): void => {
  const ok = __ilhaServerAction("x:ok", (id: string) => id);
  void ok;
  // @ts-expect-error bigint is not a SnapshotValue RPC result
  const bad = __ilhaServerAction("x:bad", () => 1n);
  void bad;
};

void typecheckRouterApi;
void typecheckServerActionResult;

describe("types.test anchors", () => {
  it("exposes callable public surface", () => {
    expect(Object.prototype.toString.call(httpResponse)).toBe(
      "[object Function]"
    );
    expect(Object.prototype.toString.call(serializeHead)).toBe(
      "[object Function]"
    );
  });
});
