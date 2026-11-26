/**
 * The `MessageLog` service and its no-op default, apart from `MessageLog`: a runtime reads the service
 * from here, so an app that provides no log doesn't ship that module's wire schema and encoder.
 */
import type * as Clock from "effect/Clock";
import * as Context from "effect/Context";

import type * as Log from "../message-log.ts";

/**
 * An entry draft the runtime hands the recorder: the entry's tag and fields,
 * without the `seq`, `at`, `session`, `path`, `instance` and `component` the
 * recorder stamps itself.
 *
 * @internal
 */
export interface Draft {
  readonly _tag: string;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- a draft carries arbitrary entry fields (message, source, lists); the recorder stamps the known ones.
  readonly [field: string]: unknown;
}

/**
 * What the runtime's recorder gives the service: synchronous entry recording
 * plus the causality bookkeeping. Structural: `internal/recorder.ts` (owned
 * by the component runtime) provides it through `load`.
 *
 * @internal
 */
export interface Recording {
  readonly record: (
    instance: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- the recorder keys instances by identity; any runtime value may pass through.
    draft: Draft
  ) => number | undefined;
  readonly step: <A>(f: () => A) => A;
  readonly session: <A>(f: () => A) => A;
  readonly follow: (late?: boolean) => <A>(f: () => A) => A;
  readonly tree: (draft: Draft) => void;
  readonly numberOf: (instance: unknown) => number | undefined; // oxlint-disable-line anti-slop/no-unknown-parameters -- the recorder keys instances by identity; any runtime value may pass through.
}

/** @internal */
export const noop: Log.MessageLog = {
  enabled: false,
  record: () => {
    // The no-op log records nothing.
  },
};

/** @internal */
export const MessageLog: Context.Reference<Log.MessageLog> =
  Context.Reference<Log.MessageLog>("@ilha/model/MessageLog", {
    defaultValue: () => noop,
  });

const run = <A>(f: () => A): A => f();

/** @internal */
export const silent: Recording = {
  follow: () => run,
  numberOf: () => undefined, // oxlint-disable-line unicorn/no-useless-undefined -- the silent recording numbers no instances, so undefined is the value.
  record: () => undefined, // oxlint-disable-line unicorn/no-useless-undefined -- the silent recording stores nothing, so undefined is the value.
  session: run,
  step: run,
  tree: () => {
    // The silent recording stores nothing.
  },
};

/** @internal */
export let recorder: // oxlint-disable-line import/no-mutable-exports -- late-bound once by load when the kernel module registers its recorder.
  | ((
      log: Log.MessageLog,
      clock: Clock.Clock,
      session: string,
      app: string
    ) => Recording)
  | undefined;

/** @internal */
export const load = (make: NonNullable<typeof recorder>): void => {
  recorder = make;
};
/**
 * The page-global log `MessageLog.attach` installed (devtools uses this).
 * While set, every kernel records into it in addition to any per-registry
 * log. `attachSeq` bumps on every attach and detach so kernels rebuild
 * their global recording and re-emit `SessionStarted`.
 *
 * @internal
 */
export let attached: Log.MessageLog | undefined; // oxlint-disable-line import/no-mutable-exports -- the page-global sink installed by attachGlobal; cleared on detach.

/** @internal */
export let attachSeq = 0; // oxlint-disable-line import/no-mutable-exports -- bumped on every attach and detach so kernels rebuild their global recording.

/**
 * Install `log` as the page-global sink, returning a detach function that
 * removes it again only if it is still the installed one.
 *
 * @internal
 */
export const attachGlobal = (log: Log.MessageLog): (() => void) => {
  attached = log;
  attachSeq += 1;
  return () => {
    if (attached === log) {
      attached = undefined;
      attachSeq += 1;
    }
  };
};
