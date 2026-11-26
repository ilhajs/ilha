import * as Cause from "effect/Cause";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
/**
 * The pure query runtime behind Story and Scene query steps: `loaded`,
 * `loadFailed`, `loadedMany`, `loadedMore`, `loadMoreFailed`, `waitExpired`,
 * `keepPending(name)`, `given`'s `queries`, `queryInfo`, `loadingMore`,
 * `queries`/`results`, `fromLog`'s `QueryChanged`, the acknowledgement
 * checks, and `Command.afterRefetch` waits with `writes` and optimistic
 * patches. No cache, no Layers, no fetches: writes land synchronously and
 * `onChange` messages dispatch through `update` at once.
 *
 * Args evaluation mirrors the runtime's order: entries evaluate in
 * declaration order against a live results map pre-filled with `Initial`,
 * so an entry sees earlier entries' opened results. Args are re-evaluated
 * whenever the Model, props or results change; keyed entries drop keys the
 * query no longer returns, with no `onChange`.
 */
import * as AsyncResult from "effect/reactivity/AsyncResult";

import type * as Command from "../command.ts";
import type { ListIssue } from "../component.ts";
import { boundOf } from "../internal/queries.ts";
import type { Entry } from "../internal/queries.ts";
import { defOf } from "../query.ts";
import type * as Query from "../query.ts";
import type {
  Engine,
  EngineInternals,
  EngineState,
  PendingEntry,
} from "./engine.ts";
import type { Slices } from "./parts.ts";
import { registerTestExtension } from "./steps.ts";
import type { Given, KeyedLoad, QueryInfo, Target } from "./steps.ts";
import { describeTarget, matchesTarget } from "./targets.ts";

/**
 * What the query runtime reads: the engine state plus the module name for
 * errors. Both `Engine` and `EngineInternals` satisfy it, so the `h`
 * helper (which receives internals) shares the readers.
 */
export interface QueryHost {
  readonly state: Pick<EngineState, "component" | "props" | "model" | "slices">;
  readonly module: string;
}

/** Whether `value` is a string. */
const isString = <T>(value: T): value is T & string =>
  typeof value === "string";

/** Whether `value` is a function. */
const isFunction = <T>(
  value: T
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- guarded functions return query-defined values; callers narrow per query.
): value is T & ((...args: readonly never[]) => unknown) =>
  typeof value === "function";

/** Whether `value` is a non-null object. */
const isObject = <T>(value: T): value is T & object =>
  typeof value === "object" && value !== null;

/** The query type id every query class carries as `static [TypeId]`. */
const QUERY_TYPE_ID = "~@effect/ui/Query" as const;

/** A typed query failure as an `AsyncResult`. */
const failedResult = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- query failures carry untyped errors; Cause.fail preserves them.
  error: unknown
): AsyncResult.AsyncResult<unknown, unknown> =>
  AsyncResult.failure(Cause.fail(error));

/**
 * The `QueryDef` of a whole-query invalidation target, patch, write or
 * entry target, or `undefined` for anything else.
 */
const targetDef = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- invalidation targets are query classes, instances or plain values; narrowed below.
  query: unknown
): Query.QueryDef | undefined => {
  if (!isObject(query) && !isFunction(query)) {
    return undefined;
  }
  if (!(QUERY_TYPE_ID in query)) {
    return undefined;
  }
  const def: unknown = query[QUERY_TYPE_ID];
  if (!isObject(def)) {
    return undefined;
  }
  if (!("name" in def && "argsKey" in def)) {
    return undefined;
  }
  const { name, argsKey } = def;
  if (!isString(name) || !isFunction(argsKey)) {
    return undefined;
  }
  // SAFETY: the definition was built as a QueryDef by its query class; name and argsKey select it.
  return def as Query.QueryDef;
};

/** One stored result: the opened value plus its write flags. */
export interface StoredResult {
  readonly result: AsyncResult.AsyncResult<unknown, unknown>;
  readonly waiting: boolean;
  readonly patched: boolean;
  readonly more: Query.More<unknown> | undefined;
}

/** The query slice's engine state, under `slices["query"]`. */
export interface QueryState {
  /** Stored results by query name, then args key. */
  readonly entries: Map<string, Map<string, StoredResult>>;
  /** The args keys each query currently returns, by query name. */
  readonly currentKeys: Map<string, readonly string[]>;
  /** The decoded args per key, by query name then args key. */
  readonly argsByKey: Map<string, Map<string, unknown>>;
  /** Infinite queries with a load more pending, by query name. */
  readonly loadMore: Set<string>;
  /** Query names `keepPending` marked. */
  readonly kept: Set<string>;
  /** Live optimistic patches, by query name then args key. */
  readonly livePatches: Map<string, Set<string>>;
}

const freshState = (): QueryState => ({
  argsByKey: new Map(),
  currentKeys: new Map(),
  entries: new Map(),
  kept: new Set(),
  livePatches: new Map(),
  loadMore: new Set(),
});

/** The query state, creating it on first use. */
export const queryStateOf = (host: QueryHost): QueryState => {
  // SAFETY: the "query" slice entry is stored as QueryState below; absent entries are created here.
  const existing = host.state.slices["query"] as QueryState | undefined;
  if (existing !== undefined) {
    return existing;
  }
  const state = freshState();
  host.state.slices["query"] = state;
  return state;
};

/** The component's bound query entries, or `[]` without any. */
const boundEntries = (
  component: QueryHost["state"]["component"]
): readonly Entry[] => {
  // SAFETY: query-bearing test components carry "~queries"; boundOf returns undefined otherwise.
  const bound = boundOf(
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- AnyComponent erases the "~queries" marker; no single assertion bridges the gap.
    component.definition as unknown as { readonly "~queries": unknown }
  );
  return bound?.entries ?? [];
};

const storedAt = (
  qs: QueryState,
  name: string,
  argsKey: string
): StoredResult | undefined => qs.entries.get(name)?.get(argsKey);

const storeAt = (
  qs: QueryState,
  name: string,
  argsKey: string,
  stored: StoredResult
): void => {
  let byKey = qs.entries.get(name);
  if (byKey === undefined) {
    byKey = new Map();
    qs.entries.set(name, byKey);
  }
  byKey.set(argsKey, stored);
};

