// =============================================================================
// @ilha/store/query — persistQuery() test suite
// Run with: bun test (happy-dom provides window/location/history)
// =============================================================================

import { describe, it, expect, mock, beforeEach } from "bun:test";

import { z } from "zod";

import { store } from "./index";
import { persistQuery, type NavigateFn } from "./query";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Injected navigate that mirrors the router's contract onto happy-dom history. */
function makeNavigate() {
  return mock<NavigateFn>((to, opts) => {
    history[opts?.replace ? "replaceState" : "pushState"](null, "", to);
  });
}

function filtersStore() {
  return store(
    z.object({
      q: z.string().default(""),
      page: z.coerce.number().int().min(1).default(1),
      sort: z.string().default(""),
    }),
  )
    .onError(() => {}) // silence expected rejections (invalid URL params)
    .build();
}

beforeEach(() => {
  history.replaceState(null, "", "/list");
});

describe("persistQuery()", () => {
  it("store write → URL via navigate (replace by default), unrelated params untouched", () => {
    history.replaceState(null, "", "/list?tab=all");
    const s = filtersStore();
    const navigate = makeNavigate();
    const stop = persistQuery(s, { navigate });

    s.setState({ q: "shoes", page: 2 });

    expect(navigate).toHaveBeenCalledTimes(1);
    const [to, opts] = navigate.mock.calls[0]!;
    expect(opts?.replace).toBe(true);
    const url = new URL(to, location.origin);
    expect(url.pathname).toBe("/list");
    expect(url.searchParams.get("tab")).toBe("all");
    expect(url.searchParams.get("q")).toBe("shoes");
    expect(url.searchParams.get("page")).toBe("2");
    stop();
  });

  it('history: "push" pushes; back (popstate) restores the previous store value', () => {
    const s = filtersStore();
    const navigate = makeNavigate();
    const stop = persistQuery(s, { navigate, history: "push" });

    s.setState({ page: 2 });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![1]?.replace).toBe(false);
    expect(location.search).toBe("?page=2");

    // Simulate the back button: URL returns to the previous entry, popstate fires.
    history.replaceState(null, "", "/list");
    window.dispatchEvent(new Event("popstate"));

    expect(s.getState().page).toBe(1);
    // Router → store sync must not echo a new navigation.
    expect(navigate).toHaveBeenCalledTimes(1);
    stop();
  });

  it("seeds from the URL on init: coerced + validated, invalid values degrade to defaults", () => {
    history.replaceState(null, "", "/list?page=3&q=boots");
    const s = filtersStore();
    const stop = persistQuery(s, { navigate: makeNavigate() });
    expect(s.getState()).toEqual({ q: "boots", page: 3, sort: "" });
    stop();

    history.replaceState(null, "", "/list?page=banana&q=hats");
    const s2 = filtersStore();
    const stop2 = persistQuery(s2, { navigate: makeNavigate() });
    expect(s2.getState()).toEqual({ q: "hats", page: 1, sort: "" });
    stop2();
  });

  it("omitDefaults: returning a key to its default removes the param", () => {
    const s = filtersStore();
    const navigate = makeNavigate();
    const stop = persistQuery(s, { navigate });

    s.setState({ page: 2 });
    expect(location.search).toBe("?page=2");
    s.setState({ page: 1 });
    expect(location.search).toBe("");
    // Empty string counts as default-equal when the default is "".
    s.setState({ q: "x" });
    s.setState({ q: "" });
    expect(location.search).toBe("");
    stop();
  });

  it("no write-echo loop: one store write → exactly one navigation", () => {
    const s = filtersStore();
    const navigate = makeNavigate();
    const stop = persistQuery(s, { navigate });

    s.setState({ q: "boots" });
    // Even if the router reports our own navigation back (afterNavigate),
    // applying the same URL must not re-navigate.
    window.dispatchEvent(new Event("popstate"));
    expect(navigate).toHaveBeenCalledTimes(1);
    stop();
  });

  it("debounce: rapid writes coalesce into one navigation with the final state", async () => {
    const s = filtersStore();
    const navigate = makeNavigate();
    const stop = persistQuery(s, { navigate, debounce: 20 });

    s.setState({ q: "a" });
    s.setState({ q: "ab" });
    s.setState({ q: "abc" });
    expect(navigate).toHaveBeenCalledTimes(0);
    await sleep(60);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(new URL(navigate.mock.calls[0]![0], location.origin).searchParams.get("q")).toBe("abc");
    stop();
  });

  it("a push write flushes the pending debounced replace first", async () => {
    const s = filtersStore();
    const navigate = makeNavigate();
    const stop = persistQuery(s, {
      navigate,
      debounce: 1000,
      history: (keys) => (keys.includes("page") ? "push" : "replace"),
    });

    s.setState({ q: "boots" }); // debounced replace, still pending
    s.setState({ page: 2 }); // push — must flush the replace first
    expect(navigate).toHaveBeenCalledTimes(2);
    const first = new URL(navigate.mock.calls[0]![0], location.origin);
    expect(navigate.mock.calls[0]![1]?.replace).toBe(true);
    expect(first.searchParams.get("q")).toBe("boots");
    expect(first.searchParams.get("page")).toBeNull();
    const second = new URL(navigate.mock.calls[1]![0], location.origin);
    expect(navigate.mock.calls[1]![1]?.replace).toBe(false);
    expect(second.searchParams.get("q")).toBe("boots");
    expect(second.searchParams.get("page")).toBe("2");
    stop();
  });

  it("two stores persisting different keys don't clobber each other", () => {
    const a = store({ q: "" }).build();
    const b = store({ page: "1" }).build();
    const navigate = makeNavigate();
    const stopA = persistQuery(a, { navigate });
    const stopB = persistQuery(b, { navigate });

    a.setState({ q: "boots" });
    b.setState({ page: "4" });
    const sp = new URL(location.href).searchParams;
    expect(sp.get("q")).toBe("boots");
    expect(sp.get("page")).toBe("4");

    a.setState({ q: "" });
    expect(new URL(location.href).searchParams.get("page")).toBe("4");
    stopA();
    stopB();
  });

  it("params mapping + per-key codec: custom names and serialization round-trip", () => {
    history.replaceState(null, "", "/list?search=hats&tags=a,b");
    const s = store({ q: "", tags: [] as string[], internal: 0 }).build();
    const navigate = makeNavigate();
    const stop = persistQuery(s, {
      navigate,
      params: {
        q: "search",
        tags: {
          serialize: (tags) => tags.join(","),
          deserialize: (raw) => (raw === "" ? [] : raw.split(",")),
        },
      },
    });

    expect(s.getState().q).toBe("hats");
    expect(s.getState().tags).toEqual(["a", "b"]);

    s.setState({ tags: ["x"], internal: 9 }); // internal is not persisted
    const sp = new URL(location.href).searchParams;
    expect(sp.get("tags")).toBe("x");
    expect(sp.get("internal")).toBeNull();
    stop();
  });

  it("teardown flushes a pending debounced write and stops syncing", async () => {
    const s = filtersStore();
    const navigate = makeNavigate();
    const stop = persistQuery(s, { navigate, debounce: 1000 });

    s.setState({ q: "boots" });
    expect(navigate).toHaveBeenCalledTimes(0);
    stop();
    expect(navigate).toHaveBeenCalledTimes(1);
    s.setState({ q: "later" });
    await sleep(10);
    expect(navigate).toHaveBeenCalledTimes(1);
    stop(); // idempotent
  });

  it("SSR: no-op without window — never touches history/location", () => {
    const g = globalThis as { window?: unknown };
    const win = g.window;
    // Simulate a server environment.
    delete g.window;
    try {
      const s = filtersStore();
      const navigate = makeNavigate();
      const stop = persistQuery(s, { navigate });
      s.setState({ q: "boots" });
      expect(navigate).toHaveBeenCalledTimes(0);
      stop();
    } finally {
      g.window = win;
    }
  });
});
