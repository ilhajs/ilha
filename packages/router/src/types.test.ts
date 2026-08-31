import { httpResponse, router, serializeHead } from "./index";
import type { Page, RenderResponse } from "./index";

declare const aPage: Page;

export function typecheckRouterApi(): void {
  const Ro = router().route("/", aPage);
  const respFromRequest: Promise<RenderResponse> = Ro.renderResponse(
    new Request("http://localhost/"),
  );
  const respFromUrl: Promise<RenderResponse> = Ro.renderResponse("http://localhost/");
  const resp: Response = httpResponse("<p>hi</p>", { status: 200, cspNonce: "abc123" });
  const head = serializeHead([{ title: "Title", link: [{ rel: "stylesheet", href: "/app.css" }] }]);
  const headTags: string = head.headTags;
  void respFromRequest;
  void respFromUrl;
  void resp.status;
  void headTags;
}

import { describe, expect, it } from "bun:test";

describe("types.test anchors", () => {
  it("exposes callable public surface", () => {
    expect(typeof httpResponse).toBe("function");
    expect(typeof serializeHead).toBe("function");
  });
});