// oxlint-disable-next-line anti-slop/no-unknown-returns -- args lookups return query-defined args; def.argsKey decodes them.
const argsAt = (qs: QueryState, name: string, argsKey: string): unknown =>
  qs.argsByKey.get(name)?.get(argsKey);

/** The opened results of every query, as `$.queries` and `h.queries` see them. */
export const queryOpened = (host: QueryHost): Slices => {
  const bound = boundEntries(host.state.component);
  const out: Slices = {};
  for (const entry of bound) {
    // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
    out[entry.name] = entry.keyed ? withGet([]) : AsyncResult.initial(true);
  }
  for (const entry of bound) {
    if (entry.keyed) {
      // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
      const keys = currentKeyedKeys(host, entry);
      // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
      out[entry.name] = withGet(
        keys.map((key) => {
          const stored = storedAt(queryStateOf(host), entry.name, key.argsKey);
          return {
            args: key.args,
            patched: stored?.patched ?? false,
            result: stored?.result ?? AsyncResult.initial(true),
          };
        })
      );
    } else if (entry.list) {
      // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
      out[entry.name] = openInfinite(host, entry);
      // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
      const at = currentSingleKey(host, entry);
      const stored =
        at === undefined
          ? undefined
          : storedAt(queryStateOf(host), entry.name, at.argsKey);
      out[entry.name] = stored?.result ?? AsyncResult.initial(at !== undefined);
    }
  }
  return out;
};

const withGet = <A extends { readonly args: unknown }>(
  list: readonly A[]
): readonly A[] & {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- key args are arbitrary user values; Equal.equals compares them structurally.
  readonly get: (args: unknown) => Option.Option<A>;
} => {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- key args are arbitrary user values; compared with Equal.equals below.
  const get = (args: unknown): Option.Option<A> => {
    const found = list.find((item) => Equal.equals(item.args, args));
    return found === undefined ? Option.none() : Option.some(found);
  };
  return Object.assign([...list], { get });
};

/** Runs one entry's args function against the current Model and props. */
const runArgs = (
  host: QueryHost,
  entry: Entry,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the opened results map is heterogeneous by query; each entry narrows its own args.
  queries: Slices
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- args functions return query-defined args; def.argsKey decodes them.
): unknown => {
  try {
    return entry.args({
      model: host.state.model,
      props: host.state.props,
      queries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${host.module}.queries: the args of the query "${entry.name}" threw: ${message}`,
      { cause: error }
    );
  }
};

/** The current args of a single or infinite query, or `undefined` when disabled. */
const currentSingleKey = (
  host: QueryHost,
  entry: Entry
): { readonly args: unknown; readonly argsKey: string } | undefined => {
  const args = runArgs(host, entry, queryOpened(host));
  if (args === undefined) {
    return undefined;
  }
  return { args, argsKey: defOf(entry.query).argsKey(args) };
};

/** The current key list of a `queryMany` query. */
const currentKeyedKeys = (
  host: QueryHost,
  entry: Entry
): readonly { readonly args: unknown; readonly argsKey: string }[] => {
  const raw = runArgs(host, entry, queryOpened(host));
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new TypeError(
      `${host.module}.queries: the query "${entry.name}" is a queryMany entry, but its args returned a non-array`
    );
  }
  const def = defOf(entry.query);
  const seen = new Set<string>();
  const out: { readonly args: unknown; readonly argsKey: string }[] = [];
  for (const args of raw) {
    const argsKey = def.argsKey(args);
    if (!seen.has(argsKey)) {
      seen.add(argsKey);
      out.push({ args, argsKey });
    }
  }
  return out;
};

/** Opens one infinite query's stored result as `h.queries` shows it. */
const openInfinite = (
  host: QueryHost,
  entry: Entry
): AsyncResult.AsyncResult<unknown, unknown> => {
  const at = currentSingleKey(host, entry);
  if (at === undefined) {
    return AsyncResult.initial(false);
  }
  return (
    storedAt(queryStateOf(host), entry.name, at.argsKey)?.result ??
    AsyncResult.initial(true)
  );
};

/** Flattens held pages into items, keeping the first item per definition key. */
const itemsOf = (
  entry: Entry,
  pages: readonly unknown[]
): readonly unknown[] => {
  const { list } = defOf(entry.query);
  if (list === undefined) {
    return [];
  }
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  for (const page of pages) {
    // SAFETY: list.items maps a held page to its items; pages come from stored infinite results.
    for (const item of list.items(page)) {
      const key = list.key(item);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
  }
  return out;
};

/** Recomputes args, prunes dropped keyed keys, and publishes `queries`/`results`. */
export const refreshQueries = (host: QueryHost): void => {
  const qs = queryStateOf(host);
  const bound = boundEntries(host.state.component);
  for (let round = 0; round < 100; round += 1) {
    let stable = true;
    for (const entry of bound) {
      if (entry.keyed) {
        const keys = currentKeyedKeys(host, entry);
        const next = keys.map((key) => key.argsKey);
        const previous = qs.currentKeys.get(entry.name) ?? [];
        if (!Equal.equals(previous.toSorted(), next.toSorted())) {
          stable = false;
        }
        qs.currentKeys.set(entry.name, next);
        let byArgs = qs.argsByKey.get(entry.name);
        if (byArgs === undefined) {
          byArgs = new Map();
          qs.argsByKey.set(entry.name, byArgs);
        }
        for (const key of keys) {
          byArgs.set(key.argsKey, key.args);
        }
        // Prune stored keys the query no longer returns, with no `onChange`.
        const stored = qs.entries.get(entry.name);
        if (stored !== undefined) {
          // oxlint-disable-next-line unicorn/no-useless-spread -- snapshots the keys: stored entries are deleted during iteration below.
          for (const argsKey of [...stored.keys()]) {
            if (!next.includes(argsKey)) {
              stored.delete(argsKey);
            }
          }
        }
      } else {
        const at = currentSingleKey(host, entry);
        const next = at === undefined ? [] : [at.argsKey];
        const previous = qs.currentKeys.get(entry.name) ?? [];
        if (!Equal.equals(previous, next)) {
          stable = false;
        }
        qs.currentKeys.set(entry.name, next);
        if (at !== undefined) {
          let byArgs = qs.argsByKey.get(entry.name);
          if (byArgs === undefined) {
            byArgs = new Map();
            qs.argsByKey.set(entry.name, byArgs);
          }
          byArgs.set(at.argsKey, at.args);
        }
      }
    }
    if (stable) {
      break;
    }
    if (round === 99) {
      throw new Error(
        `${host.module}.queries: the query args keep changing: an onChange writes a Model whose args differ again`
      );
    }
  }
  const published = queryOpened(host);
  host.state.slices["queries"] = published;
  host.state.slices["results"] = published;
};

/** Each of the component's queries, with its `Query`'s name and current args. */
export const queryInfoOf = (host: QueryHost): readonly QueryInfo[] =>
  boundEntries(host.state.component).map((entry) => {
    const { name } = defOf(entry.query);
    if (entry.keyed) {
      return {
        args: currentKeyedKeys(host, entry).map((key) => key.args),
        name: entry.name,
        query: name,
      };
    }
    return {
      args: currentSingleKey(host, entry)?.args,
      name: entry.name,
      query: name,
    };
  });

/** The infinite queries with a load more pending. */
export const queryLoadingMore = (host: QueryHost): readonly string[] =>
  [...queryStateOf(host).loadMore].toSorted();

/** Applies a step's `$.loadMore`/`$.reset` intents. */
export const noteStepLists = (
  engine: Engine,
  lists: readonly ListIssue[]
): void => {
  if (lists.length === 0) {
    return;
  }
  const qs = queryStateOf(engine);
  const bound = boundEntries(engine.state.component);
  for (const list of lists) {
    const entry = bound.find((candidate) => candidate.name === list.name);
    if (entry === undefined || !entry.list) {
      throw new Error(
        `${engine.module}.${list.op}: the query "${list.name}" isn't an infinite query of ${engine.state.component.definitionName}`
      );
    }
    if (list.op === "loadMore") {
      qs.loadMore.add(list.name);
    } else {
      // Reset drops every page after the first; the first page stays held.
      // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
      const at = currentSingleKey(engine, entry);
      if (at !== undefined) {
        const stored = storedAt(qs, list.name, at.argsKey);
        // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
        const pages = infinitePages(stored);
        if (pages.length > 1) {
          // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
          storeInfinite(
            qs,
            entry,
            at.argsKey,
            pages.slice(0, 1),
            // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
            moreAfterPages(entry, pages.slice(0, 1))
          );
        }
      }
      qs.loadMore.delete(list.name);
    }
  }
  refreshQueries(engine);
};

