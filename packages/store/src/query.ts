// =============================================================================
// @ilha/store/query — persistQuery(): URL query-string persistence
//
// Keeps store keys in sync with individual search params (?q=abc&page=2),
// nuqs-style. URL writes go through @ilha/router's navigate() (auto-detected,
// or injected via options) so loaders re-run and route signals stay correct.
//
// Also: stock codecs, isomorphic readQuery/querySpec.parse for loaders, and
// withQuery merge helpers so apps don't strip foreign params.
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
  /** Value → param string. Default: `String(value)` (dev-warns on object/array). */
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

/** Global ms, or a per-key map (missing keys → 0). */
export type DebounceOption<TState extends object> =
  | number
  | Partial<Record<keyof TState & string, number>>;

/**
 * Global mode, per-key map (missing keys → `"replace"`), or a function of the
 * changed keys (legacy).
 */
export type HistoryOption<TState extends object> =
  | HistoryMode
  | Partial<Record<keyof TState & string, HistoryMode>>
  | ((changedKeys: Array<keyof TState & string>) => HistoryMode);

export interface PersistQueryOptions<TState extends object> {
  /**
   * Which keys to persist and how they map to search params. Omitted → every
   * state key, each under its own name.
   */
  params?: PersistQueryParams<TState>;
  /**
   * History strategy per write: `"replace"` (default), `"push"`, a per-key map
   * (`{ q: "replace", f: "push" }`), or a function of the changed keys.
   * If any changed key resolves to `"push"`, the write is a push (and any
   * pending debounced replace is flushed first).
   */
  history?: HistoryOption<TState>;
  /**
   * Debounce URL writes (ms). A single number applies to every key; a map
   * sets per-key delays (`{ q: 250, f: 0 }`). Default: `0`.
   * A push key always flushes pending debounced replaces first.
   */
  debounce?: DebounceOption<TState>;
  /**
   * Drop a param from the URL when its value equals the store's initial
   * default (clean URLs). Default: `true`.
   */
  omitDefaults?: boolean;
  /**
   * URL writer. Default: auto-detect `@ilha/router`'s `navigate` (dynamic
   * import); when the router isn't installed, falls back to the raw History
   * API with a dev warning (loaders won't re-run on writes).
   *
   * Early writes before auto-detect resolves are **deferred** (queued), not
   * dropped — they replay in order once `navigate` is ready.
   */
  navigate?: NavigateFn;
}

// ---------------------------------------------------------------------------
// Built-in codecs
// ---------------------------------------------------------------------------

const isDev = () => typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

/** URL-safe JSON (UTF-8 → percent-encoding only where needed by URLSearchParams). */
function jsonSerialize(value: unknown): string {
  return JSON.stringify(value);
}

function jsonDeserialize<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export type StringArrayCodecOptions = {
  /**
   * `"comma"` (default): single param `?tags=a,b` with comma escaping.
   * `"repeat"`: `?tags=a&tags=b` — use with `readQuery` / multi-get; persistQuery
   * still writes a single set via join when serializing to one param string.
   * For full repeat-param round-trips prefer loader-side `parse` + custom write.
   */
  style?: "comma" | "repeat";
  /** Separator when `style: "comma"`. Default: `","`. */
  separator?: string;
};

export type IntCodecOptions = {
  min?: number;
  max?: number;
  default?: number;
};

export type BoolCodecOptions = {
  /** Strings treated as true. Default: `["1","true","yes","on"]`. */
  truthy?: string[];
  /** Strings treated as false. Default: `["0","false","no","off",""]`. */
  falsy?: string[];
};

/**
 * Stock query codecs. Prefer these over ad-hoc `String(array)` —
 * `String([]) === ""` and `String([{…}]) === "[object Object]"`.
 *
 * ```ts
 * params: {
 *   page: codec.int({ min: 1 }),
 *   tags: codec.stringArray(),
 *   f: codec.json<Filter[]>(),
 * }
 * ```
 */
