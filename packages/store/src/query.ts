// =============================================================================
// @ilha/store/query — persistQuery(): URL query-string persistence
//
// Keeps store keys in sync with individual search params (?q=abc&page=2),
// nuqs-style. URL writes go through @ilha/router's navigate() (auto-detected,
// or injected via options) so loaders re-run and route signals stay correct.
// =============================================================================

import type { StoreBuiltins, Unsub } from "./index";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The slice of a built store persistQuery needs. */
export type PersistQueryStore<TState extends object> = Pick<
  StoreBuiltins<TState>,
  "getState" | "getInitialState" | "setState" | "subscribe"
>;

/** Signature-compatible with `@ilha/router`'s `navigate`. */
export type NavigateFn = (to: string, opts?: { replace?: boolean; scroll?: boolean }) => void;

/** Per-key mapping: a param name, or a codec with optional custom (de)serialization. */
export type QueryParamCodec<T> = {
  /** Search param name. Default: the state key itself. */
  param?: string;
  /** Value → param string. Default: `String(value)`. */
  serialize?: (value: T) => string;
  /**
   * Param string → value. Default: identity (the raw string) — schema stores
   * coerce/validate it on write (e.g. `z.coerce.number()`). Throwing falls
   * back to the key's default.
   */
  deserialize?: (raw: string) => T;
};

export type PersistQueryParams<TState extends object> = {
  [K in keyof TState & string]?: string | QueryParamCodec<TState[K]>;
};

export type HistoryMode = "push" | "replace";

