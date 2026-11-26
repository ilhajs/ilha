import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Schema from "effect/Schema";
import type { AtomHandle } from "ilha";

import type * as Command from "../command.ts";
import type * as Query from "../query.ts";
import type { QueryDef } from "../query.ts";
import type { InstanceRecord } from "./kernel.ts";
import type * as Kernel from "./kernel.ts";
import { bind } from "./queries.ts";
import type {
  Bound,
  Entry,
  Group,
  KeyedChange,
  Marker,
  Results,
} from "./queries.ts";
import * as queryCore from "./query-core.ts";
import { keyOf } from "./subscriptions.ts";

// Set once by the kernel module, which owns dispatch, seeds and holds.
let dispatchQueryMessage: typeof Kernel.dispatchQueryMessage = () => {
  throw new Error(
    "query-run used before the kernel bound dispatchQueryMessage"
  );
};
let failQuery: typeof Kernel.failQuery = () => {
  throw new Error("query-run used before the kernel bound failQuery");
};
let holdRender: typeof Kernel.holdRender = () => {
  throw new Error("query-run used before the kernel bound holdRender");
};
let pushSeed: typeof Kernel.pushSeed = () => {
  throw new Error("query-run used before the kernel bound pushSeed");
};
let recordFetchStarted: typeof Kernel.recordFetchStarted = () => {
  throw new Error("query-run used before the kernel bound recordFetchStarted");
};
// oxlint-disable-next-line no-useless-undefined -- mirrors Kernel.recordQueryChanged's void-returning hook type.
let recordQueryChanged: typeof Kernel.recordQueryChanged = () => undefined;
let refreshForQuery: typeof Kernel.refreshForQuery = () => {
  throw new Error("query-run used before the kernel bound refreshForQuery");
};
let releaseRender: typeof Kernel.releaseRender = () => {
  throw new Error("query-run used before the kernel bound releaseRender");
};
let resolveEnv: typeof Kernel.resolveEnv = () => {
  throw new Error("query-run used before the kernel bound resolveEnv");
};
let slotFreeHandle: typeof Kernel.slotFreeHandle = () => {
  throw new Error("query-run used before the kernel bound slotFreeHandle");
};
let takeSeed: typeof Kernel.takeSeed = () => ({
  found: false as const,
  value: undefined,
});

/**
 * Give query runs the kernel's dispatch, seeds and holds. Called once by
 * the kernel module.
 *
 * @internal
 */
export const bindQueryRunKernel = (hooks: {
  readonly dispatchQueryMessage: typeof Kernel.dispatchQueryMessage;
  readonly failQuery: typeof Kernel.failQuery;
  readonly holdRender: typeof Kernel.holdRender;
  readonly pushSeed: typeof Kernel.pushSeed;
  readonly recordFetchStarted: typeof Kernel.recordFetchStarted;
  readonly recordQueryChanged: typeof Kernel.recordQueryChanged;
  readonly refreshForQuery: typeof Kernel.refreshForQuery;
  readonly releaseRender: typeof Kernel.releaseRender;
  readonly resolveEnv: typeof Kernel.resolveEnv;
  readonly slotFreeHandle: typeof Kernel.slotFreeHandle;
  readonly takeSeed: typeof Kernel.takeSeed;
}): void => {
  ({
    dispatchQueryMessage,
    failQuery,
    holdRender,
    pushSeed,
    recordFetchStarted,
    recordQueryChanged,
    refreshForQuery,
    releaseRender,
    resolveEnv,
    slotFreeHandle,
    takeSeed,
  } = hooks);
};

type Cache = queryCore.Cache;
type Handle = ReturnType<Cache["watch"]>;
// oxlint-disable-next-line no-explicit-any -- mirrors AsyncResult's any-typed success/failure payloads used by query-core.
type Settled = AsyncResult.Success<any, any> | AsyncResult.Failure<any, any>;

interface Watch {
  marker: Marker;
  readonly logKey: string;
  handle: Handle | undefined;
  released: boolean;
  held: boolean;
  debounce: ReturnType<typeof setTimeout> | undefined;
}

interface KeyedRun {
  group: Group;
  readonly logKey: string;
  readonly values: Map<
    string,
    {
      readonly args: unknown;
      readonly result: Settled;
      readonly patched: boolean;
    }
  >;
  readonly changes: Set<string>;
}

interface QueryState {
  readonly bound: Bound;
  results: Results;
  readonly resultsAtom: AtomHandle<Results>;
  readonly watches: Map<string, Watch>;
  readonly keyed: Map<string, KeyedRun>;
  readonly loads: Set<() => void>;
  queued: boolean;
  synced: boolean;
  mounting: boolean;
}

