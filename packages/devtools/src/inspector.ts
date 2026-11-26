/**
 * The inspector's core: it reads the Wire entries of a message log and keeps
 * what a devtools view asks of them. It has no UI and no Layer.
 *
 * `make` gives an `Inspector`, which keeps one `Session` for each session id
 * it is given entries of. A session holds its last entries in a ring buffer
 * and answers by `seq`: the entry behind a number, the entries an entry
 * names and the ones that name it, the Command run an `update` issued, the
 * Layer builds, Subscriptions, mounts and Command runs of an instance, and
 * the entry an instance's Model is compared with.
 *
 * It reads Wire frames only, so a `Schema.Redacted` value reaches it as the
 * encoder's placeholder and never in clear. It states what the entries say
 * and nothing else: a Command run has a start when the log has its
 * `CommandStarted`, and an end when the log has its end entry.
 */
import type * as Schema from "effect/Schema";

import { isPlaceholder } from "./wire";
import type { InterruptReason, Issued, WireEntry, WireUpdate } from "./wire";

/** One session's entries plus its ingest step, kept by `make` per session id. */
interface SessionStore {
  readonly session: Session;
  readonly ingest: (entry: WireEntry) => void;
}

/** One session's folded state, kept by `makeHistory` per session id. */
interface SessionFold {
  readonly record: (entry: WireEntry, excluded: boolean) => void;
  readonly clear: (upTo: number) => void;
  readonly holds: (seq: number) => boolean;
  readonly at: (seq: number) => HistoryState;
  readonly instanceAt: (
    seq: number,
    instance: number
  ) => Held | "outside" | undefined;
}

/** What `Session.resolve` gives for a `seq` the session doesn't hold. */
export interface Outside {
  readonly _tag: "Outside";
  readonly seq: number;
}

/**
 * How a `Record` ended.
 *
 * A Command run: `"ended"` for `CommandEnded`, `"server"` for
 * `CommandDropped`, `"failed"` for a `Failed` whose `issued` is the run's,
 * and the entry's own `reason` for `CommandInterrupted`. A mount:
 * `MountEnded`'s `reason`. A Layer build: `"ready"`, `"failed"`, or
 * `"unmount"` for one still pending at its instance's `Unmounted`. A
 * Subscription: `"stopped"`, or `"unmount"` for one still going at its
 * instance's `Unmounted`.
 */
export type Reason =
  | InterruptReason
  | "ended"
  | "server"
  | "completed"
  | "closed"
  | "failed"
  | "ready"
  | "stopped";

/** One thing an instance started that goes on for a while. */
export interface Record {
  /** `"layer"`, `"subscription"`, `"mount"` or `"command"`. */
  readonly kind: "layer" | "subscription" | "mount" | "command";
  /** The `instance` number of the instance it belongs to. */
  readonly instance: number;
  /** The Layer's component, the Subscription's or mount's name, or the Command's name. */
  readonly name: string;
  /** A Subscription's key. Only a `"subscription"` record has it. */
  readonly key?: string | undefined;
  /** The entry that issued the run and its index. Only a `"command"` record has it. */
  readonly issued?: Issued | undefined;
  /** The `seq` of the entry that started it. Only a Command run can be without one. */
  readonly start?: number | undefined;
  /** The `seq` of the entry that ended it. */
  readonly end?: number | undefined;
  /** How it ended. */
  readonly reason?: Reason | undefined;
}

/** An instance the session has entries of. */
export interface Instance {
  /** The `instance` number, unique in the session. */
  readonly instance: number;
  /** The instance's path in the tree. */
  readonly path: string;
  /** The instance's component name. */
  readonly component: string;
  /** The `seq` of its `Mounted` entry, when the session was given one. */
  readonly mounted?: number | undefined;
  /** The `seq` of its `Unmounted` entry, when the session was given one. */
  readonly unmounted?: number | undefined;
}

/** What an instance's Command runs and entries come to, kept as entries arrive and leave. */
export interface Summary extends Instance {
  /** The `instance` this one is under. Absent for a root or an orphan. */
  readonly parent?: number | undefined;
  /** Open Command records without a `start`: queued, waiting or stopped first. */
  readonly waiting: number;
  /** Open Command records with a `start`. */
  readonly running: number;
  /** Ended Command records, counted by reason in first-ended order. */
  readonly ended: readonly {
    readonly reason: Reason;
    readonly count: number;
  }[];
  /** The `seq` of the instance's latest activity entry the buffer holds. */
  readonly latest?: number | undefined;
  /** Counts of the instances under this one, at any depth. */
  readonly below: {
    readonly instances: number;
    readonly failing: number;
    readonly running: number;
  };
}

/** One entry naming another. */
export interface Link {
  /** `"causedBy"`, `"issued"`, `"source"` or `"started"`. */
  readonly rel: "causedBy" | "issued" | "source" | "started";
  /** The named `seq`: from `back`, the entry named; from `forward`, the entry that names. */
  readonly seq: number;
  /** The command index, for `"issued"` and `"source"` links that name one. */
  readonly index?: number | undefined;
}

