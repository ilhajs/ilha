/**
 * The message log for `@ilha/model` islands. `@ilha/model` hands each
 * dispatch over as raw values; this module summarizes, diffs, and buffers
 * them, so apps never ship that code.
 */
import { summarizeValue } from "ilha/debug";
import type { InspectValue } from "ilha/debug";

import type {
  ModelLogDiff,
  ModelLogEntry,
  ModelLogFieldChange,
} from "./protocol";

/** Newest entries kept per island instance; older entries drop first. */
export const MODEL_LOG_CAP = 100;

/** One dispatch from `@ilha/model`, restated so this package loads without it. */
export interface DispatchRecord {
  readonly instance: object;
  readonly message: unknown;
  readonly before: unknown;
  readonly after: unknown;
  readonly commands: number;
}

/** A log fed by `attachModelRecorder(log.record)` and read per island. */
export interface ModelLog {
  /** Pass to `attachModelRecorder` from `@ilha/model`. */
  readonly record: (dispatch: DispatchRecord) => void;
  /**
   * The newest entries of the island whose atoms are `atoms` (from
   * `atomsOf(id)` in `ilha/debug`), oldest first, or `undefined` when none
   * of them dispatched while recording.
   */
  readonly read: (
    atoms: readonly object[]
  ) => readonly ModelLogEntry[] | undefined;
}

const UNSAFE_KEY = /^(?:__proto__|constructor|prototype)$/u;

const isObject = <T>(value: T): value is T & object =>
  typeof value === "object" && value !== null;

/** Plain records and arrays diff by field; everything else snapshots whole. */
const isDiffable = <T>(value: T): value is T & object => {
  if (!isObject(value)) {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
};

/**
 * Summarize without ever throwing: a value whose getter throws records as
 * `"<unserializable>"` instead of breaking the recorder.
 */
const safeSummarize = <T>(value: T): InspectValue => {
  try {
    return summarizeValue(value);
  } catch {
    return "<unserializable>";
  }
};

const diffModel = <M>(before: M, after: M): ModelLogDiff => {
  if (!isDiffable(before) || !isDiffable(after)) {
    return {
      _tag: "snapshot",
      after: safeSummarize(after),
      before: safeSummarize(before),
    };
  }
  const prev = new Map<string, unknown>(Object.entries(before));
  const next = new Map<string, unknown>(Object.entries(after));
  const changed: Record<string, ModelLogFieldChange> = {};
  for (const field of new Set([...prev.keys(), ...next.keys()])) {
    if (
      !UNSAFE_KEY.test(field) &&
      !Object.is(prev.get(field), next.get(field))
    ) {
      changed[field] = {
        after: safeSummarize(next.get(field)),
        before: safeSummarize(prev.get(field)),
      };
    }
  }
  return { _tag: "fields", changed };
};

/**
 * Create a message log. Buffers are keyed by each island's model atom, so an
 * unmounted island's buffer goes away with it.
 */
export const createModelLog = (): ModelLog => {
  const buffers = new WeakMap<object, ModelLogEntry[]>();
  return {
    read: (atoms) => {
      const found = atoms.find((atom) => buffers.has(atom));
      const entries = found === undefined ? undefined : buffers.get(found);
      return entries === undefined ? undefined : [...entries];
    },
    record: ({ after, before, commands, instance, message }) => {
      let entries = buffers.get(instance);
      if (entries === undefined) {
        entries = [];
        buffers.set(instance, entries);
      }
      entries.push({
        at: Date.now(),
        commands,
        diff: diffModel(before, after),
        message: safeSummarize(message),
      });
      if (entries.length > MODEL_LOG_CAP) {
        entries.splice(0, entries.length - MODEL_LOG_CAP);
      }
    },
  };
};
