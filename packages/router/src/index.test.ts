import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";

import ilha, { ISLAND_MOUNT_INTERNAL } from "ilha";

import {
  router,
  navigate,
  useRoute,
  isActive,
  enableLinkInterception,
  RouterView,
  routePath,
  routeParams,
  routeSearch,
  defineLayout,
  wrapError,
  loader,
  redirect,
  Redirect,
  error,
  LoaderError,
  composeLoaders,
  prefetch,
  RouterLink,
} from "./index";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

// Simple schema helper for tests - creates a StandardSchemaV1 compatible schema
function createSchema<T>(): {
  "~standard": {
    version: 1;
    vendor: "test";
    types: { input: T; output: T };
    validate: (value: unknown) => { value: T };
  };
} {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      types: undefined as unknown as { input: any; output: any },
      validate: (value: unknown) => ({ value: value as any }),
    },
  } as any;
}

function makeEl(inner = ""): Element {
  const el = document.createElement("div");
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

function cleanup(el: Element) {
  document.body.removeChild(el);
}

function setLocation(path: string) {
  window.location.href = "http://localhost" + path;
}

function popstate() {
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
}

function detached() {
  return document.createElement("div");
}

// ─────────────────────────────────────────────
// Shared Page islands
// ─────────────────────────────────────────────

const HomePage = ilha.render(() => `<p>home</p>`);
const AboutPage = ilha.render(() => `<p>about</p>`);
const UserPage = ilha.render(() => {
  const { params } = useRoute();
  return `<p>user:${params().id ?? "none"}</p>`;
});
const NotFound = ilha.render(() => `<p>404</p>`);

// shared registry used across hydratable tests
const registry: Record<string, typeof HomePage> = {
  home: HomePage,
  about: AboutPage,
  user: UserPage,
  NotFound: NotFound,
};

// ─────────────────────────────────────────────
// route matching
// ─────────────────────────────────────────────

describe("route matching", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setLocation("/");
    el = makeEl();
    unmount = router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .route("/user/:id", UserPage)
      .route("/**", NotFound)
      .mount(el);
  });

  afterEach(() => {
    unmount();
    cleanup(el);
    setLocation("/");
  });

  it("matches static root route", () => {
    expect(routePath()).toBe("/");
    expect(el.innerHTML).toContain("home");
  });

  it("matches static /about route after navigate()", () => {
    navigate("/about");
    expect(routePath()).toBe("/about");
    expect(el.innerHTML).toContain("about");
  });

  it("matches :id param route and populates routeParams", () => {
    navigate("/user/42");
    expect(routePath()).toBe("/user/42");
    expect(routeParams()).toEqual({ id: "42" });
  });

  it("matches wildcard /** for unknown paths", () => {
    navigate("/does-not-exist");
    expect(el.innerHTML).toContain("404");
  });

  it("clears params when navigating away from a param route", () => {
    navigate("/user/7");
    expect(routeParams()).toEqual({ id: "7" });
    navigate("/about");
    expect(routeParams()).toEqual({});
  });

  it("matches routes in declaration order — first match wins", () => {
    navigate("/about");
    expect(el.innerHTML).toContain("about");
    expect(el.innerHTML).not.toContain("404");
  });
});

// ─────────────────────────────────────────────
// navigate()
// ─────────────────────────────────────────────

describe("navigate()", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setLocation("/");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
  });

  afterEach(() => {
    unmount();
    cleanup(el);
    setLocation("/");
  });

  it("pushes a new history entry by default", () => {
    const before = history.length;
    navigate("/about");
    expect(history.length).toBe(before + 1);
  });

  it("replaces history entry when replace: true", () => {
    const before = history.length;
    navigate("/about", { replace: true });
    expect(history.length).toBe(before);
  });

  it("updates routePath signal", () => {
    navigate("/about");
    expect(routePath()).toBe("/about");
  });

  it("updates routeSearch signal", () => {
    navigate("/about?tab=docs");
    expect(routeSearch()).toBe("?tab=docs");
  });

  it("re-renders outlet to matched island", () => {
    expect(el.innerHTML).toContain("home");
    navigate("/about");
    expect(el.innerHTML).toContain("about");
  });

  it("renders empty outlet for unmatched path (no wildcard)", () => {
    unmount();
    unmount = router().route("/", HomePage).mount(el);
    navigate("/ghost");
    expect(el.querySelector("[data-router-empty]")).not.toBeNull();
  });
});

// ─────────────────────────────────────────────
// popstate
// ─────────────────────────────────────────────

describe("popstate", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setLocation("/");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
  });

  afterEach(() => {
    unmount();
    cleanup(el);
    setLocation("/");
  });

  it("syncs route when popstate fires", () => {
    setLocation("/about");
    popstate();
    expect(routePath()).toBe("/about");
    expect(el.innerHTML).toContain("about");
  });

  it("does NOT respond to popstate after unmount", () => {
    unmount();
    setLocation("/about");
    popstate();
    expect(routePath()).toBe("/");
  });
});

// ─────────────────────────────────────────────
// useRoute()
// ─────────────────────────────────────────────

describe("useRoute()", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setLocation("/");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/user/:id", UserPage).mount(el);
  });

  afterEach(() => {
    unmount();
    cleanup(el);
    setLocation("/");
  });

  it("path signal matches current location", () => {
    expect(useRoute().path()).toBe("/");
  });

  it("params signal is empty on non-param route", () => {
    expect(useRoute().params()).toEqual({});
  });

  it("params signal reflects :id after navigate", () => {
    navigate("/user/99");
    expect(useRoute().params()).toEqual({ id: "99" });
  });

  it("search signal reflects query string", () => {
    navigate("/user/1?ref=home");
    expect(useRoute().search()).toBe("?ref=home");
  });
});

// ─────────────────────────────────────────────
// isActive()
// ─────────────────────────────────────────────

describe("isActive()", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setLocation("/");
    el = makeEl();
    unmount = router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .route("/user/:id", UserPage)
      .mount(el);
  });

  afterEach(() => {
    unmount();
    cleanup(el);
    setLocation("/");
  });

  it("returns true for the current exact path", () => {
    expect(isActive("/")).toBe(true);
  });

  it("returns false for a non-current path", () => {
    expect(isActive("/about")).toBe(false);
  });

  it("returns true after navigating to that path", () => {
    navigate("/about");
    expect(isActive("/about")).toBe(true);
    expect(isActive("/")).toBe(false);
  });

  it("returns true for :id pattern when a matching path is active", () => {
    navigate("/user/7");
    expect(isActive("/user/:id")).toBe(true);
  });

  it("returns false for :id pattern when a different path is active", () => {
    navigate("/about");
    expect(isActive("/user/:id")).toBe(false);
  });
});

