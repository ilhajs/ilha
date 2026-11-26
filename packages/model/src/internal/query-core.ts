/**
 * The cache half of `Query`: its host signals, its problems sink, its key
 * format and the cache's service key. The rest of the module is reached
 * through `loaded`, which `Query` sets when an app imports it, so an app
 * without queries doesn't bundle the cache.
 *
 * Component-side integration (component binding, registered below):
 * - `internal/queries.ts` provides `bind(component, queries)`, which checks
 *   a component's `queries` option and builds its bound record (`Bound`,
 *   `Entry`, `Keyed`, `Marker`, `Group`).
 * - `internal/query-run.ts` provides the per-instance watch sync (`cacheOf`,
 *   `mounted`, `synced`, `applyLists`, the Command run handles) over the
 *   runtime kernel, driven by the component lifecycle.
 * - `internal/query-run.ts` registers both here through
 *   `registerComponentBinding` at its module bottom; `internal/kernel.ts`
 *   imports it for that side effect and reaches the hooks through
 *   `componentBindingOf()`, so neither the kernel nor `Component` imports
 *   `Query`. The cache itself never reads the binding: `Loaded` below is
 *   cache-level only.
 * - `query.ts` installs the cache half through `load` at its own module
 *   bottom.
 * - Router prefetch stays out: `Router` is Out, so there is no prefetch hook.
 *
 * @internal
 */
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";

import type * as Command from "../command.ts";
import type * as Query from "../query.ts";
import type * as Kernel from "./kernel.ts";

// -----------------------------------------------------------------------------
// The loaded module
// -----------------------------------------------------------------------------

/** @internal */
export type Cache = ReturnType<typeof Query.internals>;

/** @internal */
export interface CacheOptions {
  readonly visibility: Query.Signal;
  readonly connectivity: Query.Signal;
  readonly report: (problem: Query.Problem.Any) => void;
  readonly idleMs?: number | undefined;
  readonly idleTimeToLive?: Duration.Input | undefined;
  /**
   * The server's per-request mode: an entry settles at most once and is never
   * stale after, every settle is stored, a query's own `invalidate` is ignored
   * and reported, and no idle timer, interval or host edge runs.
   */
  readonly settleOnce?: boolean | undefined;
  /** `false`: no fetch ever starts, as on a server render with a budget of 0. */
  readonly fetches?: boolean | undefined;
}

/**
 * What the runtime and `Component` call in `Query`, without importing it.
 * Cache-level only: the component binding registers separately below, so
 * the cache bundle never pulls in the component runtime.
 *
 * @internal
 */
export interface Loaded extends Pick<
  typeof Query,
  | "defOf"
  | "internals"
  | "makeSnapshot"
  | "makeSnapshotMap"
  | "sameMore"
  | "snapshotData"
  | "snapshotMapData"
  | "snapshotMapSchema"
  | "snapshotSchema"
> {
  /** Builds a cache, with its disposal. The context supplies the `Clock` and the scheduler. */
  readonly buildCache: (
    context: Context.Context<never>,
    options: CacheOptions
  ) => { readonly cache: Cache; readonly dispose: Effect.Effect<void> };
}

/**
 * `Query`'s functions, once an app has imported it. A query and a snapshot
 * can only exist after that.
 *
 * @internal
 */
// oxlint-disable-next-line import/no-mutable-exports -- assigned exactly once by load() when Query boots; importers read the live binding.
export let loaded: Loaded | undefined;

/** @internal */
export const load = (module: Loaded | undefined): void => {
  loaded = module;
};

/**
 * The per-instance query hooks the component runtime calls: watch sync,
 * `$.loadMore`/`$.reset`, view/update/log views, and the Command run
 * handles. Implemented by `internal/query-run.ts`; the kernel reaches them
 * through the binding, so it never imports that module.
 *
 * @internal
 */
