// =============================================================================
// @ilha/store/query — persistQuery() test suite
// Run with: bun test (happy-dom provides window/location/history)
// =============================================================================

import { describe, it, expect, mock, beforeEach } from "bun:test";

import { z } from "zod";

import { store } from "./index";
import {
  persistQuery,
  codec,
  readQuery,
  querySpec,
  withQuery,
  storeHref,
  type NavigateFn,
} from "./query";

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

  it("per-key debounce: q waits, f writes immediately", async () => {
    const s = store({ q: "", f: [] as { column: string }[] }).build();
    const navigate = makeNavigate();
    const stop = persistQuery(s, {
      navigate,
      debounce: { q: 40, f: 0 },
      params: {
        q: codec.string(),
        f: codec.json(),
      },
    });

    s.setState({ q: "boots" });
    expect(navigate).toHaveBeenCalledTimes(0);
    s.setState({ f: [{ column: "x" }] });
    // f has debounce 0 → immediate write includes pending q
    expect(navigate).toHaveBeenCalledTimes(1);
    const sp = new URL(navigate.mock.calls[0]![0], location.origin).searchParams;
    expect(sp.get("q")).toBe("boots");
    expect(sp.get("f")).toBe(JSON.stringify([{ column: "x" }]));
    stop();
  });

  it("per-key history map: f pushes, q replaces", () => {
    const s = store({ q: "", f: [] as string[] }).build();
    const navigate = makeNavigate();
    const stop = persistQuery(s, {
      navigate,
      history: { q: "replace", f: "push" },
      params: {
        q: codec.string(),
        f: codec.json(),
      },
    });

    s.setState({ q: "a" });
    expect(navigate.mock.calls[0]![1]?.replace).toBe(true);
    s.setState({ f: [1] as unknown as string[] });
    expect(navigate.mock.calls[1]![1]?.replace).toBe(false);
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

  it("built-in codec.json round-trips arrays through URL", () => {
    type F = { column: string; op: string; value: string };
    history.replaceState(
      null,
      "",
      "/list?f=" + encodeURIComponent(JSON.stringify([{ column: "name", op: "eq", value: "a" }])),
    );
    const s = store({ f: [] as F[] }).build();
    const navigate = makeNavigate();
    const stop = persistQuery(s, {
      navigate,
      params: { f: codec.json<F[]>() },
    });
    expect(s.getState().f).toEqual([{ column: "name", op: "eq", value: "a" }]);
    s.setState({ f: [{ column: "age", op: "gt", value: "10" }] });
    expect(JSON.parse(new URL(location.href).searchParams.get("f")!)).toEqual([
      { column: "age", op: "gt", value: "10" },
    ]);
    stop();
  });

  it("built-in codec.stringArray escapes commas", () => {
    const s = store({ tags: [] as string[] }).build();
    const navigate = makeNavigate();
    const stop = persistQuery(s, {
      navigate,
      params: { tags: codec.stringArray() },
    });
    s.setState({ tags: ["a,b", "c"] });
    const raw = new URL(location.href).searchParams.get("tags")!;
    expect(raw).toContain(encodeURIComponent("a,b"));
    // re-hydrate
    history.replaceState(null, "", "/list?tags=" + encodeURIComponent(raw));
    // URLSearchParams may decode once — seed a fresh store
    const s2 = store({ tags: [] as string[] }).build();
    const stop2 = persistQuery(s2, {
      navigate: makeNavigate(),
      params: { tags: codec.stringArray() },
    });
    expect(s2.getState().tags).toEqual(["a,b", "c"]);
    stop();
    stop2();
  });

  it("applyFromUrl accepts schema-cloned arrays via serialize equality", () => {
    history.replaceState(null, "", "/list?tags=" + encodeURIComponent("a,b"));
    const s = store(
      z.object({
        tags: z.array(z.string()).default([]),
      }),
    )
      .onError(() => {})
      .build();
    const navigate = makeNavigate();
    const stop = persistQuery(s, {
      navigate,
      params: {
        tags: {
          serialize: (t) => t.join(","),
          deserialize: (raw) => (raw === "" ? [] : raw.split(",")),
        },
      },
    });
    expect(s.getState().tags).toEqual(["a", "b"]);
    stop();
  });

  it("an external navigation cancels a pending debounced write", async () => {
    const s = filtersStore();
    const navigate = makeNavigate();
    const stop = persistQuery(s, { navigate, debounce: 20 });

    s.setState({ q: "stale" }); // debounced, still pending
    // Back/forward lands on a different owned-param state before the flush.
    history.replaceState(null, "", "/list?q=fresh");
    window.dispatchEvent(new Event("popstate"));

    expect(s.getState().q).toBe("fresh");
    await sleep(60);
    // The stale pending write must not have navigated over the external URL.
    expect(navigate).toHaveBeenCalledTimes(0);
    expect(location.search).toBe("?q=fresh");
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

describe("readQuery / querySpec", () => {
  it("readQuery parses with the same codecs as persistQuery (isomorphic)", () => {
    const initial = { q: "", page: 1, f: [] as { id: number }[] };
    const opts = {
      params: {
        f: codec.json<{ id: number }[]>(),
        page: codec.int({ min: 1, default: 1 }),
      },
    };
    const url = new URL(
      "http://x/list?q=hi&page=3&f=" + encodeURIComponent(JSON.stringify([{ id: 1 }])),
    );
    const parsed = readQuery(initial, url, opts);
    expect(parsed).toEqual({ q: "hi", page: 3, f: [{ id: 1 }] });

    // missing → defaults
    expect(readQuery(initial, new URL("http://x/list"), opts)).toEqual(initial);
  });

  it("querySpec shares parse + persist options", () => {
    const spec = querySpec(
      { q: "", page: 1 as number, tags: [] as string[] },
      {
        params: {
          page: codec.int({ min: 1, default: 1 }),
          tags: codec.stringArray(),
        },
        debounce: { q: 250 },
        history: { page: "push" },
      },
    );

    const parsed = spec.parse("?q=x&page=2&tags=a,b");
    expect(parsed.q).toBe("x");
    expect(parsed.page).toBe(2);
    expect(parsed.tags).toEqual(["a", "b"]);

    expect(spec.persistOptions.debounce).toEqual({ q: 250 });

    history.replaceState(null, "", "/list?q=from-url");
    const s = store(spec.defaults).build();
    const navigate = makeNavigate();
    const stop = spec.persist(s, { navigate });
    expect(s.getState().q).toBe("from-url");
    stop();
  });

  it("withQuery merges without dropping foreign keys", () => {
    expect(withQuery("/list?q=boots&tab=all", { page: 2 })).toBe("/list?q=boots&tab=all&page=2");
    expect(withQuery("/list?page=1", { page: null })).toBe("/list");
  });

  it("storeHref serializes owned keys and preserves foreign params", () => {
    history.replaceState(null, "", "/list?tab=all&q=old");
    const s = store({ q: "old", page: 1 }).build();
    s.setState({ q: "new", page: 3 });
    const href = storeHref(s, { page: 4 }, {});
    const u = new URL(href, location.origin);
    expect(u.searchParams.get("tab")).toBe("all");
    expect(u.searchParams.get("q")).toBe("new");
    expect(u.searchParams.get("page")).toBe("4");
  });
});

describe("codec", () => {
  it("int / bool / enum / isoDate", () => {
    expect(codec.int({ min: 1 }).deserialize!("3")).toBe(3);
    expect(codec.int({ min: 1, default: 1 }).deserialize!("0")).toBe(1);
    expect(codec.bool().serialize!(true)).toBe("1");
    expect(codec.bool().deserialize!("yes")).toBe(true);
    expect(codec.enum(["asc", "desc"] as const).deserialize!("desc")).toBe("desc");
    const d = new Date("2020-01-01T00:00:00.000Z");
    expect(codec.isoDate().deserialize!(codec.isoDate().serialize!(d)!).toISOString()).toBe(
      d.toISOString(),
    );
  });

  it("jsonb round-trips", () => {
    const c = codec.jsonb<{ a: number }>();
    const raw = c.serialize!({ a: 1 })!;
    expect(raw).not.toContain("+");
    expect(c.deserialize!(raw)).toEqual({ a: 1 });
  });
});