// ─────────────────────────────────────────────
// enableLinkInterception()
// ─────────────────────────────────────────────

describe("enableLinkInterception()", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setLocation("/");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
  });

  afterEach(() => {
    unmount();
    cleanup(el);
    setLocation("/");
  });

  it("intercepts internal <a> clicks and navigates client-side", () => {
    const link = document.createElement("a");
    link.setAttribute("href", "/about");
    el.appendChild(link);
    link.click();
    expect(routePath()).toBe("/about");
    expect(el.innerHTML).toContain("about");
  });

  it("does not intercept clicks with ctrlKey held", () => {
    const root = detached();
    const link = document.createElement("a");
    link.setAttribute("href", "/about");
    root.appendChild(link);
    const stop = enableLinkInterception(root);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    stop();
    expect(routePath()).toBe("/");
  });

  it("does not intercept target=_blank links", () => {
    const root = detached();
    const link = document.createElement("a");
    link.setAttribute("href", "/about");
    link.setAttribute("target", "_blank");
    root.appendChild(link);
    const stop = enableLinkInterception(root);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    stop();
    expect(routePath()).toBe("/");
  });

  it("does not intercept anchor-only (#hash) links", () => {
    const root = detached();
    const link = document.createElement("a");
    link.setAttribute("href", "#section");
    root.appendChild(link);
    const stop = enableLinkInterception(root);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    stop();
    expect(routePath()).toBe("/");
  });

  it("returns a cleanup that removes its listener", () => {
    const root = detached();
    const link = document.createElement("a");
    link.setAttribute("href", "/about");
    root.appendChild(link);
    const stop = enableLinkInterception(root);
    stop();
    link.dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true }));
    expect(routePath()).toBe("/");
  });
});

// ─────────────────────────────────────────────
// RouterView
// ─────────────────────────────────────────────

describe("RouterView", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setLocation("/");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
  });

  afterEach(() => {
    unmount();
    cleanup(el);
    setLocation("/");
  });

  it("renders matched island inside data-router-view wrapper", () => {
    expect(el.querySelector("[data-router-view]")).not.toBeNull();
    expect(el.innerHTML).toContain("home");
  });

  it("re-renders outlet reactively on navigate", () => {
    navigate("/about");
    expect(el.querySelector("[data-router-view]")).not.toBeNull();
    expect(el.innerHTML).toContain("about");
  });

  it("renders data-router-empty when no route matches", () => {
    unmount();
    unmount = router().route("/", HomePage).mount(el);
    navigate("/unknown");
    expect(el.querySelector("[data-router-empty]")).not.toBeNull();
  });

  it("RouterView is a valid ilha Island (has .mount and .toString)", () => {
    expect(typeof RouterView.mount).toBe("function");
    expect(typeof RouterView.toString).toBe("function");
  });
});

// ─────────────────────────────────────────────
// router() isolation
// ─────────────────────────────────────────────

describe("router() isolation", () => {
  it("calling router() resets the route registry", () => {
    setLocation("/");
    const el1 = makeEl();
    const el2 = makeEl();
    const u1 = router().route("/", HomePage).route("/about", AboutPage).mount(el1);
    const u2 = router().route("/", HomePage).mount(el2);
    navigate("/about");
    expect(el2.querySelector("[data-router-empty]")).not.toBeNull();
    u1();
    u2();
    cleanup(el1);
    cleanup(el2);
    setLocation("/");
  });

  it("unmount() removes the popstate listener", () => {
    setLocation("/");
    const el = makeEl();
    const unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
    unmount();
    setLocation("/about");
    popstate();
    expect(routePath()).toBe("/");
    cleanup(el);
    setLocation("/");
  });
});

// ─────────────────────────────────────────────
// URL encoding
// ─────────────────────────────────────────────

describe("URL encoding", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setLocation("/");
    el = makeEl();
    unmount = router().route("/user/:id", UserPage).route("/**", NotFound).mount(el);
  });

  afterEach(() => {
    unmount();
    cleanup(el);
    setLocation("/");
  });

  it("decodes percent-encoded param values", () => {
    navigate("/user/hello%20world");
    expect(routeParams()).toEqual({ id: "hello world" });
  });
});

// ─────────────────────────────────────────────
// warn on missing selector
// ─────────────────────────────────────────────

describe("router() — missing host element", () => {
  it("warns and returns a no-op unmount when selector not found", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const unmount = router().route("/", HomePage).mount("#does-not-exist");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[ilha-router]"));
    expect(typeof unmount).toBe("function");
    unmount();
    warn.mockRestore();
  });
});

// ─────────────────────────────────────────────
// rou3 pattern syntax
// ─────────────────────────────────────────────

describe("rou3 pattern syntax", () => {
  it(":param — single named segment", () => {
    router().route("/user/:id", UserPage).render("/user/42");
    expect(routeParams()).toEqual({ id: "42" });
  });

  it("**:slug — named catch-all captures rest of path", () => {
    const CatchAll = ilha.render(() => {
      const { params } = useRoute();
      return `<p>slug:${(params() as any).slug ?? ""}</p>`;
    });
    const html = router().route("/docs/**:slug", CatchAll).render("/docs/guide/intro");
    expect(html).toContain("slug:guide/intro");
    expect(routeParams()).toMatchObject({ slug: "guide/intro" });
  });

  it("/** — anonymous wildcard matches anything", () => {
    const html = router().route("/", HomePage).route("/**", NotFound).render("/anything/nested");
    expect(html).toContain("404");
  });

  it("multiple :param segments", () => {
    const Page = ilha.render(() => {
      const { params } = useRoute();
      const p = params() as any;
      return `<p>${p.org}/${p.repo}</p>`;
    });
    router().route("/:org/:repo", Page).render("/ilha/router");
    expect(routeParams()).toEqual({ org: "ilha", repo: "router" });
  });

  it("static segment takes priority over :param", () => {
    const Special = ilha.render(() => `<p>special</p>`);
    const html = router()
      .route("/user/me", Special)
      .route("/user/:id", UserPage)
      .render("/user/me");
    expect(html).toContain("special");
    expect(html).not.toContain("user:");
  });
});