/** The held pages of a stored infinite result, or `[]`. */
const infinitePages = (
  stored: StoredResult | undefined
): readonly unknown[] => {
  if (stored === undefined || !AsyncResult.isSuccess(stored.result)) {
    return [];
  }
  // SAFETY: held infinite values record pages; Array.isArray below validates the pages shape.
  const value = stored.result.value as { readonly pages?: unknown };
  const pages = value?.pages;
  return Array.isArray(pages) ? pages : [];
};

const moreAfterPages = (
  entry: Entry,
  pages: readonly unknown[]
): Query.More<unknown> => {
  const { list } = defOf(entry.query);
  if (list === undefined || pages.length === 0) {
    return { _tag: "Available" };
  }
  const last = pages.at(-1);
  return Option.isNone(list.next(last, pages))
    ? { _tag: "End" }
    : { _tag: "Available" };
};

/** Stores an infinite result with recomputed items. */
const storeInfinite = (
  qs: QueryState,
  entry: Entry,
  argsKey: string,
  pages: readonly unknown[],
  more: Query.More<unknown>
): void => {
  storeAt(qs, entry.name, argsKey, {
    more,
    patched: false,
    result: AsyncResult.success({
      items: itemsOf(entry, pages),
      more,
      pages: [...pages],
    }),
    waiting: false,
  });
};

/** The values and options splitOpts pulls off step args. */
interface SplitOpts {
  readonly values: readonly unknown[];
  readonly opts: WriteOpts;
}

interface WriteOpts {
  readonly waiting?: boolean | undefined;
  readonly patched?: boolean | undefined;
}

/** Splits a trailing `{waiting?, patched?}` options object off step args. */
const splitOpts = (rest: readonly unknown[]): SplitOpts => {
  const last = rest.at(-1);
  if (
    isObject(last) &&
    !Array.isArray(last) &&
    Object.keys(last).every((key) => key === "waiting" || key === "patched")
  ) {
    // SAFETY: every key is waiting or patched, so the object has exactly the WriteOpts shape.
    return { opts: last as WriteOpts, values: rest.slice(0, -1) };
  }
  return { opts: {}, values: rest };
};

/** Resolves a query step's name to its bound entry, throwing for none. */
const resolveEntry = (host: QueryHost, step: string, name: string): Entry => {
  const bound = boundEntries(host.state.component);
  const entry = bound.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new Error(
      `${step}: the component ${host.state.component.definitionName} has no query "${name}"${
        bound.length === 0
          ? `: it declares no queries`
          : `; it declares:\n  - ${bound.map((candidate) => candidate.name).join("\n  - ")}`
      }`
    );
  }
  return entry;
};

