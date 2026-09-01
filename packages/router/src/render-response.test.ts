import { afterEach, describe, expect, it } from "bun:test";

import { h } from "ilha";

import { error, redirect, router, wrapLayout, wrapError, type Page } from "./index";

afterEach(() => {
  document.body.replaceChildren();
});

const Home: Page = async () => {
  return h("p", null, "home");
};

const About: Page = async () => h("p", null, "about");

describe("router.renderResponse", () => {
  it("renders a matched page as html with status 200", async () => {
    const r = router().route("/", Home).route("/about", About);
    const res = await r.renderResponse("http://localhost/about");
    expect(res.kind).toBe("html");
    expect((res as { html: string }).html).toContain("about");
    expect((res as { html: string }).html).toContain("data-ilha");
    expect((res as { status?: number }).status).toBe(200);
  });

  it("collects head entries declared by the page", async () => {
    const Titled: Page = async () => {
      const { head } = await import("./index");
      head({ title: "Page title" });
      return h("p", null, "titled");
    };
    const r = router().route("/titled", Titled);
    const res = await r.renderResponse("http://localhost/titled");
    expect(res.kind).toBe("html");
    const headTags = (res as { head?: { headTags?: string } }).head?.headTags ?? "";
    expect(headTags).toContain("<title");
    expect(headTags).toContain("Page title");
  });

  it("wraps pages in layouts with children", async () => {
    const Layout = ({ children }: { children?: unknown }) =>
      h("main", { class: "shell" }, children as never);
    const r = router().route("/", wrapLayout(Layout, Home));
    const res = await r.renderResponse("http://localhost/");
    expect((res as { html: string }).html).toContain('class="shell"');
    expect((res as { html: string }).html).toContain("home");
  });

  it("routes through the error boundary on RouteError", async () => {
    const Failing: Page = async () => {
      error(404, "missing page");
    };
    const r = router()
      .route("/missing", Failing)
      .errorBoundary("/missing", (err) => h("p", null, `boundary:${err.message}`));
    // The island render fails before the boundary takes over; ilha logs it.
    const prevError = console.error;
    console.error = () => {};
    try {
      const res = await r.renderResponse("http://localhost/missing");
      expect(res.kind).toBe("error");
      expect((res as { status: number }).status).toBe(404);
      expect((res as { html: string }).html).toContain("boundary:missing page");
    } finally {
      console.error = prevError;
    }
  });

  it("wrapError converts page throws into the handler view", async () => {
    const Failing: Page = async () => {
      error(418, "short and stout");
    };
    const r = router().route(
      "/teapot",
      wrapError(({ message }) => h("p", null, message), Failing),
    );
    const res = await r.renderResponse("http://localhost/teapot");
    expect(res.kind).toBe("html");
    expect((res as { html: string }).html).toContain("short and stout");
  });

  it("returns redirect kind for thrown redirects", async () => {
    const Login: Page = async () => {
      redirect("/auth", 307);
    };
    const r = router().route("/login", Login);
    const res = await r.renderResponse("http://localhost/login");
    expect(res.kind).toBe("redirect");
    expect((res as { to: string }).to).toBe("/auth");
    expect((res as { status: number }).status).toBe(307);
  });

  it("renders notFound for unmatched paths", async () => {
    const Missing: Page = async () => h("p", null, "not-found-page");
    const r = router({ notFound: Missing }).route("/", Home);
    const res = await r.renderResponse("http://localhost/nowhere");
    expect(res.kind).toBe("html");
    expect((res as { html: string }).html).toContain("not-found-page");
  });

  it("returns a 404 error kind without a notFound page", async () => {
    const r = router().route("/", Home);
    const res = await r.renderResponse("http://localhost/nowhere");
    expect(res.kind).toBe("error");
    expect((res as { status: number }).status).toBe(404);
  });
});

describe("router.respond", () => {
  it("returns a Response with rendered html and security headers", async () => {
    const r = router().route("/", Home);
    const res = await r.respond("http://localhost/");
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toContain("home");
  });

  it("surfaces error statuses on the Response", async () => {
    const Failing: Page = async () => {
      error(404, "gone");
    };
    const prevError = console.error;
    console.error = () => {};
    try {
      const r = router().route("/gone", Failing);
      const res = await r.respond("http://localhost/gone");
      expect(res.status).toBe(404);
    } finally {
      console.error = prevError;
    }
  });
});
