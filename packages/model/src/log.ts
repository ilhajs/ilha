import type * as Atom from "effect/reactivity/Atom";
import { summarizeValue } from "ilha/debug";
import type { InspectValue } from "ilha/debug";

/** Newest entries kept per island instance; older entries drop first. */
export const MODEL_LOG_CAP = 100;

/** One changed top-level model field, summarized before and after. */
export interface ModelLogFieldChange {
  readonly before: InspectValue;
  readonly after: InspectValue;
}

/**
 * How one message changed the model: changed top-level fields for record
 * models, summarized before/after snapshots for anything else.
 */
export type ModelLogDiff =
  | {
      readonly _tag: "fields";
      readonly changed: Readonly<Record<string, ModelLogFieldChange>>;
    }
  | {
      readonly _tag: "snapshot";
      readonly before: InspectValue;
      readonly after: InspectValue;
    };

/** One recorded dispatch: the message, the model change, the work started. */
export interface ModelLogEntry {
  /** `Date.now()` when the message dispatched. */
  readonly at: number;
  /** How many commands the message started. */
  readonly commands: number;
  /** What the message changed in the model. */
  readonly diff: ModelLogDiff;
  /** The message, safely summarized. */
  readonly message: InspectValue;
}

interface InstanceLog {
  readonly entries: ModelLogEntry[];
  readonly generation: number;
}

/** Active `attachModelRecorder` calls; recording runs while above zero. */
let recording = 0;
/** Bumped when the last recorder detaches, orphaning every buffer at once. */
let generation = 0;
/** Per-instance ring buffers, keyed by the model state atom. */
const buffers = new WeakMap<object, InstanceLog>();

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
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
};

/**
 * Summarize without ever throwing: logging must not break `dispatch`. A
 * value whose getter throws records as `"<unserializable>"`.
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
  const prev = new Map(Object.entries(before));
  const next = new Map(Object.entries(after));
  const changed: Record<string, ModelLogFieldChange> = {};
  const fields = new Set([...prev.keys(), ...next.keys()]);
  for (const field of fields) {
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
 * Record every dispatch into a per-island ring buffer. Attach once — the
 * devtools page script does it for you — and read islands back with
 * {@link readModelLog}. The returned detach stops recording and drops every
 * buffer. Detached, `dispatch` pays one flag check and nothing else: no
 * buffer, no serialization, no allocation.
 */
export const attachModelRecorder = (): (() => void) => {
  recording += 1;
  let detached = false;
  return () => {
    if (!detached) {
      detached = true;
      recording -= 1;
      if (recording === 0) {
        generation += 1;
      }
    }
  };
};

/**
 * Read one island's recorded messages. Pass the live atoms from `atomsOf(id)`
 * in `ilha/debug`; returns a copy of the newest entries, oldest first, or
 * `undefined` when no atom has a current log.
 */
export const readModelLog = (
  atoms: readonly unknown[]
): readonly ModelLogEntry[] | undefined => {
  for (const atom of atoms) {
    if (isObject(atom)) {
      const found = buffers.get(atom);
      if (found !== undefined && found.generation === generation) {
        return [...found.entries];
      }
    }
  }
  return undefined;
};

/**
 * Whether any recorder is attached. Internal: `dispatch` checks it before
 * touching the log, so the detached path stays allocation-free.
 */
export const isLogRecording = (): boolean => recording > 0;

/** Record one dispatch. Internal: `dispatch` calls it only while recording. */
export const recordDispatch = <Msg, M>(
  key: Atom.Atom<unknown>,
  message: Msg,
  before: M,
  after: M,
  commands: number
): void => {
  let log = buffers.get(key);
  if (log === undefined || log.generation !== generation) {
    log = { entries: [], generation };
    buffers.set(key, log);
  }
  log.entries.push({
    at: Date.now(),
    commands,
    diff: diffModel(before, after),
    message: safeSummarize(message),
  });
  if (log.entries.length > MODEL_LOG_CAP) {
    log.entries.splice(0, log.entries.length - MODEL_LOG_CAP);
  }
};

/** Drop one instance's log. Internal: runs from the unmount cleanup. */
export const dropLog = (key: Atom.Atom<unknown>): void => {
  buffers.delete(key);
};