/** Fires the entry's `onChange` and delivers its message, if any. */
const fireOnChange = (
  engine: Engine,
  step: string,
  entry: Entry,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- onChange receives the opened result; each query types its own result.
  result: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- onChange receives the changed keys; each query types its own changes.
  changes?: unknown
): void => {
  const { onChange } = entry;
  if (onChange === undefined) {
    return;
  }
  let message: unknown;
  try {
    // SAFETY: onChange is the author's unchecked handler; it takes the opened result plus optional changes.
    message = onChange(
      ...(changes === undefined ? [result] : [result, changes])
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${step}: the onChange of the query "${entry.name}" threw: ${messageText}`,
      { cause: error }
    );
  }
  if (message !== undefined) {
    engine.deliver(message);
  }
};

/** Settles awaiting runs whose entries all hold settled results. */
const settleAwaiting = (engine: Engine): void => {
  const qs = queryStateOf(engine);
  // oxlint-disable-next-line unicorn/no-useless-spread -- snapshots the pending runs: runs settle and replace the array below.
  for (const pendingEntry of [...engine.state.pending]) {
    if (
      pendingEntry.status !== "awaiting" ||
      pendingEntry.message === undefined
    ) {
      continue;
    }
    const settled = pendingEntry.awaiting.every((query) => {
      const stored = storedAt(
        qs,
        query.name,
        // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
        queryArgsKey(engine, query.name, query.args)
      );
      return stored !== undefined && !AsyncResult.isInitial(stored.result);
    });
    if (settled) {
      const { message } = pendingEntry;
      engine.state.pending = engine.state.pending.filter(
        (other) => other !== pendingEntry
      );
      engine.settleRun(pendingEntry);
      engine.deliver(message);
    }
  }
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- args keys are query-defined args; def.argsKey decodes them.
const queryArgsKey = (host: QueryHost, name: string, args: unknown): string => {
  const entry = boundEntries(host.state.component).find(
    (candidate) => candidate.name === name
  );
  if (entry === undefined) {
    throw new Error(
      `${host.module}.queries: the query "${name}" doesn't exist`
    );
  }
  return defOf(entry.query).argsKey(args);
};

/**
 * Loads a query with a Success: `loaded(name, value, opts?)`, keyed
 * `loaded(name, args, value, opts?)`, infinite `loaded(name, pages, opts?)`.
 */
export const queryLoaded = (
  engine: Engine,
  step: string,
  name: string,
  rest: readonly unknown[]
): void => {
  const entry = resolveEntry(engine, step, name);
  const { values, opts } = splitOpts(rest);
  const qs = queryStateOf(engine);
  if (entry.keyed) {
    const [args, value] = values;
    if (values.length !== 2 || value === undefined) {
      throw new Error(
        `${step}: loaded("${name}", args, value) takes the key args and the Success value`
      );
    }
    const argsKey = defOf(entry.query).argsKey(args);
    // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
    if (
      !currentKeyedKeys(engine, entry).some((key) => key.argsKey === argsKey)
    ) {
      throw new Error(
        `${step}: the query "${name}" doesn't currently return the args ${JSON.stringify(args)}`
      );
    }
    // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
    guardLivePatch(engine, step, name, argsKey, opts);
    storeAt(qs, name, argsKey, {
      more: undefined,
      patched: opts.patched ?? false,
      result: AsyncResult.success(value),
      waiting: opts.waiting ?? false,
    });
    // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
    setArgs(qs, name, argsKey, args);
    const list = currentKeyedKeys(engine, entry).map((key) => {
      const stored = storedAt(qs, name, key.argsKey);
      return {
        args: key.args,
        patched: stored?.patched ?? false,
        result: stored?.result ?? AsyncResult.initial(true),
      };
    });
    fireOnChange(engine, step, entry, withGet(list), [
      {
        args,
        patched: opts.patched ?? false,
        result: AsyncResult.success(value),
      },
    ]);
  } else if (entry.list) {
    const [pages] = values;
    if (values.length !== 1 || !Array.isArray(pages)) {
      throw new Error(
        `${step}: loaded("${name}", pages) takes the page array of the infinite query`
      );
    }
    const at = currentSingleKey(engine, entry);
    if (at === undefined) {
      throw new Error(
        `${step}: the query "${name}" is disabled at the current Model`
      );
    }
    // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
    guardLivePatch(engine, step, name, at.argsKey, opts);
    qs.loadMore.delete(name);
    storeInfinite(qs, entry, at.argsKey, pages, moreAfterPages(entry, pages));
    fireOnChange(engine, step, entry, storedAt(qs, name, at.argsKey)?.result);
  } else {
    const [value] = values;
    if (values.length !== 1 || value === undefined) {
      throw new Error(
        `${step}: loaded("${name}", value) takes the Success value`
      );
    }
    const at = currentSingleKey(engine, entry);
    if (at === undefined) {
      throw new Error(
        `${step}: the query "${name}" is disabled at the current Model`
      );
    }
    // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
    guardLivePatch(engine, step, name, at.argsKey, opts);
    storeAt(qs, name, at.argsKey, {
      more: undefined,
      patched: opts.patched ?? false,
      result: AsyncResult.success(value),
      waiting: opts.waiting ?? false,
    });
    fireOnChange(engine, step, entry, AsyncResult.success(value));
  }
  refreshQueries(engine);
  settleAwaiting(engine);
};

const setArgs = (
  qs: QueryState,
  name: string,
  argsKey: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- stored args are query-defined; def.argsKey decodes them.
  args: unknown
): void => {
  let byArgs = qs.argsByKey.get(name);
  if (byArgs === undefined) {
    byArgs = new Map();
    qs.argsByKey.set(name, byArgs);
  }
  byArgs.set(argsKey, args);
};

/** Throws while a run's live patch covers the entry and the write isn't patched. */
const guardLivePatch = (
  host: QueryHost,
  step: string,
  name: string,
  argsKey: string,
  opts: WriteOpts
): void => {
  if (
    !queryStateOf(host).livePatches.get(name)?.has(argsKey) ||
    opts.patched === true
  ) {
    return;
  }
  throw new Error(
    `${step}: a running Command's patch is live on the query "${name}": only a patched write is allowed while it is`
  );
};

/**
 * Loads a query with a typed failure: `loadFailed(name, error, opts?)`,
 * keyed `loadFailed(name, args, error, opts?)`.
 */