export interface QueryRunHooks {
  /** Create the results atom, seed and hydrate it, and sync the first watches. */
  readonly mounted: (rec: Kernel.InstanceRecord) => void;
  /** Re-evaluate args and sync watches. Throws on an `args` throw; the caller fails the instance. */
  readonly synced: (rec: Kernel.InstanceRecord) => void;
  /** Apply `$.loadMore`/`$.reset` issues after an update. */
  readonly applyLists: (
    rec: Kernel.InstanceRecord,
    lists: readonly {
      readonly name: string;
      readonly op: "loadMore" | "reset";
    }[]
  ) => void;
  /** The view's `queries`/`previous`/`patched`, or `undefined` without queries. */
  readonly viewOf: (rec: Kernel.InstanceRecord) =>
    | {
        readonly queries: unknown;
        readonly previous: unknown;
        readonly patched: unknown;
      }
    | undefined;
  /** The `queries` an update sees, for `$.queries`. */
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the update's queries view is assembled by the binding in internal/query-run.ts; this bundle names no type for it.
  readonly queriesForUpdate: (rec: Kernel.InstanceRecord) => unknown;
  /** The `queries` a `Mounted` or `Update` entry carries, or `undefined` without queries. */
  readonly logResults: (
    rec: Kernel.InstanceRecord
    // oxlint-disable-next-line anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type -- log records are keyed by entry name with per-query payloads; the MessageLog contract types them at the log boundary.
  ) => Record<string, unknown> | undefined;
  /** Begin a Service Command's cache run at issue, or `undefined` with nothing to apply. */
  readonly beginRun: (
    rec: Kernel.InstanceRecord,
    command: Command.Issued<unknown, never>
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- a begun run handle from internal/query-run.ts, or undefined with nothing to apply; kept opaque to avoid the import.
  ) => unknown;
  /** Mark a begun run started, once its fiber starts. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are provisioned by beginRun and threaded opaquely; the concrete RunHandle lives in internal/query-run.ts, which this bundle must not import.
  readonly startRun: (token: unknown) => void;
  /** Finish a begun run as stopped, before its fiber starts. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are provisioned by beginRun and threaded opaquely; the concrete RunHandle lives in internal/query-run.ts, which this bundle must not import.
  readonly cancelRun: (token: unknown) => void;
  /** Runs a Command body in the run: provides `CurrentRun` and finishes on exit. */
  readonly runBody: <A, E, R>(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are provisioned by beginRun and threaded opaquely; the concrete RunHandle lives in internal/query-run.ts, which this bundle must not import.
    token: unknown,
    body: Effect.Effect<A, E, R>,
    writes: ((success: A) => readonly Query.Write[]) | undefined
  ) => Effect.Effect<A, E, R>;
  /** The entries an `afterRefetch` run waits for once its success applied, or `undefined` without a wait. */
  readonly awaited: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are provisioned by beginRun and threaded opaquely; the concrete RunHandle lives in internal/query-run.ts, which this bundle must not import.
    token: unknown
  ) => readonly Query.AwaitedEntry[] | undefined;
  /** The awaited entries still in flight or owed. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are provisioned by beginRun and threaded opaquely; the concrete RunHandle lives in internal/query-run.ts, which this bundle must not import.
  readonly outstanding: (token: unknown) => readonly Query.AwaitedEntry[];
  /** Calls `f` once no awaited entry is outstanding. Returns the cancel. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are provisioned by beginRun and threaded opaquely; the concrete RunHandle lives in internal/query-run.ts, which this bundle must not import.
  readonly onRefetched: (token: unknown, f: () => void) => () => void;
  /** Milliseconds on the cache's clock since an `afterRefetch` run applied its invalidation. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are provisioned by beginRun and threaded opaquely; the concrete RunHandle lives in internal/query-run.ts, which this bundle must not import.
  readonly sinceApplied: (token: unknown) => number;
}

/**
 * The component-side query integration, installed by `internal/query-run.ts`.
 * `bind` checks a component's `queries` option and builds its bound record;
 * `run` is the per-instance watch sync over the runtime kernel.
 *
 * @internal
 */
export interface ComponentBinding {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the bound queries record's type lives in internal/queries.ts; bind returns that record opaquely to avoid the import.
  readonly bind: (component: string, queries: unknown) => unknown;
  readonly run: QueryRunHooks;
}

let componentBinding: ComponentBinding | undefined;

/**
 * Installs the component-side query integration. `internal/query-run.ts` calls
 * this once at its module bottom, and `internal/kernel.ts` imports that
 * module for the side effect. The cache never reads the binding.
 *
 * @internal
 */
export const registerComponentBinding = (binding: ComponentBinding): void => {
  componentBinding = binding;
};

/**
 * The installed component-side query integration, or `undefined` when
 * `internal/query-run.ts` hasn't been loaded (server builds without queries).
 *
 * @internal
 */
export const componentBindingOf = (): ComponentBinding | undefined =>
  componentBinding;

// -----------------------------------------------------------------------------
// What a component and a watch carry
// -----------------------------------------------------------------------------

/**
 * A component's bound `queries`. `undefined` without any. Typed as
 * `unknown` so the cache bundle never imports `internal/queries.ts`; the
 * real `Bound` lives there.
 *
 * @internal
 */
export const boundOf = (component: {
  readonly "~queries"?: unknown;
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the bound record's type lives in internal/queries.ts; the bundle reads the hook without importing it.
}): unknown | undefined => component["~queries"];

/** @internal */
export const markerKey = "~@effect/ui/Component/watchMarker";

/** @internal */
export const groupKey = "~@effect/ui/Component/watchGroup";

/**
 * What one query's watch carries for the runtime. Typed as `unknown` so the
 * cache bundle never imports `internal/queries.ts`; the real `Marker` lives
 * there.
 *
 * @internal
 */