/** The entry an instance's state is compared with. */
export interface Previous {
  /** The `seq` of the instance's state entry before this one. */
  readonly seq: number;
  /** Whether the Model differs: `true`, `false`, or `"unknown"` when only placeholders could differ. */
  readonly changed?: boolean | "unknown" | undefined;
  /** The earlier Model and props, kept across eviction and clear as a baseline. */
  readonly model?: Schema.Json | undefined;
  /** The earlier props, kept across eviction and clear as a baseline. */
  readonly props?: Schema.Json | undefined;
}

/** One difference between two Wire values, at `path`. */
export interface Change {
  /** `"changed"` has both values, `"added"` only `after`, `"removed"` only `before`, `"unknown"` is a placeholder on either side. */
  readonly kind: "changed" | "added" | "removed" | "unknown";
  /** Keys and indexes from the root to the difference. */
  readonly path: readonly (string | number)[];
  /** The value before. */
  readonly before?: Schema.Json | undefined;
  /** The value after. */
  readonly after?: Schema.Json | undefined;
}

/** What an inspector keeps of one session of a message log. */
export interface Session {
  /** The session id. */
  readonly id: string;
  /** The `app` of the session's `SessionStarted`, once the session was given it. */
  readonly app: string | undefined;
  /** The entries in the buffer, oldest first. */
  readonly entries: () => readonly WireEntry[];
  /** The entry with this `seq`, or `Outside` when the buffer doesn't hold it. */
  readonly resolve: (seq: number) => WireEntry | Outside;
  /** The instances, in the order they were first seen. */
  readonly instances: () => readonly Instance[];
  /** How many instances the session has. */
  readonly instanceCount: () => number;
  /** The summary of one instance, by its `instance` number. */
  readonly summary: (instance: number) => Summary | undefined;
  /** The instances with a Command record or a `latest` entry, latest first, and those with no `latest` last. */
  readonly active: () => readonly Summary[];
  /** The instances whose `parent` is `instance`, in first-seen order. With no `instance`, those with no `parent`. */
  readonly children: (instance?: number | undefined) => readonly Summary[];
  /** The instances whose name, last path segment or `component` holds `text`, ignoring case. */
  readonly find: (text: string) => readonly Summary[];
  /** The records of one instance, or of every instance, oldest first within an instance. */
  readonly records: (instance?: number | undefined) => readonly Record[];
  /** The record of the Command run an entry issued at this index. */
  readonly run: (issued: Issued) => Record | undefined;
  /** The entries the entry with this `seq` names. */
  readonly back: (seq: number) => readonly Link[];
  /** The entries in the buffer that name this `seq`, oldest first. */
  readonly forward: (seq: number) => readonly Link[];
  /** For a `Waiting`, `Mounted` or `Update`: the instance's state entry before it. */
  readonly previous: (seq: number) => Previous | undefined;
  /** Empties the buffer, keeping open records, mounted instances and each one's pre-clear baseline. */
  readonly clear: () => void;
}

/** Reads Wire entries into one `Session` for each session id. */
export interface Inspector {
  /** Takes entries in the order they were logged; an entry whose `seq` isn't above the last is ignored. */
  readonly ingest: (batch: readonly WireEntry[]) => void;
  /** The sessions, in the order they were first seen. */
  readonly sessions: () => readonly Session[];
  /** Forgets a session and every entry of it. */
  readonly remove: (session: string) => void;
}

/** An instance's state at one `seq`: the Model, props and query results a repaint starts from. */
export interface Held {
  /** The instance's path in the tree. */
  readonly path: string;
  /** The Model the instance had at the `seq`. */
  readonly model: unknown;
  /** The props the instance had at the `seq`. */
  readonly props: unknown;
  /** The query results the instance had at the `seq`. */
  readonly queries: unknown;
  /** The `seq` of the `Unmounted` entry, when the instance had unmounted by the folded `seq`. */
  readonly unmounted?: number | undefined;
}

/** The repaint lookup for one `seq`: the recorded state at each mounted path. */
export type HistoryState = (path: string) => HeldState | undefined;

/** The recorded state at one mounted path: the Model, props and query results to paint with. */
export interface HeldState {
  /** The Model to paint with. */
  readonly model: unknown;
  /** The props to paint with. */
  readonly props: unknown;
  /** The query results to paint with. */
  readonly queries?: unknown | undefined;
}

/** Folds entries into each instance's state at any held `seq`, for time travel and `get_state`. */
export interface History {
  /** Folds one entry in. Pass `excluded: true` for an update the timeline hides, coalesced per instance. */
  readonly record: (entry: WireEntry, excluded?: boolean | undefined) => void;
  /** Drops every entry at or below `upTo`, folding them into the base. */
  readonly clear: (session: string, upTo: number) => void;
  /** Forgets a session and every entry of it. */
  readonly drop: (session: string) => void;
  /** Whether the `seq` is still a shown entry of the session. */
  readonly holds: (session: string, seq: number) => boolean;
  /** The repaint lookup at `seq`, or `undefined` when the session doesn't hold it. */
  readonly at: (session: string, seq: number) => HistoryState | undefined;
  /** One instance's state at `seq`: its `Held`, or `"outside"` past eviction, or `undefined` for no session. */
  readonly instanceAt: (
    session: string,
    seq: number,
    instance: number
  ) => Held | "outside" | undefined;
}