export const codec = {
  /** Identity string codec (explicit). */
  string(): QueryParamCodec<string> {
    return {
      serialize: (v) => (v == null ? "" : String(v)),
      deserialize: (raw) => raw,
    };
  },

  /** Integer with optional bounds; invalid → `default` or throw for store degrade. */
  int(opts: IntCodecOptions = {}): QueryParamCodec<number> {
    const { min, max, default: def } = opts;
    return {
      serialize: (v) => String(v),
      deserialize: (raw) => {
        const n = Number(raw);
        if (!Number.isFinite(n) || !Number.isInteger(n)) {
          if (def !== undefined) return def;
          throw new Error(`invalid int: ${raw}`);
        }
        if (min !== undefined && n < min) {
          if (def !== undefined) return def;
          throw new Error(`int below min: ${n}`);
        }
        if (max !== undefined && n > max) {
          if (def !== undefined) return def;
          throw new Error(`int above max: ${n}`);
        }
        return n;
      },
    };
  },

  /** Number (float) with optional bounds. */
  number(opts: { min?: number; max?: number; default?: number } = {}): QueryParamCodec<number> {
    const { min, max, default: def } = opts;
    return {
      serialize: (v) => String(v),
      deserialize: (raw) => {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          if (def !== undefined) return def;
          throw new Error(`invalid number: ${raw}`);
        }
        if (min !== undefined && n < min) {
          if (def !== undefined) return def;
          throw new Error(`number below min: ${n}`);
        }
        if (max !== undefined && n > max) {
          if (def !== undefined) return def;
          throw new Error(`number above max: ${n}`);
        }
        return n;
      },
    };
  },

  bool(opts: BoolCodecOptions = {}): QueryParamCodec<boolean> {
    const truthy = new Set((opts.truthy ?? ["1", "true", "yes", "on"]).map((s) => s.toLowerCase()));
    const falsy = new Set(
      (opts.falsy ?? ["0", "false", "no", "off", ""]).map((s) => s.toLowerCase()),
    );
    return {
      serialize: (v) => (v ? "1" : "0"),
      deserialize: (raw) => {
        const k = raw.toLowerCase();
        if (truthy.has(k)) return true;
        if (falsy.has(k)) return false;
        throw new Error(`invalid bool: ${raw}`);
      },
    };
  },

  /**
   * Comma-separated strings. Commas inside values are percent-encoded so
   * `URLSearchParams` does not double-encode the whole blob incorrectly.
   */
  stringArray(opts: StringArrayCodecOptions = {}): QueryParamCodec<string[]> {
    const sep = opts.separator ?? ",";
    const style = opts.style ?? "comma";
    return {
      serialize: (arr) => {
        if (!Array.isArray(arr) || arr.length === 0) return "";
        if (style === "repeat") {
          // Single-param fallback for persistQuery's set(); loaders may use getAll.
          return arr.map(String).join(sep);
        }
        return arr.map((s) => encodeURIComponent(String(s))).join(sep);
      },
      deserialize: (raw) => {
        if (raw === "") return [];
        if (style === "repeat") {
          return raw.split(sep).map(String);
        }
        return raw.split(sep).map((part) => {
          try {
            return decodeURIComponent(part);
          } catch {
            return part;
          }
        });
      },
    };
  },

  /** JSON object/array in one param. */
  json<T = unknown>(): QueryParamCodec<T> {
    return {
      serialize: (v) => jsonSerialize(v),
      deserialize: (raw) => jsonDeserialize<T>(raw),
    };
  },

  /**
   * Compact URL-safe JSON via base64url (no `+`/`/`/`=` in the param).
   * Prefer plain `json()` when values are small and human-readable URLs matter.
   */
  jsonb<T = unknown>(): QueryParamCodec<T> {
    return {
      serialize: (v) => {
        const json = JSON.stringify(v);
        if (typeof btoa === "function") {
          const b64 = btoa(unescape(encodeURIComponent(json)));
          return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        }
        // Node / SSR
        return Buffer.from(json, "utf8").toString("base64url");
      },
      deserialize: (raw) => {
        let json: string;
        if (typeof atob === "function") {
          const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
          const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
          json = decodeURIComponent(escape(atob(b64 + pad)));
        } else {
          json = Buffer.from(raw, "base64url").toString("utf8");
        }
        return JSON.parse(json) as T;
      },
    };
  },

  /** ISO-8601 date (`Date` ↔ string). Invalid → throw (degrades to default). */
  isoDate(): QueryParamCodec<Date> {
    return {
      serialize: (d) => (d instanceof Date ? d.toISOString() : String(d)),
      deserialize: (raw) => {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${raw}`);
        return d;
      },
    };
  },

  /** Constrained string set. */
  enum<const T extends string>(values: readonly T[], opts?: { default?: T }): QueryParamCodec<T> {
    const set = new Set<string>(values);
    return {
      serialize: (v) => String(v),
      deserialize: (raw) => {
        if (set.has(raw)) return raw as T;
        if (opts?.default !== undefined) return opts.default;
        throw new Error(`invalid enum: ${raw}`);
      },
    };
  },
} as const;

// ---------------------------------------------------------------------------
// Internals — entries / codecs
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
  hasCustomSerialize: boolean;
}

function defaultSerialize(key: string, value: unknown): string {
  if (value !== null && typeof value === "object") {
    if (isDev()) {
      console.warn(
        `[@ilha/store] persistQuery: key "${key}" is an object/array without a codec — ` +
          `String() would produce an unusable value. Register params.${key} with codec.json(), ` +
          `codec.stringArray(), or a custom serialize/deserialize. Writing via JSON.stringify for now.`,
      );
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  if (value === undefined || value === null) return "";
  return String(value);
}

/** Every default key is owned; `params` only supplies codecs / renames. */
function expandParamsForDefaults<TState extends object>(
  defaults: TState,
  params: QuerySpecCodecMap<TState> | undefined,
): PersistQueryParams<TState> {
  const out: Record<string, string | QueryParamCodec<unknown>> = {};
  for (const key of Object.keys(defaults as object)) {
    const spec = params?.[key as keyof TState & string];
    out[key] = (spec === undefined ? {} : spec) as string | QueryParamCodec<unknown>;
  }
  return out as PersistQueryParams<TState>;
}

function buildEntries<TState extends object>(
  initial: TState,
  params: PersistQueryParams<TState> | undefined,
): Entry[] {
  const rec = initial as Record<string, unknown>;
  const keys = params ? Object.keys(params) : Object.keys(rec);
  return keys.map((key) => {
    const spec = params?.[key as keyof TState & string];
    const codecSpec = typeof spec === "object" && spec !== null ? spec : {};
    const param = typeof spec === "string" ? spec : (codecSpec.param ?? key);
    const hasCustomSerialize = typeof codecSpec.serialize === "function";
    const serialize = hasCustomSerialize
      ? (codecSpec.serialize as (value: unknown) => string)
      : (value: unknown) => defaultSerialize(key, value);
    return {
      key,
      param,
      serialize,
      deserialize: codecSpec.deserialize as Entry["deserialize"],
      defaultStr: serialize(rec[key]),
      hasCustomSerialize,
    };
  });
}

// ---------------------------------------------------------------------------
// Isomorphic parse — shared with persistQuery hydrate
// ---------------------------------------------------------------------------

export type QuerySource = URL | URLSearchParams | string;

function toSearchParams(source: QuerySource): URLSearchParams {
  if (typeof source === "string") {
    const s = source.startsWith("?") ? source.slice(1) : source;
    // Full URL string
    if (/^https?:\/\//i.test(source) || source.startsWith("/")) {
      try {
        return new URL(source, "http://local.invalid").searchParams;
      } catch {
        return new URLSearchParams(s);
      }
    }
    return new URLSearchParams(s);
  }
  if (source instanceof URL) return source.searchParams;
  return source;
}

/**
 * Parse owned query params with the same codecs/defaults as `persistQuery`.
 * Pure and isomorphic (no `window`) — use in loaders for first-paint chrome
 * and data queries.
 *
 * ```ts
 * export const load = loader(({ url }) => {
 *   const filters = readQuery(filtersStore, url, { params: { f: codec.json() } });
 *   return { filters, rows: api.list(filters) };
 * });
 * ```
 */
export function readQuery<TState extends object>(
  storeOrInitial: PersistQueryStore<TState> | TState,
  source: QuerySource,
  options: Pick<PersistQueryOptions<TState>, "params" | "omitDefaults"> = {},
): TState {
  const initial =
    typeof (storeOrInitial as PersistQueryStore<TState>).getInitialState === "function"
      ? (storeOrInitial as PersistQueryStore<TState>).getInitialState()
      : (storeOrInitial as TState);
  // All initial keys are owned; `options.params` only supplies codecs/renames.
  const params = expandParamsForDefaults(initial, options.params);
  return parseWithEntries(initial, buildEntries(initial, params), toSearchParams(source));
}

function parseWithEntries<TState extends object>(
  initial: TState,
  entries: Entry[],
  sp: URLSearchParams,
): TState {
  const out = { ...(initial as object) } as Record<string, unknown>;
  for (const e of entries) {
    const raw = sp.get(e.param);
    if (raw == null) {
      out[e.key] = (initial as Record<string, unknown>)[e.key];
      continue;
    }
    try {
      out[e.key] = e.deserialize ? e.deserialize(raw) : raw;
    } catch {
      out[e.key] = (initial as Record<string, unknown>)[e.key];
    }
  }
  return out as TState;
}

// ---------------------------------------------------------------------------
// querySpec — one definition, store + parse + persist
// ---------------------------------------------------------------------------

export type QuerySpecCodecMap<TState extends object> = {
  [K in keyof TState & string]?: QueryParamCodec<TState[K]> | string;
};

export interface QuerySpecOptions<TState extends object> {
  /** Per-key codecs / param renames (merged into persist options). */
  params?: QuerySpecCodecMap<TState>;
  debounce?: DebounceOption<TState>;
  history?: HistoryOption<TState>;
  omitDefaults?: boolean;
  navigate?: NavigateFn;
}

/**
 * Shared query definition for loaders and client controls.
 *
 * ```ts
 * const spec = querySpec(
 *   { q: "", page: 1, f: [] as Filter[] },
 *   { params: { f: codec.json() }, debounce: { q: 250 }, history: { f: "push" } },
 * );
 * export const filters = store(z.object({…})).build(); // or store(spec.defaults)
 * // loader: const { q, f } = spec.parse(url);
 * // client: onMount(() => spec.persist(filters));
 * ```
 */
export function querySpec<TState extends object>(
  defaults: TState,
  options: QuerySpecOptions<TState> = {},
) {
  // Codecs are optional per key; every default key is owned (unlike persistQuery
  // `params`, which also selects the key set when provided).
  const params = expandParamsForDefaults(defaults, options.params);
  const entries = buildEntries(defaults, params);

  const persistOptions: PersistQueryOptions<TState> = {
    params,
    debounce: options.debounce,
    history: options.history,
    omitDefaults: options.omitDefaults,
    navigate: options.navigate,
  };

  return {
    /** Default state snapshot (same object reference as passed in). */
    defaults,
    /** Options suitable for spreading into `persistQuery`. */
    persistOptions,
    /** Isomorphic parse of URL / searchParams → full state (defaults filled). */
    parse(source: QuerySource): TState {
      return parseWithEntries(defaults, entries, toSearchParams(source));
    },
    /** Alias of `parse` for symmetry with `readQuery`. */
    read(source: QuerySource): TState {
      return parseWithEntries(defaults, entries, toSearchParams(source));
    },
    /** Bind a store to the URL with this spec's codecs / debounce / history. */
    persist(
      store: PersistQueryStore<TState>,
      override?: Partial<PersistQueryOptions<TState>>,
    ): Unsub {
      return persistQuery(store, { ...persistOptions, ...override });
    },
    /**
     * Build a path that merges a patch of owned keys onto `base` (default:
     * current location when available). Uses the same serializers as persist.
     */
    href(patch: Partial<TState>, base?: string | URL): string {
      const state = { ...defaults, ...patch } as TState;
      return hrefFromEntries(
        entries,
        state as Record<string, unknown>,
        options.omitDefaults !== false,
        base,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// withQuery / href helpers — never rebuild the query string from scratch
// ---------------------------------------------------------------------------

/**
 * Merge query params onto a path (or current URL). `null`/`undefined` values
 * delete the key. Does not know about store defaults — use `querySpec.href` or
 * pass only the keys you want to set.
 *
 * ```ts
 * <a href=${withQuery("/list", { page: 2 })}>Next</a>
 * ```
 */
export function withQuery(
  path: string,
  patch: Record<string, string | number | boolean | null | undefined>,
): string {
  const url = new URL(path, "http://local.invalid");
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) url.searchParams.delete(k);
    else url.searchParams.set(k, String(v));
  }
  const search = url.searchParams.toString();
  return url.pathname + (search ? `?${search}` : "") + url.hash;
}

/**
 * Merge a patch of store-owned keys (serialized with the same codecs as
 * `persistQuery`) onto the current or given URL, preserving foreign params.
 */
export function storeHref<TState extends object>(
  store: PersistQueryStore<TState>,
  patch: Partial<TState>,
  options: Pick<PersistQueryOptions<TState>, "params" | "omitDefaults"> = {},
  base?: string | URL,
): string {
  const initial = store.getInitialState();
  const entries = buildEntries(initial, options.params);
  const state = { ...store.getState(), ...patch } as Record<string, unknown>;
  return hrefFromEntries(entries, state, options.omitDefaults !== false, base);
}

function hrefFromEntries(
  entries: Entry[],
  state: Record<string, unknown>,
  omitDefaults: boolean,
  base?: string | URL,
): string {
  let url: URL;
  if (base instanceof URL) {
    url = new URL(base.href);
  } else if (typeof base === "string") {
    url = new URL(base, typeof location !== "undefined" ? location.origin : "http://local.invalid");
  } else if (typeof location !== "undefined") {
    url = new URL(location.href);
  } else {
    url = new URL("http://local.invalid/");
  }
  const sp = url.searchParams;
  for (const e of entries) {
    const str = e.serialize(state[e.key]);
    if (omitDefaults && str === e.defaultStr) sp.delete(e.param);
    else sp.set(e.param, str);
  }
  const search = sp.toString();
  return url.pathname + (search ? `?${search}` : "") + url.hash;
}

// ---------------------------------------------------------------------------
// persistQuery
// ---------------------------------------------------------------------------

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
 * `ctx.url.searchParams` (or `readQuery` / `querySpec.parse`) remain the way
 * to consume query state for first paint and SSR. Call from island `onMount`
 * and return the unsubscribe as cleanup.
 *
 * ```ts
 * const filters = store(schema).build();
 * // island: .onMount(() => persistQuery(filters, { debounce: { q: 250, f: 0 } }))
 * ```
 *
 * ### First-paint read path
 *
 * | Concern | Read from |
 * | --- | --- |
 * | Data (where, list) | loader / `url.searchParams` |
 * | Bound controls (`bind:value`) | store (after `persistQuery`) |
 * | Chrome that must match URL on first paint (chips, badges) | loader snapshot via `readQuery` / `querySpec.parse`, not the store |
 */
export function persistQuery<TState extends object>(
  store: PersistQueryStore<TState>,
  options: PersistQueryOptions<TState> = {},
): Unsub {
  if (typeof window === "undefined") return () => {};

  const omitDefaults = options.omitDefaults !== false;
  const initial = store.getInitialState() as Record<string, unknown>;
  const entries = buildEntries(store.getInitialState(), options.params);

  // Dev: double-subscribe warning
  const subKey = store as object;
  const active = activePersistQueryStores.get(subKey) ?? 0;
  if (active > 0 && isDev()) {
    console.warn(
      "[@ilha/store] persistQuery: already active on this store — " +
        "did you forget to unsubscribe on unmount? Duplicate subscribers will double-write the URL.",
    );
  }
  activePersistQueryStores.set(subKey, active + 1);

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
        if (isDev()) {
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
    const differs = entries.some((e) => {
      const raw = sp.get(e.param);
      if (raw == null) return e.serialize(state[e.key]) !== e.defaultStr;
      return raw !== e.serialize(state[e.key]);
    });
    if (!differs) return;

    // The external URL supersedes any pending debounced write — cancel it so
    // a later flush can't clobber the URL with pre-navigation state.
    clearAllTimers();
    pendingState = null;

    const patch: Record<string, unknown> = {};
    const rawByKey = new Map<string, string | null>();

    for (const e of entries) {
      const raw = sp.get(e.param);
      rawByKey.set(e.key, raw);
      let next = initial[e.key];
      if (raw != null) {
        try {
          next = e.deserialize ? e.deserialize(raw) : raw;
        } catch (err) {
          if (isDev()) {
            console.warn(
              `[@ilha/store] persistQuery: dropped param "${e.param}" (deserialize error)`,
              err,
            );
          }
          next = initial[e.key];
        }
      }
      patch[e.key] = next;
    }

    applying = true;
    try {
      // Prefer one commit (one subscriber pulse). Schema stores validate the
      // whole snapshot — one bad param can reject the patch, so we fall back
      // to per-key commits when the batch does not stick.
      store.setState(patch as Partial<TState>);

      let curState = store.getState() as Record<string, unknown>;
      const batchStuck = entries.every((e) => Object.is(curState[e.key], state[e.key]));
      const batchHadChanges = entries.some((e) => !Object.is(patch[e.key], state[e.key]));

      if (batchStuck && batchHadChanges) {
        // Per-key so one invalid param can't reject the others.
        for (const e of entries) {
          store.setState({ [e.key]: patch[e.key] } as Partial<TState>);
        }
        curState = store.getState() as Record<string, unknown>;
      }

      // Soft-fail: prefer serialize(cur) === raw so schema-cloned arrays/objects
      // that round-trip still count as accepted.
      const recovery: Record<string, unknown> = {};
      let needRecovery = false;

      for (const e of entries) {
        const raw = rawByKey.get(e.key) ?? null;
        if (raw == null) continue;
        const cur = curState[e.key];
        const next = patch[e.key];
        let serCur: string;
        try {
          serCur = e.serialize(cur);
        } catch {
          serCur = "\0";
        }
        const accepted = serCur === raw || Object.is(cur, next) || !Object.is(cur, state[e.key]);
        if (accepted) continue;
        if (isDev()) {
          console.warn(
            `[@ilha/store] persistQuery: dropped param "${e.param}" ` +
              `(serialize mismatch | schema) raw=${JSON.stringify(raw)} got=${JSON.stringify(serCur)}`,
          );
        }
        recovery[e.key] = initial[e.key];
        needRecovery = true;
      }

      if (needRecovery) {
        store.setState(recovery as Partial<TState>);
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

  // --- debounce (global or per-key) -----------------------------------------
  let pendingState: Record<string, unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerDue = 0;

  const clearAllTimers = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    timerDue = 0;
  };

  const debounceForKey = (key: string): number => {
    const d = options.debounce;
    if (d == null) return 0;
    if (typeof d === "number") return d;
    return (d as Record<string, number | undefined>)[key] ?? 0;
  };

  const historyForKey = (key: string): HistoryMode => {
    const h = options.history;
    if (h == null || typeof h === "function") return "replace"; // fn resolved via changed set
    if (h === "push") return "push";
    if (h === "replace") return "replace";
    return (h as Record<string, HistoryMode | undefined>)[key] ?? "replace";
  };

  const resolveMode = (changedKeys: string[]): HistoryMode => {
    const h = options.history;
    if (typeof h === "function") {
      return h(changedKeys as Array<keyof TState & string>);
    }
    // Per-key map or global: push if any changed key wants push.
    for (const k of changedKeys) {
      if (historyForKey(k) === "push") return "push";
    }
    if (h === "push") return "push";
    return "replace";
  };

  /**
   * Debounce delay for a batch: use the **minimum** non-zero? Spec said
   * search 250, chips 0 — when both change together, chip wants immediate
   * push. We take the **minimum** delay among changed keys so a 0-ms key
   * flushes immediately (and still includes pending state from slower keys).
   */
  const batchDebounce = (changedKeys: string[]): number => {
    if (changedKeys.length === 0) return 0;
    let min = Infinity;
    for (const k of changedKeys) {
      const ms = debounceForKey(k);
      if (ms < min) min = ms;
    }
    return min === Infinity ? 0 : min;
  };

  const flush = (mode: HistoryMode = "replace") => {
    clearAllTimers();
    if (pendingState == null) return;
    const state = pendingState;
    pendingState = null;
    performWrite(state, mode);
  };

  const unsubStore = store.subscribe((state, prevState) => {
    if (applying) return;
    const s = state as Record<string, unknown>;
    const p = prevState as Record<string, unknown>;
    const changed = entries.filter((e) => !Object.is(s[e.key], p[e.key])).map((e) => e.key);
    if (changed.length === 0) return;

    const mode = resolveMode(changed);
    if (mode === "push") {
      // Flush any pending debounced replace first (it holds the pre-push
      // state) so the pushed history entry's predecessor is coherent.
      flush("replace");
      performWrite(s, "push");
      return;
    }

    pendingState = s;
    const delay = batchDebounce(changed);
    if (delay > 0) {
      // If a timer is already scheduled for a longer delay, reschedule to the
      // shorter remaining window so a 0-key path isn't stuck behind q's 250ms.
      const due = Date.now() + delay;
      if (timer == null || due < timerDue) {
        if (timer != null) clearTimeout(timer);
        timerDue = due;
        timer = setTimeout(() => flush("replace"), delay);
      }
    } else {
      flush("replace");
    }
  });

  // --- init: URL is the source of truth -------------------------------------
  applyFromUrl(new URL(location.href));

  return () => {
    if (stopped) return;
    stopped = true;
    flush("replace");
    unsubStore();
    unsubIncoming();
    const n = (activePersistQueryStores.get(subKey) ?? 1) - 1;
    if (n <= 0) activePersistQueryStores.delete(subKey);
    else activePersistQueryStores.set(subKey, n);
  };
}

/** Tracks concurrent persistQuery subscriptions per store (dev double-bind). */
const activePersistQueryStores = new WeakMap<object, number>();
