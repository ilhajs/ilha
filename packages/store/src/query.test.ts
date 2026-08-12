// =============================================================================
// @ilha/store/query — query() / QueryCache acceptance tests (QUERY.md §11)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import ilha, { html, mount } from "ilha";

import { store } from "./index";
import { query, QueryCache, defaultQueryCache, ILHA_QUERY } from "./query";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clearDefaultCache() {
  defaultQueryCache.clear();
}

beforeEach(() => {
  clearDefaultCache();
});

afterEach(() => {
  clearDefaultCache();
});

describe("query() / QueryCache — acceptance", () => {
  it("1: two stores, same key — fn once; both resolve from in-flight promise", async () => {
    let calls = 0;
    const fetchUser = () => {
      calls += 1;
      return sleep(20).then(() => ({ id: 1, name: "Ada" }));
    };

    const a = store({ id: 1 })
      .derived("user", async (ctx) =>
        query({
          key: ["user", ctx.get().id],
          fn: () => fetchUser(),
        }),
      )
      .build();

    const b = store({ id: 1 })
      .derived("user", async (ctx) =>
        query({
          key: ["user", ctx.get().id],
          fn: () => fetchUser(),
        }),
      )
      .build();

    expect(a.user.loading).toBe(true);
    expect(b.user.loading).toBe(true);
    await sleep(40);
    expect(calls).toBe(1);
    expect(a.user()).toEqual({ id: 1, name: "Ada" });
    expect(b.user()).toEqual({ id: 1, name: "Ada" });
    a.dispose();
    b.dispose();
  });

  it("2: re-run within staleTime — fn not called; loading stays false", async () => {
    let calls = 0;
    const s = store({ id: 1, tick: 0 })
      .derived("user", async (ctx) => {
        const { id, tick } = ctx.get();
        void tick;
        return query({
          key: ["user", id],
          fn: () => {
            calls += 1;
            return Promise.resolve({ id, name: "Ada" });
          },
          staleTime: 60_000,
        });
      })
      .build();

    await sleep(5);
    expect(calls).toBe(1);
    expect(s.user()).toEqual({ id: 1, name: "Ada" });
    expect(s.user.loading).toBe(false);

    s.setState({ tick: 1 });
    await sleep(5);
    expect(calls).toBe(1);
    expect(s.user.loading).toBe(false);
    expect(s.user()).toEqual({ id: 1, name: "Ada" });
    s.dispose();
  });

  it("3: re-run after staleTime — fn called; previous value visible while loading", async () => {
    let calls = 0;
    const s = store({ id: 1, tick: 0 })
      .derived("user", async (ctx) => {
        const { id, tick } = ctx.get();
        void tick;
        return query({
          key: ["user", id],
          fn: () => {
            calls += 1;
            return sleep(30).then(() => ({ id, name: `v${calls}` }));
          },
          staleTime: 10,
        });
      })
      .build();

    await sleep(40);
    expect(calls).toBe(1);
    expect(s.user()?.name).toBe("v1");

    await sleep(15);
    s.setState({ tick: 1 });
    expect(s.user.loading).toBe(true);
    expect(s.user()?.name).toBe("v1");
    await sleep(40);
    expect(calls).toBe(2);
    expect(s.user()?.name).toBe("v2");
    expect(s.user.loading).toBe(false);
    s.dispose();
  });

  it("4: key change — old key subscribers decremented, GC armed; new key fetches", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const s = store({ id: 1 })
      .derived("user", async (ctx) =>
        query({
          key: ["user", ctx.get().id],
          fn: () => {
            calls += 1;
            const id = ctx.get().id;
            return Promise.resolve({ id });
          },
          cache,
          gcTime: 50,
        }),
      )
      .build();

    await sleep(5);
    expect(calls).toBe(1);
    const key1 = cache.key(["user", 1]);
    expect(cache.get(key1)?.subscribers).toBe(1);

    s.setState({ id: 2 });
    await sleep(5);
    expect(calls).toBe(2);
    expect(cache.get(key1)?.subscribers).toBe(0);
    expect(cache.get(key1)?.gcTimer).toBeDefined();
    expect(cache.get(cache.key(["user", 2]))?.value).toEqual({ id: 2 });

    await sleep(60);
    expect(cache.get(key1)).toBeUndefined();
    s.dispose();
  });

  it("5: dispose mid-fetch — onResult never fires; subscribers decremented", async () => {
    const cache = new QueryCache();
    let settled = false;
    const s = store({ id: 1 })
      .derived("user", async (ctx) =>
        query({
          key: ["user", ctx.get().id],
          fn: () =>
            sleep(50).then(() => {
              settled = true;
              return { id: 1 };
            }),
          cache,
          gcTime: 5_000,
        }),
      )
      .build();

    expect(s.user.loading).toBe(true);
    const key = cache.key(["user", 1]);
    expect(cache.get(key)?.subscribers).toBe(1);
    s.dispose();
    // Abort listener decrements before GC fires (gcTime is long).
    expect(cache.get(key)?.subscribers).toBe(0);
    expect(s.user()).toBeUndefined();
    await sleep(70);
    expect(settled).toBe(true);
    // Envelope was never updated (onResult gated on aborted signal).
    expect(s.user()).toBeUndefined();
  });

  it("11: dehydrate/hydrate — cache not in snapshot; only state restored", async () => {
    const { dehydrate, hydrate } = await import("./index");
    const cache = new QueryCache();
    let calls = 0;
    const s = store({ id: 1 })
      .derived("user", async (ctx) =>
        query({
          key: ["user", ctx.get().id],
          fn: () => {
            calls += 1;
            return Promise.resolve({ id: ctx.get().id, n: calls });
          },
          cache,
          staleTime: 60_000,
        }),
      )
      .build();

    await sleep(5);
    expect(calls).toBe(1);
    expect(cache.get(cache.key(["user", 1]))?.value).toEqual({ id: 1, n: 1 });

    const snap = dehydrate(s);
    // Snapshot is raw state only — no derived / cache payload.
    expect(JSON.parse(snap)).toEqual({ id: 1 });
    s.dispose();
    cache.clear();
    expect(cache.get(cache.key(["user", 1]))).toBeUndefined();
    expect(cache.size).toBe(0);

    const s2 = store({ id: 0 })
      .derived("user", async (ctx) =>
        query({
          key: ["user", ctx.get().id],
          fn: () => {
            calls += 1;
            return Promise.resolve({ id: ctx.get().id, n: calls });
          },
          cache,
          staleTime: 60_000,
        }),
      )
      .build();

    hydrate(s2, snap);
    expect(s2.getState().id).toBe(1);
    await sleep(5);
    // Client cache was cold; hydrate did not restore the prior entry — fn ran again.
    expect(calls).toBeGreaterThan(1);
    expect(s2.user()?.id).toBe(1);
    s2.dispose();
  });

  it("6: invalidate then state write — fn called again, ignoring staleTime", async () => {
    let calls = 0;
    const cache = new QueryCache();
    const s = store({ id: 1, tick: 0 })
      .derived("user", async (ctx) => {
        const { id, tick } = ctx.get();
        void tick;
        return query({
          key: ["user", id],
          fn: () => {
            calls += 1;
            return Promise.resolve({ id, n: calls });
          },
          staleTime: 60_000,
          cache,
        });
      })
      .build();

    await sleep(5);
    expect(calls).toBe(1);
    cache.invalidate(["user", 1]);
    s.setState({ tick: 1 });
    await sleep(5);
    expect(calls).toBe(2);
    expect(s.user()?.n).toBe(2);
    s.dispose();
  });

  it("7: invalidatePrefix(['user']) removes all ['user', ...] entries", () => {
    const cache = new QueryCache();
    cache.set(cache.key(["user", 1]), {
      promise: undefined,
      value: 1,
      error: undefined,
      settledAt: 1,
      subscribers: 0,
      gcTimer: undefined,
    });
    cache.set(cache.key(["user", 2]), {
      promise: undefined,
      value: 2,
      error: undefined,
      settledAt: 1,
      subscribers: 0,
      gcTimer: undefined,
    });
    cache.set(cache.key(["post", 1]), {
      promise: undefined,
      value: 3,
      error: undefined,
      settledAt: 1,
      subscribers: 0,
      gcTimer: undefined,
    });
    cache.invalidatePrefix(["user"]);
    expect(cache.get(cache.key(["user", 1]))).toBeUndefined();
    expect(cache.get(cache.key(["user", 2]))).toBeUndefined();
    expect(cache.get(cache.key(["post", 1]))?.value).toBe(3);
  });

  it("8: fn rejects with non-Error — envelope gets Error(String); onError not invoked", async () => {
    let onErrorCalls = 0;
    const s = store({ id: 1 })
      .onError(() => {
        onErrorCalls += 1;
      })
      .derived("user", async (ctx) =>
        query({
          key: ["user", ctx.get().id],
          fn: () => Promise.reject("boom"),
        }),
      )
      .build();

    await sleep(10);
    expect(s.user.error).toBeInstanceOf(Error);
    expect(s.user.error?.message).toBe("boom");
    expect(onErrorCalls).toBe(0);
    s.dispose();
  });

  it("9: ILHA_QUERY uses Symbol.for — matches across 'bundle copies'", () => {
    expect(Symbol.for("ilha.store.query") === ILHA_QUERY).toBe(true);
    const brand = Symbol.for("ilha.store.query");
    const fake = Object.assign(new Promise(() => {}), {
      [brand]: true,
      key: ["x"],
      fn: () => Promise.resolve(1),
      staleTime: 0,
      gcTime: 0,
      cache: defaultQueryCache,
    });
    expect(brand in fake).toBe(true);
  });

  it("10: build()-time eager run creates cache entry with subscribers: 1", async () => {
    const cache = new QueryCache();
    const s = store({ id: 1 })
      .derived("user", async (ctx) =>
        query({
          key: ["user", ctx.get().id],
          fn: () => sleep(20).then(() => ({ id: 1 })),
          cache,
        }),
      )
      .build();

    const entry = cache.get(cache.key(["user", 1]));
    expect(entry).toBeDefined();
    expect(entry!.subscribers).toBe(1);
    expect(entry!.promise).toBeDefined();
    await sleep(30);
    s.dispose();
  });

  it("12: custom cache isolates from defaultQueryCache", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const s = store({ id: 1 })
      .derived("user", async (ctx) =>
        query({
          key: ["user", ctx.get().id],
          fn: () => {
            calls += 1;
            return Promise.resolve({ id: 1 });
          },
          cache,
        }),
      )
      .build();

    await sleep(5);
    expect(calls).toBe(1);
    expect(cache.get(cache.key(["user", 1]))?.value).toEqual({ id: 1 });
    expect(defaultQueryCache.get(defaultQueryCache.key(["user", 1]))).toBeUndefined();
    s.dispose();
  });

  it("13: @ilha/store/query no longer exports persistQuery (no shim)", async () => {
    const mod = await import("./query");
    expect("persistQuery" in mod).toBe(false);
    expect(typeof mod.query).toBe("function");
    expect(mod.defaultQueryCache).toBeInstanceOf(QueryCache);
  });

  it("14: persist + persistQuery resolve from @ilha/store/persist", async () => {
    const mod = await import("./persist");
    expect(typeof mod.persist).toBe("function");
    expect(typeof mod.persistQuery).toBe("function");
  });

  it("sync derived returning query() upgrades to async envelope", async () => {
    const cache = new QueryCache();
    const s = store({ id: 1 })
      .derived("user", (ctx) =>
        query({
          key: ["user", ctx.get().id],
          fn: () => Promise.resolve({ id: ctx.get().id }),
          cache,
        }),
      )
      .build();

    expect(s.user.loading).toBe(true);
    await sleep(5);
    expect(s.user()).toEqual({ id: 1 });
    expect(s.user.loading).toBe(false);
    s.dispose();
  });

  it("N1: rapid key cycling aborts intermediate fetches and settles on latest", async () => {
    const cache = new QueryCache();
    const started: number[] = [];
    const s = store({ id: 1 })
      .derived("user", async (ctx) => {
        const id = ctx.get().id;
        return query({
          key: ["user", id],
          fn: () => {
            started.push(id);
            return sleep(30).then(() => ({ id }));
          },
          cache,
          staleTime: 0,
          gcTime: 20,
        });
      })
      .build();

    s.setState({ id: 2 });
    s.setState({ id: 1 });
    await sleep(80);
    expect(s.user()?.id).toBe(1);
    expect(s.user.loading).toBe(false);
    // First id=1 and id=2 were started; final id=1 may hit in-flight or refetch.
    expect(started.length).toBeGreaterThanOrEqual(2);
    s.dispose();
  });

  it("N2: staleTime 0 refetches on every dependency change", async () => {
    let calls = 0;
    const s = store({ id: 1, tick: 0 })
      .derived("user", async (ctx) => {
        const { id, tick } = ctx.get();
        void tick;
        return query({
          key: ["user", id],
          fn: () => {
            calls += 1;
            return Promise.resolve({ id, n: calls });
          },
          staleTime: 0,
        });
      })
      .build();

    await sleep(5);
    expect(calls).toBe(1);
    s.setState({ tick: 1 });
    await sleep(5);
    expect(calls).toBe(2);
    expect(s.user()?.n).toBe(2);
    s.dispose();
  });

  it("N3: error recovery after invalidate transitions error → loading → value", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const s = store({ id: 1, tick: 0 })
      .derived("user", async (ctx) => {
        const { id, tick } = ctx.get();
        void tick;
        return query({
          key: ["user", id],
          fn: () => {
            calls += 1;
            if (calls === 1) return Promise.reject(new Error("fail"));
            return Promise.resolve({ id, ok: true });
          },
          cache,
          staleTime: 60_000,
        });
      })
      .build();

    await sleep(10);
    expect(s.user.error?.message).toBe("fail");
    expect(s.user.loading).toBe(false);

    cache.invalidate(["user", 1]);
    s.setState({ tick: 1 });
    expect(s.user.loading).toBe(true);
    await sleep(10);
    expect(s.user.error).toBeUndefined();
    expect(s.user()).toEqual({ id: 1, ok: true });
    expect(s.user.loading).toBe(false);
    s.dispose();
  });

  it("N4: gcTime 0 evicts on next tick after last subscriber drops", async () => {
    const cache = new QueryCache();
    const s = store({ id: 1 })
      .derived("user", async (ctx) =>
        query({
          key: ["user", ctx.get().id],
          fn: () => Promise.resolve({ id: 1 }),
          cache,
          gcTime: 0,
        }),
      )
      .build();

    await sleep(5);
    const key = cache.key(["user", 1]);
    expect(cache.get(key)?.value).toEqual({ id: 1 });
    s.dispose();
    expect(cache.get(key)?.subscribers).toBe(0);
    await sleep(5);
    expect(cache.get(key)).toBeUndefined();
  });

  it("QueryCache.clear and size", () => {
    const cache = new QueryCache();
    cache.set(cache.key(["a"]), {
      promise: undefined,
      value: 1,
      error: undefined,
      settledAt: 1,
      subscribers: 0,
      gcTimer: undefined,
    });
    cache.set(cache.key(["b"]), {
      promise: undefined,
      value: 2,
      error: undefined,
      settledAt: 1,
      subscribers: 0,
      gcTimer: undefined,
    });
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get(cache.key(["a"]))).toBeUndefined();
  });

  it("invalidatePrefix string-stem matches exact and longer keys only", () => {
    const cache = new QueryCache();
    // Prefix ["user"] must not match a sibling key that merely shares a string prefix.
    for (const parts of [["user"], ["user", 1], ["user", 2], ["users"], ["use"]] as unknown[][]) {
      cache.set(cache.key(parts), {
        promise: undefined,
        value: parts,
        error: undefined,
        settledAt: 1,
        subscribers: 0,
        gcTimer: undefined,
      });
    }
    cache.invalidatePrefix(["user"]);
    expect(cache.get(cache.key(["user"]))).toBeUndefined();
    expect(cache.get(cache.key(["user", 1]))).toBeUndefined();
    expect(cache.get(cache.key(["user", 2]))).toBeUndefined();
    expect(cache.get(cache.key(["users"]))?.value).toEqual(["users"]);
    expect(cache.get(cache.key(["use"]))?.value).toEqual(["use"]);
  });
});