type InstanceEntry = Exclude<
  WireEntry,
  { readonly _tag: "SessionStarted" | "FetchStarted" }
>;
type Source = WireUpdate["source"];
type Mutable<A> = { -readonly [K in keyof A]: A[K] };

interface Baseline {
  readonly seq: number;
  readonly model: Schema.Json;
  readonly props: Schema.Json;
}

interface InstanceState {
  readonly info: Mutable<Instance>;
  readonly records: Mutable<Record>[];
  readonly subscriptions: Map<string, Mutable<Record>>;
  layer: Mutable<Record> | undefined;
  state: number | undefined;
  latest: Baseline | undefined;
  baseline: Baseline | undefined;
  buffered: number;
  readonly search: string;
  waiting: number;
  running: number;
  readonly ended: Map<Reason, number>;
  lastActive: number | undefined;
  failing: boolean;
  going: boolean;
  readonly parent: InstanceState | undefined;
  readonly children: Set<InstanceState>;
  readonly below: Mutable<Summary["below"]>;
}

const reasonTone = {
  closed: "ok",
  completed: "ok",
  ended: "ok",
  failed: "bad",
  interrupt: "bad",
  layer: "bad",
  ready: "ok",
  self: "bad",
  server: "bad",
  stopped: "ok",
  switch: "bad",
  unmount: "bad",
  // oxlint-disable-next-line typescript/consistent-indexed-object-style -- Record is shadowed by this file's public Record interface; the mapped type is the only spelling.
} satisfies { readonly [K in Reason]: "ok" | "bad" };

const isRun = (
  entry: WireEntry | Outside
): entry is
  | Extract<WireEntry, { readonly _tag: "CommandStarted" }>
  | Extract<WireEntry, { readonly _tag: "CommandEnded" }>
  | Extract<WireEntry, { readonly _tag: "CommandInterrupted" }>
  | Extract<WireEntry, { readonly _tag: "CommandAwaiting" }>
  | Extract<WireEntry, { readonly _tag: "CommandDropped" }> =>
  entry._tag === "CommandStarted" ||
  entry._tag === "CommandEnded" ||
  entry._tag === "CommandInterrupted" ||
  entry._tag === "CommandAwaiting" ||
  entry._tag === "CommandDropped";
const isActivity = (entry: WireEntry): boolean =>
  entry._tag === "Update" || entry._tag === "Failed" || isRun(entry);

type Emit = (
  kind: Change["kind"],
  before?: Schema.Json | undefined,
  after?: Schema.Json | undefined
) => boolean;
interface JsonObject {
  // oxlint-disable-next-line typescript/consistent-indexed-object-style -- Record is shadowed by this file's public Record interface; the index signature is the only spelling.
  readonly [k: string]: Schema.Json;
}

const isObject = (value: Schema.Json): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const walk = (
  before: Schema.Json,
  after: Schema.Json,
  path: (string | number)[],
  emit: Emit
): boolean => {
  if (isPlaceholder(before) || isPlaceholder(after)) {
    return emit("unknown", before, after);
  }
  const stepped = (
    left: Schema.Json | undefined,
    right: Schema.Json | undefined
  ): boolean => {
    if (left === undefined) {
      // SAFETY: `left` is undefined only past `before.length`, so `right` holds the element.
      return emit("added", undefined, right as Schema.Json);
    }
    if (right === undefined) {
      return emit("removed", left);
    }
    return walk(left, right, path, emit);
  };
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      path.push(index);
      // SAFETY: the pushed index is below `length`, so at least one side holds it.
      const left = (index < before.length ? before[index] : undefined) as
        | Schema.Json
        | undefined;
      // SAFETY: the pushed index is below `length`, so at least one side holds it.
      const right = (index < after.length ? after[index] : undefined) as
        | Schema.Json
        | undefined;
      const stop = stepped(left, right);
      path.pop();
      if (stop) {
        return true;
      }
    }
    return false;
  }
  if (isObject(before) && isObject(after)) {
    for (const key of Object.keys(before)) {
      path.push(key);
      // SAFETY: `key` comes from `Object.keys(before)`, so the lookup hits.
      const left = before[key] as Schema.Json;
      // SAFETY: `Object.hasOwn` just confirmed the key when the walk runs; the removed branch needs no lookup.
      const stop = Object.hasOwn(after, key)
        ? walk(left, after[key] as Schema.Json, path, emit)
        : emit("removed", left);
      path.pop();
      if (stop) {
        return true;
      }
    }
    for (const key of Object.keys(after)) {
      if (Object.hasOwn(before, key)) {
        continue;
      }
      path.push(key);
      // SAFETY: `key` comes from `Object.keys(after)`, so the lookup hits.
      const stop = emit("added", undefined, after[key] as Schema.Json);
      path.pop();
      if (stop) {
        return true;
      }
    }
    return false;
  }
  return before !== after && emit("changed", before, after);
};

const compare = (
  before: Schema.Json,
  after: Schema.Json
): boolean | "unknown" => {
  let unknown = false;
  const changed = walk(before, after, [], (kind) => {
    if (kind !== "unknown") {
      return true;
    }
    unknown = true;
    return false;
  });
  return changed || (unknown ? "unknown" : false);
};

