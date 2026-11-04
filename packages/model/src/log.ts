import * as Effect from "effect/Effect";

/**
 * One dispatch as an attached recorder sees it: raw values, nothing copied
 * or summarized. Summarizing, diffing, and buffering belong to the
 * recorder, so apps never ship that code.
 */
export interface DispatchRecord {
  /**
   * The island instance's model atom. Join it against `atomsOf(id)` from
   * `ilha/debug` to find which island dispatched.
   */
  readonly instance: object;
  /** The dispatched message. */
  readonly message: unknown;
  /** The model `update` received. */
  readonly before: unknown;
  /** The model `update` returned. */
  readonly after: unknown;
  /** How many commands the message started. */
  readonly commands: number;
}

/** Receives every dispatch while attached. */
export type ModelRecorder = (record: DispatchRecord) => void;

/** Attached recorders; `dispatch` builds a record only while non-empty. */
const recorders = new Set<{ readonly recorder: ModelRecorder }>();

/**
 * Hand every `dispatch` of every model island to `recorder` until the
 * returned detach runs. The devtools page script attaches one for you.
 * Detached, `dispatch` pays one size check: no record, no allocation. A
 * recorder that throws is logged and never breaks `dispatch`.
 */
export const attachModelRecorder = (recorder: ModelRecorder): (() => void) => {
  // A fresh wrapper per call, so attaching the same function twice needs
  // two detaches.
  const entry = { recorder };
  recorders.add(entry);
  return () => {
    recorders.delete(entry);
  };
};

/** Whether any recorder is attached. Internal: `dispatch` checks it first. */
export const isRecording = (): boolean => recorders.size > 0;

/** Deliver one dispatch to every recorder. Internal: `dispatch` calls it. */
export const recordDispatch = (record: DispatchRecord): void => {
  for (const { recorder } of recorders) {
    try {
      recorder(record);
    } catch (error) {
      Effect.runSync(Effect.logError("@ilha/model recorder failed", error));
    }
  }
};
