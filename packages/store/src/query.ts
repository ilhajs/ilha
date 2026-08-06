// =============================================================================
// @ilha/store/query — query() / QueryCache (data-fetching cache for async deriveds)
//
// Cache, dedup, cross-store sharing, and invalidation for `.derived()` fetches.
// Hosts (store / island) detect via Symbol.for — no hard import required.
// =============================================================================

/** Survives duplicate bundle copies (same pattern as ilha.signalAccessor). */
export const ILHA_QUERY = Symbol.for("ilha.store.query");

/**
 * Method key on a QueryCall. Hosts invoke `call[ILHA_QUERY_RUN](signal, cbs)`
 * to run cache/dedup/SWR without importing this module.
 */
export const ILHA_QUERY_RUN = Symbol.for("ilha.store.query.run");

/**
 * @deprecated Prefer capture-stack attachment. Kept so older dual-bundle copies
 * of query() that still write a pending sentinel remain detectable.
 */
export const ILHA_QUERY_PENDING = Symbol.for("ilha.store.query.pending");

/**
 * Shared capture stack identity — hosts push a slot around each derived
 * evaluation; query() writes the top frame. Symbol.for keeps zero hard imports.
 */
const ILHA_QUERY_STACK = Symbol.for("ilha.store.query.stack");

type QueryCaptureSlot = { queryCall?: unknown };

function captureStack(): QueryCaptureSlot[] {
  const g = globalThis as Record<symbol, unknown>;
  let stack = g[ILHA_QUERY_STACK] as QueryCaptureSlot[] | undefined;
  if (!stack) {
    stack = [];
    g[ILHA_QUERY_STACK] = stack;
  }
  return stack;
}

const isDev = typeof process !== "undefined" ? process.env?.["NODE_ENV"] !== "production" : true;

export type CacheEntry<T = unknown> = {
  promise: Promise<T> | undefined;
  value: T | undefined;
  error: Error | undefined;
  settledAt: number;
  subscribers: number;
  gcTimer: ReturnType<typeof setTimeout> | undefined;
};

export interface QueryOptions<T> {
  /**
   * Serialisable array uniquely identifying this query.
   * Read the reactive state that should trigger a re-fetch *before*
   * building this array (i.e. inside the ctx.get() / state reads in the
   * derived function) — query() itself does no tracking.
   *
   * Prefer primitive segments only. Objects and non-finite numbers do not
   * round-trip through JSON stably and will break cache identity.
   */
  key: unknown[];

  /**
   * Performs the fetch. Capture `signal` from the enclosing derived
   * function's closure — query() does not thread signal into fn.
   */
  fn: () => Promise<T>;

  /** Freshness window (ms). Default: 0. */
  staleTime?: number;

  /** Retain cache entry after last subscriber drops (ms). Default: 300_000. */
  gcTime?: number;

  /** Explicit cache instance. Default: defaultQueryCache. */
  cache?: QueryCache;
}

export type QueryRunCallbacks = {
  onResult: (value: unknown) => void;
  onError: (err: Error) => void;
  /** Sets loading; SWR may keep the previous value. Not called on fresh hits. */
  onFetchStart: () => void;
};

export interface QueryCall<T> {
  readonly [ILHA_QUERY]: true;
  readonly [ILHA_QUERY_RUN]: (signal: AbortSignal, cbs: QueryRunCallbacks) => void;
  readonly key: unknown[];
  readonly fn: () => Promise<T>;
  readonly staleTime: number;
  readonly gcTime: number;
  readonly cache: QueryCache;
}

export class QueryCache {
  #entries = new Map<string, CacheEntry>();

  /** Number of live cache entries (including in-flight and GC-pending). */
  get size(): number {
    return this.#entries.size;
  }

  key(parts: unknown[]): string {
    return JSON.stringify(parts);
  }

  /**
   * Look up an entry. The type parameter is a convenience cast only — there is
   * no runtime check that the stored value matches `T`.
   */
  get<T>(cacheKey: string): CacheEntry<T> | undefined {
    return this.#entries.get(cacheKey) as CacheEntry<T> | undefined;
  }

  set(cacheKey: string, entry: CacheEntry): void {
    this.#entries.set(cacheKey, entry);
  }

  /** Removes one entry and clears its GC timer. */
  delete(cacheKey: string): void {
    const entry = this.#entries.get(cacheKey);
    if (entry?.gcTimer != null) clearTimeout(entry.gcTimer);
    this.#entries.delete(cacheKey);
  }

  /** Remove all entries, clearing GC timers. */
  clear(): void {
    for (const entry of this.#entries.values()) {
      if (entry.gcTimer != null) clearTimeout(entry.gcTimer);
    }
    this.#entries.clear();
  }

  /** Removes one entry by exact key parts. Next derived re-run refetches. */
  invalidate(keyParts: unknown[]): void {
    this.delete(this.key(keyParts));
  }

  /**
   * Removes every entry whose serialised key equals or extends the serialised
   * prefix. Uses string-prefix matching on `JSON.stringify` output (no
   * per-key parse). An empty prefix (`[]`) only matches the exact empty-key
   * entry — use {@link clear} for a full wipe.
   */
  invalidatePrefix(prefix: unknown[]): void {
    const serialized = this.key(prefix);
    // '[1,"x"]' → '[1,"x"' ; exact key or longer keys that continue with ',' / ']'
    const stem = serialized.slice(0, -1);
    for (const k of this.#entries.keys()) {
      if (
        k === serialized ||
        (k.startsWith(stem) && (k[stem.length] === "," || k[stem.length] === "]"))
      ) {
        this.delete(k);
      }
    }
  }
}

export const defaultQueryCache = new QueryCache();