// ─────────────────────────────────────────────
// SSR — router().render()
// ─────────────────────────────────────────────

describe("SSR render()", () => {
  it("renders matched island for root path", () => {
    const html = router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .route("/**", NotFound)
      .render("/");
    expect(html).toContain("home");
    expect(html).toContain("data-router-view");
  });

  it("renders matched island for /about", () => {
    const html = router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .route("/**", NotFound)
      .render("/about");
    expect(html).toContain("about");
    expect(html).not.toContain("home");
  });

  it("renders wildcard for unmatched path", () => {
    const html = router().route("/", HomePage).route("/**", NotFound).render("/does-not-exist");
    expect(html).toContain("404");
  });

  it("renders data-router-empty when no route matches and no wildcard", () => {
    const html = router().route("/", HomePage).render("/unknown");
    expect(html).toContain("data-router-empty");
  });

  it("resolves :id route and populates routeParams signal", () => {
    router().route("/user/:id", UserPage).route("/**", NotFound).render("/user/42");
    expect(routeParams()).toEqual({ id: "42" });
    expect(routePath()).toBe("/user/42");
  });

  it("populates routeSearch signal from query string", () => {
    router().route("/about", AboutPage).render("/about?tab=docs");
    expect(routeSearch()).toBe("?tab=docs");
  });

  it("accepts a full URL string", () => {
    const html = router()
      .route("/about", AboutPage)
      .route("/**", NotFound)
      .render("http://example.com/about?ref=test");
    expect(html).toContain("about");
    expect(routeSearch()).toBe("?ref=test");
  });

  it("accepts a URL object", () => {
    const html = router()
      .route("/about", AboutPage)
      .route("/**", NotFound)
      .render(new URL("http://example.com/about"));
    expect(html).toContain("about");
  });

  it("decodes percent-encoded params", () => {
    router().route("/user/:id", UserPage).render("/user/hello%20world");
    expect(routeParams()).toEqual({ id: "hello world" });
  });

  it("isActive() reflects last render() path", () => {
    router().route("/", HomePage).route("/about", AboutPage).render("/about");
    expect(isActive("/about")).toBe(true);
    expect(isActive("/")).toBe(false);
  });

  it("useRoute() signals reflect last render() call", () => {
    router().route("/user/:id", UserPage).render("/user/99?sort=asc");
    const { path, params, search } = useRoute();
    expect(path()).toBe("/user/99");
    expect(params()).toEqual({ id: "99" });
    expect(search()).toBe("?sort=asc");
  });
});

// ─────────────────────────────────────────────
// SSR — router().renderHydratable()
// ─────────────────────────────────────────────

describe("SSR renderHydratable()", () => {
  it("returns a string (is async)", async () => {
    const html = await router()
      .route("/", HomePage)
      .route("/**", NotFound)
      .renderHydratable("/", registry);
    expect(typeof html).toBe("string");
  });

  it("wraps output in data-router-view", async () => {
    const html = await router().route("/", HomePage).renderHydratable("/", registry);
    expect(html).toContain("data-router-view");
  });

  it("includes data-ilha attribute with the island name", async () => {
    const html = await router().route("/", HomePage).renderHydratable("/", registry);
    expect(html).toContain(`data-ilha="home"`);
  });

  it("includes island content in the output", async () => {
    const html = await router().route("/", HomePage).renderHydratable("/", registry);
    expect(html).toContain("home");
  });

  it("resolves correct island for /about", async () => {
    const html = await router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .route("/**", NotFound)
      .renderHydratable("/about", registry);
    expect(html).toContain(`data-ilha="about"`);
    expect(html).toContain("about");
    expect(html).not.toContain(`data-ilha="home"`);
  });

  it("renders data-router-empty when no route matches", async () => {
    const html = await router().route("/", HomePage).renderHydratable("/unknown", registry);
    expect(html).toContain("data-router-empty");
    expect(html).not.toContain("data-ilha");
  });

  it("populates route signals identically to render()", async () => {
    await router().route("/user/:id", UserPage).renderHydratable("/user/42", registry);
    expect(routePath()).toBe("/user/42");
    expect(routeParams()).toEqual({ id: "42" });
  });

  it("populates routeSearch signal", async () => {
    await router().route("/about", AboutPage).renderHydratable("/about?tab=docs", registry);
    expect(routeSearch()).toBe("?tab=docs");
  });

  it("accepts a full URL string", async () => {
    const html = await router()
      .route("/about", AboutPage)
      .renderHydratable("http://example.com/about", registry);
    expect(html).toContain(`data-ilha="about"`);
  });

  it("accepts a URL object", async () => {
    const html = await router()
      .route("/about", AboutPage)
      .renderHydratable(new URL("http://example.com/about"), registry);
    expect(html).toContain(`data-ilha="about"`);
  });

  it("falls back to plain SSR and warns when island is not in registry", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const Unregistered = ilha.render(() => `<p>unregistered</p>`);
    const html = await router().route("/", Unregistered).renderHydratable("/", registry);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[ilha-router]"));
    expect(html).toContain("data-router-view");
    expect(html).toContain("unregistered");
    expect(html).not.toContain("data-ilha");
    warn.mockRestore();
  });

  it("does not include data-ilha when falling back to plain SSR", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const Unregistered = ilha.render(() => `<p>x</p>`);
    const html = await router().route("/", Unregistered).renderHydratable("/", {});
    expect(html).not.toContain("data-ilha");
    warn.mockRestore();
  });

  it("snapshot option is forwarded — data-ilha-state present", async () => {
    const Stateful = ilha.state("count", 0).render(() => `<p>count</p>`);
    const reg = { Stateful };
    const html = await router().route("/", Stateful).renderHydratable("/", reg, { snapshot: true });
    expect(html).toContain("data-ilha-state");
  });

  it("snapshot: false omits data-ilha-state", async () => {
    const Stateful = ilha.state("count", 0).render(() => `<p>count</p>`);
    const reg = { Stateful };
    const html = await router()
      .route("/", Stateful)
      .renderHydratable("/", reg, { snapshot: false });
    expect(html).not.toContain("data-ilha-state");
  });

  it("each call is independent — registry lookup uses active island", async () => {
    const r = router().route("/", HomePage).route("/about", AboutPage);

    const h1 = await r.renderHydratable("/", registry);
    const h2 = await r.renderHydratable("/about", registry);

    expect(h1).toContain(`data-ilha="home"`);
    expect(h2).toContain(`data-ilha="about"`);
  });
});

