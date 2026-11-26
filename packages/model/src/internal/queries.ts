/**
 * What a component builds from `queries`: the query results an instance
 * keeps beside its Model, and how the runtime opens them for the view.
 *
 * Binding is pure: `bind` checks a component's `queries` option and builds
 * its bound record (`Bound`) with the results Schemas for page state and
 * the log, the per-triple view contexts, and the snapshot builders. The
 * per-instance watch sync lives in `internal/query-run.ts`; both register
 * through `queryCore.registerComponentBinding`, so the component runtime
 * reaches them without importing `Query`.
 *
 * @internal
 */
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";

import type * as Query from "../query.ts";
import type { QueryDef } from "../query.ts";
import * as queryCore from "./query-core.ts";
import { holdsRedacted } from "./schema-redact.ts";

// `Query` binds a component's queries through `queryCore.loaded`, so it is loaded whenever this runs.
const queryModule = (): NonNullable<typeof queryCore.loaded> => {
  if (queryCore.loaded === undefined) {
    throw new Error(
      'queries needs the Query module, which nothing imported. Import Query from "@ilha/model".'
    );
  }
  return queryCore.loaded;
};
const QueryTypeId: Query.TypeId = "~@effect/ui/Query";

type QueryFn = ($: {
  readonly model: unknown;
  readonly props: unknown;
  readonly queries: unknown;
}) => unknown; // oxlint-disable-line anti-slop/no-unknown-returns -- args functions return query-defined args; def.argsKey decodes them.

/**
 * One entry of `queries`.
 *
 * @internal
 */
export interface Entry {
  readonly name: string;
  readonly query: Query.Query.Any;
  /** A `queryMany` entry. */
  readonly keyed: boolean;
  /** A `query` of an infinite query. */
  readonly list: boolean;
  readonly args: QueryFn;
  /** From `debounce`: how many milliseconds a fetch for changed args waits. */
  readonly debounce: number | undefined;
  readonly onChange: ((...args: any[]) => unknown) | undefined; // oxlint-disable-line typescript/no-explicit-any, anti-slop/no-unknown-returns -- mirrors the author's unchecked onChange; invoked with the opened result.
}

/**
 * One set of query arguments and its cache key.
 *
 * @internal
 */
export interface Keyed {
  readonly args: unknown;
  readonly argsKey: string;
}

/**
 * What one query's watch carries for the runtime.
 *
 * @internal
 */
export interface Marker {
  readonly query: Query.Query.Any;
  readonly name: string;
  /** `undefined`: the query is disabled, and the marker is inert. */
  readonly args: unknown;
  readonly argsKey: string | undefined;
  /** Set for one key of a keyed query: its values are collected into the query's result. */
  readonly keyed: boolean;
  readonly debounce: number | undefined;
}

/**
 * A keyed query's ordered keys, accompanying its per-key watch markers.
 *
 * @internal
 */
export interface Group {
  readonly name: string;
  readonly query: Query.Query.Any;
  readonly entries: readonly Keyed[];
}

/** @internal */
export interface KeyedChange {
  readonly args: unknown;
  readonly result: AsyncResult.AsyncResult<any, any>; // oxlint-disable-line typescript/no-explicit-any -- mirrors AsyncResult's own any-typed contract for unsettled results.
}

/**
 * An instance's query results, by query name.
 *
 * @internal
 */
export type Results = Readonly<Record<string, unknown>>; // oxlint-disable-line anti-slop/no-unsafe-dictionary-type -- results are keyed by query name; each snapshot is decoded by its query's Schema.

// SAFETY: the component runtime stores the bound record under "~queries"; the Bound interface above states its contract.
/**
 * A component's bound `queries`. `undefined` without any.
 *
 * @internal
 */
export const boundOf: (component: {
  readonly "~queries": unknown;
}) => Bound | undefined = queryCore.boundOf as (component: {
  readonly "~queries": unknown;
}) => Bound | undefined;

/** @internal */
export const isWatchKey: (key: string) => boolean = queryCore.isWatchKey;