function warnBadKeySegments(key: unknown[]): void {
  if (!isDev) return;
  for (const seg of key) {
    if (typeof seg === "object" && seg !== null) {
      console.warn(
        "@ilha/store/query: key segment is an object — use primitives only for stable cache keys.",
      );
      return;
    }
    if (typeof seg === "number" && !Number.isFinite(seg)) {
      console.warn(
        "@ilha/store/query: key segment is NaN/Infinity — these do not survive JSON round-trips.",
      );
      return;
    }
  }
}

type QueryCacheEntryLike = CacheEntry<unknown>;

type QueryCallLike = {
  key: unknown[];
  fn: () => Promise<unknown>;
  staleTime: number;
  gcTime: number;
  cache: {
    key(parts: unknown[]): string;
    get(cacheKey: string): QueryCacheEntryLike | undefined;
    set(cacheKey: string, entry: QueryCacheEntryLike): void;
    delete(cacheKey: string): void;
  };
};

function cancelGcTimer(entry: QueryCacheEntryLike | undefined): void {
  if (entry?.gcTimer != null) {
    clearTimeout(entry.gcTimer);
    entry.gcTimer = undefined;
  }
}

function attachQuerySubscriber(
  entry: QueryCacheEntryLike,
  call: QueryCallLike,
  cacheKey: string,
  signal: AbortSignal,
): void {
  const onAbort = () => {
    entry.subscribers -= 1;
    if (entry.subscribers > 0 || entry.gcTimer != null) return;
    // Only arm GC when this entry is still the live cache value for the key.
    if (call.cache.get(cacheKey) !== entry) return;
    entry.gcTimer = setTimeout(() => {
      if (call.cache.get(cacheKey) === entry) call.cache.delete(cacheKey);
    }, call.gcTime);
  };
  signal.addEventListener("abort", onAbort, { once: true });
}

/**
 * Run a branded `query()` call against its cache.
 *
 * Contract for callbacks:
 * - `onResult(value)` — set envelope to `{ loading: false, value, error: undefined }`
 * - `onError(err)` — set `{ loading: false, value: undefined, error }`
 * - `onFetchStart()` — set `{ loading: true, … }` (SWR may keep prior value).
 *   Not invoked on a fresh cache hit (synchronous `onResult` only).
 */
export function executeQueryCall(
  call: QueryCallLike,
  signal: AbortSignal,
  cbs: QueryRunCallbacks,
): void {
  const { onResult, onError, onFetchStart } = cbs;
  const cacheKey = call.cache.key(call.key);
  const entry = call.cache.get(cacheKey);
  const now = Date.now();

  // Fresh hit — synchronous, no network
  if (
    entry &&
    entry.value !== undefined &&
    entry.settledAt > 0 &&
    now - entry.settledAt < call.staleTime
  ) {
    cancelGcTimer(entry);
    entry.subscribers += 1;
    attachQuerySubscriber(entry, call, cacheKey, signal);
    onResult(entry.value);
    return;
  }

  // In-flight dedup — attach to the existing promise (no cache write here;
  // the originator owns entry mutation).
  if (entry?.promise) {
    cancelGcTimer(entry);
    entry.subscribers += 1;
    attachQuerySubscriber(entry, call, cacheKey, signal);
    onFetchStart();
    entry.promise
      .then((val) => {
        if (!signal.aborted) onResult(val);
      })
      .catch((err: unknown) => {
        if (!signal.aborted) onError(err instanceof Error ? err : new Error(String(err)));
      });
    return;
  }

  // New fetch — reuse the existing entry object when present so abort handlers
  // that closed over it stay correct; insert only when the key is vacant.
  cancelGcTimer(entry);
  onFetchStart();

  let promise: Promise<unknown>;
  try {
    promise = Promise.resolve(call.fn());
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (entry) {
      entry.promise = undefined;
      entry.error = e;
    }
    onError(e);
    return;
  }

  let live = entry;
  if (live) {
    live.promise = promise;
    live.error = undefined;
    live.subscribers += 1;
    live.gcTimer = undefined;
  } else {
    live = {
      promise,
      value: undefined,
      error: undefined,
      settledAt: 0,
      subscribers: 1,
      gcTimer: undefined,
    };
    call.cache.set(cacheKey, live);
  }
  attachQuerySubscriber(live, call, cacheKey, signal);

  promise
    .then((value) => {
      live.promise = undefined;
      live.value = value;
      live.error = undefined;
      live.settledAt = Date.now();
      if (signal.aborted) return;
      onResult(value);
    })
    .catch((err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      live.promise = undefined;
      live.error = e;
      if (signal.aborted) return;
      onError(e);
    });
}

/**
 * Typed as Promise<T> so it satisfies an async `.derived()` return type.
 * At runtime this is a branded QueryCall sentinel with an executable run
 * method. When called inside a derived effect that pushes a capture slot, the
 * call is attached to that slot so hosts can detect async-function wrappers.
 */
export function query<T>(options: QueryOptions<T>): Promise<T> {
  warnBadKeySegments(options.key);

  const call = {
    [ILHA_QUERY]: true as const,
    key: options.key,
    fn: options.fn,
    staleTime: options.staleTime ?? 0,
    gcTime: options.gcTime ?? 300_000,
    cache: options.cache ?? defaultQueryCache,
    [ILHA_QUERY_RUN](signal: AbortSignal, cbs: QueryRunCallbacks) {
      executeQueryCall(call, signal, cbs);
    },
  } satisfies QueryCall<T>;

  const stack = captureStack();
  const slot = stack[stack.length - 1];
  if (slot) {
    slot.queryCall = call;
  } else {
    // Fallback when called outside a host derived evaluation.
    (globalThis as Record<symbol, unknown>)[ILHA_QUERY_PENDING] = call;
  }

  return call as unknown as Promise<T>;
}