interface Root {
  readonly cache: Cache;
  /** The cache's own teardown, from `buildCache`. */
  readonly disposeCache: Effect.Effect<void>;
  readonly disposeSignals: () => void;
  windowScheduled: boolean;
}
const roots = new WeakMap<object, Root>();
const states = new WeakMap<InstanceRecord, QueryState>();

// oxlint-disable-next-line no-non-null-assertion -- queryCore.loaded is set by registerComponentBinding before any run.
const loaded = (): NonNullable<typeof queryCore.loaded> => queryCore.loaded!;

const boundOf = (rec: InstanceRecord): Bound | undefined => {
  // SAFETY: InstanceRecord carries its definition opaquely; query-core reads ~queries when bound.
  const unknownDefinition: unknown = rec.definition;
  // SAFETY: query-core checks for the ~queries record and returns undefined when absent.
  const queryDefinition = unknownDefinition as { readonly "~queries": unknown };
  // SAFETY: bound is undefined exactly when the definition carries no ~queries record.
  return queryCore.boundOf(queryDefinition) as Bound | undefined;
};

// -----------------------------------------------------------------------------
// The island cache and the host signals' browser layer
// -----------------------------------------------------------------------------

interface BrowserSignals {
  readonly visibility: Query.Signal;
  readonly connectivity: Query.Signal;
  readonly dispose: () => void;
}

