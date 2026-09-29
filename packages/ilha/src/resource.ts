import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";

import { atom } from "./atom.ts";
import { getFiber } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import type {
  AtomHandle,
  Resource,
  ResourceFetcher,
  ResourceOptions,
} from "./types.ts";
import { watch } from "./watch.ts";

interface CacheEntry<T> {
  data?: T;
  has: boolean;
  promise?: Promise<T>;
}

interface Flight<T> {
  promise?: Promise<T>;
}

interface Sink<T> {
  data: AtomHandle<T | undefined>;
  error: AtomHandle<unknown>;
  loading: AtomHandle<boolean>;
}

interface Cell<T> {
  ctrl: AbortController | null;
  alive: boolean;
  started: boolean;
  /** Registered in `liveRefetchers[key]` while the cell is alive. */
  onInvalidate: () => void;
  /** Background refetch, rebound each render to the latest fetcher. */
  revalidate: () => void;
  sink: Sink<T>;
}

interface SsrCell<T> {
  ctrl: AbortController | null;
  refetch: () => Promise<T | undefined>;
  sink: Sink<T>;
}

const sharedCache = new Map<string, CacheEntry<unknown>>();
const liveRefetchers = new Map<string, Set<() => void>>();
const cells = new WeakMap<object, Map<string, unknown>>();

/** Unmount: stop every client cell of one fiber (all keys it ever used). */
const releaseCells = (byKey: Map<string, unknown>): void => {
  for (const [key, entry] of byKey) {
    // SAFETY: client fibers only store Cell entries (SSR returns earlier).
    const c = entry as Cell<unknown>;
    c.alive = false;
    c.ctrl?.abort();
    const live = liveRefetchers.get(key);
    live?.delete(c.onInvalidate);
    if (live && live.size === 0) {
      liveRefetchers.delete(key);
    }
  }
  byKey.clear();
};

const entryFor = <T>(key: string): CacheEntry<T> | undefined =>
  // SAFETY: entries are written by the same keyed fetch path with type T.
  sharedCache.get(key) as CacheEntry<T> | undefined;

/** Drop the cached value for `key` and refetch it in live components. */
export const invalidate = (key: string): void => {
  sharedCache.delete(key);
  const live = liveRefetchers.get(key);
  if (!live) {
    return;
  }
  for (const refetch of live) {
    refetch();
  }
};

/**
 * Fetch-once, share-everywhere async state for `key`. Concurrent mounts
 * dedupe on one in-flight request; remounts seed from the shared cache
 * (and revalidate when `staleWhileRevalidate` holds). Call unconditionally
 * at the top level of a sync component, before any `await`.
 */
