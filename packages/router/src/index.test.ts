import { afterEach, describe, expect, it } from "bun:test";

import { h } from "ilha";

import {
  afterNavigate,
  error,
  isActive,
  navigate,
  redirect,
  router,
  routeParams,
  routePath,
  wrapLayout,
} from "./index";

function makeEl(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

afterEach(() => {
  history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

const Home = async () => h("p", null, "home");
const About = async () => h("p", null, "about");
const User = async () => h("p", null, `user:${routeParams().id ?? ""}`);

describe("router", () => {
  it("matches and SSRs a page", async () => {
    const r = router().route("/", Home).route("/about", About);
    const html = await r.render("http://localhost/about");
    expect(html).toContain("about");
    expect(html).toContain("data-ilha");
  });

  it("captures params", async () => {
    const r = router().route("/user/:id", User);
    const html = await r.render("http://localhost/user/42");
    expect(html).toContain("user:42");
  });

  it("redirects from a page", async () => {
    const Go = async () => {
      redirect("/about");
    };
    const r = router().route("/", Go);
    const res = await r.renderResponse("http://localhost/");
    expect(res).toEqual({ kind: "redirect", to: "/about", status: 302 });
  });

  it("surfaces route errors", async () => {
    const Boom = async () => {
      error(401, "nope");
    };
    const r = router().route("/", Boom);
    const res = await r.renderResponse("http://localhost/");
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.status).toBe(401);
  });

  it("wraps a layout around a page", async () => {
    const Layout = (props: { children?: unknown }) =>
      h("main", { id: "shell" }, props.children as never);
    const page = wrapLayout(Layout, Home);
    const r = router().route("/", page);
    const html = await r.render("http://localhost/");
    expect(html).toContain('id="shell"');
    expect(html).toContain("home");
  });

  it("navigates in the browser", async () => {
    history.replaceState(null, "", "/");
    const host = makeEl();
    const r = router().route("/", Home).route("/about", About);
    const unmount = r.mount(host);
    await Bun.sleep(20);
    expect(host.textContent).toContain("home");
    navigate("/about");
    await Bun.sleep(20);
    expect(routePath()).toBe("/about");
    expect(host.textContent).toContain("about");
    unmount();
  });

  it("isActive matches prefixes", async () => {
    router().route("/", Home).route("/docs/:slug", About);
    await router().render("http://localhost/docs/a");
    expect(isActive("/docs")).toBe(true);
    expect(isActive("/docs", { end: true })).toBe(false);
  });

  it("afterNavigate fires on navigate", async () => {
    history.replaceState(null, "", "/");
    const host = makeEl();
    const r = router().route("/", Home).route("/about", About);
    const seen: string[] = [];
    const off = afterNavigate((n) => seen.push(n.to));
    r.mount(host);
    await Bun.sleep(10);
    navigate("/about");
    await Bun.sleep(10);
    expect(seen).toContain("/about");
    off();
  });
});