const liveSignal = (
  get: () => boolean,
  target: Document | Window,
  events: readonly string[]
): Query.Signal & { readonly dispose: () => void } => {
  const listeners = new Set<(value: boolean) => void>();
  const onEvent = (): void => {
    const value = get();
    // oxlint-disable-next-line no-useless-spread -- snapshot the set; listeners may unsubscribe while notifying.
    for (const listener of [...listeners]) {
      listener(value);
    }
  };
  // oxlint-disable-next-line eslint(curly) -- single-statement add/remove symmetry.
  for (const event of events) {
    target.addEventListener(event, onEvent);
  }
  return {
    dispose: () => {
      // oxlint-disable-next-line eslint(curly) -- single-statement add/remove symmetry.
      for (const event of events) {
        target.removeEventListener(event, onEvent);
      }
    },
    get,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
/**
 * The browser layer for the cache's host signals: visibility follows
 * `document.visibilityState`, connectivity follows `online`/`offline`.
 * Without a document (the server, DOM-free tests) both signals are
 * always true and disposing is a no-op.
 *
 * @internal
 */
export const browserSignals = (): BrowserSignals => {
  // SAFETY: globalThis.document is only read; undefined on the server selects the always-true signals.
  const doc = (globalThis as { readonly document?: Document | undefined })
    .document;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- document without addEventListener is a DOM stub; fall back to always-true signals.
  if (doc === undefined || typeof doc.addEventListener !== "function") {
    const always: Query.Signal = {
      get: () => true,
      // The server and DOM-free tests have no listeners to notify.
      subscribe: () => () => {
        // No document means no events; the unsubscribe handle is a no-op.
      },
    };
    return {
      connectivity: always,
      dispose: () => {
        // Nothing to tear down without a document.
      },
      visibility: always,
    };
  }
  const visibility = liveSignal(() => doc.visibilityState === "visible", doc, [
    "visibilitychange",
  ]);
  // SAFETY: globalThis is the Window event target for online/offline in the browser.
  const unknownTarget: unknown = globalThis;
  // SAFETY: the unknown global exposes the Window event-target surface in the browser.
  const eventTarget = unknownTarget as Window;
  const connectivity = liveSignal(
    // SAFETY: navigator.onLine is an optional boolean; missing navigator means online.
    () => (globalThis.navigator as Navigator | undefined)?.onLine ?? true,
    eventTarget,
    ["online", "offline"]
  );
  return {
    connectivity,
    dispose: () => {
      visibility.dispose();
      connectivity.dispose();
    },
    visibility,
  };
};

const rootOf = (rec: InstanceRecord): Root => {
  let root = roots.get(rec.kernel);
  if (root === undefined) {
    const signals = browserSignals();
    const baseOptions = {
      connectivity: signals.connectivity,
      report: (problem: Query.Problem.Any) => {
        rec.kernel.problems.push(problem);
      },
      visibility: signals.visibility,
    };
    const ssrOptions = { settleOnce: true };
    const built = rec.fiber.runtime.ssr
      ? loaded().buildCache(Context.empty(), { ...baseOptions, ...ssrOptions })
      : loaded().buildCache(Context.empty(), baseOptions);
    const { cache } = built;
    cache.onFetch((event) => {
      recordFetchStarted(rec.kernel, event);
    });
    root = {
      cache,
      disposeCache: built.dispose,
      disposeSignals: signals.dispose,
      windowScheduled: false,
    };
    roots.set(rec.kernel, root);
  }
  return root;
};

/**
 * Dispose an island's query cache and browser signals. Runs when the island
 * tears down (unmount, server render end).
 *
 * @internal
 */
export const disposeIsland = (
  // oxlint-disable-next-line anti-slop/no-object-parameters -- islands are keyed by kernel object identity in the roots WeakMap.
  kernel: object
): void => {
  const root = roots.get(kernel);
  if (root === undefined) {
    return;
  }
  roots.delete(kernel);
  try {
    root.disposeSignals();
  } catch {
    // Signal disposal must not break unmount.
  }
  Effect.runFork(root.disposeCache);
};

// -----------------------------------------------------------------------------
// Lifecycle: mount and sync
// -----------------------------------------------------------------------------

// oxlint-disable-next-line no-explicit-any -- fetchers take query-defined args; query-core invokes them with decoded values.
type Fetcher = (args: any) => any;

const fetcherOf = (
  ctx: Context.Context<never>,
  query: Query.Query.Any
): Fetcher | undefined => {
  // SAFETY: the context carries the query's fetcher under its own key; getOrUndefined returns undefined when absent.
  const found = Context.getOrUndefined(ctx, query as never);
  // SAFETY: a present entry is the query's fetcher; undefined stays undefined.
  return found as Fetcher | undefined;
};

const endHold = (rec: InstanceRecord, watch: Watch): void => {
  if (!watch.held) {
    return;
  }
  watch.held = false;
  releaseRender(rec);
};

const releaseWatch = (
  rec: InstanceRecord,
  watch: Watch,
  abandon = false
): void => {
  if (watch.released) {
    return;
  }
  watch.released = true;
  if (watch.debounce !== undefined) {
    clearTimeout(watch.debounce);
    watch.debounce = undefined;
  }
  endHold(rec, watch);
  watch.handle?.unregister(abandon);
};

const releaseAll = (rec: InstanceRecord, state: QueryState): void => {
  for (const watch of state.watches.values()) {
    releaseWatch(rec, watch);
  }
  state.watches.clear();
  state.keyed.clear();
  for (const cancel of state.loads) {
    cancel();
  }
  state.loads.clear();
};

const writeResult = (
  rec: InstanceRecord,
  state: QueryState,
  entry: Entry,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- results are query-defined; each query's Schema decodes them.
  result: unknown,
  changes: readonly KeyedChange[],
  key: string
): void => {
  if (rec.status !== "live" || rec.fiber.closed) {
    return;
  }
  const { bound } = state;
  if (Equal.equals(state.results[entry.name], result)) {
    return;
  }
  state.results = { ...state.results, [entry.name]: result };
  state.resultsAtom.set(state.results);
  const seq = recordQueryChanged(rec, entry.name, result);
  if (state.mounting) {
    return;
  }
  refreshForQuery(rec);
  if (
    entry.onChange === undefined ||
    rec.status !== "live" ||
    rec.fiber.closed
  ) {
    return;
  }
  let message: { readonly value: unknown } | undefined;
  try {
    message = bound
      .context(rec.model(), rec.props, state.results)
      .changed(entry.name, changes);
  } catch (error) {
    failQuery(rec, error, key);
    return;
  }
  if (message !== undefined) {
    dispatchQueryMessage(rec, entry.name, message.value, seq);
  }
};

const failWith = (rec: InstanceRecord, cause: unknown, key?: string): void =>
  failQuery(rec, cause, key);

const deliverKeyed = (
  rec: InstanceRecord,
  state: QueryState,
  run: KeyedRun
): boolean => {
  const { group } = run;
  const declared = new Set(group.entries.map((entry) => entry.argsKey));
  const changes = group.entries.flatMap((entry) => {
    const value = run.changes.has(entry.argsKey)
      ? run.values.get(entry.argsKey)
      : undefined;
    return value === undefined
      ? []
      : [{ args: value.args, result: value.result }];
  });
  const held = loaded().snapshotMapData(state.results?.[group.name]);
  let prune = false;
  for (const key of held?.entries.keys() ?? []) {
    if (!declared.has(key)) {
      prune = true;
      break;
    }
  }
  run.changes.clear();
  if (!prune && changes.length === 0) {
    return false;
  }
  const { bound } = state;
  // oxlint-disable-next-line no-non-null-assertion -- group runs are created for declared groups; byName holds every declared group.
  const entry = bound.byName.get(group.name)!;
  const snapshot = bound.snapshotMany(
    entry,
    group.entries.flatMap((at) => {
      const value = run.values.get(at.argsKey);
      return value === undefined
        ? []
        : // oxlint-disable-next-line no-useless-undefined -- snapshot's explicit undefined selects the unpatched read path.
          [bound.snapshot(entry, at, value.result, value.patched, undefined)];
    })
  );
  writeResult(rec, state, entry, snapshot, changes, run.logKey);
  return true;
};

const drainKeyed = (rec: InstanceRecord, state: QueryState): void => {
  let sent = true;
  while (sent) {
    sent = false;
    for (const run of state.keyed.values()) {
      if (rec.status !== "live" || rec.fiber.closed) {
        return;
      }
      if (deliverKeyed(rec, state, run)) {
        sent = true;
      }
    }
  }
};
const requestKeyed = (rec: InstanceRecord, state: QueryState): void => {
  if (state.queued) {
    return;
  }
  state.queued = true;
  queueMicrotask(() => {
    state.queued = false;
    if (rec.status !== "live" || rec.fiber.closed) {
      return;
    }
    drainKeyed(rec, state);
  });
};

const wouldFetch = (
  rec: InstanceRecord,
  def: QueryDef,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- args are query-defined; the query's argsKey decodes them.
  args: unknown
): boolean => {
  const info = rootOf(rec).cache.inspect(def, args);
  return (
    info === undefined ||
    (info.watchers === 0 && info.fetch === "none" && info.stale)
  );
};

const isGroup = (desc: Marker | Group): desc is Group =>
  "entries" in desc && desc.entries !== undefined;

const watchKey = (marker: Marker): string =>
  marker.argsKey === undefined
    ? keyOf(`~query/${marker.name}`)
    : keyOf(`~query/${marker.name}`, marker.argsKey);

const pruneStaleWatches = (
  rec: InstanceRecord,
  state: QueryState,
  markers: Map<string, Marker>
): void => {
  for (const [key, running] of state.watches) {
    if (markers.has(key)) {
      continue;
    }
    state.watches.delete(key);
    releaseWatch(rec, running, running.marker.debounce !== undefined);
    if (running.marker.keyed) {
      const keyed = state.keyed.get(running.marker.name);
      const { argsKey } = running.marker;
      if (keyed !== undefined && argsKey !== undefined) {
        keyed.values.delete(argsKey);
        keyed.changes.delete(argsKey);
      }
    }
  }
};

const finishSync = (
  rec: InstanceRecord,
  state: QueryState,
  folds: (() => void)[]
): void => {
  for (const fold of folds) {
    if (rec.status !== "live" || rec.fiber.closed) {
      return;
    }
    fold();
  }
  if (!state.mounting) {
    state.synced = true;
  }
  if (state.keyed.size > 0 && !state.mounting) {
    drainKeyed(rec, state);
  }
};

const syncWatches = (rec: InstanceRecord, state: QueryState): void => {
  const { bound } = state;
  // Subscribe the fiber to the results, so a settled fetch re-renders even
  // when the view only reads the Model. Reads during the server render
  // subscribe nothing; the server repaints by hand in `writeResult`.
  state.resultsAtom();
  let declared: readonly (Marker | Group)[];
  try {
    declared = bound.context(rec.model(), rec.props, state.results).watches();
  } catch (error) {
    failWith(rec, error);
    return;
  }
  const markers = new Map<string, Marker>();
  for (const subscription of declared) {
    if (isGroup(subscription)) {
      const group = subscription;
      const run = state.keyed.get(group.name);
      if (run === undefined) {
        state.keyed.set(group.name, {
          changes: new Set(),
          group,
          logKey: keyOf(`~query/${group.name}`),
          values: new Map(),
        });
      } else {
        run.group = group;
      }
      continue;
    }
    if (!markers.has(watchKey(subscription))) {
      markers.set(watchKey(subscription), subscription);
    }
  }
  pruneStaleWatches(rec, state, markers);
  const folds: (() => void)[] = [];
  for (const [key, marker] of markers) {
    const existing = state.watches.get(key);
    if (existing !== undefined) {
      existing.marker = marker;
      continue;
    }
    const def = loaded().defOf(marker.query);
    const watch: Watch = {
      debounce: undefined,
      handle: undefined,
      held: false,
      logKey:
        marker.argsKey === undefined
          ? key
          : keyOf(
              `~query/${marker.name}`,
              def.logKey(marker.args, marker.argsKey)
            ),
      marker,
      released: false,
    };
    state.watches.set(key, watch);
    if (marker.argsKey === undefined) {
      continue;
    }
    holdRender(rec);
    watch.held = true;
    const at = { args: marker.args, argsKey: marker.argsKey };
    let last:
      | {
          readonly result: Settled;
          readonly patched: boolean;
          readonly more: unknown;
        }
      | undefined;
    const send = (
      result: Settled,
      resultPatched: boolean,
      // oxlint-disable-next-line no-explicit-any -- More carries the query's next-page cursor; opened views decode it.
      more: Query.More<any> | undefined
    ): void => {
      if (watch.released || rec.status !== "live" || rec.fiber.closed) {
        return;
      }
      // SAFETY: sameMore compares opaque per-query cursors; never narrows them.
      if (
        last !== undefined &&
        last.patched === resultPatched &&
        loaded().sameMore(last.more as never, more) &&
        Equal.equals(last.result, result)
      ) {
        return;
      }
      last = { more, patched: resultPatched, result };
      endHold(rec, watch);
      if (marker.keyed) {
        // oxlint-disable-next-line no-non-null-assertion -- keyed runs are created for every declared keyed marker before watches sync.
        const run = state.keyed.get(marker.name)!;
        run.values.set(at.argsKey, {
          args: at.args,
          patched: resultPatched,
          result,
        });
        run.changes.add(at.argsKey);
        requestKeyed(rec, state);
        return;
      }
      // oxlint-disable-next-line no-non-null-assertion -- byName holds every marker the watches pass over; markers come from bound.context.
      const entry = bound.byName.get(marker.name)!;
      writeResult(
        rec,
        state,
        entry,
        bound.snapshot(entry, at, result, resultPatched, more),
        [],
        watch.logKey
      );
    };
    // oxlint-disable-next-line no-loop-func -- go closes over per-iteration marker state and runs once per watch; folds capture the settled handle per iteration.
    const go = (): void => {
      if (rec.status !== "live" || rec.fiber.closed || watch.released) {
        return;
      }
      const fetcher = fetcherOf(resolveEnv(rec), marker.query);
      if (fetcher === undefined) {
        endHold(rec, watch);
        failWith(
          rec,
          new Error(
            `${rec.path}: nothing provides the query ${JSON.stringify(
              def.name
            )}`
          ),
          watch.logKey
        );
        return;
      }
      const { cache } = rootOf(rec);
      // SAFETY: the cache stores fetchers opaquely under the query key; watch invokes them with decoded args.
      const handle = cache.watch(
        def,
        marker.args,
        fetcher as never,
        send,
        (cause) => {
          if (!watch.released) {
            failWith(rec, cause, watch.logKey);
          }
        },
        { patched: true }
      );
      watch.handle = handle;
      folds.push(() => {
        if (watch.released || rec.status !== "live" || rec.fiber.closed) {
          return;
        }
        const current = handle.patchedView();
        if (current.result._tag !== "Initial") {
          // SAFETY: patchedView holds settled snapshots; the Initial branch above selects settled results.
          send(current.result as Settled, current.patched, handle.more());
        }
      });
    };
    if (
      marker.debounce === undefined ||
      !state.synced ||
      rec.fiber.runtime.ssr ||
      // SAFETY: def is the marker's own query definition; wouldFetch only inspects its cache state.
      !wouldFetch(rec, def as never, marker.args)
    ) {
      go();
    } else {
      const delay = marker.debounce;
      watch.debounce = setTimeout(() => {
        watch.debounce = undefined;
        if (watch.released || rec.status !== "live" || rec.fiber.closed) {
          endHold(rec, watch);
          return;
        }
        go();
      }, delay);
    }
  }
  finishSync(rec, state, folds);
};

// -----------------------------------------------------------------------------
// Mount: results atoms, hydration, first sync
// -----------------------------------------------------------------------------

/** The fetch-free window closes on the next microtask, once the mount pass adopted the hydrated entries. */
const scheduleWindowClose = (root: Root): void => {
  if (root.windowScheduled) {
    return;
  }
  root.windowScheduled = true;
  queueMicrotask(() => {
    root.cache.closeWindow();
  });
};

/** A settled snapshot as a `~query` raw tuple, or `undefined` when it ships nothing (empty, patched, unencodable). */
const rawTupleOf = (
  entry: Entry,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- snapshots are query-defined; snapshotData decodes them.
  snapshot: unknown
): unknown[] | undefined => {
  const data = loaded().snapshotData(snapshot);
  if (
    data?.result === undefined ||
    data.argsKey === undefined ||
    data.patched
  ) {
    return undefined;
  }
  const def = loaded().defOf(entry.query);
  try {
    const codec = def.codec();
    if (data.result._tag === "Success") {
      return [
        data.argsKey,
        0,
        codec.encodeSuccess(data.result.value),
        data.result.timestamp,
      ];
    }
    const previous = data.result.previousSuccess;
    return [
      data.argsKey,
      1,
      data.result.cause.reasons
        .filter(Cause.isFailReason)
        .map((reason) => codec.encodeError(reason.error)),
      Option.isSome(previous) ? previous.value.timestamp : Date.now(),
    ];
  } catch {
    return undefined;
  }
};
/** Feeds one record's settled snapshots into the cache as hydrated entries. */
const hydrateFromSnapshots = (
  _rec: InstanceRecord,
  root: Root,
  bound: Bound,
  results: Results
): void => {
  const payload: Record<string, unknown[]> = {};
  for (const entry of bound.entries) {
    const value = results[entry.name];
    const snapshots: unknown[] = entry.keyed
      ? [...(loaded().snapshotMapData(value)?.entries.values() ?? [])]
      : [value];
    for (const snapshot of snapshots) {
      const tuple = rawTupleOf(entry, snapshot);
      if (tuple === undefined) {
        continue;
      }
      (payload[loaded().defOf(entry.query).name] ??= []).push(tuple);
    }
  }
  if (Object.keys(payload).length === 0) {
    return;
  }
  root.cache.hydrate(payload);
  scheduleWindowClose(root);
};

/** @internal */
export const mounted = (rec: InstanceRecord): void => {
  const bound = boundOf(rec);
  if (bound === undefined) {
    return;
  }
  if (queryCore.loaded === undefined) {
    return;
  }
  const { ssr } = rec.fiber.runtime;
  const hydrating = !ssr && rec.fiber.runtime.hydrateValues !== undefined;
  // SAFETY: bound.schema is the component's results Schema; toCodecJson preserves its codec contract.
  const unknownSchema: unknown = bound.schema;
  // SAFETY: the unknown schema value is the component's own results Schema.
  const resultsCodec = Schema.toCodecJson(
    unknownSchema as Schema.Codec<unknown, unknown>
  );
  // SAFETY: the JSON codec over unknown results satisfies the seed persistence contract for this island.
  const unknownCodec: unknown = resultsCodec;
  // SAFETY: seeds carry encoded Results; takeSeed and pushSeed read them through this codec.
  const codec = unknownCodec as Schema.ConstraintCodec<Results, unknown>;
  let results: Results = bound.empty;
  if (ssr) {
    if (bound.redacted.length === 0) {
      // SAFETY: with no redacted queries the empty results encode without secrets.
      pushSeed(
        rec,
        bound.empty,
        codec as Schema.ConstraintCodec<unknown, unknown>
      );
    }
  } else if (hydrating && bound.redacted.length === 0) {
    // SAFETY: with no redacted queries the seed decodes to plain results.
    const seed = takeSeed(
      rec,
      codec as Schema.ConstraintCodec<unknown, unknown>
    );
    if (seed.found) {
      // SAFETY: a found seed holds encoded Results for this component's Schema.
      results = seed.value as Results;
    }
  }
  const resultsState = Atom.make(results);
  if (!ssr) {
    rec.atomReleases.push(rec.kernel.registry.mount(resultsState));
  }
  const resultsAtom = slotFreeHandle(rec, resultsState);
  const state: QueryState = {
    bound,
    keyed: new Map(),
    loads: new Set(),
    mounting: true,
    queued: false,
    results,
    resultsAtom,
    synced: false,
    watches: new Map(),
  };
  states.set(rec, state);
  rec.extensions.set("queries", state);
  rec.onClose.push(() => {
    releaseAll(rec, state);
  });
  // One cache per island, visible through the record's env under the
  // `Query.Cache` key, so `Query.get` in Command bodies resolves it.
  const { cache } = rootOf(rec);
  rec.env = Context.merge(
    // SAFETY: the island cache implements the Query.Cache service contract.
    Context.make(queryCore.CacheKey, cache as never),
    rec.env
  );
  if (hydrating) {
    hydrateFromSnapshots(rec, rootOf(rec), bound, state.results);
  }
  try {
    syncWatches(rec, state);
  } finally {
    state.mounting = false;
  }
  if (state.keyed.size > 0) {
    drainKeyed(rec, state);
  }
};

/** @internal */
export const synced = (rec: InstanceRecord): void => {
  const state = states.get(rec);
  if (state === undefined) {
    return;
  }
  if (rec.status !== "live" || rec.fiber.closed) {
    return;
  }
  syncWatches(rec, state);
};

// -----------------------------------------------------------------------------
// Update integration: `$.queries`, `$.loadMore`, `$.reset`
// -----------------------------------------------------------------------------

/** @internal */
export const queriesForUpdate = (
  rec: InstanceRecord
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- queries are query-defined; the view decodes them per query.
): unknown => {
  const state = states.get(rec);
  if (state === undefined) {
    return undefined;
  }
  return state.bound.context(rec.model(), rec.props, state.results).queries;
};

/** @internal */
export const logResults = (
  rec: InstanceRecord
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- results are keyed by query name; each snapshot is decoded by its query.
): Record<string, unknown> | undefined => {
  const state = states.get(rec);
  return state === undefined ? undefined : { ...state.results };
};

interface QueryView {
  readonly queries: unknown;
  readonly previous: unknown;
  readonly patched: unknown;
}

/** @internal */
export const viewOf = (rec: InstanceRecord): QueryView | undefined => {
  const state = states.get(rec);
  if (state === undefined) {
    return undefined;
  }
  const context = state.bound.context(rec.model(), rec.props, state.results);
  return {
    patched: context.patched,
    previous: context.previous,
    queries: context.queries,
  };
};

/** @internal */
const issueList = (
  rec: InstanceRecord,
  state: QueryState,
  list: { readonly name: string; readonly op: "loadMore" | "reset" }
): void => {
  if (rec.status !== "live" || rec.fiber.closed) {
    return;
  }
  const { bound } = state;
  const field = bound.byName.get(list.name);
  if (field === undefined || !field.list) {
    return;
  }
  let args: unknown;
  try {
    ({ args } = bound
      .context(rec.model(), rec.props, state.results)
      .argsOf(field.name));
  } catch (error) {
    failWith(rec, error);
    return;
  }
  if (args === undefined) {
    return;
  }
  if (rec.fiber.runtime.ssr) {
    rec.kernel.problems.push({
      _tag: "ServerCommandIssued",
      command: `$.${list.op}(${list.name})`,
      message: `[@ilha/model] ${rec.path}'s $.${list.op}(${JSON.stringify(list.name)}) was issued during the server render and dropped`,
      path: rec.path,
    });
    return;
  }
  const def = loaded().defOf(field.query);
  const { cache } = rootOf(rec);
  if (list.op === "reset") {
    cache.reset(def, args);
    return;
  }
  const fetcher = fetcherOf(resolveEnv(rec), field.query);
  if (fetcher === undefined) {
    return;
  }
  let done = false;
  // oxlint-disable-next-line prefer-const -- let keeps the handle undefined if loadMore settles synchronously before assignment.
  let cancel: (() => void) | undefined;
  // SAFETY: loadMore stores the fetcher under the query args; the callback clears the tracked handle on settle.
  cancel = cache.loadMore(def, args, fetcher as never, () => {
    done = true;
    if (cancel !== undefined) {
      state.loads.delete(cancel);
    }
  });
  if (!done && cancel !== undefined) {
    state.loads.add(cancel);
  }
};

/** @internal */
export const applyLists = (
  rec: InstanceRecord,
  lists: readonly { readonly name: string; readonly op: "loadMore" | "reset" }[]
): void => {
  const state = states.get(rec);
  if (state === undefined) {
    return;
  }
  for (const list of lists) {
    issueList(rec, state, list);
  }
};

// -----------------------------------------------------------------------------
// Command integration: run handles through the cache
// -----------------------------------------------------------------------------

/** Whether the Command carries query declarations the cache must apply. */
const declaresQueries = (command: Command.Issued<unknown, never>): boolean =>
  "serviceTag" in command && command.serviceTag !== undefined;

/** @internal */
export const beginRun = (
  rec: InstanceRecord,
  command: Command.Issued<unknown, never>
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the run token is opaque; lifecycle helpers narrow it before use.
): unknown => {
  if (queryCore.loaded === undefined || !declaresQueries(command)) {
    return undefined;
  }
  // SAFETY: declaresQueries verified the serviceTag; the kernel sets name when it issues the command.
  const name = ("name" in command ? command.name : undefined) as string;
  // SAFETY: declaresQueries verified the serviceTag; the kernel sets invalidates when it issues the command.
  const invalidates = (
    "invalidates" in command ? command.invalidates : undefined
  ) as readonly Query.Target[] | undefined;
  // SAFETY: declaresQueries verified the serviceTag; the kernel sets optimistic when it issues the command.
  const optimistic = (
    "optimistic" in command ? command.optimistic : undefined
  ) as readonly Query.Patch[] | undefined;
  const afterRefetch =
    "afterRefetch" in command ? command.afterRefetch : undefined;
  return rootOf(rec).cache.beginRun({
    afterRefetch:
      (command._tag === "Effect" && afterRefetch !== undefined) || undefined,
    command: name,
    invalidates: invalidates ?? [],
    optimistic: optimistic ?? [],
  });
};

/** @internal */
export const startRun = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are opaque; beginRun creates them and lifecycle helpers narrow them.
  token: unknown
): void => {
  // SAFETY: beginRun created this token with start; undefined means no query declarations.
  const starter = token as { readonly start?: () => void } | undefined;
  starter?.start?.();
};

/** @internal */
export const cancelRun = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are opaque; beginRun creates them and lifecycle helpers narrow them.
  token: unknown
): void => {
  // SAFETY: beginRun created this token with finish; undefined means no query declarations.
  const canceller = token as
    | { readonly finish?: (exit: { readonly _tag: "Stopped" }) => void }
    | undefined;
  canceller?.finish?.({ _tag: "Stopped" });
};

