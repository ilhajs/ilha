import type * as Clock from "effect/Clock";

import type * as MessageLog from "../message-log.ts";
import type { InstanceRecord } from "./kernel.ts";
import type * as Kernel from "./kernel.ts";
/**
 * The runtime's recorder: entry seq assignment, `causedBy` causality and
 * instance numbering, stamped around the kernel's drafts. Ported from
 * Effect UI's `internal/recorder.ts`, adapted to the island kernel's
 * `InstanceRecord` (no Layer boundaries, query cache or shared state yet;
 * see `kernel.md`).
 *
 * Registered with `internal/message-log.ts` through `load` on import.
 *
 * @internal
 */
import type { Recording } from "./message-log.ts";

// Set once by the kernel module, which owns component logging.
let loggedComponentOf: typeof Kernel.loggedComponentOf = () => {
  throw new Error("recorder used before the kernel bound loggedComponentOf");
};

/**
 * Give the recorder the kernel's component logging. Called once by the
 * kernel module.
 *
 * @internal
 */
export const bindRecorderKernel = (hooks: {
  readonly loggedComponentOf: typeof Kernel.loggedComponentOf;
}): void => {
  ({ loggedComponentOf } = hooks);
};

interface Starting {
  seq: number | undefined;
}

interface Stamp {
  readonly seq: number;
  readonly causedBy?: number | undefined;
  readonly at: number;
  readonly session: string;
}

// SAFETY: DomEvent is the Source union member for synthetic dispatches; name is its only field.
const dispatched: MessageLog.Source = {
  _tag: "DomEvent",
  name: "dispatch",
} as MessageLog.Source;

/**
 * Build the recording for one island: `log` decides whether anything is
 * written, `clock` stamps `at`, `session`/`app` scope the entries.
 *
 * @internal
 */
export const make = (
  log: MessageLog.MessageLog,
  clock: Pick<Clock.Clock, "currentTimeMillisUnsafe">,
  session: string,
  app: string
): Recording => {
  const numbers = new WeakMap<InstanceRecord, number>();
  const seqs = new WeakMap<InstanceRecord, number>();
  let born = 0;
  let seq = 0;
  let origin: number | undefined;
  let depth = 0;
  let starting: Starting | undefined;
  const number = (): number => {
    seq += 1;
    const next = seq;
    const cause = origin;
    if (starting !== undefined) {
      origin = cause ?? next;
      starting.seq = origin;
      starting = undefined;
    }
    return next;
  };
  const under = <A>(
    cause: number | undefined,
    f: () => A,
    start = false
  ): A => {
    const was = origin;
    const wasStarting = starting;
    origin = cause;
    starting =
      start && cause === undefined && log.enabled
        ? { seq: undefined }
        : undefined;
    depth += 1;
    try {
      return f();
    } finally {
      depth -= 1;
      origin = was;
      starting = wasStarting;
    }
  };
  const step = <A>(f: () => A): A =>
    depth > 0 ? f() : under(undefined, f, true);
  const stamp = (cause: number | undefined, next: number): Stamp => ({
    seq: next,
    ...(cause === undefined ? undefined : { causedBy: cause }),
    at: clock.currentTimeMillisUnsafe(),
    session,
  });
  const sourceOf = (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- dispatch-time value decoded into a Source by the guards below.
    source: unknown
  ): MessageLog.Source => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- selects the DomEvent shorthand; the returned Source is the domain value.
    if (typeof source === "string") {
      return { _tag: "DomEvent", name: source };
    }
    // Dispatch sources are child instance records, told by their discriminant.
    const kind =
      typeof source === "object" && // oxlint-disable-line anti-slop/no-runtime-typeof -- validates the dispatch record before reading its kind tag.
      source !== null &&
      "kind" in source
        ? source.kind
        : undefined;
    if (kind === "record") {
      // SAFETY: the kind tag above identifies a child instance record; status, path and identity reads below are read-only.
      const inst = source as InstanceRecord;
      // SAFETY: Emit and Failure share the Source union with this exact field set; the discriminant above selects the right member.
      return {
        _tag: inst.status === "closed" ? "Failure" : "Emit",
        path: inst.path,
        seq: seqs.get(inst) ?? -1,
      } as MessageLog.Source;
    }
    // SAFETY: a non-record source is a Source the caller already built, or nothing when the log is disabled.
    return (source as MessageLog.Source | undefined) ?? dispatched;
  };
  const record: Recording["record"] = (instance, draft) => {
    // SAFETY: the kernel keys instances by identity; the record reads definition, status and path read-only.
    const inst = instance as InstanceRecord;
    if (!log.enabled) {
      return;
    }
    let instanceNumber = numbers.get(inst);
    if (instanceNumber === undefined) {
      numbers.set(inst, (instanceNumber = born));
      born += 1;
    }
    const cause = origin;
    const next = number();
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- the entry is assembled from draft, stamp and recorder fields, then recorded as an Entry below.
    const entry: Record<string, unknown> = {
      ...draft,
      ...stamp(cause, next),
      component: loggedComponentOf(inst.definition),
      instance: instanceNumber,
      path: inst.path,
    };
    switch (draft._tag) {
      case "Update": {
        // SAFETY: Update drafts always carry the dispatch source; Draft's open fields hold it unchecked.
        entry["source"] = sourceOf(draft["source"]);
        if (draft["viewTransition"] === undefined) {
          delete entry["viewTransition"];
        }
        entry["lists"] = draft["lists"] ?? [];
        entry["sends"] = draft["sends"] ?? [];
        seqs.set(inst, next);
        break;
      }
      case "Mounted": {
        seqs.set(inst, next);
        break;
      }
      case "Failed": {
        if (draft["issued"] === undefined) {
          delete entry["issued"];
        }
        // SAFETY: Failed drafts carry the failed update or nothing; the union below re-establishes the field contract.
        const update = draft["update"] as
          | { readonly message: unknown; readonly source: unknown }
          | undefined;
        if (update === undefined) {
          delete entry["update"];
        } else {
          entry["update"] = {
            message: update.message,
            source: sourceOf(update.source),
          };
        }
        seqs.set(inst, next);
        break;
      }
      default: {
        break;
      }
    }
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: the switch above normalizes every draft variant into its Entry field set; the record holds exactly those fields.
    log.record(entry as unknown as MessageLog.Entry);
    return next;
  };
  void app;
  // SAFETY: instance identity keys the recorder's tables; the tree and number reads below only re-establish the Entry contract.
  return {
    follow: (late) => {
      const from = origin;
      const opening = late ? starting : undefined;
      return from === undefined && opening === undefined
        ? step
        : (f) => {
            const cause = from ?? opening?.seq;
            return cause === undefined ? step(f) : under(cause, f);
          };
    },
    numberOf: (instance) => numbers.get(instance as InstanceRecord),
    record,
    session: (f) => {
      if (!log.enabled) {
        return under(undefined, f);
      }
      seq += 1;
      const next = seq;
      log.record({
        _tag: "SessionStarted",
        app,
        ...stamp(undefined, next),
      });
      return under(next, f);
    },
    step,
    tree: (draft) => {
      if (!log.enabled) {
        return;
      }
      // SAFETY: the tree draft plus stamp is the entry's field set; the record holds exactly those fields.
      log.record({
        ...draft,
        ...stamp(origin, number()),
      } as MessageLog.Entry);
    },
  };
};