/** Strict open: the stored result at the query's current args, else `Initial`, waiting when enabled. */
const open = (
  snapshot: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- snapshots are query-defined values; snapshotData decodes them.
  argsKey: string | undefined
  // oxlint-disable-next-line typescript/no-explicit-any -- mirrors AsyncResult's own any-typed contract for unsettled results.
): AsyncResult.AsyncResult<any, any> => {
  if (argsKey === undefined) {
    return AsyncResult.initial(false);
  }
  const data = queryModule().snapshotData(snapshot);
  if (data?.result === undefined || data.argsKey !== argsKey) {
    return AsyncResult.initial(true);
  }
  return data.result;
};

/** Whether the opened value includes an unconfirmed patch. */
const patched = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- snapshots are query-defined values; snapshotData decodes them.
  snapshot: unknown,
  argsKey: string | undefined
): boolean => {
  const data = queryModule().snapshotData(snapshot);
  return argsKey !== undefined && data?.argsKey === argsKey && data.patched;
};

/** A list's pages, with their items: the dedupe runs once per page array. */
const lists = new WeakMap<
  object,
  {
    readonly items: readonly unknown[];
    readonly pages: readonly unknown[];
  }
>();
const listOf = (def: QueryDef, pages: readonly unknown[]) => {
  let out = lists.get(pages);
  if (out === undefined) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- listOf runs only for list queries; previous and openList select this branch when def.list is defined.
    out = { items: def.list!.ops.itemsOf(def, pages), pages };
    lists.set(pages, out);
  }
  return out;
};
/** "Keep the previous page": a Success stored for other args, while the query is enabled. */
const previous = (
  snapshot: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- snapshots are query-defined values; snapshotData decodes them.
  argsKey: string | undefined
  // oxlint-disable-next-line typescript/no-explicit-any -- the kept previous page is query-defined; the view decodes it.
): Option.Option<any> => {
  if (argsKey === undefined) {
    return Option.none();
  }
  const data = queryModule().snapshotData(snapshot);
  if (
    data?.result === undefined ||
    data.argsKey === argsKey ||
    data.result._tag !== "Success"
  ) {
    return Option.none();
  }
  return Option.some(
    data.def.list === undefined
      ? data.result.value
      : listOf(data.def, data.result.value)
  );
};

/** One opened list per snapshot, so a view and `onChange` share it. */
const openedLists = new WeakMap<object, AsyncResult.AsyncResult<any, any>>(); // oxlint-disable-line typescript/no-explicit-any -- mirrors AsyncResult's own any-typed contract for unsettled results.

/** A list's result opened as `h.queries` shows it: `{ items, pages, more }`. */
const openList = (
  snapshot: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- snapshots are query-defined values; snapshotData decodes them.
  result: AsyncResult.AsyncResult<any, any> // oxlint-disable-line typescript/no-explicit-any -- mirrors AsyncResult's own any-typed contract for unsettled results.
  // oxlint-disable-next-line typescript/no-explicit-any -- mirrors AsyncResult's own any-typed contract for unsettled results.
): AsyncResult.AsyncResult<any, any> => {
  if (result._tag === "Initial") {
    return result;
  }
  const data = queryModule().snapshotData(snapshot)!; // oxlint-disable-line typescript/no-non-null-assertion -- openList runs on non-Initial results, which open reads from this same snapshot.
  // SAFETY: the snapshot is the results record openList opened; the cache stores it by identity.
  const cached =
    data.result === result ? openedLists.get(snapshot as object) : undefined;
  if (cached !== undefined) {
    return cached;
  }
  const more = data.more ?? { _tag: "End" };
  // oxlint-disable-next-line unicorn/no-array-method-this-argument -- AsyncResult.map is not Array#map; result is the mapped value and the callback opens it.
  const opened = AsyncResult.map(result, (pages: readonly unknown[]) => ({
    ...listOf(data.def, pages),
    more,
  }));
  if (data.result === result) {
    // SAFETY: the snapshot is the results record openList opened; the cache stores it by identity.
    openedLists.set(snapshot as object, opened);
  }
  return opened;
};

/**
 * A keyed result opened at the query's keys: an entry per key in its order,
 * each the stored result or `Initial`, waiting, and `get` by args.
 */