/**
 * Every difference between two Wire values, such as the Models of two
 * entries, in the order of `before`'s keys and then `after`'s new ones.
 *
 * Objects are compared key by key and arrays index by index, so an item
 * inserted at the front of an array reads as a change to every item after
 * it. A placeholder is a leaf whose value isn't known, so a place where
 * either value is one is reported as `"unknown"`, even when both are the
 * same placeholder.
 */
export const diff = (
  before: Schema.Json,
  after: Schema.Json
): readonly Change[] => {
  const changes: Change[] = [];
  const path: (string | number)[] = [];
  walk(before, after, path, (kind, from, to) => {
    changes.push({
      kind,
      path: [...path],
      ...(from === undefined ? undefined : { before: from }),
      ...(to === undefined ? undefined : { after: to }),
    });
    return false;
  });
  return changes;
};

const runKey = (issued: Issued): string => `${issued.seq}:${issued.index}`;

const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
};

const matchTags =
  (tags: ReadonlySet<string>): ((entry: WireEntry) => boolean) =>
  (entry) => {
    if (
      entry._tag !== "Update" ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- wire payload narrowed at the inspector boundary before tag matching.
      typeof entry.message !== "object" ||
      entry.message === null ||
      !("_tag" in entry.message)
    ) {
      return false;
    }
    const tag = entry.message._tag;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- wire payload narrowed at the inspector boundary before tag matching.
    return typeof tag === "string" && tags.has(tag);
  };

const shortName = (path: string): string => {
  const boundary = path.lastIndexOf("]/");
  if (boundary !== -1) {
    return path.slice(boundary + 2);
  }
  const bracket = path.indexOf("[");
  return bracket === -1
    ? path.slice(1)
    : path.slice(path.lastIndexOf("/", bracket) + 1);
};