export interface PersistQueryOptions<TState extends object> {
  /**
   * Which keys to persist and how they map to search params. Omitted → every
   * state key, each under its own name.
   */
  params?: PersistQueryParams<TState>;
  /**
   * History strategy per write: `"replace"` (default) or `"push"`, or a
   * function of the changed keys.
   */
  history?: HistoryMode | ((changedKeys: string[]) => HistoryMode);
  /** Debounce URL writes (ms) — for per-keystroke bound inputs. Default: `0`. */
  debounce?: number;
  /**
   * Drop a param from the URL when its value equals the store's initial
   * default (clean URLs). Default: `true`.
   */
  omitDefaults?: boolean;
  /**
   * URL writer. Default: auto-detect `@ilha/router`'s `navigate` (dynamic
   * import); when the router isn't installed, falls back to the raw History
   * API with a dev warning (loaders won't re-run on writes).
   */
  navigate?: NavigateFn;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The subset of `@ilha/router`'s module surface persistQuery uses. */
interface RouterModule {
  navigate: NavigateFn;
  afterNavigate(fn: (nav: { from: string; to: string; type: string }) => void): () => void;
  routePath(): string;
  routeSearch(): string;
  routeHash(): string;
}

interface Entry {
  key: string;
  param: string;
  serialize: (value: unknown) => string;
  deserialize?: (raw: string) => unknown;
  /** Serialized form of the key's initial default — the omit sentinel. */
  defaultStr: string;
}

function buildEntries<TState extends object>(
  initial: TState,
  params: PersistQueryParams<TState> | undefined,
): Entry[] {
  const rec = initial as Record<string, unknown>;
  const keys = params ? Object.keys(params) : Object.keys(rec);
  return keys.map((key) => {
    const spec = params?.[key as keyof TState & string];
    const codec = typeof spec === "object" && spec !== null ? spec : {};
    const param = typeof spec === "string" ? spec : (codec.param ?? key);
    const serialize = (codec.serialize ?? String) as (value: unknown) => string;
    return {
      key,
      param,
      serialize,
      deserialize: codec.deserialize as Entry["deserialize"],
      defaultStr: serialize(rec[key]),
    };
  });
}

/**
 * Keep a store in sync with the URL query string, one search param per key:
 *
 * 1. On call (client), seeds the store from `location.search` — owned params
 *    are parsed and written through `setState`, so schema stores coerce and
 *    validate them; invalid values degrade to the key's default, never throw.
 * 2. Subscribes to the store and mirrors owned keys into the URL via the
 *    router's `navigate()` (replace by default), preserving unrelated params.
 * 3. Subscribes to committed navigations (back/forward, links) and writes
 *    owned-param changes back into the store — without re-triggering a
 *    navigation.
 *
 * No-op on the server (returns an inert unsubscribe) — loaders reading
 * `ctx.url.searchParams` remain the way to consume query state server-side.
 * Call the returned function to stop syncing (flushes any pending debounced
 * write).
 *
 * ```ts
 * const filters = store(schema).build();
 * persistQuery(filters, { debounce: 250 });
 * ```
 */
export function persistQuery<TState extends object>(
  store: PersistQueryStore<TState>,
  options: PersistQueryOptions<TState> = {},
): Unsub {
  if (typeof window === "undefined") return () => {};

  const omitDefaults = options.omitDefaults !== false;
  const debounceMs = options.debounce ?? 0;
  const initial = store.getInitialState() as Record<string, unknown>;
  const entries = buildEntries(store.getInitialState(), options.params);

  let stopped = false;
  // True while a URL → store write is committing, so the store subscriber
  // doesn't echo it back into a navigation.
  let applying = false;

  // --- navigate resolution --------------------------------------------------
  let router: RouterModule | null = null;
  let nav: NavigateFn | null = options.navigate ?? null;
  let unsubIncoming: Unsub = () => {};
  // Writes that arrive before auto-detection resolves, replayed in order.
  let deferred: Array<() => void> | null = null;

  const onPopstate = () => {
    applyFromUrl(new URL(location.href));
  };

  const listenPopstate = () => {
    window.addEventListener("popstate", onPopstate);
    unsubIncoming = () => window.removeEventListener("popstate", onPopstate);
  };

  if (nav) {
    listenPopstate();
  } else {
    deferred = [];
    import("@ilha/router").then(
      (mod: RouterModule) => {
        if (stopped) return;
        router = mod;
        nav = mod.navigate;
        unsubIncoming = mod.afterNavigate((n) => {
          applyFromUrl(new URL(n.to, location.origin));
        });
        drainDeferred();
      },
      () => {
        if (stopped) return;
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            "[@ilha/store] persistQuery: @ilha/router not found — falling back to the " +
              "History API. Route loaders will NOT re-run on query writes; pass " +
              "options.navigate to integrate with your router.",
          );
        }
        nav = (to, opts) => {
          history[opts?.replace ? "replaceState" : "pushState"](history.state, "", to);
        };
        listenPopstate();
        drainDeferred();
      },
    );
  }

  const drainDeferred = () => {
    const queue = deferred!;
    deferred = null;
    for (const run of queue) run();
  };

  // --- URL helpers ----------------------------------------------------------

  /** Current logical URL — router signals when mounted, `location` otherwise. */
  const currentUrl = (): URL => {
    if (router && router.routePath()) {
      return new URL(
        router.routePath() + router.routeSearch() + router.routeHash(),
        location.origin,
      );
    }
    return new URL(location.href);
  };

  /** Param string a key should occupy in the URL, or `null` for "absent". */
  const ownedValue = (state: Record<string, unknown>, e: Entry): string | null => {
    const str = e.serialize(state[e.key]);
    return omitDefaults && str === e.defaultStr ? null : str;
  };

  // --- URL → store ----------------------------------------------------------

  function applyFromUrl(url: URL): void {
    if (stopped) return;
    const sp = url.searchParams;
    const state = store.getState() as Record<string, unknown>;

    // Echo guard: if every owned param already reflects the store, no-op.
    // (Our own navigations always match here, by construction.)
    const differs = entries.some((e) => {
      const raw = sp.get(e.param);
      if (raw == null) return e.serialize(state[e.key]) !== e.defaultStr;
      return raw !== e.serialize(state[e.key]);
    });
    if (!differs) return;

    applying = true;
    try {
      for (const e of entries) {
        const raw = sp.get(e.param);
        let next = initial[e.key];
        if (raw != null) {
          try {
            next = e.deserialize ? e.deserialize(raw) : raw;
          } catch {
            // Bad param → key's default.
          }
        }
        // Per-key commits so one invalid param can't reject the others.
        // Schema stores validate/coerce; a rejected patch leaves state as-is.
        store.setState({ [e.key]: next } as Partial<TState>);
        if (raw != null) {
          const cur = (store.getState() as Record<string, unknown>)[e.key];
          const accepted =
            !Object.is(cur, state[e.key]) || Object.is(cur, next) || e.serialize(cur) === raw;
          // Schema rejected the raw value and the previous value doesn't
          // match the URL either — degrade to the default.
          if (!accepted) store.setState({ [e.key]: initial[e.key] } as Partial<TState>);
        }
      }
    } finally {
      applying = false;
    }
  }

  // --- store → URL ----------------------------------------------------------

  const performWrite = (state: Record<string, unknown>, mode: HistoryMode) => {
    const run = () => {
      if (stopped && !nav) return;
      const url = currentUrl();
      const from = url.pathname + url.search + url.hash;
      const sp = url.searchParams;
      for (const e of entries) {
        const v = ownedValue(state, e);
        if (v == null) sp.delete(e.param);
        else sp.set(e.param, v);
      }
      const search = sp.toString();
      const to = url.pathname + (search ? `?${search}` : "") + url.hash;
      if (to === from) return;
      nav!(to, mode === "replace" ? { replace: true, scroll: false } : { replace: false });
    };
    if (deferred) deferred.push(run);
    else run();
  };

  // --- debounce -------------------------------------------------------------
  let pendingState: Record<string, unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pendingState == null) return;
    const state = pendingState;
    pendingState = null;
    performWrite(state, "replace");
  };

  const resolveMode = (changedKeys: string[]): HistoryMode => {
    const h = options.history;
    if (typeof h === "function") return h(changedKeys);
    return h ?? "replace";
  };

  const unsubStore = store.subscribe((state, prevState) => {
    if (applying) return;
    const s = state as Record<string, unknown>;
    const p = prevState as Record<string, unknown>;
    const changed = entries.filter((e) => !Object.is(s[e.key], p[e.key])).map((e) => e.key);
    if (changed.length === 0) return;

    if (resolveMode(changed) === "push") {
      // Flush any pending debounced replace first (it holds the pre-push
      // state) so the pushed history entry's predecessor is coherent.
      flush();
      performWrite(s, "push");
      return;
    }

    pendingState = s;
    if (debounceMs > 0) {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    } else {
      flush();
    }
  });

  // --- init: URL is the source of truth -------------------------------------
  applyFromUrl(new URL(location.href));

  return () => {
    if (stopped) return;
    stopped = true;
    flush();
    unsubStore();
    unsubIncoming();
  };
}