// ─────────────────────────────────────────────
// SSR → client hydration pipeline
// ─────────────────────────────────────────────

describe("SSR → client hydration pipeline", () => {
  let el: Element;

  afterEach(() => {
    if (el && el.parentNode) cleanup(el);
  });

  it("hydrate: true — does not wipe SSR innerHTML on mount", async () => {
    const ssrHtml = await router().route("/", HomePage).renderHydratable("/", registry);

    setLocation("/");
    el = makeEl(ssrHtml);

    const unmount = router().route("/", HomePage).mount(el, { hydrate: true });
    // SSR content must still be present — mount() must not clear the DOM
    expect(el.innerHTML).toContain("home");
    expect(el.innerHTML).toContain("data-router-view");
    unmount();
  });

  it("hydrate: true — data-ilha attribute is preserved in the DOM", async () => {
    const ssrHtml = await router().route("/", HomePage).renderHydratable("/", registry);

    setLocation("/");
    el = makeEl(ssrHtml);

    const unmount = router().route("/", HomePage).mount(el, { hydrate: true });
    expect(el.innerHTML).toContain('data-ilha="home"');
    unmount();
  });

  it("hydrate: true — sentinel node is hidden and appended", async () => {
    const ssrHtml = await router().route("/", HomePage).renderHydratable("/", registry);

    setLocation("/");
    el = makeEl(ssrHtml);

    const unmount = router().route("/", HomePage).mount(el, { hydrate: true });
    // Sentinel is a display:none div injected by hydrate mode
    const sentinel = el.querySelector("div[style*='display: none']");
    expect(sentinel).not.toBeNull();
    unmount();
  });

  it("hydrate: true — sentinel is removed after unmount()", async () => {
    const ssrHtml = await router().route("/", HomePage).renderHydratable("/", registry);

    setLocation("/");
    el = makeEl(ssrHtml);

    const unmount = router().route("/", HomePage).mount(el, { hydrate: true });
    unmount();
    const sentinel = el.querySelector("div[style*='display: none']");
    expect(sentinel).toBeNull();
  });

  it("hydrate: false — RouterView replaces SSR content on mount", () => {
    setLocation("/");
    el = makeEl('<div data-router-view><p id="ssr-content">old</p></div>');

    const unmount = router().route("/", HomePage).mount(el, { hydrate: false });
    // Non-hydrate mount overwrites the host with RouterView output
    expect(el.textContent).toContain("home");
    unmount();
  });

  it("hydrate: true — navigation after hydration renders new Page via RouterView", async () => {
    const ssrHtml = await router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .renderHydratable("/", registry);

    setLocation("/");
    el = makeEl(ssrHtml);

    const unmount = router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .mount(el, { hydrate: true });

    navigate("/about");
    await Promise.resolve();
    await Promise.resolve(); // two microtask ticks for queueMicrotask inside sentinel

    expect(el.textContent).toContain("about");
    unmount();
  });

  it("hydrate: true — route signals are correct immediately after mount", async () => {
    const ssrHtml = await router()
      .route("/user/:id", UserPage)
      .renderHydratable("/user/77", registry);

    setLocation("/user/77");
    el = makeEl(ssrHtml);

    const unmount = router().route("/user/:id", UserPage).mount(el, { hydrate: true });
    expect(routePath()).toBe("/user/77");
    expect(routeParams()).toEqual({ id: "77" });
    unmount();
  });

  it("hydrate: true — popstate updates route signals", async () => {
    const ssrHtml = await router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .renderHydratable("/", registry);

    setLocation("/");
    el = makeEl(ssrHtml);

    const unmount = router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .mount(el, { hydrate: true });

    setLocation("/about");
    popstate();

    expect(routePath()).toBe("/about");
    unmount();
  });

  it("hydrate: true — unmount() removes popstate listener", async () => {
    const ssrHtml = await router().route("/", HomePage).renderHydratable("/", registry);

    setLocation("/");
    el = makeEl(ssrHtml);

    const unmount = router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .mount(el, { hydrate: true });
    unmount();

    setLocation("/about");
    popstate();
    // listener removed — routePath must not have advanced to /about
    expect(routePath()).not.toBe("/about");
  });
});

// ─────────────────────────────────────────────
// SSR full-Page HTML template (entry-server shape)
// ─────────────────────────────────────────────

describe("SSR full-Page HTML template", () => {
  function htmlTemplate(body: string, clientEntry = "/entry-client.js"): string {
    return `<!doctype html><html><head><title>Ilha App</title></head><body><div id="app">${body}</div><script type="module" src="${clientEntry}"></script></body></html>`;
  }

  it("wraps renderHydratable output in a full HTML document", async () => {
    const body = await router().route("/", HomePage).renderHydratable("/", registry);

    const full = htmlTemplate(body);
    expect(full).toContain("<!doctype html>");
    expect(full).toContain("<title>Ilha App</title>");
    expect(full).toContain('id="app"');
    expect(full).toContain("home");
    expect(full).toContain('data-ilha="home"');
  });

  it("includes the client entry script tag", async () => {
    const body = await router().route("/", HomePage).renderHydratable("/", registry);

    const full = htmlTemplate(body, "/entry-client.js");
    expect(full).toContain('src="/entry-client.js"');
    expect(full).toContain('type="module"');
  });

  it("SSR body is inside #app — client hydration target is correct", async () => {
    const body = await router().route("/about", AboutPage).renderHydratable("/about", registry);

    const full = htmlTemplate(body);
    const parser = new DOMParser();
    const doc = parser.parseFromString(full, "text/html");
    const app = doc.querySelector("#app");
    expect(app).not.toBeNull();
    expect(app!.innerHTML).toContain("data-router-view");
    expect(app!.innerHTML).toContain("about");
  });

  it("multiple routes produce distinct HTML bodies", async () => {
    const r = router().route("/", HomePage).route("/about", AboutPage);
    const homeBody = await r.renderHydratable("/", registry);
    const aboutBody = await r.renderHydratable("/about", registry);

    expect(htmlTemplate(homeBody)).toContain('data-ilha="home"');
    expect(htmlTemplate(aboutBody)).toContain('data-ilha="about"');
    expect(htmlTemplate(homeBody)).not.toContain('data-ilha="about"');
  });

  it("route signals are reset correctly after each renderHydratable call", async () => {
    const r = router().route("/", HomePage).route("/user/:id", UserPage);

    await r.renderHydratable("/user/5", registry);
    expect(routePath()).toBe("/user/5");
    expect(routeParams()).toEqual({ id: "5" });

    await r.renderHydratable("/", registry);
    expect(routePath()).toBe("/");
    expect(routeParams()).toEqual({});
  });
});

