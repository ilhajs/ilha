import { describe, expect, it } from "bun:test";

import { httpResponse, router, serializeHead } from "./index";
import type { Page, RenderResponse } from "./index";

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

void typecheckRouterApi;

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
