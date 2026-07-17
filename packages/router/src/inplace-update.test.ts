// =============================================================================
// Same-island navigations update the mounted view in place (no remount):
// loader data flows through updateProps + morph, so focus, caret, and scroll
// survive — the persistQuery filter-input case. Island-changed navigations
// keep the teardown + mount path.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";

import ilha, { html } from "ilha";

import { router, navigate, loader, invalidate, wrapLayout } from "./index";

function makeEl(inner = ""): Element {
  const el = document.createElement("div");
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

function cleanup(el: Element) {
  el.remove();
}

function setLocation(path: string) {
  window.location.href = "http://localhost" + path;
}

const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

/** Wait long enough for scrollAfterNavigate's requestAnimationFrame. */
const flushRaf = async () => {
  await new Promise((r) => setTimeout(r, 40));
};

const HomePage = ilha.render(() => `<p>home</p>`);
const AboutPage = ilha.render(() => `<p>about</p>`);

/** A search page: an input plus a loader-driven list. */
function makeSearchPage() {
  return ilha.render(
    ({ input }: any) =>
      `<div><input data-q /><ul>${((input?.rows ?? []) as string[])
        .map((r) => `<li>${r}</li>`)
        .join("")}</ul></div>`,
  );
}

/** Loader echoing ?q= into rows. */
function makeSearchLoader() {
  return mock(async ({ url }: any) => ({ rows: [url.searchParams.get("q") ?? ""] }));
}

describe("same-island in-place updates (SPA mode)", () => {
  let el: Element;
  let unmount: (() => void) | null = null;

  beforeEach(() => {
    setLocation("/");
    el = makeEl();
  });

  afterEach(() => {
    unmount?.();
    unmount = null;
    cleanup(el);
    setLocation("/");
  });

  it("focus + caret survive a search-only navigation; the list re-renders with new data", async () => {
    const SearchPage = makeSearchPage();
    const load = makeSearchLoader();
    unmount = router().route("/", HomePage).route("/s", SearchPage, loader(load)).mount(el);

    navigate("/s?q=a");
    await flush();
    expect(el.innerHTML).toContain("<li>a</li>");

    const input = el.querySelector<HTMLInputElement>("input[data-q]")!;
    input.focus();
    input.value = "ab";
    input.setSelectionRange(1, 1);
    expect(document.activeElement).toBe(input);

    navigate("/s?q=ab");
    await flush();

    // Same DOM node — not a remounted copy — still focused, caret intact.
    expect(el.querySelector("input[data-q]")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    // And the loader-driven part of the view did re-render.
    expect(load).toHaveBeenCalledTimes(2);
    expect(el.innerHTML).toContain("<li>ab</li>");
    expect(el.innerHTML).not.toContain("<li>a</li><li>a</li>");
  });

  it("updateProps path: view container and page root are not replaced across a param change", async () => {
    const SearchPage = makeSearchPage();
    const load = makeSearchLoader();
    unmount = router().route("/", HomePage).route("/s", SearchPage, loader(load)).mount(el);

    navigate("/s?q=one");
    await flush();
    const view = el.querySelector("[data-router-view]")!;
    const pageRoot = view.firstElementChild!;

    navigate("/s?q=two");
    await flush();

    // innerHTML was not reassigned — same container, same page root element.
    expect(el.querySelector("[data-router-view]")).toBe(view);
    expect(view.firstElementChild).toBe(pageRoot);
    expect(view.innerHTML).toContain("<li>two</li>");
  });

  it("island change still remounts: effect cleanup runs exactly once, none for same-island navs", async () => {
    let cleanups = 0;
    const FxPage = ilha
      .effect(() => () => {
        cleanups++;
      })
      .render(({ input }: any) => `<p>fx:${input?.rows?.[0] ?? "-"}</p>`);
    const load = makeSearchLoader();
    unmount = router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .route("/fx", FxPage, loader(load))
      .mount(el);

    navigate("/fx?q=a");
    await flush();
    navigate("/fx?q=b");
    await flush();
    expect(cleanups).toBe(0); // in-place update — no teardown
    expect(el.innerHTML).toContain("fx:b");

    navigate("/about");
    await flush();
    expect(cleanups).toBe(1); // island changed — exactly one teardown
    expect(el.innerHTML).toContain("about");
  });

  it("invalidate() updates the mounted island in place — focused element preserved", async () => {
    const SearchPage = makeSearchPage();
    const load = makeSearchLoader();
    unmount = router().route("/", HomePage).route("/s", SearchPage, loader(load)).mount(el);

    navigate("/s?q=a");
    await flush();
    const input = el.querySelector<HTMLInputElement>("input[data-q]")!;
    input.focus();

    await invalidate();
    await flush();

    expect(load).toHaveBeenCalledTimes(2);
    expect(el.querySelector("input[data-q]")).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it("superseded navigations never apply: only the final loader result reaches the DOM", async () => {
    const SearchPage = makeSearchPage();
    const pending: Array<{ q: string; resolve: () => void }> = [];
    const load = mock(({ url }: any) => {
      const q = url.searchParams.get("q") ?? "";
      return new Promise((resolve) => {
        pending.push({ q, resolve: () => resolve({ rows: [q] }) });
      });
    });
    unmount = router()
      .route("/", HomePage)
      .route("/s", SearchPage, loader(load as any))
      .mount(el);

    navigate("/s?q=a");
    await flush(); // loader for "a" is in flight
    navigate("/s?q=ab");
    await flush();
    navigate("/s?q=abc");
    await flush();

    // Resolve stale loaders first — their navigations were superseded, so
    // their data must never be pushed into the view.
    pending.find((p) => p.q === "a")?.resolve();
    pending.find((p) => p.q === "ab")?.resolve();
    await flush();
    expect(el.innerHTML).not.toContain("<li>a</li>");
    expect(el.innerHTML).not.toContain("<li>ab</li>");

    pending.find((p) => p.q === "abc")?.resolve();
    await flush();
    expect(el.innerHTML).toContain("<li>abc</li>");
  });

  it("same-island navigation keeps scroll; island change scrolls to top", async () => {
    const SearchPage = makeSearchPage();
    const load = makeSearchLoader();
    unmount = router()
      .route("/", HomePage)
      .route("/about", AboutPage)
      .route("/s", SearchPage, loader(load))
      .mount(el);
    navigate("/s?q=a");
    await flush();

    const scrollSpy = spyOn(window, "scrollTo").mockImplementation((() => {}) as any);
    try {
      navigate("/s?q=ab");
      await flush();
      await flushRaf();
      // Param change on the same island — no scroll reset.
      expect(scrollSpy).not.toHaveBeenCalled();

      navigate("/about");
      await flush();
      await flushRaf();
      // Island change — existing scroll-to-top behavior.
      expect(scrollSpy).toHaveBeenCalledWith(0, 0);
    } finally {
      scrollSpy.mockRestore();
    }
  });

  it("layouts update in place too: page under an input-ignoring layout keeps focus and gets new props", async () => {
    const SearchPage = makeSearchPage();
    // Layout that never reads its input — props must still reach the page.
    const Wrapped = wrapLayout(
      (children: any) => ilha.render(() => html`<section data-shell>${children}</section>`),
      SearchPage,
    );
    const load = makeSearchLoader();
    unmount = router().route("/", HomePage).route("/l", Wrapped, loader(load)).mount(el);

    navigate("/l?q=a");
    await flush();
    expect(el.innerHTML).toContain("<li>a</li>");
    const input = el.querySelector<HTMLInputElement>("input[data-q]")!;
    input.focus();

    navigate("/l?q=ab");
    await flush();

    expect(el.querySelector("input[data-q]")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(el.innerHTML).toContain("<li>ab</li>");
    expect(el.querySelector("[data-shell]")).not.toBeNull();
  });
});

describe("same-island in-place updates (hydrate mode)", () => {
  afterEach(() => {
    setLocation("/");
  });

  it("router-mounted view updates in place on the second same-island navigation", async () => {
    const SearchPage = makeSearchPage();
    const load = makeSearchLoader();
    const reg = { home: HomePage, search: SearchPage };

    setLocation("/");
    const el = makeEl(`<div data-router-view><p>home</p></div>`);
    const unmount = router()
      .route("/", HomePage)
      .route("/s", SearchPage, loader(load))
      .mount(el, { hydrate: true, registry: reg });
    await flush();

    // First navigation to /s mounts the island fresh (island changed).
    navigate("/s?q=a");
    await flush();
    expect(el.innerHTML).toContain("<li>a</li>");
    const input = el.querySelector<HTMLInputElement>("input[data-q]")!;
    input.focus();

    // Second navigation: same island — must update in place.
    navigate("/s?q=ab");
    await flush();
    expect(el.querySelector("input[data-q]")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(el.innerHTML).toContain("<li>ab</li>");

    unmount();
    cleanup(el);
  });

  it("adopts the SSR-hydrated island: the very first same-island navigation updates in place", async () => {
    const SearchPage = makeSearchPage();
    const load = makeSearchLoader();
    const reg = { home: HomePage, search: SearchPage };

    const ssrHtml = await router()
      .route("/", HomePage)
      .route("/s", SearchPage, loader(load))
      .renderHydratable("/s?q=a", reg);
    expect(ssrHtml).toContain("<li>a</li>");

    setLocation("/s?q=a");
    const el = makeEl(ssrHtml);
    // App boot: ilha.mount() hydrates the SSR islands (the router never saw
    // these handles — it must adopt them).
    const hydrated = ilha.mount(reg, { root: el });
    const unmount = router()
      .route("/", HomePage)
      .route("/s", SearchPage, loader(load))
      .mount(el, { hydrate: true, registry: reg });
    await flush();

    const input = el.querySelector<HTMLInputElement>("input[data-q]")!;
    input.focus();

    navigate("/s?q=ab");
    await flush();

    // In-place: the hydrated input survived the first client navigation.
    expect(el.querySelector("input[data-q]")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(el.innerHTML).toContain("<li>ab</li>");

    unmount();
    void hydrated.unmount();
    cleanup(el);
  });
});