// ─────────────────────────────────────────────
// defineLayout()
// ─────────────────────────────────────────────

describe("defineLayout()", () => {
  it("returns the same function reference (identity)", () => {
    const layout = (children: typeof HomePage) => ilha.render(() => children.toString());
    const result = defineLayout(layout);
    expect(result).toBe(layout);
  });

  it("wraps Page content when the returned layout is called", () => {
    const layout = defineLayout((children) =>
      ilha.render(() => `<layout>${children.toString()}</layout>`),
    );
    const Page = ilha.render(() => `<p>content</p>`);
    const wrapped = layout(Page);
    expect(wrapped.toString()).toContain("<layout>");
    expect(wrapped.toString()).toContain("<p>content</p>");
  });

  it("returned island has .toString and .mount", () => {
    const layout = defineLayout((children) => ilha.render(() => children.toString()));
    const wrapped = layout(HomePage);
    expect(typeof wrapped.toString).toBe("function");
    expect(typeof wrapped.mount).toBe("function");
  });

  it("composes with wrapLayout — output is identical to satisfies LayoutHandler pattern", () => {
    // defineLayout should produce the same result as the manual satisfies cast
    const fn = (children: typeof HomePage) =>
      ilha.render(() => `<shell>${children.toString()}</shell>`);

    const viaDefine = defineLayout(fn);
    const Page = ilha.render(() => `<p>Page</p>`);

    const wrappedViaDefine = viaDefine(Page);
    const wrappedDirect = fn(Page);

    expect(wrappedViaDefine.toString()).toBe(wrappedDirect.toString());
  });

  it("nested defineLayout calls compose inside-out", () => {
    const outer = defineLayout((children) =>
      ilha.render(() => `<outer>${children.toString()}</outer>`),
    );
    const inner = defineLayout((children) =>
      ilha.render(() => `<inner>${children.toString()}</inner>`),
    );
    const Page = ilha.render(() => `<p>Page</p>`);

    // outer wraps inner wraps Page — outermost last in call chain
    const wrapped = outer(inner(Page));
    const html = wrapped.toString();

    expect(html).toContain("<outer>");
    expect(html).toContain("<inner>");
    expect(html).toContain("<p>Page</p>");
    expect(html.indexOf("<outer>")).toBeLessThan(html.indexOf("<inner>"));
    expect(html.indexOf("<inner>")).toBeLessThan(html.indexOf("<p>Page</p>"));
  });
});

// ─────────────────────────────────────────────
// loader() identity + type anchor
// ─────────────────────────────────────────────

describe("loader()", () => {
  it("returns the function unchanged (identity)", () => {
    const fn = async () => ({ x: 1 });
    expect(loader(fn)).toBe(fn);
  });

  it("works with sync loaders", () => {
    const fn = () => ({ x: 1 });
    expect(loader(fn)).toBe(fn);
  });
});

// ─────────────────────────────────────────────
// redirect() / error() sentinels
// ─────────────────────────────────────────────

describe("redirect()", () => {
  it("throws a Redirect instance", () => {
    expect(() => redirect("/login")).toThrow();
    try {
      redirect("/login");
    } catch (e) {
      expect(e).toBeInstanceOf(Redirect);
    }
  });

  it("defaults to status 302", () => {
    try {
      redirect("/login");
    } catch (e: any) {
      expect(e.status).toBe(302);
      expect(e.to).toBe("/login");
    }
  });

  it("accepts a custom status", () => {
    try {
      redirect("/new", 301);
    } catch (e: any) {
      expect(e.status).toBe(301);
    }
  });

  it("Redirect instances have the __ilhaRedirect marker", () => {
    try {
      redirect("/x");
    } catch (e: any) {
      expect(e.__ilhaRedirect).toBe(true);
    }
  });
});