const openKeyed = (
  def: QueryDef,
  snapshots: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- keyed snapshots are query-defined values; snapshotMapData decodes them.
  entries: readonly Keyed[]
): readonly {
  readonly args: unknown;
  readonly result: AsyncResult.AsyncResult<any, any>; // oxlint-disable-line typescript/no-explicit-any -- mirrors AsyncResult's own any-typed contract for unsettled results.
}[] => {
  const stored = queryModule().snapshotMapData(snapshots)?.entries;
  const opened = entries.map((entry) => {
    const data = queryModule().snapshotData(stored?.get(entry.argsKey));
    return {
      args: entry.args,
      patched: data?.patched ?? false,
      result: data?.result ?? AsyncResult.initial(true),
    };
  });
  const byKey = new Map<string, (typeof opened)[number]>();
  for (const [index, entry] of opened.entries()) {
    const source = entries[index];
    if (source !== undefined) {
      byKey.set(source.argsKey, entry);
    }
  }
  return Object.assign(opened, {
    get: (args: unknown) => Option.fromNullishOr(byKey.get(def.argsKey(args))), // oxlint-disable-line anti-slop/no-unknown-parameters -- key lookup decodes args through the query's argsKey.
  });
};

/**
 * Returns query arguments deduplicated by key, in first-occurrence order.
 */
const uniqueArgs = (
  component: string,
  name: string,
  def: QueryDef,
  args: unknown // oxlint-disable-line anti-slop/no-unknown-parameters -- queryMany args are query-defined; the array check below decodes them.
): readonly Keyed[] => {
  if (!Array.isArray(args)) {
    throw new TypeError(
      `${component}: queries.${name} is a queryMany query, and its args must return an array.`
    );
  }
  const seen = new Set<string>();
  const out: Keyed[] = [];
  for (const one of args) {
    const argsKey = def.argsKey(one);
    if (seen.has(argsKey)) {
      continue;
    }
    seen.add(argsKey);
    out.push({ args: one, argsKey });
  }
  return out;
};

const isQuery = (u: unknown): u is Query.Query.Any =>
  Predicate.hasProperty(u, QueryTypeId);

/**
 * Checks the entries of `queries`. Throws on an entry that isn't
 * `{ query, args }` or `{ queryMany, args }`.
 */
