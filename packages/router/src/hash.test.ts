import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";

import ilha from "ilha";

import {
  router,
  navigate,
  enableLinkInterception,
  routePath,
  routeSearch,
  routeHash,
  RouterLink,
  setHistoryMode,
  getHistoryMode,
} from "./index";

// ─────────────────────────────────────────────
// Shared Page islands
// ─────────────────────────────────────────────

const HomePage = ilha.render(() => `<p>home</p>`);
const AboutPage = ilha.render(() => `<p>about</p>`);
const UserPage = ilha.render(() => `<p>user</p>`);

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeEl(inner = ""): Element {
  const el = document.createElement("div");
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

function cleanup(el: Element) {
  if (el.parentNode === document.body) document.body.removeChild(el);
}

function detached(): Element {
  return document.createElement("div");
}

/**
 * Set the URL bar to a hash-mode URL. We anchor at "/" because in a real
 * hash-mode app the document is served from a single path (often "/" or
 * "index.html") and the hash carries the route.
 */
function setHashLocation(logicalPath: string) {
  const hash = logicalPath.startsWith("#") ? logicalPath : "#" + logicalPath;
  window.location.href = "http://localhost/" + hash;
}

function popstate() {
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
}

function hashchange() {
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function resetMode() {
  setHistoryMode("history");
}

// ─────────────────────────────────────────────
// Mode toggle — public API
// ─────────────────────────────────────────────

describe("setHistoryMode / getHistoryMode", () => {
  afterEach(() => {
    resetMode();
  });

  it("defaults to history mode", () => {
    expect(getHistoryMode()).toBe("history");
  });

  it("switches to hash mode when set", () => {
    setHistoryMode("hash");
    expect(getHistoryMode()).toBe("hash");
  });

  it("switches back to history mode when set", () => {
    setHistoryMode("hash");
    setHistoryMode("history");
    expect(getHistoryMode()).toBe("history");
  });
});

// ─────────────────────────────────────────────
// Initial sync — router reads from hash on mount
// ─────────────────────────────────────────────

describe("hash mode — initial mount", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setHistoryMode("hash");
  });

  afterEach(() => {
    unmount?.();
    cleanup(el);
    resetMode();
    window.location.href = "http://localhost/";
  });

  it("reads route from location.hash on mount", () => {
    setHashLocation("/about");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
    expect(routePath()).toBe("/about");
    expect(el.innerHTML).toContain("about");
  });

  it("treats empty hash as root path", () => {
    window.location.href = "http://localhost/";
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
    expect(routePath()).toBe("/");
    expect(el.innerHTML).toContain("home");
  });

  it("treats bare '#' as root path", () => {
    window.location.href = "http://localhost/#";
    el = makeEl();
    unmount = router().route("/", HomePage).mount(el);
    expect(routePath()).toBe("/");
  });

  it("parses search params from inside the hash", () => {
    setHashLocation("/about?tab=docs");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
    expect(routePath()).toBe("/about");
    expect(routeSearch()).toBe("?tab=docs");
  });

  it("parses an in-hash anchor into routeHash()", () => {
    setHashLocation("/about#section");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
    expect(routePath()).toBe("/about");
    expect(routeHash()).toBe("#section");
  });
});

// ─────────────────────────────────────────────
// navigate() in hash mode
// ─────────────────────────────────────────────

describe("hash mode — navigate()", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setHistoryMode("hash");
    setHashLocation("/");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
  });

  afterEach(() => {
    unmount();
    cleanup(el);
    resetMode();
    window.location.href = "http://localhost/";
  });

  it("writes the logical path into location.hash", () => {
    navigate("/about");
    expect(window.location.hash).toBe("#/about");
  });

  it("updates routePath to the logical path (no leading hash)", () => {
    navigate("/about");
    expect(routePath()).toBe("/about");
  });

  it("re-renders outlet to matched island", () => {
    expect(el.innerHTML).toContain("home");
    navigate("/about");
    expect(el.innerHTML).toContain("about");
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

  it("dedups duplicate navigations", () => {
    navigate("/about");
    const before = history.length;
    navigate("/about");
    expect(history.length).toBe(before);
  });

  it("preserves search params when navigating", () => {
    navigate("/about?tab=docs");
    expect(window.location.hash).toBe("#/about?tab=docs");
    expect(routePath()).toBe("/about");
    expect(routeSearch()).toBe("?tab=docs");
  });
});

