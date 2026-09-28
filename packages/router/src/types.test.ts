import { describe, expect, it } from "bun:test";

import {
  beforeNavigate,
  httpResponse,
  navigating,
  prime,
  routeHash,
  router,
  searchParam,
  serializeHead,
  useContext,
  useRoute,
} from "./index";
import type { Navigation, Page, RenderResponse } from "./index";
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

const typecheckRouteHooks = (): void => {
  const off: () => void = beforeNavigate(
    (nav: Navigation & { cancel: () => void }) => {
      const to: string = nav.to;
      void to;
    }
  );
  const busy: boolean = navigating();
  const hash: string = routeHash();
  const route = useRoute();
  const path: string = route.path();
  const params: Record<string, string> = route.params();
  const search: string = route.search();
  const ctx: { request?: Request } = useContext();
  void ctx.request;
  prime();
  off();
  void busy;
  void hash;
  void path;
  void params;
  void search;
};

void typecheckRouteHooks;

const typecheckSearchParam = (): void => {
  const tab = searchParam("t", { default: "overview" });
  const current: string = tab();
  tab.set("logs");
  const page = searchParam("p", { default: 1, parse: Number });
  page.update((n) => n + 1);
  // @ts-expect-error page is numeric
  page.set("2");
  // @ts-expect-error non-string params require parse
  const bad = searchParam("n", { default: 1 });
  void bad;
  void current;
};

void typecheckSearchParam;

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