export const queryLoadFailed = (
  engine: Engine,
  step: string,
  name: string,
  rest: readonly unknown[]
): void => {
  const entry = resolveEntry(engine, step, name);
  const { values, opts } = splitOpts(rest);
  const qs = queryStateOf(engine);
  if (entry.keyed) {
    const [args, error] = values;
    if (values.length !== 2 || error === undefined) {
      throw new Error(
        `${step}: loadFailed("${name}", args, error) takes the key args and the typed failure`
      );
    }
    const argsKey = defOf(entry.query).argsKey(args);
    // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
    if (
      !currentKeyedKeys(engine, entry).some((key) => key.argsKey === argsKey)
    ) {
      throw new Error(
        `${step}: the query "${name}" doesn't currently return the args ${JSON.stringify(args)}`
      );
    }
    storeAt(qs, name, argsKey, {
      more: undefined,
      patched: false,
      result: failedResult(error),
      waiting: opts.waiting ?? false,
    });
    setArgs(qs, name, argsKey, args);
    fireOnChange(engine, step, entry, queryOpened(engine)[name], [
      { args, result: failedResult(error) },
    ]);
  } else if (entry.list) {
    throw new Error(
      `${step}: loadFailed doesn't take an infinite query: use loadMoreFailed for "${name}"`
    );
  } else {
    const [error] = values;
    if (values.length !== 1 || error === undefined) {
      throw new Error(
        `${step}: loadFailed("${name}", error) takes the typed failure`
      );
    }
    const at = currentSingleKey(engine, entry);
    if (at === undefined) {
      throw new Error(
        `${step}: the query "${name}" is disabled at the current Model`
      );
    }
    storeAt(qs, name, at.argsKey, {
      more: undefined,
      patched: false,
      result: failedResult(error),
      waiting: opts.waiting ?? false,
    });
    fireOnChange(engine, step, entry, failedResult(error));
  }
  refreshQueries(engine);
  settleAwaiting(engine);
};

/** Loads several keys of a `queryMany` query in one write. */
export const queryLoadedMany = (
  engine: Engine,
  step: string,
  name: string,
  loads: readonly KeyedLoad[]
): void => {
  const entry = resolveEntry(engine, step, name);
  if (!entry.keyed) {
    throw new Error(
      `${step}: loadedMany takes a queryMany query, but "${name}" isn't one`
    );
  }
  const qs = queryStateOf(engine);
  const current = new Set(
    currentKeyedKeys(engine, entry).map((key) => key.argsKey)
  );
  const changes: {
    readonly args: unknown;
    readonly result: AsyncResult.AsyncResult<unknown, unknown>;
  }[] = [];
  for (const load of loads) {
    const argsKey = defOf(entry.query).argsKey(load.args);
    if (!current.has(argsKey)) {
      throw new Error(
        `${step}: the query "${name}" doesn't currently return the args ${JSON.stringify(load.args)}`
      );
    }
    if ("value" in load) {
      // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
      guardLivePatch(engine, step, name, argsKey, load);
    }
    const result =
      "value" in load
        ? AsyncResult.success(load.value)
        : failedResult(load.error);
    storeAt(qs, name, argsKey, {
      more: undefined,
      patched: ("value" in load ? load.patched : false) ?? false,
      result,
      waiting: load.waiting ?? false,
    });
    setArgs(qs, name, argsKey, load.args);
    changes.push({ args: load.args, result });
  }
  const list = currentKeyedKeys(engine, entry).map((key) => {
    const stored = storedAt(qs, name, key.argsKey);
    return {
      args: key.args,
      patched: stored?.patched ?? false,
      result: stored?.result ?? AsyncResult.initial(true),
    };
  });
  fireOnChange(engine, step, entry, withGet(list), changes);
  refreshQueries(engine);
  settleAwaiting(engine);
};

/** Appends a page, settling the query's pending load more. */
export const queryLoadedMore = (
  engine: Engine,
  step: string,
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- appended pages are query-defined; the page schema validates them.
  page: unknown
): void => {
  const entry = resolveEntry(engine, step, name);
  if (!entry.list) {
    throw new Error(
      `${step}: loadedMore takes an infinite query, but "${name}" isn't one`
    );
  }
  const qs = queryStateOf(engine);
  if (!qs.loadMore.has(name)) {
    throw new Error(`${step}: the query "${name}" has no load more pending`);
  }
  const at = currentSingleKey(engine, entry);
  if (at === undefined) {
    throw new Error(
      `${step}: the query "${name}" is disabled at the current Model`
    );
  }
  const pages = [...infinitePages(storedAt(qs, name, at.argsKey)), page];
  qs.loadMore.delete(name);
  storeInfinite(qs, entry, at.argsKey, pages, moreAfterPages(entry, pages));
  fireOnChange(engine, step, entry, storedAt(qs, name, at.argsKey)?.result);
  refreshQueries(engine);
  settleAwaiting(engine);
};

/** Fails a pending load more, keeping the held pages. */
export const queryLoadMoreFailed = (
  engine: Engine,
  step: string,
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- typed failures are schema-erased until the query runtime decodes them.
  error: unknown
): void => {
  const entry = resolveEntry(engine, step, name);
  if (!entry.list) {
    throw new Error(
      `${step}: loadMoreFailed takes an infinite query, but "${name}" isn't one`
    );
  }
  const qs = queryStateOf(engine);
  if (!qs.loadMore.has(name)) {
    throw new Error(`${step}: the query "${name}" has no load more pending`);
  }
  const at = currentSingleKey(engine, entry);
  if (at === undefined) {
    throw new Error(
      `${step}: the query "${name}" is disabled at the current Model`
    );
  }
  const stored = storedAt(qs, name, at.argsKey);
  const pages = infinitePages(stored);
  const failed: Query.More<unknown> = { _tag: "Failed", error };
  if (stored !== undefined && AsyncResult.isSuccess(stored.result)) {
    storeAt(qs, name, at.argsKey, {
      more: failed,
      patched: stored.patched,
      result: AsyncResult.success({
        items: itemsOf(entry, pages),
        more: failed,
        pages: [...pages],
      }),
      waiting: false,
    });
  } else {
    storeAt(qs, name, at.argsKey, {
      more: failed,
      patched: false,
      result: failedResult(error),
      waiting: false,
    });
  }
  qs.loadMore.delete(name);
  refreshQueries(engine);
  settleAwaiting(engine);
};

/** Ends an `afterRefetch` wait by budget and delivers its message. */
export const queryWaitExpired = (
  engine: Engine,
  step: string,
  target: Target
): void => {
  const match = engine.state.pending.find(
    (entry) =>
      entry.status === "awaiting" &&
      entry.message !== undefined &&
      matchesTarget(entry.command, target)
  );
  if (match === undefined) {
    throw new Error(
      `${step}: nothing waiting matches ${describeTarget(target)}: only an afterRefetch run waits`
    );
  }
  const { message } = match;
  engine.state.pending = engine.state.pending.filter(
    (other) => other !== match
  );
  engine.settleRun(match);
  engine.deliver(message);
};