describe("error()", () => {
  it("throws a LoaderError instance", () => {
    expect(() => error(404, "not found")).toThrow();
    try {
      error(404, "not found");
    } catch (e) {
      expect(e).toBeInstanceOf(LoaderError);
    }
  });

  it("carries status and message", () => {
    try {
      error(403, "forbidden");
    } catch (e: any) {
      expect(e.status).toBe(403);
      expect(e.message).toBe("forbidden");
    }
  });

  it("LoaderError instances have the __ilhaLoaderError marker", () => {
    try {
      error(500, "oops");
    } catch (e: any) {
      expect(e.__ilhaLoaderError).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────
// composeLoaders() — merges layout + Page loaders
// ─────────────────────────────────────────────

describe("composeLoaders()", () => {
  const ctx = () => ({
    params: {},
    request: new Request("http://localhost/"),
    url: new URL("http://localhost/"),
    signal: new AbortController().signal,
  });

  it("returns an empty object for an empty list", async () => {
    const composed = composeLoaders([] as const);
    expect(await composed(ctx())).toEqual({});
  });

  it("returns the single loader unchanged when given one", () => {
    const fn = async () => ({ x: 1 });
    expect(composeLoaders([fn])).toBe(fn);
  });

  it("merges results from multiple loaders", async () => {
    const a = async () => ({ a: 1 });
    const b = async () => ({ b: 2 });
    const composed = composeLoaders([a, b]);
    expect(await composed(ctx())).toEqual({ a: 1, b: 2 });
  });

  it("later loader wins on key collision (Page overrides layout)", async () => {
    const layout = async () => ({ user: "layout-user", extra: 1 });
    const Page = async () => ({ user: "Page-user" });
    const composed = composeLoaders([layout, Page]);
    const result = await composed(ctx());
    expect(result).toEqual({ user: "Page-user", extra: 1 });
  });

  it("runs loaders in parallel (concurrent, not sequential)", async () => {
    const order: string[] = [];
    const slow = async () => {
      order.push("slow-start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("slow-end");
      return { slow: true };
    };
    const fast = async () => {
      order.push("fast-start");
      await new Promise((r) => setTimeout(r, 5));
      order.push("fast-end");
      return { fast: true };
    };
    await composeLoaders([slow, fast])(ctx());
    // Both starts happen before either end — proves parallelism
    expect(order.indexOf("slow-start")).toBeLessThan(order.indexOf("fast-end"));
    expect(order.indexOf("fast-start")).toBeLessThan(order.indexOf("slow-end"));
  });

  it("passes the same ctx to all loaders", async () => {
    const seen: any[] = [];
    const a = async (c: any) => {
      seen.push(c);
      return {};
    };
    const b = async (c: any) => {
      seen.push(c);
      return {};
    };
    const c = ctx();
    await composeLoaders([a, b])(c);
    expect(seen[0]).toBe(c);
    expect(seen[1]).toBe(c);
  });

  it("propagates a Redirect thrown by any loader", async () => {
    const ok = async () => ({ a: 1 });
    const redirects = async () => {
      redirect("/login");
    };
    await expect(composeLoaders([ok, redirects])(ctx())).rejects.toBeInstanceOf(Redirect);
  });

  it("propagates a LoaderError thrown by any loader", async () => {
    const ok = async () => ({ a: 1 });
    const errs = async () => {
      error(404, "nope");
    };
    await expect(composeLoaders([ok, errs])(ctx())).rejects.toBeInstanceOf(LoaderError);
  });

  it("tolerates null/undefined loader return (treats as empty)", async () => {
    // Loaders should generally return objects, but undefined should not corrupt the merge.
    const a = async () => ({ a: 1 });
    const b = async () => undefined as any;
    const composed = composeLoaders([a, b]);
    const result = await composed(ctx());
    expect(result).toEqual({ a: 1 });
  });
});

// ─────────────────────────────────────────────
// router.runLoader() — the loader endpoint entry
// ─────────────────────────────────────────────

describe("router.runLoader()", () => {
  it("returns { kind: 'data', data: {} } for routes without a loader", async () => {
    const r = router().route("/", HomePage);
    const result = await r.runLoader("/");
    expect(result).toEqual({ kind: "data", data: {} });
  });

  it("returns { kind: 'not-found' } for unmatched paths", async () => {
    const r = router().route("/", HomePage);
    const result = await r.runLoader("/missing");
    expect(result).toEqual({ kind: "not-found" });
  });

  it("runs the loader and returns its data", async () => {
    const load = loader(async () => ({ user: "alice" }));
    const r = router().route("/", HomePage, load);
    const result = await r.runLoader("/");
    expect(result).toEqual({ kind: "data", data: { user: "alice" } });
  });

  it("passes decoded params to the loader", async () => {
    const captured: any[] = [];
    const load = loader(async (c) => {
      captured.push(c.params);
      return { id: c.params.id };
    });
    const r = router().route("/user/:id", UserPage, load);
    const result = await r.runLoader("/user/42");
    expect(captured[0]).toEqual({ id: "42" });
    expect(result).toEqual({ kind: "data", data: { id: "42" } });
  });

  it("decodes URL-encoded params before passing to loader", async () => {
    const captured: any[] = [];
    const load = loader(async (c) => {
      captured.push(c.params);
      return {};
    });
    const r = router().route("/user/:id", UserPage, load);
    await r.runLoader("/user/hello%20world");
    expect(captured[0]).toEqual({ id: "hello world" });
  });

  it("passes the URL object to the loader", async () => {
    let capturedUrl: URL | undefined;
    const load = loader(async (c) => {
      capturedUrl = c.url;
      return {};
    });
    const r = router().route("/about", AboutPage, load);
    await r.runLoader("/about?tab=docs");
    expect(capturedUrl).toBeInstanceOf(URL);
    expect(capturedUrl!.pathname).toBe("/about");
    expect(capturedUrl!.search).toBe("?tab=docs");
  });

  it("provides an AbortSignal to the loader", async () => {
    let capturedSignal: AbortSignal | undefined;
    const load = loader(async (c) => {
      capturedSignal = c.signal;
      return {};
    });
    const r = router().route("/", HomePage, load);
    await r.runLoader("/");
    expect(capturedSignal).toBeDefined();
    expect(typeof capturedSignal!.aborted).toBe("boolean");
  });

  it("forwards the supplied Request to the loader", async () => {
    let capturedRequest: Request | undefined;
    const load = loader(async (c) => {
      capturedRequest = c.request;
      return {};
    });
    const r = router().route("/", HomePage, load);
    const req = new Request("http://example.com/", { headers: { "x-custom": "yes" } });
    await r.runLoader("/", req);
    expect(capturedRequest).toBe(req);
  });

  it("synthesises a Request when none is supplied", async () => {
    let capturedRequest: Request | undefined;
    const load = loader(async (c) => {
      capturedRequest = c.request;
      return {};
    });
    const r = router().route("/", HomePage, load);
    await r.runLoader("http://example.com/");
    expect(capturedRequest).toBeDefined();
  });

  it("catches redirect() and returns { kind: 'redirect' }", async () => {
    const load = loader(async () => {
      redirect("/login", 301);
    });
    const r = router().route("/", HomePage, load);
    const result = await r.runLoader("/");
    expect(result).toEqual({ kind: "redirect", to: "/login", status: 301 });
  });

  it("catches error() and returns { kind: 'error' }", async () => {
    const load = loader(async () => {
      error(404, "not found");
    });
    const r = router().route("/", HomePage, load);
    const result = await r.runLoader("/");
    expect(result).toEqual({ kind: "error", status: 404, message: "not found" });
  });

  it("catches generic thrown errors as 500", async () => {
    const load = loader(async () => {
      throw new Error("boom");
    });
    const r = router().route("/", HomePage, load);
    const result = await r.runLoader("/");
    expect(result).toEqual({ kind: "error", status: 500, message: "boom" });
  });

  it("honours error.status on generic thrown errors", async () => {
    const load = loader(async () => {
      const e: any = new Error("bad");
      e.status = 418;
      throw e;
    });
    const r = router().route("/", HomePage, load);
    const result = await r.runLoader("/");
    expect(result).toEqual({ kind: "error", status: 418, message: "bad" });
  });

  it("accepts a URL object as the first argument", async () => {
    const load = loader(async () => ({ ok: true }));
    const r = router().route("/", HomePage, load);
    const result = await r.runLoader(new URL("http://example.com/"));
    expect(result).toEqual({ kind: "data", data: { ok: true } });
  });
});

// ─────────────────────────────────────────────
// router.renderHydratable() — loader-fed input
// ─────────────────────────────────────────────

describe("renderHydratable() with loader", () => {
  const Greeter = ilha
    .input(createSchema<{ name?: string }>())
    .render(({ input }) => `<p>hello ${input.name ?? "stranger"}</p>`);

  it("feeds loader output into the island as input", async () => {
    const load = loader(async () => ({ name: "world" }));
    const html = await router().route("/", Greeter, load).renderHydratable("/", { Greeter });
    expect(html).toContain("hello world");
  });

  it("loader receives params from the matched route", async () => {
    const UserIsland = ilha
      .input(createSchema<{ id?: string }>())
      .render(({ input }) => `<p>u:${input.id ?? "?"}</p>`);
    const load = loader(async ({ params }) => ({ id: params.id }));
    const html = await router()
      .route("/user/:id", UserIsland, load)
      .renderHydratable("/user/7", { u: UserIsland });
    expect(html).toContain("u:7");
  });

  it("renders empty-route HTML when no route matches (loader not invoked)", async () => {
    let called = false;
    const load = loader(async () => {
      called = true;
      return {};
    });
    const html = await router().route("/", Greeter, load).renderHydratable("/missing", { Greeter });
    expect(html).toContain("data-router-empty");
    expect(called).toBe(false);
  });

  it("routes without loaders still render (backward-compat)", async () => {
    const html = await router().route("/", HomePage).renderHydratable("/", registry);
    expect(html).toContain("home");
  });

  it("forwards the supplied Request to the loader", async () => {
    let captured: Request | undefined;
    const load = loader(async ({ request }) => {
      captured = request;
      return {};
    });
    const req = new Request("http://example.com/", { headers: { "x-trace": "abc" } });
    await router().route("/", Greeter, load).renderHydratable("/", { Greeter }, {}, req);
    expect(captured).toBe(req);
  });

  it("loader data appears in data-ilha-props when snapshot is on", async () => {
    const load = loader(async () => ({ name: "alice" }));
    const html = await router()
      .route("/", Greeter, load)
      .renderHydratable("/", { Greeter }, { snapshot: true });
    // Loader return is the island's input — ilha serialises it in data-ilha-props
    expect(html).toContain("data-ilha-props");
    expect(html).toContain("alice");
  });

  it("renders meta-refresh for redirects (string-return compat)", async () => {
    const load = loader(async () => {
      redirect("/login");
    });
    const html = await router().route("/", Greeter, load).renderHydratable("/", { Greeter });
    expect(html).toContain('meta http-equiv="refresh"');
    expect(html).toContain("/login");
  });
});

// ─────────────────────────────────────────────
// router.renderResponse() — structured envelope
// ─────────────────────────────────────────────

describe("renderResponse()", () => {
  const Greeter = ilha
    .input(createSchema<{ name?: string }>())
    .render(({ input }) => `<p>hi ${input.name ?? "anon"}</p>`);

  it("returns { kind: 'html' } for successful renders", async () => {
    const load = loader(async () => ({ name: "bob" }));
    const res = await router().route("/", Greeter, load).renderResponse("/", { Greeter });
    expect(res.kind).toBe("html");
    if (res.kind === "html") {
      expect(res.html).toContain("hi bob");
    }
  });

  it("returns { kind: 'redirect' } when loader calls redirect()", async () => {
    const load = loader(async () => {
      redirect("/signin", 307);
    });
    const res = await router()
      .route("/protected", Greeter, load)
      .renderResponse("/protected", { Greeter });
    expect(res).toEqual({ kind: "redirect", to: "/signin", status: 307 });
  });

  it("returns { kind: 'error' } when loader calls error()", async () => {
    const load = loader(async () => {
      error(404, "gone");
    });
    const res = await router().route("/", Greeter, load).renderResponse("/", { Greeter });
    expect(res.kind).toBe("error");
    if (res.kind === "error") {
      expect(res.status).toBe(404);
      expect(res.message).toBe("gone");
      expect(typeof res.html).toBe("string");
    }
  });

  it("returns { kind: 'html', status: 404 } for unmatched routes", async () => {
    const res = await router().route("/", Greeter).renderResponse("/nowhere", { Greeter });
    expect(res.kind).toBe("html");
    if (res.kind === "html") {
      expect(res.status).toBe(404);
      expect(res.html).toContain("data-router-empty");
    }
  });

  it("renders html without invoking a loader when none is registered", async () => {
    const res = await router().route("/", HomePage).renderResponse("/", registry);
    expect(res.kind).toBe("html");
    if (res.kind === "html") expect(res.html).toContain("home");
  });
});

// ─────────────────────────────────────────────
// route() — backward compatibility with 2-arg form
// ─────────────────────────────────────────────

describe("route() backward compatibility", () => {
  it("2-argument .route() still registers the route", () => {
    const r = router().route("/", HomePage).route("/about", AboutPage);
    // Use isActive as a cheap probe that the route is registered
    setLocation("/about");
    // Need a sync that doesn't require .mount() — renderHydratable() does it
    // but is async. Just check that runLoader reports data+island resolved.
    return r.runLoader("/about").then((res) => {
      expect(res.kind).toBe("data");
    });
  });

  it("mixing loader and non-loader routes on the same builder works", async () => {
    const load = loader(async () => ({ x: 1 }));
    const r = router().route("/", HomePage).route("/with-loader", HomePage, load);

    const a = await r.runLoader("/");
    const b = await r.runLoader("/with-loader");
    expect(a).toEqual({ kind: "data", data: {} });
    expect(b).toEqual({ kind: "data", data: { x: 1 } });
  });
});

// ─────────────────────────────────────────────
// prefetch() — opt-out when no loader registered
// ─────────────────────────────────────────────

describe("prefetch()", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    fetchSpy = (spyOn(globalThis, "fetch") as any).mockImplementation(async () => {
      return new Response(JSON.stringify({ kind: "data", data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("does not fetch when the route has no loader", () => {
    router().route("/no-loader-a", HomePage); // no loader
    prefetch("/no-loader-a");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not fetch for unmatched paths", () => {
    router().route(
      "/has-loader",
      HomePage,
      loader(async () => ({})),
    );
    prefetch("/not-a-route");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches the loader endpoint when the route has a loader", () => {
    router().route(
      "/pf-fetch",
      HomePage,
      loader(async () => ({})),
    );
    prefetch("/pf-fetch");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = (fetchSpy.mock.calls[0] as any[])[0] as string;
    expect(url).toContain("/__ilha/loader");
    expect(url).toContain("path=");
  });

  it("is idempotent — second call with same path does not fetch again", () => {
    router().route(
      "/pf-idem",
      HomePage,
      loader(async () => ({})),
    );
    prefetch("/pf-idem");
    prefetch("/pf-idem");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("encodes the path into the query string", () => {
    router().route(
      "/pf-enc/:id",
      HomePage,
      loader(async () => ({})),
    );
    prefetch("/pf-enc/abc?tab=reviews");
    const url = (fetchSpy.mock.calls[0] as any[])[0] as string;
    expect(url).toContain(encodeURIComponent("/pf-enc/abc?tab=reviews"));
  });
});

// ─────────────────────────────────────────────
// RouterLink — data-prefetch attribute + hover
// ─────────────────────────────────────────────

describe("RouterLink", () => {
  it("renders with data-prefetch attribute and data-link marker", () => {
    // RouterLink uses .state() so toString props don't seed state — the SSR
    // markup carries the empty defaults. We just assert the static markers
    // that enable click interception and hover prefetch are present.
    const html = RouterLink.toString();
    expect(html).toContain("data-prefetch");
    expect(html).toContain("data-link");
  });
});

// ─────────────────────────────────────────────
// wrapError / wrapLayout — hydration interactivity
// ─────────────────────────────────────────────

describe("wrapError / wrapLayout hydration", () => {
  let el: Element;

  afterEach(() => {
    if (el && el.parentNode) cleanup(el);
  });

  /** Flush microtasks so reactive signal propagation completes. Two ticks
   *  are needed: first tick propagates the signal change, second tick runs
   *  the render effect that updates the DOM. */
  function flushEffects() {
    return Promise.resolve().then(() => Promise.resolve());
  }

  it("wrapError preserves interactivity — state updates work on direct mount", async () => {
    const Counter = ilha
      .state("count", 0)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<button data-inc>count:${state.count()}</button>`);

    const ErrorPage = ilha.render(() => `<p>error</p>`);
    const Wrapped = wrapError((_err, _route) => ErrorPage, Counter);

    // SSR the wrapped island
    const ssrHtml = Wrapped.toString();
    expect(ssrHtml).toContain("count:0");

    el = makeEl(ssrHtml);

    // Mount directly — wrapError's custom .mount should forward to Counter
    const unmount = Wrapped.mount(el);

    // Click the button — state should update (interactivity check)
    const btn = el.querySelector("[data-inc]");
    expect(btn).not.toBeNull();
    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await flushEffects();

    expect(el.innerHTML).toContain("count:1");
    unmount();
  });

  it("wrapError preserves interactivity after hydration via ilha.mount", async () => {
    const Counter = ilha
      .state("count", 0)
      .on("[data-inc]@click", ({ state }) => {
        state.count(state.count() + 1);
      })
      .render(({ state }) => `<button data-inc>count:${state.count()}</button>`);

    const ErrorPage = ilha.render(() => `<p>error</p>`);
    const Wrapped = wrapError((_err, _route) => ErrorPage, Counter);

    const reg: Record<string, typeof Counter> = { Counter: Wrapped };

    // Use hydratable to produce SSR HTML with state snapshot
    const ssrHtml = await Wrapped.hydratable({}, { name: "Counter", snapshot: true });
    expect(ssrHtml).toContain("count:0");

    setLocation("/");
    el = makeEl(ssrHtml);

    // ilha.mount discovers and activates [data-ilha] elements
    const { unmount } = ilha.mount(reg, { root: el });

    // Click the button — state should update (interactivity check)
    const btn = el.querySelector("[data-inc]");
    expect(btn).not.toBeNull();
    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await flushEffects();

    expect(el.innerHTML).toContain("count:1");
    unmount();
  });

  it("wrapError ISLAND_MOUNT_INTERNAL forwards updateProps to inner page", () => {
    const Greeter = ilha
      .input<{ name: string }>()
      .render(({ input }) => `<p>hello ${input.name}</p>`);

    const ErrorPage = ilha.render(() => `<p>error</p>`);
    const Wrapped = wrapError((_err, _route) => ErrorPage, Greeter);

    el = makeEl(Wrapped.toString());

    // Mount via ISLAND_MOUNT_INTERNAL (simulates slot-based child mounting)
    const internal = (Wrapped as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] as
      | ((
          host: Element,
          props?: Record<string, unknown>,
        ) => {
          unmount: () => void;
          updateProps: (props?: Record<string, unknown>) => void;
        })
      | undefined;
    expect(internal).toBeDefined();

    const handle = internal!(el, { name: "alice" });
    expect(el.innerHTML).toContain("hello alice");

    // Push new props — should re-render the inner page
    handle.updateProps({ name: "bob" });
    expect(el.innerHTML).toContain("hello bob");

    handle.unmount();
  });

  it("wrapError ISLAND_MOUNT_INTERNAL falls back to errorIsland when page.mount throws", () => {
    const Broken = ilha.render(() => `<p>broken</p>`);
    // Break the internal mount to force the catch branch
    (Broken as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] = () => {
      throw new Error("mount failed");
    };

    const ErrorPage = ilha.render(() => `<p>error-fallback</p>`);
    const Wrapped = wrapError((_err, _route) => ErrorPage, Broken);

    el = makeEl(Wrapped.toString());

    const internal = (Wrapped as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] as
      | ((
          host: Element,
          props?: Record<string, unknown>,
        ) => {
          unmount: () => void;
          updateProps: () => void;
        })
      | undefined;

    // Should not throw — should render error island instead
    const handle = internal!(el);
    expect(el.innerHTML).toContain("error-fallback");

    // updateProps is a no-op for error islands (by design)
    handle.updateProps();
    expect(el.innerHTML).toContain("error-fallback");

    handle.unmount();
  });
});