/** @internal */
export const runBody = <A, E, R>(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are opaque; beginRun creates them and lifecycle helpers narrow them.
  token: unknown,
  body: Effect.Effect<A, E, R>,
  writes: ((success: A) => readonly Query.Write[]) | undefined
): Effect.Effect<A, E, R> => {
  if (token === undefined) {
    return body;
  }
  // SAFETY: beginRun created this token with run; defined means query declarations exist.
  const runner = token as {
    readonly run: (
      body: Effect.Effect<A, E, R>,
      writes: ((success: A) => readonly Query.Write[]) | undefined
    ) => Effect.Effect<A, E, R>;
  };
  return runner.run(body, writes);
};

/** @internal */
export const awaited = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are opaque; beginRun creates them and lifecycle helpers narrow them.
  token: unknown
): readonly Query.AwaitedEntry[] | undefined => {
  if (token === undefined) {
    return undefined;
  }
  // SAFETY: beginRun created this token as a RunHandle; defined means query declarations exist.
  const handle = token as Query.RunHandle;
  return handle.awaited();
};

/** @internal */
export const outstanding = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are opaque; beginRun creates them and lifecycle helpers narrow them.
  token: unknown
): readonly Query.AwaitedEntry[] => {
  if (token === undefined) {
    return [];
  }
  // SAFETY: beginRun created this token as a RunHandle; defined means query declarations exist.
  const handle = token as Query.RunHandle;
  return handle.outstanding();
};