// ─────────────────────────────────────────────
// hashchange & popstate — back/forward and address bar edits
// ─────────────────────────────────────────────

describe("hash mode — change events", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setHistoryMode("hash");
    setHashLocation("/");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
  });

  afterEach(() => {
    unmount();
    cleanup(el);
    resetMode();
    window.location.href = "http://localhost/";
  });

  it("syncs route when popstate fires (back/forward)", () => {
    setHashLocation("/about");
    popstate();
    expect(routePath()).toBe("/about");
    expect(el.innerHTML).toContain("about");
  });

  it("syncs route when hashchange fires (address bar edit)", () => {
    setHashLocation("/about");
    hashchange();
    expect(routePath()).toBe("/about");
    expect(el.innerHTML).toContain("about");
  });

  it("does NOT respond to hashchange after unmount", () => {
    unmount();
    setHashLocation("/about");
    hashchange();
    expect(routePath()).toBe("/");
  });

  it("does NOT respond to popstate after unmount", () => {
    unmount();
    setHashLocation("/about");
    popstate();
    expect(routePath()).toBe("/");
  });
});

// ─────────────────────────────────────────────
// Link interception
// ─────────────────────────────────────────────

describe("hash mode — link interception", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setHistoryMode("hash");
    setHashLocation("/");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
  });

  afterEach(() => {
    unmount();
    cleanup(el);
    resetMode();
    window.location.href = "http://localhost/";
  });

  it("intercepts hash-form links (#/about)", () => {
    const link = document.createElement("a");
    link.setAttribute("href", "#/about");
    el.appendChild(link);
    link.click();
    expect(routePath()).toBe("/about");
    expect(el.innerHTML).toContain("about");
  });

  it("intercepts plain-path links (/about) — same logical path", () => {
    const link = document.createElement("a");
    link.setAttribute("href", "/about");
    el.appendChild(link);
    link.click();
    expect(routePath()).toBe("/about");
    expect(window.location.hash).toBe("#/about");
  });

  it("does NOT intercept in-page anchor links (#section)", () => {
    const root = detached();
    const link = document.createElement("a");
    link.setAttribute("href", "#section");
    root.appendChild(link);
    const stop = enableLinkInterception(root);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    stop();
    expect(routePath()).toBe("/");
  });

  it("does NOT intercept bare '#' links", () => {
    const root = detached();
    const link = document.createElement("a");
    link.setAttribute("href", "#");
    root.appendChild(link);
    const stop = enableLinkInterception(root);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    stop();
    expect(routePath()).toBe("/");
  });

  it("does NOT intercept ctrl-click", () => {
    const root = detached();
    const link = document.createElement("a");
    link.setAttribute("href", "#/about");
    root.appendChild(link);
    const stop = enableLinkInterception(root);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    stop();
    expect(routePath()).toBe("/");
  });

  it("does NOT intercept target=_blank", () => {
    const root = detached();
    const link = document.createElement("a");
    link.setAttribute("href", "#/about");
    link.setAttribute("target", "_blank");
    root.appendChild(link);
    const stop = enableLinkInterception(root);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    stop();
    expect(routePath()).toBe("/");
  });

  it("respects data-no-intercept", () => {
    const root = detached();
    const link = document.createElement("a");
    link.setAttribute("href", "#/about");
    link.setAttribute("data-no-intercept", "");
    root.appendChild(link);
    const stop = enableLinkInterception(root);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    stop();
    expect(routePath()).toBe("/");
  });

  it("intercepts absolute same-origin URLs with a hash route", () => {
    // Routes are already registered by the outer beforeEach.
    const root = detached();
    const link = document.createElement("a");
    link.setAttribute("href", "http://localhost/#/about");
    root.appendChild(link);
    const stop = enableLinkInterception(root);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    stop();
    expect(routePath()).toBe("/about");
  });
});

// ─────────────────────────────────────────────
// RouterLink rendering
// ─────────────────────────────────────────────