/** Marks a query's unloaded entries or pending load more as kept. */
export const queryKeepPending = (
  engine: Engine,
  step: string,
  name: string
): void => {
  const entry = resolveEntry(engine, step, name);
  const qs = queryStateOf(engine);
  // oxlint-disable-next-line eslint/no-use-before-define -- helpers are defined below; entry points stay on top.
  if (unloadedKeys(engine, entry).length === 0 && !qs.loadMore.has(name)) {
    throw new Error(
      `${step}: keeping the query "${name}" matches nothing pending: it is fully loaded`
    );
  }
  qs.kept.add(name);
};

/** The args keys of one query with no settled result. */
const unloadedKeys = (host: QueryHost, entry: Entry): readonly string[] => {
  const qs = queryStateOf(host);
  if (entry.keyed) {
    return currentKeyedKeys(host, entry)
      .map((key) => key.argsKey)
      .filter((argsKey) => {
        const stored = storedAt(qs, entry.name, argsKey);
        return stored === undefined || AsyncResult.isInitial(stored.result);
      });
  }
  const at = currentSingleKey(host, entry);
  if (at === undefined) {
    return [];
  }
  const stored = storedAt(qs, entry.name, at.argsKey);
  return stored === undefined || AsyncResult.isInitial(stored.result)
    ? [at.argsKey]
    : [];
};

/** Work in flight blocking a message step: unloaded entries of unkept queries. */
export const queryInFlight = (host: QueryHost): readonly string[] => {
  const items: string[] = [];
  const qs = queryStateOf(host);
  for (const entry of boundEntries(host.state.component)) {
    if (qs.kept.has(entry.name)) {
      continue;
    }
    for (const argsKey of unloadedKeys(host, entry)) {
      items.push(
        `the query "${entry.name}" is waiting for a result at ${JSON.stringify(argsAt(qs, entry.name, argsKey))}: settle it with loaded or loadFailed, or keep it with keepPending`
      );
    }
  }
  return items;
};

/** Every pending query item, kept included: what the end check and `given` can't leave. */
export const queryAllPending = (host: QueryHost): readonly string[] => {
  const items: string[] = [];
  const qs = queryStateOf(host);
  for (const entry of boundEntries(host.state.component)) {
    if (qs.kept.has(entry.name)) {
      continue;
    }
    for (const argsKey of unloadedKeys(host, entry)) {
      items.push(
        `the query "${entry.name}" is unloaded at ${JSON.stringify(argsAt(qs, entry.name, argsKey))}`
      );
    }
    if (qs.loadMore.has(entry.name)) {
      items.push(
        `the query "${entry.name}" has a load more pending: settle it with loadedMore or loadMoreFailed`
      );
    }
  }
  return items;
};

/** `given` guards: entries the new Model would disable. */
export const queryCheckGiven = (
  host: QueryHost,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- given models are arbitrary user values; each query's args decodes its slice.
  model: unknown
): readonly string[] => {
  const items: string[] = [];
  const opened = queryOpened(host);
  for (const entry of boundEntries(host.state.component)) {
    if (entry.keyed) {
      continue;
    }
    let args: unknown;
    try {
      args = entry.args({
        model,
        props: host.state.props,
        queries: opened,
      });
    } catch {
      continue;
    }
    if (args === undefined && unloadedKeys(host, entry).length > 0) {
      items.push(
        `given would disable the query "${entry.name}" while its entry is still unloaded`
      );
    }
  }
  return items;
};

/**
 * Writes `given`'s `queries`: per query, a Success value, an infinite
 * query's page array, or keyed `{args, value|error}` entries.
 */
export const queryGiven = (
  engine: Engine,
  step: string,
  given: Given
): void => {
  const qs = queryStateOf(engine);
  for (const [name, value] of Object.entries(given)) {
    const entry = resolveEntry(engine, step, name);
    if (entry.keyed) {
      if (!Array.isArray(value)) {
        throw new TypeError(
          `${step}: given's "${name}" is a queryMany query, so it takes an array of keyed entries`
        );
      }
      const current = new Set(
        currentKeyedKeys(engine, entry).map((key) => key.argsKey)
      );
      // SAFETY: given entries are {args, value|error} records; the shape is validated below.
      for (const load of value as readonly KeyedLoad[]) {
        if (!isObject(load) || !("args" in load)) {
          throw new Error(
            `${step}: given's "${name}" entries take {args, value} or {args, error}`
          );
        }
        const argsKey = defOf(entry.query).argsKey(load.args);
        if (!current.has(argsKey)) {
          throw new Error(
            `${step}: given's "${name}" names args ${JSON.stringify(load.args)} the new Model doesn't return`
          );
        }
        if ("value" in load) {
          storeAt(qs, name, argsKey, {
            more: undefined,
            patched: ("value" in load ? load.patched : false) ?? false,
            result: AsyncResult.success(
              "value" in load ? load.value : undefined
            ),
            waiting: load.waiting ?? false,
          });
        } else if ("error" in load) {
          storeAt(qs, name, argsKey, {
            more: undefined,
            patched: false,
            result: failedResult("error" in load ? load.error : undefined),
            waiting: load.waiting ?? false,
          });
        } else {
          throw new Error(
            `${step}: given's "${name}" entries take {args, value} or {args, error}`
          );
        }
        setArgs(qs, name, argsKey, load.args);
      }
    } else if (entry.list) {
      if (!Array.isArray(value)) {
        throw new TypeError(
          `${step}: given's "${name}" is an infinite query, so it takes the page array`
        );
      }
      const at = currentSingleKey(engine, entry);
      if (at === undefined) {
        throw new Error(
          `${step}: given's "${name}" is disabled at the new Model`
        );
      }
      // SAFETY: given pages are the infinite query's page array; the array shape was checked above.
      const pages = value as readonly unknown[];
      storeInfinite(qs, entry, at.argsKey, pages, moreAfterPages(entry, pages));
    } else {
      const at = currentSingleKey(engine, entry);
      if (at === undefined) {
        throw new Error(
          `${step}: given's "${name}" is disabled at the new Model`
        );
      }
      storeAt(qs, name, at.argsKey, {
        more: undefined,
        patched: false,
        result: AsyncResult.success(value),
        waiting: false,
      });
    }
  }
  refreshQueries(engine);
};

