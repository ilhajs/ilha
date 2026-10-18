import { atom, untrack } from "./atom.ts";
import { getFiber } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import type { Resource, ResourceFetcher, ResourceOptions } from "./types.ts";
import { watch } from "./watch.ts";

interface CacheEntry {
  data?: unknown;
  has?: boolean;
  promise?: Promise<unknown>;
}

interface Cell {
  alive: boolean;
  ctrl?: AbortController;
  /** Background refetch, rebound each render to the latest fetcher. */
  kick: () => void;
  /** Stable entry in `live` for `invalidate(key)`. */
  onInvalidate: () => void;
}

/** Client-side results shared across mounts. SSR never reads or writes it. */
const cache = new Map<string, CacheEntry>();
const live = new Map<string, Set<() => void>>();
const cells = new WeakMap<FiberLocal, Map<string, Cell>>();

const ignore = (): void => {
  /* not kicked yet */
};

/** Run `p` in the background; failures already landed in the error atom. */
const background = async <T>(p: Promise<T>): Promise<void> => {
  try {
    await p;
  } catch {
    /* surfaced through the resource's error atom */
  }
};

/** Drop the cached value for `key` and refetch it in live components. */
export const invalidate = (key: string): void => {
  cache.delete(key);
  for (const kick of live.get(key) ?? []) {
    kick();
  }
};

/**
 * Fetch-once, share-everywhere async state for `key`. Concurrent mounts
 * dedupe on one in-flight request; remounts seed from the shared cache
 * (and revalidate when `staleWhileRevalidate` holds). On the server each
 * render fetches fresh and `renderToString` waits for it. Call
 * unconditionally at the top level of a sync component, before any `await`.
 */
export const resource = <T>(
  key: string,
  fetcher: ResourceFetcher<T>,
  opts?: ResourceOptions
): Resource<T> => {
  const fiber = getFiber();
  const { runtime } = fiber;
  // oxlint-disable-next-line unicorn/no-useless-undefined -- resources start valueless
  const data = atom<T | undefined>(undefined);
  // oxlint-disable-next-line unicorn/no-useless-undefined -- no failure yet
  const failure = atom<unknown>(undefined);
  const loading = atom(true);

  let byKey = cells.get(fiber);
  if (!byKey) {
    byKey = new Map();
    cells.set(fiber, byKey);
  }
  const fresh = !byKey.has(key);
  let cell = byKey.get(key);
  if (!cell) {
    const c: Cell = { alive: true, kick: ignore, onInvalidate: () => c.kick() };
    cell = c;
    byKey.set(key, c);
  }

  /** Land a fetch in this cell unless it was superseded or unmounted. */
  const land = async (p: Promise<T>, ctrl?: AbortController): Promise<T> => {
    const current = () => cell.alive && !ctrl?.signal.aborted;
    try {
      const v = await p;
      if (current()) {
        data.set(v);
        failure.set(undefined);
        loading.set(false);
      }
      return v;
    } catch (error) {
      if (current()) {
        failure.set(error);
        loading.set(false);
      }
      throw error;
    }
  };

  /** Fetch into the shared cache; the entry keeps its last good value. */
  const fetchShared = async (ctrl: AbortController): Promise<T> => {
    const flight = fetcher(key, { signal: ctrl.signal });
    cache.set(key, { ...cache.get(key), promise: flight });
    try {
      const v = await flight;
      if (cache.get(key)?.promise === flight) {
        cache.set(key, { data: v, has: true });
      }
      return v;
    } catch (error) {
      const cur = cache.get(key);
      if (cur?.promise === flight) {
        cur.promise = undefined;
      }
      throw error;
    }
  };

  const start = async (): Promise<T | undefined> => {
    if (!cell.alive) {
      return untrack(data);
    }
    loading.set(true);
    const hit = runtime.ssr ? undefined : cache.get(key);
    if (hit?.promise) {
      // Join the in-flight request and land its result here too.
      // SAFETY: cache entries under `key` hold this resource's T.
      return land(hit.promise as Promise<T>);
    }
    cell.ctrl?.abort();
    const ctrl = new AbortController();
    cell.ctrl = ctrl;
    if (!runtime.ssr) {
      return land(fetchShared(ctrl), ctrl);
    }
    // Hold renderToString() open until this fetch settles.
    runtime.begin();
    try {
      return await land(fetcher(key, { signal: ctrl.signal }), ctrl);
    } finally {
      runtime.end();
    }
  };
  cell.kick = () => {
    void background(start());
  };

  if (fresh) {
    if (!runtime.ssr) {
      let set = live.get(key);
      if (!set) {
        set = new Set();
        live.set(key, set);
      }
      set.add(cell.onInvalidate);
    }
    const hit = runtime.ssr ? undefined : cache.get(key);
    const seed = untrack(data);
    if (hit?.has) {
      // SAFETY: cache entries under `key` hold this resource's T.
      data.set(hit.data as T);
      loading.set(false);
    }
    if (hit?.promise) {
      // SAFETY: cache entries under `key` hold this resource's T.
      void background(land(hit.promise as Promise<T>));
    } else if (hit?.has || seed !== undefined) {
      if (!hit) {
        // A hydrated (SSR snapshot) value becomes the shared seed.
        cache.set(key, { data: seed, has: true });
      }
      if (opts?.staleWhileRevalidate === false) {
        loading.set(false);
      } else {
        cell.kick();
      }
    } else {
      cell.kick();
    }
  }

  // Unconditional for slot stability; one teardown per fiber covers every
  // key it ever used.
  const owned = byKey;
  watch.once(() => () => {
    for (const [k, c] of owned) {
      c.alive = false;
      c.ctrl?.abort();
      const set = live.get(k);
      set?.delete(c.onInvalidate);
      if (set?.size === 0) {
        live.delete(k);
      }
    }
    owned.clear();
  });

  return { data, error: failure, loading, refetch: start };
};