const makeSession = (
  id: string,
  size: number,
  isExcluded: (entry: WireEntry) => boolean
): SessionStore => {
  const entries = new Map<number, WireEntry>();
  const hidden = new Set<number>();
  const coalesced = new Map<number, WireEntry>();
  const instances = new Map<number, InstanceState>();
  const runs = new Map<string, Mutable<Record>>();
  const mounts = new Map<number, Mutable<Record>>();
  const back = new Map<number, Link[]>();
  const forward = new Map<number, Link[]>();
  const previous = new Map<number, Previous>();
  const ended = new Map<number, Mutable<Record>[]>();
  const roots = new Set<InstanceState>();
  const byPath = new Map<string, InstanceState[]>();
  const active = new Set<InstanceState>();
  let app: string | undefined;
  let last = -Infinity;

  const link = (
    from: number,
    rel: Link["rel"],
    seq: number,
    index?: number | undefined
  ): void => {
    push(back, from, index === undefined ? { rel, seq } : { index, rel, seq });
    push(
      forward,
      seq,
      index === undefined ? { rel, seq: from } : { index, rel, seq: from }
    );
  };

  const parentFor = (
    path: string,
    instance: number
  ): InstanceState | undefined => {
    for (
      let end = path.lastIndexOf("/");
      end > 0;
      end = path.lastIndexOf("/", end - 1)
    ) {
      const there = byPath.get(path.slice(0, end));
      if (there === undefined) {
        continue;
      }
      for (let index = there.length - 1; index >= 0; index -= 1) {
        // SAFETY: `index` counts down from `there.length - 1` to 0, so it stays in range.
        const candidate = there[index] as InstanceState;
        if (candidate.info.instance < instance) {
          return candidate;
        }
      }
    }
    return undefined;
  };

  const ancestors = (
    inst: InstanceState,
    f: (below: InstanceState["below"]) => void
  ): void => {
    for (let at = inst.parent; at !== undefined; at = at.parent) {
      f(at.below);
    }
  };

  const tally = (record: Record, by: 1 | -1): void => {
    if (record.kind !== "command") {
      return;
    }
    const inst = instances.get(record.instance);
    if (inst === undefined) {
      return;
    }
    if (record.end === undefined) {
      if (record.start === undefined) {
        inst.waiting += by;
      } else {
        inst.running += by;
      }
      return;
    }
    // SAFETY: `end` and `reason` are always amended together, so a record with `end` set has a `reason`.
    const count = (inst.ended.get(record.reason as Reason) ?? 0) + by;
    if (count === 0) {
      // SAFETY: `end` and `reason` are always amended together, so a record with `end` set has a `reason`.
      inst.ended.delete(record.reason as Reason);
    } else {
      // SAFETY: `end` and `reason` are always amended together, so a record with `end` set has a `reason`.
      inst.ended.set(record.reason as Reason, count);
    }
  };

  const refresh = (inst: InstanceState): void => {
    let failing = false;
    for (const reason of inst.ended.keys()) {
      if (reasonTone[reason] === "bad") {
        failing = true;
      }
    }
    const going = inst.running > 0;
    if (failing !== inst.failing) {
      inst.failing = failing;
      ancestors(inst, (below) => {
        below.failing += failing ? 1 : -1;
      });
    }
    if (going !== inst.going) {
      inst.going = going;
      ancestors(inst, (below) => {
        below.running += going ? 1 : -1;
      });
    }
    if (
      inst.waiting + inst.running + inst.ended.size > 0 ||
      inst.lastActive !== undefined
    ) {
      active.add(inst);
    } else {
      active.delete(inst);
    }
  };

  const add = (inst: InstanceState): void => {
    instances.set(inst.info.instance, inst);
    push(byPath, inst.info.path, inst);
    (inst.parent?.children ?? roots).add(inst);
    ancestors(inst, (below) => {
      below.instances += 1;
    });
  };

  const droppable = (inst: InstanceState): boolean =>
    inst.buffered === 0 &&
    inst.records.length === 0 &&
    inst.children.size === 0 &&
    (inst.info.unmounted !== undefined || inst.info.mounted === undefined);

  const drop = (inst: InstanceState): void => {
    const { path } = inst.info;
    instances.delete(inst.info.instance);
    const same = byPath.get(path);
    if (same !== undefined) {
      if (same.length === 1) {
        byPath.delete(path);
      } else {
        same.splice(same.indexOf(inst), 1);
      }
    }
    (inst.parent?.children ?? roots).delete(inst);
    ancestors(inst, (below) => {
      below.instances -= 1;
    });
    if (inst.parent !== undefined && droppable(inst.parent)) {
      drop(inst.parent);
    }
  };

  const amend = (record: Mutable<Record>, patch: Partial<Record>): void => {
    tally(record, -1);
    Object.assign(record, patch);
    tally(record, 1);
    const owner = instances.get(record.instance);
    if (owner !== undefined) {
      refresh(owner);
    }
  };

  const open = (
    inst: InstanceState,
    record: Mutable<Record>
  ): Mutable<Record> => {
    inst.records.push(record);
    tally(record, 1);
    return record;
  };

  const close = (
    record: Mutable<Record>,
    seq: number,
    reason: Reason
  ): void => {
    amend(record, { end: seq, reason });
    push(ended, seq, record);
  };

  const end = (seq: number, issued: Issued, reason: Reason): void => {
    link(seq, "issued", issued.seq, issued.index);
    const run = runs.get(runKey(issued));
    if (run !== undefined && run.end === undefined) {
      close(run, seq, reason);
    }
  };

  const linkSource = (
    inst: InstanceState,
    from: number,
    source: Source
  ): void => {
    switch (source._tag) {
      case "Command": {
        return link(from, "source", source.issued.seq, source.issued.index);
      }
      case "Subscription": {
        const start = inst.subscriptions.get(source.key)?.start;
        return start === undefined ? undefined : link(from, "source", start);
      }
      case "Query":
      case "Emit":
      case "Failure":
      case "Send":
      case "Shared":
      case "Mount": {
        return link(from, "source", source.seq);
      }
      case "Collected":
      case "DomEvent":
      case "Dispatch": {
        return undefined;
      }
      default: {
        return undefined;
      }
    }
  };

  // oxlint-disable-next-line eslint/complexity -- entry-type state machine; splitting it would churn dispatch behavior.
  const change = (inst: InstanceState, entry: InstanceEntry): void => {
    const { instance, seq } = entry;
    switch (entry._tag) {
      case "Waiting":
      case "Mounted":
      case "Update": {
        if (inst.state !== undefined) {
          const before = entries.get(inst.state);
          let memory: Previous;
          if (before !== undefined && "model" in before) {
            memory = {
              changed: compare(before.model, entry.model),
              seq: inst.state,
            };
          } else if (inst.baseline?.seq === inst.state) {
            // SAFETY: the seq match means `baseline` holds this state's model.
            const baseline = inst.baseline as Baseline;
            memory = {
              ...baseline,
              changed: compare(baseline.model, entry.model),
            };
          } else {
            memory = { seq: inst.state };
          }
          previous.set(seq, memory);
        }
        inst.state = seq;
        inst.latest = { model: entry.model, props: entry.props, seq };
        if (entry._tag === "Waiting") {
          return;
        }
        if (entry._tag === "Mounted") {
          inst.info.mounted = seq;
        } else {
          linkSource(inst, seq, entry.source);
        }
        for (let index = 0; index < entry.commands.length; index += 1) {
          // SAFETY: `index` counts up from 0 below `entry.commands.length`, so it stays in range.
          const command = entry.commands[
            index
          ] as (typeof entry.commands)[number];
          if (command._tag === "Interrupt") {
            continue;
          }
          const issued = { index, seq };
          runs.set(
            runKey(issued),
            open(inst, {
              instance,
              issued,
              kind: "command",
              name: command.name,
            })
          );
        }
        return;
      }
      case "Failed": {
        if (entry.update !== undefined) {
          linkSource(inst, seq, entry.update.source);
        }
        if (entry.issued !== undefined) {
          end(seq, entry.issued, "failed");
        }
        return;
      }
      case "Unmounted": {
        inst.info.unmounted = seq;
        inst.latest = undefined;
        inst.baseline = undefined;
        if (inst.layer !== undefined) {
          close(inst.layer, seq, "unmount");
        }
        inst.layer = undefined;
        for (const record of inst.subscriptions.values()) {
          close(record, seq, "unmount");
        }
        inst.subscriptions.clear();
        return;
      }
      case "LayerPending": {
        inst.layer ??= open(inst, {
          instance,
          kind: "layer",
          name: entry.component,
          start: seq,
        });
        return;
      }
      case "LayerReady":
      case "LayerFailed": {
        if (inst.layer !== undefined) {
          close(
            inst.layer,
            seq,
            entry._tag === "LayerReady" ? "ready" : "failed"
          );
        }
        inst.layer = undefined;
        return;
      }
      case "SubscriptionStarted": {
        const record = open(inst, {
          instance,
          key: entry.key,
          kind: "subscription",
          name: entry.name,
          start: seq,
        });
        inst.subscriptions.set(entry.key, record);
        return;
      }
      case "SubscriptionStopped": {
        const record = inst.subscriptions.get(entry.key);
        if (record === undefined) {
          return;
        }
        close(record, seq, "stopped");
        inst.subscriptions.delete(entry.key);
        return;
      }
      case "MountStarted": {
        mounts.set(
          seq,
          open(inst, { instance, kind: "mount", name: entry.name, start: seq })
        );
        return;
      }
      case "MountEnded": {
        link(seq, "started", entry.started);
        const record = mounts.get(entry.started);
        if (record === undefined) {
          return;
        }
        close(record, seq, entry.reason);
        mounts.delete(entry.started);
        return;
      }
      case "CommandStarted": {
        link(seq, "issued", entry.issued.seq, entry.issued.index);
        const key = runKey(entry.issued);
        let run = runs.get(key);
        if (run === undefined) {
          run = open(inst, {
            instance,
            issued: entry.issued,
            kind: "command",
            name: entry.name,
          });
          runs.set(key, run);
        }
        amend(run, { start: seq });
        return;
      }
      case "CommandAwaiting":
      case "SendDropped": {
        return link(seq, "issued", entry.issued.seq, entry.issued.index);
      }
      case "CommandEnded":
      case "CommandInterrupted":
      case "CommandDropped": {
        return end(
          seq,
          entry.issued,
          entry._tag === "CommandEnded" ? "ended" : entry.reason
        );
      }
      case "PropsChanged":
      case "QueryChanged":
      case "Kept":
      case "Drawn": {
        return undefined;
      }
      default: {
        return undefined;
      }
    }
  };

  const track = (entry: InstanceEntry): void => {
    let inst = instances.get(entry.instance);
    if (inst === undefined) {
      inst = {
        baseline: undefined,
        below: { failing: 0, instances: 0, running: 0 },
        buffered: 0,
        children: new Set(),
        ended: new Map(),
        failing: false,
        going: false,
        info: {
          component: entry.component,
          instance: entry.instance,
          path: entry.path,
        },
        lastActive: undefined,
        latest: undefined,
        layer: undefined,
        parent: parentFor(entry.path, entry.instance),
        records: [],
        running: 0,
        search: `${shortName(entry.path)}\n${entry.component}`.toLowerCase(),
        state: undefined,
        subscriptions: new Map(),
        waiting: 0,
      };
      add(inst);
    }
    inst.buffered += 1;
    if (isActivity(entry) && !hidden.has(entry.seq)) {
      inst.lastActive = entry.seq;
    }
    change(inst, entry);
    refresh(inst);
  };

  const evict = (seq: number, entry: WireEntry, prune = true): void => {
    entries.delete(seq);
    hidden.delete(seq);
    previous.delete(seq);
    for (const named of back.get(seq) ?? []) {
      const kept = forward
        .get(named.seq)
        ?.filter((naming) => naming.seq !== seq);
      if (kept === undefined) {
        continue;
      }
      if (kept.length === 0) {
        forward.delete(named.seq);
      } else {
        forward.set(named.seq, kept);
      }
    }
    back.delete(seq);
    for (const record of ended.get(seq) ?? []) {
      const owner = instances.get(record.instance);
      if (owner !== undefined) {
        owner.records.splice(owner.records.indexOf(record), 1);
        if (record.issued !== undefined) {
          runs.delete(runKey(record.issued));
        }
        tally(record, -1);
        refresh(owner);
      }
    }
    ended.delete(seq);
    if (entry._tag === "SessionStarted" || entry._tag === "FetchStarted") {
      return;
    }
    const inst = instances.get(entry.instance);
    if (inst === undefined) {
      return;
    }
    inst.buffered -= 1;
    if (seq === inst.lastActive) {
      inst.lastActive = undefined;
      refresh(inst);
    }
    if (prune && droppable(inst)) {
      drop(inst);
    }
  };

  const summarize = (inst: InstanceState): Summary => ({
    ...inst.info,
    ...(inst.parent === undefined
      ? undefined
      : { parent: inst.parent.info.instance }),
    below: { ...inst.below },
    ended: Array.from(inst.ended, ([reason, count]) => ({ count, reason })),
    running: inst.running,
    waiting: inst.waiting,
    ...(inst.lastActive === undefined
      ? undefined
      : { latest: inst.lastActive }),
  });

  const session: Session = {
    active: () =>
      [...active]
        .map(summarize)
        .toSorted((a, b) => (b.latest ?? -1) - (a.latest ?? -1)),
    get app() {
      return app;
    },
    back: (seq) => [...(back.get(seq) ?? [])],
    children: (instance) =>
      [
        ...(instance === undefined
          ? roots
          : (instances.get(instance)?.children ?? [])),
      ].map(summarize),
    clear: () => {
      for (const inst of instances.values()) {
        inst.baseline = inst.latest;
      }
      for (const [seq, entry] of entries) {
        evict(seq, entry);
      }
      coalesced.clear();
    },
    entries: () => {
      const all = [...entries.values()];
      return hidden.size === 0
        ? all
        : all.filter((entry) => !hidden.has(entry.seq));
    },
    find: (text) => {
      const needle = text.toLowerCase();
      const found: Summary[] = [];
      for (const inst of instances.values()) {
        if (inst.search.includes(needle)) {
          found.push(summarize(inst));
        }
      }
      return found;
    },
    forward: (seq) => [...(forward.get(seq) ?? [])],
    id,
    instanceCount: () => instances.size,
    instances: () => [...instances.values()].map((inst) => ({ ...inst.info })),
    previous: (seq) => previous.get(seq),
    records: (instance) =>
      (instance === undefined
        ? [...instances.values()].flatMap((inst) => inst.records)
        : (instances.get(instance)?.records ?? [])
      ).map((record) => ({
        ...record,
      })),
    resolve: (seq) => entries.get(seq) ?? { _tag: "Outside", seq },
    run: (issued) => {
      const record = runs.get(runKey(issued));
      return record === undefined ? undefined : { ...record };
    },
    summary: (instance) => {
      const inst = instances.get(instance);
      return inst === undefined ? undefined : summarize(inst);
    },
  };

  return {
    ingest: (entry) => {
      if (entry.seq <= last) {
        return;
      }
      last = entry.seq;
      if (entry._tag === "Update" && isExcluded(entry)) {
        const replaced = coalesced.get(entry.instance);
        if (replaced !== undefined) {
          const inst = instances.get(entry.instance);
          if (inst?.state === replaced.seq) {
            inst.state = previous.get(replaced.seq)?.seq;
          }
          evict(replaced.seq, replaced, false);
        }
        hidden.add(entry.seq);
        coalesced.set(entry.instance, entry);
      } else {
        coalesced.clear();
      }
      entries.set(entry.seq, entry);
      if (entry.causedBy !== undefined) {
        link(entry.seq, "causedBy", entry.causedBy);
      }
      if (entry._tag === "SessionStarted") {
        ({ app } = entry);
      } else if (entry._tag !== "FetchStarted") {
        track(entry);
      }
      for (const [seq, oldest] of entries) {
        if (entries.size - hidden.size <= size) {
          break;
        }
        evict(seq, oldest);
      }
    },
    session,
  };
};