/** Ingests a live `QueryChanged` entry during `fromLog` replay. */
export const ingestQueryChanged = (
  engine: Engine,
  step: string,
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- log results are schema-erased until the entry's schemas decode them.
  result: unknown
): void => {
  const entry = resolveEntry(engine, step, name);
  const qs = queryStateOf(engine);
  if (entry.keyed) {
    if (!Array.isArray(result)) {
      throw new TypeError(
        `${step}: the log's QueryChanged for the queryMany query "${name}" isn't a key list`
      );
    }
    // SAFETY: log key lists hold {args, result} records; the shape is validated below.
    for (const item of result as readonly {
      readonly args: unknown;
      readonly result: unknown;
    }[]) {
      if (!isObject(item) || !("args" in item && "result" in item)) {
        continue;
      }
      const argsKey = defOf(entry.query).argsKey(item.args);
      storeAt(qs, name, argsKey, {
        more: undefined,
        patched: false,
        // SAFETY: log results are stored as AsyncResults; fromLog replays them verbatim.
        result: item.result as AsyncResult.AsyncResult<unknown, unknown>,
        waiting: false,
      });
      setArgs(qs, name, argsKey, item.args);
    }
  } else {
    const at = currentSingleKey(engine, entry);
    if (at === undefined) {
      return;
    }
    storeAt(qs, entry.name, at.argsKey, {
      more: undefined,
      patched: false,
      // SAFETY: log results are stored as AsyncResults; fromLog replays them verbatim.
      result: result as AsyncResult.AsyncResult<unknown, unknown>,
      waiting: false,
    });
  }
  refreshQueries(engine);
};

/** Applies a Command's optimistic patches when it is issued. */
export const noteIssued = (
  engine: Engine,
  command: Command.Issued<unknown, never>
): void => {
  if (command.optimistic.length === 0) {
    return;
  }
  const qs = queryStateOf(engine);
  const bound = boundEntries(engine.state.component);
  for (const patch of command.optimistic) {
    const def = targetDef(patch.query);
    if (def === undefined) {
      continue;
    }
    const entry = bound.find(
      (candidate) => defOf(candidate.query).name === def.name
    );
    if (entry === undefined) {
      continue;
    }
    const keys =
      patch._tag === "PatchAll"
        ? (qs.currentKeys.get(entry.name) ?? [])
        : [def.argsKey(patch.args)];
    for (const argsKey of keys) {
      const stored = storedAt(qs, entry.name, argsKey);
      if (stored === undefined || !AsyncResult.isSuccess(stored.result)) {
        continue;
      }
      // SAFETY: patches map a held value to its replacement; both variants take the value first.
      // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- patch values are entry Success values; each patch types its own value.
      const applyPatch = patch.patch as (value: unknown) => unknown;
      const patched = entry.list
        ? {
            // SAFETY: held values are records of the entry's Success; the spread reattaches untouched Success fields.
            ...(stored.result.value as Slices),
            // SAFETY: list patches map held pages to held pages.
            items: itemsOf(
              entry,
              applyPatch(infinitePages(stored)) as readonly unknown[]
            ),
            pages: applyPatch(infinitePages(stored)),
          }
        : applyPatch(stored.result.value);
      storeAt(qs, entry.name, argsKey, {
        ...stored,
        patched: true,
        result: AsyncResult.success(patched),
      });
      let live = qs.livePatches.get(entry.name);
      if (live === undefined) {
        live = new Set();
        qs.livePatches.set(entry.name, live);
      }
      live.add(argsKey);
    }
  }
};

/** Drops a Command's live patches when its run ends however it ends. */
export const dropLivePatches = (
  engine: Engine,
  command: Command.Issued<unknown, never>
): void => {
  if (command.optimistic.length === 0) {
    return;
  }
  const qs = queryStateOf(engine);
  const bound = boundEntries(engine.state.component);
  for (const patch of command.optimistic) {
    const def = targetDef(patch.query);
    if (def === undefined) {
      continue;
    }
    const entry = bound.find(
      (candidate) => defOf(candidate.query).name === def.name
    );
    if (entry === undefined) {
      continue;
    }
    if (patch._tag === "PatchAll") {
      qs.livePatches.delete(entry.name);
    } else {
      qs.livePatches.get(entry.name)?.delete(def.argsKey(patch.args));
    }
  }
};

/** The own-query entries a run invalidates, minus the entries its writes stored. */
// oxlint-disable-next-line eslint/complexity -- invalidatedEntries matches three invalidation shapes over two patch lists; splitting would scatter the add/continue flow.
const invalidatedEntries = (
  engine: Engine,
  command: Command.Issued<unknown, never>,
  written: ReadonlySet<string>
): readonly AwaitedEntry[] => {
  const bound = boundEntries(engine.state.component);
  const qs = queryStateOf(engine);
  const out = new Map<string, AwaitedEntry>();
  const add = (name: string, argsKey: string): void => {
    const key = `${name} ${argsKey}`;
    if (written.has(key) || out.has(key)) {
      return;
    }
    const current = qs.currentKeys.get(name) ?? [];
    if (!current.includes(argsKey)) {
      return;
    }
    out.set(key, { args: argsAt(qs, name, argsKey), name });
  };
  for (const target of command.invalidates) {
    if (
      isObject(target) &&
      "name" in target &&
      "_tag" in target &&
      target._tag === "Tag"
    ) {
      // SAFETY: the _tag check above selects the Tag variant, whose name is a string.
      const tag = (target as Query.Tag).name;
      for (const entry of bound) {
        if (!defOf(entry.query).tags.includes(tag)) {
          continue;
        }
        for (const argsKey of qs.currentKeys.get(entry.name) ?? []) {
          add(entry.name, argsKey);
        }
      }
      continue;
    }
    if (isObject(target) && "_tag" in target && target._tag === "Entry") {
      // SAFETY: the _tag check above selects the EntryTarget variant.
      const ref = target as Query.EntryTarget;
      const def = targetDef(ref.query);
      if (def === undefined) {
        continue;
      }
      const entry = bound.find(
        (candidate) => defOf(candidate.query).name === def.name
      );
      if (entry !== undefined) {
        add(entry.name, def.argsKey(ref.args));
      }
      continue;
    }
    const def = targetDef(target);
    if (def === undefined) {
      continue;
    }
    const entry = bound.find(
      (candidate) => defOf(candidate.query).name === def.name
    );
    if (entry === undefined) {
      continue;
    }
    for (const argsKey of qs.currentKeys.get(entry.name) ?? []) {
      add(entry.name, argsKey);
    }
  }
  for (const patch of command.optimistic) {
    const def = targetDef(patch.query);
    if (def === undefined) {
      continue;
    }
    const entry = bound.find(
      (candidate) => defOf(candidate.query).name === def.name
    );
    if (entry === undefined) {
      continue;
    }
    if (patch._tag === "PatchAll") {
      for (const argsKey of qs.currentKeys.get(entry.name) ?? []) {
        add(entry.name, argsKey);
      }
    } else {
      add(entry.name, def.argsKey(patch.args));
    }
  }
  return [...out.values()];
};