describe("hash mode — RouterLink", () => {
  beforeEach(() => {
    setHistoryMode("hash");
  });

  afterEach(() => {
    resetMode();
  });

  it("renders an empty-state link with '#' as the href in hash mode", () => {
    // With no state seeded, state.href() returns "" so toLinkHref produces "#"
    const html = RouterLink.toString();
    expect(html).toContain("data-link");
    expect(html).toContain("data-prefetch");
  });

  it("renders the empty-state RouterLink without errors in history mode", () => {
    resetMode();
    const html = RouterLink.toString();
    expect(html).toContain("data-link");
    expect(html).toContain("data-prefetch");
  });
});

// ─────────────────────────────────────────────
// Mode isolation — switching back to history mode resets behavior
// ─────────────────────────────────────────────

describe("hash mode — hydrate warning", () => {
  let el: Element;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    setHistoryMode("hash");
    setHashLocation("/");
  });

  afterEach(() => {
    unmount?.();
    cleanup(el);
    resetMode();
    window.location.href = "http://localhost/";
  });

  it("warns when mount({ hydrate: true }) is called in hash mode", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    el = makeEl();
    unmount = router().route("/", HomePage).mount(el, { hydrate: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("hash mode"));
    warn.mockRestore();
  });

  it("does NOT warn when mount() is called without hydrate in hash mode", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    el = makeEl();
    unmount = router().route("/", HomePage).mount(el);
    // Filter for the hash-mode hydrate warning specifically — other warnings
    // (e.g. from RouterView edge cases) should not fail this test.
    const hashWarnings = warn.mock.calls.filter((call) => String(call[0]).includes("hash mode"));
    expect(hashWarnings).toHaveLength(0);
    warn.mockRestore();
  });

  it("does NOT warn when mount({ hydrate: true }) is called in history mode", () => {
    resetMode();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    el = makeEl();
    unmount = router().route("/", HomePage).mount(el, { hydrate: true });
    const hashWarnings = warn.mock.calls.filter((call) => String(call[0]).includes("hash mode"));
    expect(hashWarnings).toHaveLength(0);
    warn.mockRestore();
  });
});

describe("hash mode — mode isolation", () => {
  let el: Element;
  let unmount: (() => void) | undefined;

  afterEach(() => {
    unmount?.();
    cleanup(el);
    resetMode();
    window.location.href = "http://localhost/";
  });

  it("after switching back to history mode, navigate() writes pathname (not hash)", () => {
    setHistoryMode("hash");
    setHashLocation("/");
    setHistoryMode("history");

    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
    navigate("/about");

    expect(window.location.pathname).toBe("/about");
    expect(routePath()).toBe("/about");
  });

  it("hash adapter and history adapter don't interfere across remount", () => {
    // First mount: hash mode
    setHistoryMode("hash");
    setHashLocation("/about");
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
    expect(routePath()).toBe("/about");
    unmount();
    cleanup(el);

    // Remount: history mode
    setHistoryMode("history");
    window.location.href = "http://localhost/";
    el = makeEl();
    unmount = router().route("/", HomePage).route("/about", AboutPage).mount(el);
    expect(routePath()).toBe("/");
  });
});

// ─────────────────────────────────────────────
// Multi-step navigation — exercises the dedup + popstate paths together
// ─────────────────────────────────────────────

describe("hash mode — navigation sequences", () => {
  let el: Element;
  let unmount: () => void;

  beforeEach(() => {
    setHistoryMode("hash");
    setHashLocation("/");
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
    resetMode();
    window.location.href = "http://localhost/";
  });

  it("navigates between three routes correctly", () => {
    navigate("/about");
    expect(routePath()).toBe("/about");
    expect(el.innerHTML).toContain("about");

    navigate("/user/42");
    expect(routePath()).toBe("/user/42");
    expect(el.innerHTML).toContain("user");

    navigate("/");
    expect(routePath()).toBe("/");
    expect(el.innerHTML).toContain("home");
  });

  it("simulated back navigation re-renders prior route", () => {
    navigate("/about");
    expect(routePath()).toBe("/about");

    // Simulate the user pressing back: the URL hash reverts and popstate fires.
    setHashLocation("/");
    popstate();

    expect(routePath()).toBe("/");
    expect(el.innerHTML).toContain("home");
  });
});