/**
 * Makes an inspector whose sessions each hold their last `size` shown
 * entries (1,000 by default).
 *
 * `exclude` lists message `_tag` values, matched across every component. An
 * `Update` whose message has one of those tags is omitted from `entries`,
 * and a run of them takes one slot per instance: each replaces the
 * instance's earlier excluded entry while no shown entry of any instance
 * sits between them. Links to a replaced entry resolve to `Outside`. The
 * next shown entry is still compared with the latest excluded state.
 *
 * `exclude` is not a way to hide sensitive data: later entries still carry
 * whatever an excluded message changed in the Model. Use `Schema.Redacted`
 * for sensitive values.
 */
export const make = (options?: {
  readonly size?: number | undefined;
  readonly exclude?: readonly string[] | undefined;
}): Inspector => {
  const size = Math.max(1, options?.size ?? 1000);
  const sessions = new Map<string, SessionStore>();
  return {
    ingest: (batch) => {
      for (const entry of batch) {
        let state = sessions.get(entry.session);
        if (state === undefined) {
          state = makeSession(
            entry.session,
            size,
            matchTags(new Set(options?.exclude))
          );
          sessions.set(entry.session, state);
        }
        state.ingest(entry);
      }
    },
    remove: (session) => {
      sessions.delete(session);
    },
    sessions: () => [...sessions.values()].map((state) => state.session),
  };
};