interface AwaitedEntry {
  readonly name: string;
  readonly args: unknown;
}

/**
 * Handles a settled run for `afterRefetch` and `writes`. Returns `true`
 * when the run now waits on its queries (the engine must not settle it),
 * `false` when the engine settles and delivers as usual.
 */
export const noteResolve = (
  engine: Engine,
  run: PendingEntry,
  command: Command.Issued<unknown, never>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run results are untyped until writes decode them.
  result: unknown
): boolean => {
  const qs = queryStateOf(engine);
  const bound = boundEntries(engine.state.component);
  const written = new Set<string>();
  if (command.writes !== undefined) {
    let writes: readonly Query.Write[];
    try {
      writes = command.writes(result);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `${engine.module}.resolve: the writes of ${command.name} threw: ${messageText}`,
        { cause: error }
      );
    }
    for (const write of writes) {
      const def = targetDef(write.query);
      if (def === undefined) {
        continue;
      }
      const entry = bound.find(
        (candidate) => defOf(candidate.query).name === def.name
      );
      if (entry === undefined) {
        continue;
      }
      const argsKey = def.argsKey(write.args);
      if (entry.list) {
        // SAFETY: infinite writes hold the page array; the array shape was checked above.
        const pages = Array.isArray(write.value)
          ? (write.value as readonly unknown[])
          : [write.value];
        storeInfinite(qs, entry, argsKey, pages, moreAfterPages(entry, pages));
      } else {
        storeAt(qs, entry.name, argsKey, {
          more: undefined,
          patched: false,
          result: AsyncResult.success(write.value),
          waiting: false,
        });
      }
      setArgs(qs, entry.name, argsKey, write.args);
      written.add(`${entry.name} ${argsKey}`);
    }
    refreshQueries(engine);
  }
  dropLivePatches(engine, command);
  if (command.afterRefetch === undefined || command._tag !== "Effect") {
    return false;
  }
  const awaiting = invalidatedEntries(engine, command, written);
  if (awaiting.length === 0) {
    settleAwaiting(engine);
    return false;
  }
  run.status = "awaiting";
  // SAFETY: a newly awaiting run gains its message and awaited entries here; both fields stay readonly to other writers.
  Object.assign(run, {
    awaiting,
    message: command.resolve(result),
  });
  return true;
};

/** The previous settled result of every query, by name. */
type PreviousByName = Record<string, Option.Option<unknown>>;

/** Whether each query holds a patched write, by name. */
type PatchedByName = Record<string, boolean>;

/** The `previous`/`patched` helpers `h` gains beside `queries`. */
const openPrevious = (host: QueryHost): PreviousByName => {
  const out: PreviousByName = {};
  const qs = queryStateOf(host);
  for (const entry of boundEntries(host.state.component)) {
    if (entry.keyed) {
      continue;
    }
    const current = qs.currentKeys.get(entry.name) ?? [];
    const byKey = qs.entries.get(entry.name);
    let previous: Option.Option<unknown> = Option.none();
    if (byKey !== undefined) {
      for (const [argsKey, stored] of byKey) {
        if (
          current.includes(argsKey) ||
          !AsyncResult.isSuccess(stored.result)
        ) {
          continue;
        }
        previous = Option.some(
          entry.list
            ? {
                items: itemsOf(entry, infinitePages(stored)),
                pages: infinitePages(stored),
              }
            : stored.result.value
        );
        break;
      }
    }
    out[entry.name] = previous;
  }
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- PreviousByName maps every query to its Option by construction.
  return out;
};

const openPatched = (host: QueryHost): PatchedByName => {
  const out: PatchedByName = {};
  const qs = queryStateOf(host);
  for (const entry of boundEntries(host.state.component)) {
    if (entry.keyed) {
      continue;
    }
    const current = qs.currentKeys.get(entry.name) ?? [];
    out[entry.name] = current.some(
      (argsKey) => storedAt(qs, entry.name, argsKey)?.patched === true
    );
  }
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- PatchedByName maps every query to its flag by construction.
  return out;
};

/** Registers the query slice's `h` helpers with the engine. */
export const registerQuerySlice = (): void => {
  registerTestExtension({
    allPending: (state) => {
      // SAFETY: test extensions receive the engine internals; the query slice reads state and module.
      const internals = state as EngineInternals;
      return queryAllPending({
        module: internals.module,
        state: internals.state,
      });
    },
    checkGiven: (state, model) => {
      // SAFETY: test extensions receive the engine internals; the query slice reads state and module.
      const internals = state as EngineInternals;
      return queryCheckGiven(
        { module: internals.module, state: internals.state },
        model
      );
    },
    helper: (ctx) => {
      // SAFETY: test extensions receive the engine internals; the query slice reads state and module.
      const internals = ctx as EngineInternals;
      const host: QueryHost = {
        module: internals.module,
        state: internals.state,
      };
      return {
        patched: openPatched(host),
        previous: openPrevious(host),
        queries: queryOpened(host),
      };
    },
    inFlight: (state) => {
      // SAFETY: test extensions receive the engine internals; the query slice reads state and module.
      const internals = state as EngineInternals;
      return queryInFlight({
        module: internals.module,
        state: internals.state,
      });
    },
    name: "query",
  });
};