/** @internal */
export const onRefetched = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are opaque; beginRun creates them and lifecycle helpers narrow them.
  token: unknown,
  f: () => void
): (() => void) => {
  if (token === undefined) {
    // No queries ran, so nothing can refetch; the unsubscribe handle is a no-op.
    return () => {
      // No-op handle; onRefetched without a run has nothing to unsubscribe.
    };
  }
  // SAFETY: beginRun created this token as a RunHandle; defined means query declarations exist.
  const handle = token as Query.RunHandle;
  return handle.onRefetched(f);
};

/** @internal */
export const sinceApplied = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run tokens are opaque; beginRun creates them and lifecycle helpers narrow them.
  token: unknown
): number => {
  if (token === undefined) {
    return 0;
  }
  // SAFETY: beginRun created this token as a RunHandle; defined means query declarations exist.
  const handle = token as Query.RunHandle;
  return handle.sinceApplied();
};

/**
 * Install the query runtime's component binding. Called explicitly by the
 * kernel at import so `sideEffects: false` stays safe; importing this module
 * alone registers nothing.
 *
 * @internal
 */
export const registerQueryRun = (): void => {
  queryCore.registerComponentBinding({
    bind,
    run: {
      applyLists,
      awaited,
      beginRun,
      cancelRun,
      logResults,
      mounted,
      onRefetched,
      outstanding,
      queriesForUpdate,
      runBody,
      sinceApplied,
      startRun,
      synced,
      viewOf,
    },
  });
};