const foldEntry = (
  states: Map<number, Held>,
  entry: WireEntry,
  keepUnmounted: boolean
): void => {
  switch (entry._tag) {
    case "Waiting":
    case "Mounted":
    case "Update": {
      states.set(entry.instance, {
        model: entry.model,
        path: entry.path,
        props: entry.props,
        queries: entry.queries ?? states.get(entry.instance)?.queries,
      });
      return;
    }
    case "PropsChanged": {
      const held = states.get(entry.instance);
      if (held !== undefined) {
        states.set(entry.instance, { ...held, props: entry.props });
      }
      return;
    }
    case "QueryChanged": {
      const held = states.get(entry.instance);
      if (held !== undefined) {
        states.set(entry.instance, {
          ...held,
          queries: isPlaceholder(held.queries)
            ? held.queries
            : {
                // oxlint-disable-next-line anti-slop/no-runtime-typeof -- wire payload narrowed at the fold boundary before spreading prior queries.
                ...(typeof held.queries === "object" &&
                held.queries !== null &&
                !Array.isArray(held.queries)
                  ? held.queries
                  : undefined),
                [entry.name]: entry.result,
              },
        });
      }
      return;
    }
    case "Unmounted": {
      const held = states.get(entry.instance);
      if (keepUnmounted && held !== undefined) {
        states.set(entry.instance, { ...held, unmounted: entry.seq });
      } else {
        states.delete(entry.instance);
      }
      break;
    }
    default: {
      break;
    }
  }
};