export const resource = <T>(
  key: string,
  fetcher: ResourceFetcher<T>,
  opts?: ResourceOptions
): Resource<T> => {
  const fiber: FiberLocal = getFiber();
  // oxlint-disable-next-line unicorn/no-useless-undefined -- resources start valueless; undefined is the seed
  const data = atom<T | undefined>(undefined);
  // oxlint-disable-next-line unicorn/no-useless-undefined -- no failure yet; undefined is the seed
  const error = atom<unknown>(undefined);
  const loading = atom<boolean>(true);

  let byKey = cells.get(fiber);
  if (!byKey) {
    byKey = new Map();
    cells.set(fiber, byKey);
  }

  if (fiber.runtime.ssr) {
    // Server: fetch fresh per render; the shared cache never crosses requests.
    // SAFETY: one SSR cell per (fiber, key); T matches because the call-site fetcher is stable.
    let ssrCell = byKey.get(key) as SsrCell<T> | undefined;
    if (!ssrCell) {
      const { runtime } = fiber;
      const sc: SsrCell<T> = {
        ctrl: null,
        refetch: async () => {
          sc.ctrl?.abort();
          const ctrl = new AbortController();
          sc.ctrl = ctrl;
          sc.sink.loading.set(true);
          // Hold renderToString() open until this fetch settles.
          runtime.begin();
          try {
            const v = await fetcher(key, { signal: ctrl.signal });
            if (!ctrl.signal.aborted) {
              sc.sink.data.set(v);
              sc.sink.error.set(undefined);
              sc.sink.loading.set(false);
            }
            return v;
          } catch (fetchError) {
            if (!ctrl.signal.aborted) {
              sc.sink.error.set(fetchError);
              sc.sink.loading.set(false);
            }
            throw fetchError;
          } finally {
            runtime.end();
          }
        },
        sink: { data, error, loading },
      };
      Effect.runSync(
        Scope.addFinalizer(
          fiber.scope,
          Effect.sync(() => sc.ctrl?.abort())
        )
      );
      byKey.set(key, sc);
      ssrCell = sc;
      const settleSsr = async (): Promise<void> => {
        try {
          await sc.refetch();
        } catch {
          // Failures land in the error atom.
        }
      };
      void settleSsr();
    }
    // SAFETY: slots reuse the same underlying atoms across renders.
    ssrCell.sink = { data, error, loading };
    return { data, error, loading, refetch: ssrCell.refetch };
  }

  // SAFETY: one cell per (fiber, key); T matches because the call-site fetcher is stable.
  let cell = byKey.get(key) as Cell<T> | undefined;
  if (!cell) {
    const fresh: Cell<T> = {
      alive: true,
      ctrl: null,
      onInvalidate: () => {
        fresh.revalidate();
      },
      revalidate: () => {
        // Bound below, before anything can invalidate this cell.
      },
      sink: { data, error, loading },
      started: false,
    };
    cell = fresh;
    byKey.set(key, cell);
    // Live from creation, not from a first-render-only watch: a key that
    // changes on a later render still gets invalidations.
    let live = liveRefetchers.get(key);
    if (!live) {
      live = new Set();
      liveRefetchers.set(key, live);
    }
    live.add(cell.onInvalidate);
  }
  // SAFETY: slots reuse the same underlying atoms across renders, so any
  // generation of handles reads and writes the same values.
  cell.sink = { data, error, loading };
  const c = cell;
  const fiberCells = byKey;

  const adoptShared = async (shared: Promise<T>): Promise<void> => {
    try {
      const v = await shared;
      if (c.alive) {
        c.sink.data.set(v);
        c.sink.error.set(undefined);
        c.sink.loading.set(false);
      }
    } catch (fetchError) {
      if (c.alive) {
        c.sink.error.set(fetchError);
        c.sink.loading.set(false);
      }
    }
  };

  const start = (): Promise<T | undefined> => {
    if (!c.alive) {
      return Promise.resolve(c.sink.data());
    }
    const hit = entryFor<T>(key);
    if (hit?.promise) {
      // Join the in-flight request, but land its result in this cell too —
      // otherwise only the component that started the fetch would update.
      c.sink.loading.set(true);
      void adoptShared(hit.promise);
      return hit.promise;
    }
    c.ctrl?.abort();
    const ctrl = new AbortController();
    c.ctrl = ctrl;
    c.sink.loading.set(true);
    const flight: Flight<T> = {};
    const run = async (): Promise<T> => {
      try {
        const v = await fetcher(key, { signal: ctrl.signal });
        const cur = entryFor<T>(key);
        if (cur?.promise === flight.promise) {
          sharedCache.set(key, { data: v, has: true });
        }
        if (c.alive && !ctrl.signal.aborted) {
          c.sink.data.set(v);
          c.sink.error.set(undefined);
          c.sink.loading.set(false);
        }
        return v;
      } catch (fetchError) {
        const cur = entryFor<T>(key);
        if (cur?.promise === flight.promise) {
          cur.promise = undefined;
        }
        if (c.alive && !ctrl.signal.aborted) {
          c.sink.error.set(fetchError);
          c.sink.loading.set(false);
        }
        throw fetchError;
      }
    };
    const p = run();
    flight.promise = p;
    const prev = entryFor<T>(key);
    sharedCache.set(key, {
      data: prev?.data,
      has: prev?.has ?? false,
      promise: p,
    });
    return p;
  };

  const settleStart = async (): Promise<void> => {
    try {
      await start();
    } catch {
      // Background failures land in the error atom.
    }
  };
  c.revalidate = () => {
    void settleStart();
  };

  if (!c.started) {
    c.started = true;
    const swr = opts?.staleWhileRevalidate ?? true;
    const hit = entryFor<T>(key);
    if (hit?.promise) {
      if (hit.has) {
        c.sink.data.set(hit.data);
        c.sink.loading.set(false);
      }
      void adoptShared(hit.promise);
    } else if (hit?.has) {
      c.sink.data.set(hit.data);
      c.sink.error.set(undefined);
      c.sink.loading.set(false);
      if (swr) {
        void settleStart();
      }
    } else {
      const seed = c.sink.data();
      if (seed === undefined) {
        void settleStart();
      } else {
        // Hydrated (SSR snapshot) value becomes the shared seed.
        sharedCache.set(key, { data: seed, has: true });
        if (swr) {
          void settleStart();
        } else {
          c.sink.loading.set(false);
        }
      }
    }
  }

  // Unconditional: watch slots are positional, so a watch.once that only
  // runs on the first render would shift every later watch() in the
  // component — and the shifted slot's dispose kills this cell mid-fetch.
  // One teardown per fiber covers every key it ever used.
  watch.once(() => () => {
    releaseCells(fiberCells);
  });

  return { data, error, loading, refetch: () => start() };
};