const parse = (
  component: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- entries are author-written; the checks below decode each one.
  queries: unknown
): readonly Entry[] => {
  if (queries === undefined) {
    return [];
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates the entries record before opening it.
  if (typeof queries !== "object" || queries === null) {
    throw new Error(
      `${component}: queries must be a record of { query, args } or { queryMany, args } entries.`
    );
  }
  return Object.entries(queries).map(([name, entry]): Entry => {
    const fail = (why: string) =>
      new Error(`${component}: queries.${name} ${why}`);
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates the entry before reading its fields.
    if (typeof entry !== "object" || entry === null) {
      throw fail("must be { query, args } or { queryMany, args }.");
    }
    const {
      args,
      debounce,
      query,
      queryMany,
      onChange,
    }: {
      readonly args?: unknown;
      readonly debounce?: unknown;
      readonly query?: unknown;
      readonly queryMany?: unknown;
      readonly onChange?: unknown;
    } = entry;
    if ((query === undefined) === (queryMany === undefined)) {
      throw fail("must have exactly one of query and queryMany.");
    }
    const definition = query ?? queryMany;
    if (!isQuery(definition)) {
      throw fail(
        `has a ${
          query === undefined ? "queryMany" : "query"
        } that isn't a Query.`
      );
    }
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates the args function before binding it.
    if (typeof args !== "function") {
      throw fail("must have an args function.");
    }
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates onChange before binding it.
    if (onChange !== undefined && typeof onChange !== "function") {
      throw fail("has an onChange that isn't a function.");
    }
    const list = queryModule().defOf(definition).list !== undefined;
    if (queryMany !== undefined && list) {
      throw fail(
        "has an infinite query under queryMany. An infinite query takes query."
      );
    }
    return {
      // SAFETY: args is the validated args function; QueryFn names its context contract.
      args: args as QueryFn,
      // SAFETY: debounce is the author's Duration input when present; Duration.toMillis validates it.
      debounce:
        debounce === undefined
          ? undefined
          : Duration.toMillis(debounce as Duration.Input),
      keyed: queryMany !== undefined,
      list,
      name,
      // SAFETY: onChange is the validated function form; Entry names its invocation contract.
      onChange: onChange as Entry["onChange"],
      query: definition,
    };
  });
};

/** A query's evaluated arguments, deduplicated by key for a keyed query. */
type Current =
  | {
      readonly args: unknown;
      readonly argsKey: string | undefined;
      readonly entries?: undefined;
    }
  | {
      readonly args: readonly unknown[];
      readonly argsKey: undefined;
      readonly entries: readonly Keyed[];
    };

/**
 * The views of one `(model, props, results)`: each query runs at most once,
 * and the watches, `queries`, `previous` and `patched` share its args.
 *
 * @internal
 */
export interface QueryContext {
  readonly queries: Record<string, any>; // oxlint-disable-line typescript/no-explicit-any, anti-slop/no-unsafe-dictionary-type -- mirrors the QuerySpec value contract the views open; each result is decoded by its query.
  readonly previous: Record<string, Option.Option<any>>; // oxlint-disable-line typescript/no-explicit-any -- mirrors AsyncResult's own any-typed contract for unsettled results.
  readonly patched: Record<string, boolean>;
  /** The watch markers and keyed groups of every query, which the runtime registers. */
  readonly watches: () => readonly (Marker | Group)[];
  /** The args of a query: a keyed query's are its unique args. */
  readonly argsOf: (name: string) => Current;
  /**
   * The message a query's `onChange` returns for its result as these views open
   * it, or `undefined` without `onChange`. A keyed query's also gets `changes`.
   */
  readonly changed: (
    name: string,
    changes: readonly KeyedChange[]
  ) => { readonly value: unknown } | undefined;
}

/**
 * The Schema of an instance's results: a struct with each query's result Schema.
 *
 * @internal
 */
export type ResultsSchema = Schema.Struct<
  Readonly<Record<string, Schema.Codec<unknown, unknown>>>
>;

/** @internal */
export interface Bound {
  readonly entries: readonly Entry[];
  readonly byName: ReadonlyMap<string, Entry>;
  /** Every result empty: an instance's results before a query writes one. */
  readonly empty: Results;
  /** The Schema of the results for page state and history: a field per query, by name. */
  readonly schema: ResultsSchema;
  /**
   * The Schema of the results for the message log. It keeps `waiting` and a
   * list's exact `more`, which `update` can read and page state drops.
   */
  readonly logSchema: ResultsSchema;
  /** The bound entries whose args, success or error Schema holds a `Schema.Redacted`. */
  readonly redacted: readonly string[];
  readonly context: (
    model: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- views open any model; each query's Schema decodes its slice.
    props: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- views open any props; each query's args decodes its slice.
    results: Results | undefined
  ) => QueryContext;
  /** A single or infinite query's result holding `result` at `entry`. */
  readonly snapshot: (
    entry: Entry,
    at: Keyed,
    result: AsyncResult.Success<any, any> | AsyncResult.Failure<any, any>, // oxlint-disable-line typescript/no-explicit-any -- mirrors AsyncResult's own any-typed contract for unsettled results.
    patched: boolean,
    more: Query.More<any> | undefined // oxlint-disable-line typescript/no-explicit-any -- mirrors Query's own any-typed More contract.
  ) => unknown; // oxlint-disable-line anti-slop/no-unknown-returns -- snapshots are query-defined values; snapshotData decodes them.
  /** A keyed query's result holding `snapshots`, one per args key. */
  readonly snapshotMany: (
    entry: Entry,
    snapshots: Iterable<unknown>
  ) => unknown; // oxlint-disable-line anti-slop/no-unknown-returns -- snapshot maps are query-defined values; snapshotMapData decodes them.
}

interface State {
  readonly $: {
    readonly model: unknown;
    readonly props: unknown;
    readonly queries: unknown;
  };
  readonly results: Results;
  readonly memo: Map<string, Current>;
  /** The opened keyed results, built at the first read. */
  readonly opened: Map<string, unknown>;
  readonly running: string[];
}

/**
 * Binds `queries`. `undefined` without any. Throws when entries are
 * declared but `Query` was never imported, or when an entry is malformed.
 *
 * @internal
 */
export const bind = (
  component: string,
  queries: unknown // oxlint-disable-line anti-slop/no-unknown-parameters -- declarations are author-written; parse decodes each entry.
): Bound | undefined => {
  const entries = parse(component, queries);
  if (entries.length === 0) {
    return undefined;
  }
  if (queryCore.loaded === undefined) {
    throw new Error(
      `${component}: queries needs the Query module, which nothing imported. Import Query from "@ilha/model".`
    );
  }
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const empty: Record<string, unknown> = {}; // oxlint-disable-line anti-slop/no-unsafe-dictionary-type -- the mutable build buffer for the frozen Results below.
  const fields: Record<string, Schema.Top> = {};
  const logFields: Record<string, Schema.Top> = {};
  const redacted: string[] = [];
  for (const entry of entries) {
    const def = queryModule().defOf(entry.query);
    empty[entry.name] = entry.keyed
      ? queryModule().makeSnapshotMap(def, entry.name, [])
      : queryModule().makeSnapshot(def, entry.name, undefined, undefined); // oxlint-disable-line unicorn/no-useless-undefined -- entry and result are required parameters; undefined seeds the empty snapshot.
    fields[entry.name] = entry.keyed
      ? queryModule().snapshotMapSchema(entry.query, entry.name)
      : queryModule().snapshotSchema(entry.query, entry.name);
    logFields[entry.name] = entry.keyed
      ? queryModule().snapshotMapSchema(entry.query, entry.name, true)
      : queryModule().snapshotSchema(entry.query, entry.name, true);
    if (
      holdsRedacted(def.args.ast) ||
      holdsRedacted(def.success.ast) ||
      holdsRedacted(def.error.ast)
    ) {
      redacted.push(entry.name);
    }
  }
  Object.freeze(empty);
  const states = new WeakMap<object, State>();
  const argsOf = (state: State, entry: Entry): Current => {
    let current = state.memo.get(entry.name);
    if (current !== undefined) {
      return current;
    }
    if (state.running.includes(entry.name)) {
      throw new Error(
        `${component}: the queries ${[
          ...state.running.slice(state.running.indexOf(entry.name)),
          entry.name,
        ].join(" -> ")} read each other in a cycle.`
      );
    }
    state.running.push(entry.name);
    let args: unknown;
    try {
      args = entry.args(state.$);
    } finally {
      state.running.pop();
    }
    const def = queryModule().defOf(entry.query);
    if (entry.keyed) {
      const keyed = uniqueArgs(component, entry.name, def, args);
      current = {
        args: keyed.map((one) => one.args),
        argsKey: undefined,
        entries: keyed,
      };
    } else {
      current = {
        args,
        argsKey: args === undefined ? undefined : def.argsKey(args),
      };
    }
    state.memo.set(entry.name, current);
    return current;
  };
  // The three views share prototypes built once here, so a render defines no property.
  const view = (
    read: (
      snapshot: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- views open any snapshot; each query decodes its slice.
      argsKey: string | undefined,
      entry: Entry
    ) => unknown, // oxlint-disable-line anti-slop/no-unknown-returns -- views open query-defined values; each query decodes its slice.
    keyed?: (state: State, entry: Entry) => unknown // oxlint-disable-line anti-slop/no-unknown-returns -- keyed views open query-defined values; each query decodes its slice.
  ) => {
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the views define one property per query name at bind time; reads go through the getters below.
    const proto: Record<string, unknown> = {};
    for (const entry of entries) {
      if (entry.keyed && keyed === undefined) {
        continue;
      }
      const field = entry;
      Object.defineProperty(proto, field.name, {
        enumerable: true,
        // oxlint-disable-next-line anti-slop/no-object-parameters -- the view instance is created from the shared prototype below.
        get(this: object) {
          const state = states.get(this)!; // oxlint-disable-line typescript/no-non-null-assertion -- the getter runs only on views viewOf built and registered in states.
          return field.keyed
            ? keyed!(state, field) // oxlint-disable-line typescript/no-non-null-assertion -- keyed views are built only with a keyed reader; the guard above selects that branch.
            : read(
                state.results[field.name],
                argsOf(state, field).argsKey,
                field
              );
        },
      });
    }
    return proto;
  };
  const openKeyedResult = (state: State, entry: Entry) => {
    let opened = state.opened.get(entry.name);
    if (opened === undefined) {
      opened = openKeyed(
        queryModule().defOf(entry.query),
        state.results[entry.name],
        argsOf(state, entry).entries! // oxlint-disable-line typescript/no-non-null-assertion -- openKeyedResult runs only for keyed entries; argsOf sets entries exactly then.
      );
      state.opened.set(entry.name, opened);
    }
    return opened;
  };
  const queriesProto = view((snapshot, argsKey, entry) => {
    const result = open(snapshot, argsKey);
    return entry.list ? openList(snapshot, result) : result;
  }, openKeyedResult);
  const previousProto = view(previous);
  const patchedProto = view(patched);
  const viewOf = (
    // oxlint-disable-next-line anti-slop/no-object-parameters -- prototypes are the shared view objects built above.
    proto: object,
    state: State
  ) => {
    const out = Object.create(proto);
    states.set(out, state);
    return out;
  };
  const watchesOf = (state: State) =>
    entries.flatMap((entry) => {
      const current = argsOf(state, entry);
      if (current.entries === undefined) {
        const marker: Marker = {
          args: current.args,
          argsKey: current.argsKey,
          debounce: entry.debounce,
          keyed: false,
          name: entry.name,
          query: entry.query,
        };
        return [marker];
      }
      // A keyed query: one watcher per unique key, and the group that collects their values.
      const group: Group = {
        entries: current.entries,
        name: entry.name,
        query: entry.query,
      };
      return [
        group,
        ...current.entries.map((one): Marker => ({
          args: one.args,
          argsKey: one.argsKey,
          debounce: entry.debounce,
          keyed: true,
          name: entry.name,
          query: entry.query,
        })),
      ];
    });
  const make = (
    model: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- contexts open any model; each query decodes its slice.
    props: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- contexts open any props; each query decodes its slice.
    results: Results
  ): QueryContext => {
    // oxlint-disable-next-line typescript/no-explicit-any, anti-slop/no-unsafe-dictionary-type -- mirrors the QuerySpec value contract the views open; each result is decoded by its query.
    const queriesView: Record<string, any> = viewOf(
      queriesProto,
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: viewOf registers the state below before any read; the placeholder only satisfies the prototype walk.
      undefined as unknown as State
    );
    const state: State = {
      $: { model, props, queries: queriesView },
      memo: new Map(),
      opened: new Map(),
      results,
      running: [],
    };
    states.set(queriesView, state);
    const previousView = viewOf(previousProto, state);
    const patchedView = viewOf(patchedProto, state);
    states.set(previousView, state);
    states.set(patchedView, state);
    return {
      argsOf: (name) => argsOf(state, byName.get(name)!), // oxlint-disable-line typescript/no-non-null-assertion -- byName holds every bound entry; views read only bound names.
      changed: (name, changes) => {
        const entry = byName.get(name)!; // oxlint-disable-line typescript/no-non-null-assertion -- byName holds every bound entry; changed reads only bound names.
        if (entry.onChange === undefined) {
          return;
        }
        return {
          value: entry.keyed
            ? entry.onChange(queriesView[name], changes)
            : entry.onChange(queriesView[name]),
        };
      },
      patched: patchedView,
      previous: previousView,
      queries: queriesView,
      watches: () => watchesOf(state),
    };
  };
  // One context per (model, props, results), shared by the watches and the view of that triple.
  const contexts = new WeakMap<
    object,
    {
      readonly model: unknown;
      readonly props: unknown;
      readonly context: QueryContext;
    }
  >();
  // SAFETY: Struct builds a struct Schema from a fields record at runtime; ResultsSchema names its contract.
  const struct = Schema.Struct as (
    fields: Record<string, Schema.Top>
  ) => ResultsSchema;
  return {
    byName,
    context: (model, props, results = empty) => {
      const found = contexts.get(results);
      if (
        found !== undefined &&
        found.model === model &&
        found.props === props
      ) {
        return found.context;
      }
      const context = make(model, props, results);
      contexts.set(results, { context, model, props });
      return context;
    },
    empty,
    entries,
    logSchema: struct(logFields),
    redacted,
    schema: struct(fields),
    snapshot: (entry, at, result, resultPatched, more) =>
      queryModule().makeSnapshot(
        queryModule().defOf(entry.query),
        entry.name,
        at,
        result,
        resultPatched,
        more
      ),
    snapshotMany: (entry, snapshots) =>
      queryModule().makeSnapshotMap(
        queryModule().defOf(entry.query),
        entry.name,
        snapshots
      ),
  };
};