const makeSessionHistory = (size: number): SessionFold => {
  const base = new Map<number, Held>();
  const logged: WireEntry[] = [];
  const shown = new Set<number>();
  const coalesced = new Map<number, WireEntry>();
  let floor = -Infinity;
  let last = -Infinity;
  const drop = (): void => {
    // SAFETY: `drop` only runs while `logged` is non-empty, so the shift hits.
    const oldest = logged.shift() as WireEntry;
    floor = oldest.seq;
    shown.delete(oldest.seq);
    if (oldest._tag === "Update" && coalesced.get(oldest.instance) === oldest) {
      coalesced.delete(oldest.instance);
    }
    foldEntry(base, oldest, false);
  };
  const fold = (seq: number): Map<number, Held> => {
    const states = new Map(base);
    for (const entry of logged) {
      if (entry.seq > seq) {
        break;
      }
      foldEntry(states, entry, true);
    }
    return states;
  };
  return {
    at: (seq) => {
      const states = fold(seq);
      const byPath = new Map<string, HeldState>();
      for (const instance of [...states.keys()].toSorted((a, b) => a - b)) {
        // SAFETY: `instance` comes from `states.keys()`, so the lookup hits.
        const { path, unmounted, ...recorded } = states.get(instance) as Held;
        if (unmounted === undefined) {
          byPath.set(path, recorded);
        }
      }
      // A render can log child mounts after the selected entry, even when
      // their cause is at or before it. Changes to a path or ancestor block reuse.
      const dirty = new Set<string>();
      for (const entry of logged) {
        if (entry.seq <= seq) {
          continue;
        }
        switch (entry._tag) {
          case "Mounted":
          case "Waiting": {
            if (
              entry.causedBy !== undefined &&
              entry.causedBy <= seq &&
              !byPath.has(entry.path) &&
              ![...dirty].some(
                (ancestor) =>
                  entry.path === ancestor ||
                  entry.path.startsWith(`${ancestor}/`)
              )
            ) {
              byPath.set(entry.path, {
                model: entry.model,
                props: entry.props,
                queries: entry.queries,
              });
            }
            break;
          }
          case "Update":
          case "PropsChanged":
          case "QueryChanged":
          case "Unmounted": {
            dirty.add(entry.path);
            break;
          }
          default: {
            break;
          }
        }
      }
      return (path) => byPath.get(path);
    },
    clear: (upTo) => {
      // SAFETY: the length check means `logged[0]` is a held WireEntry.
      while (logged.length > 0 && (logged[0] as WireEntry).seq <= upTo) {
        drop();
      }
    },
    holds: (seq) => shown.has(seq),
    instanceAt: (seq, instance) =>
      seq < floor ? "outside" : fold(seq).get(instance),
    record: (entry, excluded = false) => {
      if (entry.seq <= last) {
        return;
      }
      last = entry.seq;
      if (excluded && entry._tag === "Update") {
        const replaced = coalesced.get(entry.instance);
        if (replaced !== undefined) {
          logged.splice(logged.lastIndexOf(replaced), 1);
        }
        const queries =
          replaced !== undefined && "queries" in replaced
            ? replaced.queries
            : undefined;
        // SAFETY: `entry` is already a WireEntry; only its queries field is filled in.
        const merged =
          entry.queries === undefined && queries !== undefined
            ? ({ ...entry, queries } as WireEntry)
            : entry;
        logged.push(merged);
        coalesced.set(entry.instance, merged);
        return;
      }
      coalesced.clear();
      logged.push(entry);
      shown.add(entry.seq);
      while (shown.size > size) {
        drop();
      }
    },
  };
};

/**
 * Makes a per-session state fold: each instance's Model, props and query
 * results at any held `seq`, for time travel and the `get_state` tool.
 *
 * Feed it the same entries as the `Inspector`, with `excluded: true` for an
 * update the timeline hides. `at(seq)` replays from the last evicted base
 * through `seq`, so reads stay accurate while old entries leave the buffer.
 */
export const makeHistory = (size: number): History => {
  const sessions = new Map<string, SessionFold>();
  return {
    at: (session, seq) => {
      const held = sessions.get(session);
      return held === undefined || !held.holds(seq) ? undefined : held.at(seq);
    },
    clear: (session, upTo) => {
      sessions.get(session)?.clear(upTo);
    },
    drop: (session) => {
      sessions.delete(session);
    },
    holds: (session, seq) => sessions.get(session)?.holds(seq) ?? false,
    instanceAt: (session, seq, instance) =>
      sessions.get(session)?.instanceAt(seq, instance),
    record: (entry, excluded) => {
      let session = sessions.get(entry.session);
      if (session === undefined) {
        sessions.set(entry.session, (session = makeSessionHistory(size)));
      }
      session.record(entry, excluded ?? false);
    },
  };
};