describe("query() inside island .derived()", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    clearDefaultCache();
  });

  it("resolves into the island envelope and writes the cache", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const Island = ilha
      .state("id", 1)
      .derived("user", async ({ state, signal }) =>
        query({
          key: ["island-user", state.id()],
          fn: () => {
            calls += 1;
            void signal;
            return Promise.resolve({ id: state.id(), n: calls });
          },
          cache,
        }),
      )
      .render(({ derived }) => {
        if (derived.user.loading) return "loading";
        if (derived.user.error) return `err:${derived.user.error.message}`;
        return `ok:${derived.user()?.n}`;
      });

    const el = document.createElement("div");
    document.body.append(el);
    const unmount = Island.mount(el);

    expect(el.textContent).toBe("loading");
    expect(cache.get(cache.key(["island-user", 1]))?.promise).toBeDefined();
    await sleep(10);
    expect(calls).toBe(1);
    expect(el.textContent).toBe("ok:1");
    expect(cache.get(cache.key(["island-user", 1]))?.value).toEqual({ id: 1, n: 1 });
    unmount();
  });

  it("two islands with the same key share one in-flight fetch", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const make = (name: string) =>
      ilha
        .state("id", 1)
        .derived("user", async ({ state }) =>
          query({
            key: ["shared", state.id()],
            fn: () => {
              calls += 1;
              return sleep(20).then(() => ({ id: state.id(), from: name }));
            },
            cache,
          }),
        )
        .render(({ derived }) => (derived.user.loading ? "…" : `${derived.user()?.id}:${calls}`));

    const A = make("a");
    const B = make("b");
    const elA = document.createElement("div");
    const elB = document.createElement("div");
    document.body.append(elA, elB);
    const stopA = A.mount(elA);
    const stopB = B.mount(elB);

    expect(elA.textContent).toBe("…");
    expect(elB.textContent).toBe("…");
    await sleep(40);
    expect(calls).toBe(1);
    expect(elA.textContent).toBe("1:1");
    expect(elB.textContent).toBe("1:1");
    stopA();
    stopB();
  });

  it("staleTime hit keeps loading false and skips fn on dependency re-run", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const Island = ilha
      .state("id", 1)
      .state("tick", 0)
      .derived("user", async ({ state, signal }) => {
        const id = state.id();
        void state.tick();
        return query({
          key: ["stale", id],
          fn: () => {
            calls += 1;
            void signal;
            return Promise.resolve({ id, n: calls });
          },
          cache,
          staleTime: 60_000,
        });
      })
      .action("bump", (_, { state }) => {
        state.tick(state.tick() + 1);
      })
      .render(
        ({ derived, action }) =>
          html`<button type="button" onclick=${action.bump}>
            ${derived.user.loading ? "L" : `V${derived.user()?.n}`}
          </button>`,
      );

    const el = document.createElement("div");
    document.body.append(el);
    const unmount = Island.mount(el);
    await sleep(10);
    expect(calls).toBe(1);
    // html`` keeps indentation whitespace inside the button — compare trimmed text.
    expect(el.textContent?.trim()).toBe("V1");

    el.querySelector("button")!.click();
    await sleep(10);
    expect(calls).toBe(1);
    expect(el.textContent?.trim()).toBe("V1");
    unmount();
  });

  it("after staleTime, re-run refetches and keeps previous value while loading", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const Island = ilha
      .state("id", 1)
      .state("tick", 0)
      .derived("user", async ({ state }) => {
        const id = state.id();
        void state.tick();
        return query({
          key: ["swr", id],
          fn: () => {
            calls += 1;
            return sleep(25).then(() => ({ name: `v${calls}` }));
          },
          cache,
          staleTime: 10,
        });
      })
      .action("bump", (_, { state }) => {
        state.tick(state.tick() + 1);
      })
      .render(
        ({ derived, action }) =>
          html`<button type="button" onclick=${action.bump}>
            ${
              derived.user.loading
                ? `L:${derived.user()?.name ?? "-"}`
                : `R:${derived.user()?.name}`
            }
          </button>`,
      );

    const el = document.createElement("div");
    document.body.append(el);
    const unmount = Island.mount(el);
    await sleep(40);
    // html`` keeps indentation whitespace inside the button — compare trimmed text.
    expect(el.textContent?.trim()).toBe("R:v1");

    await sleep(15);
    el.querySelector("button")!.click();
    // SWR: previous value still visible under loading.
    expect(el.textContent?.trim()).toBe("L:v1");
    await sleep(40);
    expect(calls).toBe(2);
    expect(el.textContent?.trim()).toBe("R:v2");
    unmount();
  });

  it("key change starts a new fetch and GC-arms the old entry", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const Island = ilha
      .state("id", 1)
      .derived("user", async ({ state, signal }) =>
        query({
          key: ["key", state.id()],
          fn: () => {
            calls += 1;
            const id = state.id();
            void signal;
            return Promise.resolve({ id });
          },
          cache,
          gcTime: 40,
        }),
      )
      .action("next", (_, { state }) => {
        state.id(state.id() + 1);
      })
      .render(
        ({ derived, action }) =>
          html`<button type="button" onclick=${action.next}>${derived.user()?.id ?? "…"}</button>`,
      );

    const el = document.createElement("div");
    document.body.append(el);
    const unmount = Island.mount(el);
    await sleep(10);
    expect(calls).toBe(1);
    const key1 = cache.key(["key", 1]);
    expect(cache.get(key1)?.subscribers).toBe(1);

    el.querySelector("button")!.click();
    await sleep(10);
    expect(calls).toBe(2);
    expect(el.textContent).toBe("2");
    expect(cache.get(key1)?.subscribers).toBe(0);
    expect(cache.get(key1)?.gcTimer).toBeDefined();
    expect(cache.get(cache.key(["key", 2]))?.value).toEqual({ id: 2 });

    await sleep(50);
    expect(cache.get(key1)).toBeUndefined();
    unmount();
  });

  it("rejection lands on derived.error and never throws into the island", async () => {
    const Island = ilha
      .state("id", 1)
      .derived("user", async ({ state, signal }) =>
        query({
          key: ["err", state.id()],
          fn: () => {
            void signal;
            return Promise.reject("boom");
          },
        }),
      )
      .render(({ derived }) => {
        if (derived.user.loading) return "loading";
        if (derived.user.error) return `err:${derived.user.error.message}`;
        return "ok";
      });

    const el = document.createElement("div");
    document.body.append(el);
    const unmount = Island.mount(el);
    await sleep(10);
    expect(el.textContent).toBe("err:boom");
    unmount();
  });

  it("invalidate + state write refetches even inside staleTime", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const Island = ilha
      .state("id", 1)
      .state("tick", 0)
      .derived("user", async ({ state, signal }) => {
        const id = state.id();
        void state.tick();
        return query({
          key: ["inv", id],
          fn: () => {
            calls += 1;
            void signal;
            return Promise.resolve({ n: calls });
          },
          cache,
          staleTime: 60_000,
        });
      })
      .action("bump", (_, { state }) => {
        state.tick(state.tick() + 1);
      })
      .render(
        ({ derived, action }) =>
          html`<button type="button" onclick=${action.bump}>${derived.user()?.n ?? "…"}</button>`,
      );

    const el = document.createElement("div");
    document.body.append(el);
    const unmount = Island.mount(el);
    await sleep(10);
    expect(calls).toBe(1);

    cache.invalidate(["inv", 1]);
    el.querySelector("button")!.click();
    await sleep(10);
    expect(calls).toBe(2);
    expect(el.textContent).toBe("2");
    unmount();
  });

  it("unmount mid-fetch drops onResult and decrements subscribers", async () => {
    const cache = new QueryCache();
    let settled = false;
    const Island = ilha
      .state("id", 1)
      .derived("user", async ({ state, signal }) =>
        query({
          key: ["abort", state.id()],
          fn: () =>
            sleep(40).then(() => {
              settled = true;
              void signal;
              return { id: 1 };
            }),
          cache,
          gcTime: 5_000,
        }),
      )
      .render(({ derived }) => (derived.user.loading ? "loading" : "done"));

    const el = document.createElement("div");
    document.body.append(el);
    const unmount = Island.mount(el);
    expect(el.textContent).toBe("loading");
    const key = cache.key(["abort", 1]);
    expect(cache.get(key)?.subscribers).toBe(1);

    unmount();
    expect(cache.get(key)?.subscribers).toBe(0);
    await sleep(60);
    expect(settled).toBe(true);
    // Host is gone — text stays at last paint (loading), envelope not updated to done.
    expect(el.textContent).toBe("loading");
  });

  it("island and store with the same key share the cache", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const fetchOnce = () => {
      calls += 1;
      return sleep(15).then(() => ({ id: 1, n: calls }));
    };

    const s = store({ id: 1 })
      .derived("user", async (ctx) =>
        query({
          key: ["cross", ctx.get().id],
          fn: fetchOnce,
          cache,
          staleTime: 60_000,
        }),
      )
      .build();

    const Island = ilha
      .state("id", 1)
      .derived("user", async ({ state }) =>
        query({
          key: ["cross", state.id()],
          fn: fetchOnce,
          cache,
          staleTime: 60_000,
        }),
      )
      .render(({ derived }) => (derived.user.loading ? "…" : `i:${derived.user()?.n}`));

    const el = document.createElement("div");
    document.body.append(el);
    const unmount = Island.mount(el);

    expect(s.user.loading).toBe(true);
    expect(el.textContent).toBe("…");
    await sleep(30);
    expect(calls).toBe(1);
    expect(s.user()?.n).toBe(1);
    expect(el.textContent).toBe("i:1");
    unmount();
    s.dispose();
  });

  it("sync island derived returning query() upgrades to async envelope", async () => {
    const cache = new QueryCache();
    const Island = ilha
      .state("id", 1)
      .derived("user", ({ state, signal }) =>
        query({
          key: ["sync-island", state.id()],
          fn: () => {
            void signal;
            return Promise.resolve({ id: state.id() });
          },
          cache,
        }),
      )
      .render(({ derived }) => (derived.user.loading ? "loading" : `id:${derived.user()?.id}`));

    const el = document.createElement("div");
    document.body.append(el);
    const unmount = Island.mount(el);
    expect(el.textContent).toBe("loading");
    await sleep(10);
    expect(el.textContent).toBe("id:1");
    unmount();
  });

  it("works with mount() registry discovery", async () => {
    const cache = new QueryCache();
    const UserBadge = ilha
      .state("id", 7)
      .derived("user", async ({ state, signal }) =>
        query({
          key: ["mount", state.id()],
          fn: () => {
            void signal;
            return Promise.resolve({ id: state.id(), label: "Ada" });
          },
          cache,
        }),
      )
      .render(({ derived }) => (derived.user.loading ? "…" : (derived.user()?.label ?? "")));

    document.body.innerHTML = `<div data-ilha="UserBadge"></div>`;
    const { unmount } = mount({ UserBadge });
    expect(document.body.textContent).toBe("…");
    await sleep(10);
    expect(document.body.textContent).toBe("Ada");
    unmount();
  });
});