// oxlint-disable-next-line anti-slop/no-object-parameters, anti-slop/no-unknown-returns -- subscriptions are untyped runtime handles from the component kernel; the marker is read, never written, and internal/queries.ts owns the real Marker type.
export const markerOf = (subscription: object): unknown | undefined =>
  // SAFETY: the component kernel only stores the marker under this key when bound by bind(); reading it back yields unknown exactly as declared.
  (subscription as { readonly [markerKey]?: unknown })[markerKey];

/**
 * A keyed query's ordered keys. Typed as `unknown` so the cache bundle never
 * imports `internal/queries.ts`; the real `Group` lives there.
 *
 * @internal
 */
// oxlint-disable-next-line anti-slop/no-object-parameters, anti-slop/no-unknown-returns -- subscriptions are untyped runtime handles from the component kernel; the group is read, never written, and internal/queries.ts owns the real Group type.
export const groupOf = (subscription: object): unknown | undefined =>
  // SAFETY: the component kernel only stores the group under this key for keyed queries; reading it back yields unknown exactly as declared.
  (subscription as { readonly [groupKey]?: unknown })[groupKey];

/** @internal */
export const isWatchKey = (key: string): boolean => key.startsWith("~query/");

// -----------------------------------------------------------------------------
// The cache
// -----------------------------------------------------------------------------

/** @internal */
export const CacheTypeId = "~@effect/ui/Query/Cache";

/** @internal */
export const CacheCellTypeId = "~@effect/ui/Query/CacheCell";

/**
 * Stands in for a root's cache as the `Cache` service while `Query` isn't
 * loaded: `Query.internals` makes the cache from it.
 *
 * @internal
 */
export interface CacheCell {
  readonly [CacheTypeId]: typeof CacheTypeId;
  readonly [CacheCellTypeId]: () => Cache;
}

/**
 * The key of `Query.Cache`, to provide the service without importing `Query`.
 *
 * @internal
 */
export const CacheKey: Context.Key<Query.Cache, Query.Cache["Service"]> =
  Context.Service<Query.Cache, Query.Cache["Service"]>(
    "@effect/ui/Query/Cache"
  );

// -----------------------------------------------------------------------------
// Host signals
// -----------------------------------------------------------------------------

interface SettableSignal extends Query.Signal {
  readonly set: (value: boolean) => void;
}

/** Adds a listener to a set. Returns its removal. */
export const addListener = <A>(
  listeners: Set<A>,
  listener: A
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * A settable signal, for tests and for host Layers.
 *
 * @internal
 */
export const makeSignal = (initial = true): SettableSignal => {
  let current = initial;
  const listeners = new Set<(value: boolean) => void>();
  return {
    get: () => current,
    set: (value) => {
      if (value === current) {
        return;
      }
      current = value;
      // oxlint-disable-next-line unicorn/no-useless-spread -- a listener may unsubscribe while notified; iterate over a snapshot.
      for (const listener of [...listeners]) {
        listener(value);
      }
    },
    subscribe: (listener) => addListener(listeners, listener),
  };
};

const alwaysTrue: Query.Signal = {
  get: () => true,
  subscribe: () => () => {
    /* the always-true signal never notifies */
  },
};

/** @internal */
export const Visibility: Context.Reference<Query.Signal> =
  Context.Reference<Query.Signal>("@effect/ui/Query/Visibility", {
    defaultValue: () => alwaysTrue,
  });

/** @internal */
export const Connectivity: Context.Reference<Query.Signal> =
  Context.Reference<Query.Signal>("@effect/ui/Query/Connectivity", {
    defaultValue: () => alwaysTrue,
  });

/** @internal */
export const Problems: Context.Reference<(problem: Query.Problem.Any) => void> =
  Context.Reference<(problem: Query.Problem.Any) => void>(
    "@effect/ui/Query/Problems",
    {
      // oxlint-disable-next-line no-console
      defaultValue: () => (problem) => console.warn(problem.message),
    }
  );

/** @internal */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- problems are query-defined payloads handed to the Problems handler; the handler types its own input.
export const report = (ctx: Context.Context<never>, problem: unknown): void => {
  try {
    // SAFETY: Problems handlers accept any problem payload by contract; never only widens the call to that contract.
    Context.get(ctx, Problems)(problem as never);
  } catch {
    /* Problems reporting must never throw. */
  }
};

// -----------------------------------------------------------------------------
// Keys
// -----------------------------------------------------------------------------

/**
 * The entry key format and its non-JSON leaf marker. Shared with the
 * snapshot wire format: defined in `./wire-ast.ts` (owned by the MessageLog
 * slice with the redaction helpers) and re-exported here so `query.ts`
 * keeps reaching them as `queryCore.canonical` / `queryCore.NonJsonLeaf`.
 *
 * @internal
 */
export { canonical, NonJsonLeaf } from "./wire-ast.ts";
