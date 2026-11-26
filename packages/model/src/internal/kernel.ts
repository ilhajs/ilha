import * as Cause from "effect/Cause";
import type * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { Client, h as coreH } from "ilha";
import type { AtomHandle, View, VNode } from "ilha";
/**
 * The island-scoped kernel: instance records keyed by path, dispatch,
 * failure, Commands, Subscriptions, snapshots and the log hookup. One
 * kernel per `AtomRegistry` (one per island); records may outlive their
 * Ilha fiber, which is what keep-alive builds on.
 *
 * See `spec/kernel.md` for the record layout, lifecycle hooks and the
 * extension points slices plug into.
 *
 * @internal
 */
import {
  getFiber,
  onFiberClose,
  onRuntimeClose,
  readTracked,
  withFiber,
} from "ilha/internal";
import type { FiberLocal, HFn, IlhaRuntime, PropBag } from "ilha/internal";

import type * as Command from "../command.ts";
import { groupKeyOf, nameOf } from "../command.ts";
import type * as Component from "../component.ts";
import {
  bindModelRenderer,
  initStepOf,
  isStep,
  makeUpdateApi,
} from "../component.ts";
import type * as Dom from "../dom.ts";
import type * as MessageLog from "../message-log.ts";
import type * as Mount from "../mount.ts";
import type * as Subscription from "../subscription.ts";
import { isDirect } from "../subscription.ts";
import { readCallProps, routeEmit } from "./child.ts";
import type { ChildProps } from "./child.ts";
import { baseEnv, registerRef } from "./dom-env.ts";
import {
  bindKeepAliveCloser,
  bindKeepAliveFail,
  bindKeepAliveH,
  bindKeptRunKernel,
  checkKeepAliveDouble,
  isKeptParked,
  keepAliveHelper,
  keptPaths,
  keepsAlive,
  processKept,
} from "./kept-run.ts";
import {
  bindLayerRunKernel,
  bootProvide,
  provideSettled,
  reselectProvide,
  stashProvideCommand,
} from "./layer-run.ts";
import { bindLazyKernel } from "./lazy.ts";
import {
  attached as attachedLog,
  attachSeq as attachedSeq,
  load as loadRecorder,
  recorder as loadedRecorder,
  silent,
} from "./message-log.ts";
import type { Draft, Recording } from "./message-log.ts";
import {
  bindMountRunKernel,
  mountRef,
  stopAll as stopAllMounts,
} from "./mount-run.ts";
import { isNoop } from "./noop.ts";
import {
  bindPartsRunKernel,
  checkChildCall,
  isHeadlessImpl,
  makePartsHelper,
} from "./parts-run.ts";
import {
  checkChildPaths,
  collectChildren,
  definitionNameOf,
  segmentOf,
} from "./paths.ts";
import { boundOf, componentBindingOf } from "./query-core.ts";
import {
  bindQueryRunKernel,
  disposeIsland as disposeQueryIsland,
  registerQueryRun,
} from "./query-run.ts";
import { bindRecorderKernel, make as makeRecorder } from "./recorder.ts";
import { deliverable, next, schedule } from "./schedule.ts";
import {
  bindSharedRunKernel,
  readsOf,
  sharesOf,
  applySends,
  baselineCollects,
  dueReports,
  leaveShared,
  readsRecord,
  refreshOwner,
} from "./shared-run.ts";
import {
  bindOutletRenderer,
  checkSlotPlacements,
  patchSlotOutlets,
  resetPlacements,
  slotHelpers,
  slotOutletOf,
} from "./slots.ts";
import { isRedactedState, modelCodecOf } from "./state-codec.ts";
import { duplicateKey } from "./subscriptions.ts";

loadRecorder(makeRecorder);
registerQueryRun();

/**
 * A dispatch source: a DOM event name, the Command run or Subscription key
 * that sent the message, or the child instance that emitted it (mapped to
 * `Emit`/`Failure` by the recorder).
 *
 * @internal
 */
export type DispatchSource =
  | { readonly _tag: "DomEvent"; readonly name: string }
  | {
      readonly _tag: "Subscription";
      readonly key: string;
      readonly name: string;
      readonly deps: readonly (string | number | boolean | null)[] | undefined;
    }
  | {
      readonly _tag: "Command";
      readonly name: string;
      readonly issued: MessageLog.Issued;
      readonly spanId: string | undefined;
      readonly traceId: string | undefined;
    }
  | {
      readonly _tag: "Query";
      readonly name: string;
      readonly seq: number | undefined;
    }
  | {
      readonly _tag: "Mount";
      readonly seq: number;
      readonly name: string;
      readonly args: unknown;
      readonly argsSchema: Schema.Top;
    }
  | { readonly _tag: "Send"; readonly path: string; readonly seq: number }
  | {
      readonly _tag: "Shared";
      readonly name: string;
      readonly path: string;
      readonly seq: number;
    }
  | { readonly _tag: "Collected" }
  | { readonly _tag: "Devtools" }
  | InstanceRecord;

/**
 * One island's runtime: the records by path, the log wiring, problems for
 * the test host, and per-component redaction warnings.
 *
 * @internal
 */
export interface IslandKernel {
  readonly registry: AtomRegistry;
  /** Instance records by path. */
  readonly records: Map<string, InstanceRecord>;
  readonly fibers: WeakMap<object, InstanceRecord>;
  /**
   * The record owning each hole fiber's props box. Ilha paints a component
   * nested inside plain elements with a shallow fiber copy (`{...fiber}`),
   * so the copy's `.parent` skips the real parent fiber; the copy shares
   * the parent's props box object, which never happens across records.
   */
  readonly boxOwners: WeakMap<object, InstanceRecord>;
  /** The instance whose view wrote each model-component vnode, by vnode identity. First walk wins. */
  readonly writtenBy: WeakMap<object, InstanceRecord>;
  log: MessageLog.MessageLog;
  clock: Pick<Clock.Clock, "currentTimeMillisUnsafe">;
  recording: Recording;
  recordingLog: MessageLog.MessageLog | undefined;
  /** Whether the first entry was recorded into the per-registry log (wrapped in a session). */
  localStarted: boolean;
  /** The page-global log the global recording fans out to, if still attached. */
  globalLog: MessageLog.MessageLog | undefined;
  /** The page-global recording (rebuilt when `attach`/`detach` bump the slot). */
  globalRecording: Recording;
  /** The attach slot generation the global recording was built for. */
  globalSeq: number;
  /** Whether the first entry was recorded into the global log. */
  globalStarted: boolean;
  app: string;
  session: string;
  /** Set while devtools time travel shows a historical copy; the live island keeps running hidden. */
  paused: boolean;
  /** Whether the first hydrating paint settled: components mounted later run init sends/emits normally. */
  hydrationDone: boolean;
  readonly problems: unknown[];
  readonly warnedRedacted: Set<string>;
}

let islandSeq = 0;
const kernels = new WeakMap<AtomRegistry, IslandKernel>();
/** Every live island kernel, for devtools session enumeration. Islands live for the page's lifetime. */
const liveKernels = new Set<IslandKernel>();

const silentLog: MessageLog.MessageLog = {
  enabled: false,
  record: () => {
    // Disabled: no test host or devtools attached, so entries are dropped.
  },
};

/**
 * The kernel for the island `registry` belongs to, creating it on first
 * use. Records die with the kernel, and the kernel with the registry.
 *
 * @internal
 */
export const kernelOf = (registry: AtomRegistry): IslandKernel => {
  let kernel = kernels.get(registry);
  if (kernel === undefined) {
    islandSeq += 1;
    kernel = {
      app: `island-${islandSeq}`,
      boxOwners: new WeakMap(),
      clock: { currentTimeMillisUnsafe: () => Date.now() },
      fibers: new WeakMap(),
      globalLog: undefined,
      globalRecording: silent,
      globalSeq: attachedSeq,
      globalStarted: false,
      hydrationDone: false,
      localStarted: false,
      log: silentLog,
      paused: false,
      problems: [],
      recording: silent,
      recordingLog: undefined,
      records: new Map(),
      registry,
      session: `island-${islandSeq}`,
      warnedRedacted: new Set(),
      writtenBy: new WeakMap(),
    };
    kernels.set(registry, kernel);
    liveKernels.add(kernel);
  }
  return kernel;
};

/**
 * Point an island's kernel at a `MessageLog` (the test host and devtools do
 * this). The log is off by default and costs nothing when off: entry drafts
 * are built only when `log.enabled`.
 *
 * @internal
 */
export const setLog = (
  registry: AtomRegistry,
  log: MessageLog.MessageLog,
  clock?: Pick<Clock.Clock, "currentTimeMillisUnsafe"> | undefined
): void => {
  const kernel = kernelOf(registry);
  kernel.log = log;
  if (clock !== undefined) {
    kernel.clock = clock;
  }
  // SAFETY: the recorder only reads currentTimeMillisUnsafe, which kernel.clock always provides.
  kernel.recording =
    log.enabled && loadedRecorder !== undefined
      ? loadedRecorder(
          log,
          kernel.clock as Clock.Clock,
          kernel.session,
          kernel.app
        )
      : silent;
  kernel.recordingLog = log.enabled ? log : undefined;
  kernel.localStarted = false;
};
/**
 * Every live island kernel, for devtools session enumeration.
 *
 * @internal
 */
export const islands = (): readonly IslandKernel[] => [...liveKernels];

/**
 * The record mounted at `path` in the island `registry`, if it exists.
 *
 * @internal
 */
export const recordOf = (
  registry: AtomRegistry,
  path: string
): InstanceRecord | undefined => kernels.get(registry)?.records.get(path);

/**
 * The live Model of every live record in the island, by path. Records that
 * cannot report (closing, parked without a fiber value) are skipped.
 *
 * @internal
 */
export const snapshotModels = (
  registry: AtomRegistry
): ReadonlyMap<string, unknown> => {
  const out = new Map<string, unknown>();
  const kernel = kernels.get(registry);
  if (kernel === undefined) {
    return out;
  }
  for (const [path, rec] of kernel.records) {
    if (rec.status !== "live") {
      continue;
    }
    try {
      out.set(path, rec.model());
    } catch {
      continue;
    }
  }
  return out;
};

/**
 * The component message Schema of a definition, for devtools dispatch
 * decoding.
 *
 * @internal
 */
// SAFETY: DefinitionAny carries its declared message Schema; messageSchemaOf only exposes it for devtools decoding.
export const messageSchemaOf = (
  definition: Component.DefinitionAny
): Schema.Top => definition.message as Schema.Top;

/**
 * Deliver an already-decoded message to the instance at `path` through the
 * normal update and logging path. Returns `false` when the path is missing
 * or closed.
 *
 * @internal
 */
export const dispatchAtPath = (
  registry: AtomRegistry,
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- devtools delivers pre-decoded messages; the update API validates them before use.
  message: unknown
): boolean => {
  const rec = kernels.get(registry)?.records.get(path);
  if (rec === undefined || rec.status !== "live") {
    return false;
  }
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  dispatch(rec, { _tag: "Devtools" }, message);
  return true;
};

/**
 * Mark the island paused while devtools shows a historical copy. The live
 * island keeps running hidden; painting and resume belong to the caller.
 *
 * @internal
 */
export const setSessionPaused = (
  registry: AtomRegistry,
  paused: boolean
): void => {
  const kernel = kernels.get(registry);
  if (kernel !== undefined) {
    kernel.paused = paused;
  }
};

/**
 * Whether the island is paused for devtools time travel.
 *
 * @internal
 */
export const isSessionPaused = (registry: AtomRegistry): boolean =>
  kernels.get(registry)?.paused ?? false;

/**
 * The island's host element: the root the first record's fiber paints into.
 * `undefined` before anything mounts.
 *
 * @internal
 */
export const hostOf = (registry: AtomRegistry): Element | undefined => {
  const kernel = kernels.get(registry);
  if (kernel === undefined) {
    return undefined;
  }
  for (const rec of kernel.records.values()) {
    if (rec.fiber.root instanceof Element) {
      return rec.fiber.root;
    }
  }
  return undefined;
};
/**
 * Whether an entry draft is worth building: either the per-registry log or
 * the page-global log wants it. When both are off this is two cheap
 * checks and the draft is never built.
 *
 * @internal
 */
export const kernelHasLog = (kernel: IslandKernel): boolean =>
  kernel.recording !== silent || attachedLog !== undefined;

/**
 * The kernel's page-global recording, rebuilt when `attach`/`detach` bump
 * the slot (so a fresh attach re-emits `SessionStarted`). Disabled or
 * detached means no global recording.
 */
const globalRecordingOf = (kernel: IslandKernel): Recording | undefined => {
  const log = attachedLog;
  if (log === undefined || !log.enabled) {
    kernel.globalLog = undefined;
    kernel.globalSeq = attachedSeq;
    return undefined;
  }
  if (kernel.globalLog !== log || kernel.globalSeq !== attachedSeq) {
    kernel.globalLog = log;
    kernel.globalSeq = attachedSeq;
    // SAFETY: the recorder only reads currentTimeMillisUnsafe, which kernel.clock always provides.
    kernel.globalRecording =
      loadedRecorder === undefined
        ? silent
        : loadedRecorder(
            log,
            kernel.clock as Clock.Clock,
            kernel.session,
            kernel.app
          );
    kernel.globalStarted = false;
  }
  return kernel.globalRecording === silent ? undefined : kernel.globalRecording;
};

/**
 * Record one draft, wrapping the kernel's first entry per sink in a
 * session so each log gets its own `SessionStarted` per root.
 */
const recordOnce = (
  kernel: IslandKernel,
  recording: Recording,
  which: "local" | "global",
  rec: InstanceRecord,
  draft: Draft
): number | undefined => {
  // SAFETY: Recording.record returns the entry seq for this draft; the silent recording never reaches this call.
  const run = (): number | undefined =>
    recording.record(rec, draft) as number | undefined;
  if (which === "local") {
    if (!kernel.localStarted) {
      kernel.localStarted = true;
      return recording.session(run);
    }
    return run();
  }
  if (!kernel.globalStarted) {
    kernel.globalStarted = true;
    return recording.session(run);
  }
  return run();
};

/**
 * Record one entry draft into the per-registry log, the page-global log,
 * or both. Returns the per-registry `seq` when present. The keep-alive and
 * shared slices log `Kept`/`Drawn`/`SendDropped` through this.
 *
 * @internal
 */
export const recordEntry = (
  rec: InstanceRecord,
  draft: Draft
): number | undefined => {
  const { kernel } = rec;
  const local = kernel.recording === silent ? undefined : kernel.recording;
  const global = globalRecordingOf(kernel);
  if (local === undefined && global === undefined) {
    return undefined;
  }
  const seq =
    local === undefined
      ? undefined
      : recordOnce(kernel, local, "local", rec, draft);
  if (global !== undefined) {
    const gseq = recordOnce(kernel, global, "global", rec, draft);
    // Follow-ups reference entries by seq: the page-global log is the one
    // devtools reads, so its seq wins when both logs record.
    return gseq ?? seq;
  }
  return seq;
};

/**
 * Record a `QueryChanged` entry for a query result the runtime wrote, and
 * return its seq for the `onChange` message's source. Used by the query
 * runtime; a no-op without a log.
 *
 * @internal
 */
export const recordQueryChanged = (
  rec: InstanceRecord,
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- query results are author-defined snapshots; recorded verbatim into the QueryChanged draft.
  result: unknown
): number | undefined => {
  if (!kernelHasLog(rec.kernel)) {
    return undefined;
  }
  return recordEntry(rec, { _tag: "QueryChanged", name, result });
};

/**
 * Record a tree-level `FetchStarted` entry for a query cache fetch. Tree
 * entries carry no path or instance: the fetch is reported once per
 * island, whatever records watch it.
 *
 * @internal
 */
export const recordFetchStarted = (
  kernel: IslandKernel,
  event: {
    readonly query: string;
    readonly logKey: string;
    readonly trigger: MessageLog.FetchTrigger;
    readonly restart: boolean;
    readonly inWindow: boolean;
    readonly stored: boolean;
    readonly page?: number | undefined;
    readonly cursor?: Schema.Json | undefined;
  }
): void => {
  const local = kernel.recording === silent ? undefined : kernel.recording;
  const global = globalRecordingOf(kernel);
  if (local === undefined && global === undefined) {
    return;
  }
  const draft: Draft = { _tag: "FetchStarted", ...event };
  if (local !== undefined) {
    if (kernel.localStarted) {
      local.tree(draft);
    } else {
      kernel.localStarted = true;
      local.session(() => {
        local.tree(draft);
      });
    }
  }
  if (global !== undefined) {
    if (kernel.globalStarted) {
      global.tree(draft);
    } else {
      kernel.globalStarted = true;
      global.session(() => {
        global.tree(draft);
      });
    }
  }
};

/**
 * Re-render a record outside a render: the server path, where query
 * results arrive after the first paint and nothing subscribes to them.
 * On the client the results atom's subscription re-renders instead, so
 * this is a no-op there.
 *
 * @internal
 */
export const refreshForQuery = (rec: InstanceRecord): void => {
  if (rec.status !== "live" || rec.fiber.closed) {
    return;
  }
  if (!rec.fiber.runtime.ssr) {
    return;
  }
  withFiber(rec.fiber, () =>
    rec.fiber.paint(
      // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
      renderModelComponent(
        rec.fiber,
        rec.definition,
        rec.implementation,
        rec.callRaw
      )
    )
  );
};

/**
 * Deliver a query `onChange` message to an instance, with the `QueryChanged`
 * entry's seq as its source.
 *
 * @internal
 */
export const dispatchQueryMessage = (
  rec: InstanceRecord,
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- query onChange messages are author-defined; the update API validates them before use.
  message: unknown,
  seq: number | undefined
): void => {
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  dispatch(rec, { _tag: "Query", name, seq }, message);
};

/**
 * Fail an instance from a query watch: an `args` throw, a missing fetcher
 * or a defect. Query failures use the `subscription` source.
 *
 * @internal
 */
export const failQuery = (
  rec: InstanceRecord,
  cause: unknown,
  key?: string | undefined
): void => {
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  failOutside(
    rec,
    "subscription",
    cause,
    key === undefined ? undefined : { name: key }
  );
};

/** Hold the island runtime's pending count across a query fetch. @internal */
export const holdRender = (rec: InstanceRecord): void => {
  rec.fiber.runtime.begin();
};

/** Release a {@link holdRender} hold. @internal */
export const releaseRender = (rec: InstanceRecord): void => {
  rec.fiber.runtime.end();
};

/**
 * A live Command run: the scheduler entry plus its fiber control.
 *
 * @internal
 */
export interface RunControl {
  name: string;
  key: string | undefined;
  mode: Command.Mode;
  status: "running" | "queued" | "awaiting" | "stopping";
  readonly command: Command.Issued<unknown, never>;
  readonly issued: MessageLog.Issued;
  interruptFiber: (() => void) | undefined;
  stopped: boolean;
  stopReason: MessageLog.InterruptReason | undefined;
  spanId: string | undefined;
  traceId: string | undefined;
  elementCount: number;
  allNoop: boolean;
  /** Self-reference: satisfies the scheduler's `Entry.value`. */
  value: RunControl;
  /** The query cache's run handle, for Service Commands with query declarations. */
  query: unknown;
  /** The `afterRefetch` wait cancel, while a refetch wait is pending. */
  wait: { readonly cancel: () => void } | undefined;
  /** A delivered result waiting for its turn under `queue`, or a held `afterRefetch` success. */
  pendingMessage: unknown;
  /** How a held `afterRefetch` success's wait ended, once it may deliver. */
  readyWait:
    | {
        readonly waitEnded: MessageLog.WaitEnded;
        readonly outstanding: readonly MessageLog.AwaitedEntry[];
      }
    | undefined;
}

/**
 * A live Subscription key: its declaration, fiber control and, for
 * `direct`, its latest state and detach function.
 *
 * @internal
 */
export interface SubControl {
  readonly key: string;
  readonly name: string;
  readonly deps: readonly (string | number | boolean | null)[] | undefined;
  readonly declaration: Subscription.Subscription<unknown, never>;
  interrupt: (() => void) | undefined;
  detach: (() => void) | undefined;
  latest: unknown;
  ended: boolean;
  stopped: boolean;
}

/**
 * One model-component vnode from an author's view walk, with the instance
 * that wrote it. A tree parent records these so mounting children resolve
 * their author even when the vnode was forwarded through `h.children`.
 *
 * @internal
 */
export interface WalkedChild {
  readonly name: string;
  readonly key: string;
  readonly path: string;
  readonly author: InstanceRecord;
  /** The vnode the author wrote, for keep-alive tagging checks. */
  readonly vnode: VNode;
}

/**
 * An instance record: everything the kernel knows about one mounted
 * component. Keyed by path in the kernel; extensions carry shared state,
 * provide/Env, keep-alive, slots, mounts and query bindings (see
 * `spec/kernel.md`).
 *
 * @internal
 */
export interface InstanceRecord {
  readonly kind: "record";
  readonly kernel: IslandKernel;
  readonly definition: Component.DefinitionAny;
  readonly implementation: Component.MakeImpl<unknown, unknown, never>;
  readonly name: string;
  readonly path: string;
  readonly parent: InstanceRecord | undefined;
  /** The instance whose view wrote this instance's vnode (SPEC §4.1). Usually the parent; differs for forwarded vnodes. */
  author: InstanceRecord | undefined;
  fiber: FiberLocal;
  /** The decoded props. */
  props: unknown;
  /** The call options the author wrote (or defaults): `onEmit`, `onFailure`, `fallback`, `children`. */
  callProps: ChildProps;
  /** The raw call options, kept so the query runtime can re-render the record outside a render. */
  callRaw: Component.CallOptions<unknown, never>;
  model: AtomHandle<unknown>;
  /** Bumped on running-state and failure changes the view subscribes to. */
  signal: AtomHandle<number>;
  status: "live" | "failed" | "closed";
  failureCause: Cause.Cause<unknown> | undefined;
  readonly runs: RunControl[];
  readonly subs: Map<string, SubControl>;
  /** Child paths from the last successful view walk. */
  children: Set<string>;
  /** The last walk's children with their authors: what mounts resolve against. */
  lastWalk: WalkedChild[];
  /** The Layer environment Commands and Subscriptions resolve (`provide` fills this on settle). */
  env: Context.Context<never>;
  /** Extension state, keyed by slice (`"keepAlive"`, `"queries"`, ...). */
  readonly extensions: Map<string, unknown>;
  /** Close hooks slices register (run on record close). */
  readonly onClose: (() => void)[];
  /** Releases for the record's slot-free state atoms, run when the record closes. */
  readonly atomReleases: (() => void)[];
}

const toError = (cause: unknown): Error => {
  if (cause instanceof Error) {
    return cause;
  }
  if (Cause.isCause(cause)) {
    return new Error(Cause.pretty(cause));
  }
  return new Error(String(cause));
};

const toCause = (cause: unknown): Cause.Cause<unknown> =>
  Cause.isCause(cause) ? cause : Cause.die(cause);

const escapeId = (value: string): string =>
  value.replaceAll(
    /[^A-Za-z0-9]/gu,
    (char) => `_${(char.codePointAt(0) ?? 0).toString(36)}_`
  );

const nearestRecord = (
  kernel: IslandKernel,
  fiber: FiberLocal | undefined
): InstanceRecord | undefined => {
  for (let at = fiber; at !== undefined; at = at.parent) {
    const found = kernel.fibers.get(at);
    if (found !== undefined) {
      return found;
    }
    // A component nested inside plain elements renders on a shallow fiber
    // copy whose `.parent` skips the real parent fiber; the copy shares
    // the parent hole's props box, so it still resolves to the parent.
    // SAFETY: the loop condition guarantees at is defined; the cast recovers narrowing the for-condition does not preserve.
    const box = (at as FiberLocal).propsBox;
    if (box !== undefined) {
      const viaBox = kernel.boxOwners.get(box);
      if (viaBox !== undefined) {
        return viaBox;
      }
    }
  }
  return undefined;
};

const discoverKey = (
  parent: InstanceRecord | undefined,
  fiber: FiberLocal
): string => {
  // A keyed list stamps its rows on the rendering fiber's `keyedHoles`: walk
  // the hole's ancestors to the fiber that rendered it. Without a model
  // parent (a keyed list straight under a plain root) this walk is the only
  // thing separating the rows' paths.
  for (
    let at: FiberLocal | undefined = fiber.parent;
    at !== undefined;
    at = at.parent
  ) {
    const keyed = at.keyedHoles;
    if (keyed !== undefined) {
      for (const [key, hole] of keyed) {
        if (hole === fiber) {
          return key;
        }
      }
    }
  }
  if (parent === undefined) {
    return "";
  }
  const keyed = parent.fiber.keyedHoles;
  if (keyed !== undefined) {
    for (const [key, hole] of keyed) {
      if (hole === fiber) {
        return key;
      }
    }
  }
  return "";
};

interface Flush {
  types: Set<string> | undefined;
  active: boolean;
  /** Per-flush `$.send` counts for the 100-round loop guard. */
  sendCounts: Map<InstanceRecord, number>;
}

const canTransition = (): boolean => {
  // SAFETY: document is an optional DOM API probed for view transitions; guarded by undefined checks below.
  const doc = (
    globalThis as {
      readonly document?: { readonly startViewTransition?: unknown };
    }
  ).document;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- feature-detecting the optional DOM view-transition API, which has no Schema boundary.
  if (doc === undefined || typeof doc.startViewTransition !== "function") {
    return false;
  }
  // SAFETY: matchMedia is an optional DOM API; guarded by the function check below.
  const { matchMedia } = globalThis as {
    readonly matchMedia?: (query: string) => { readonly matches: boolean };
  };
  if (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- feature-detecting the optional DOM matchMedia API, which has no Schema boundary.
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return false;
  }
  return true;
};

const startTransition = (types: readonly string[], fn: () => void): void => {
  // SAFETY: document is an optional DOM API probed for view transitions; guarded by the function check below.
  const doc = (
    globalThis as {
      readonly document?: { readonly startViewTransition?: unknown };
    }
  ).document;
  // SAFETY: startViewTransition is untyped in this DOM lib; called only after the function check below.
  const start = doc?.startViewTransition as
    | ((...args: readonly unknown[]) => void)
    | undefined;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- feature-detecting the optional DOM view-transition API, which has no Schema boundary.
  if (typeof start !== "function") {
    fn();
    return;
  }
  try {
    if (types.length > 0) {
      start.call(doc, { types: [...types], update: fn });
    } else {
      start.call(doc, fn);
    }
  } catch {
    fn();
  }
};

const bumpSignal = (rec: InstanceRecord): void => {
  if (!rec.fiber.closed) {
    rec.signal.update((n) => n + 1);
  }
};

const shallowComponentOf = (
  definition: Component.DefinitionAny
): MessageLog.LoggedComponent => {
  const shares = sharesOf(definition);
  const extra: OptionalDefinitionFields = {};
  if (shares?.sharesSchema !== undefined) {
    extra.sharesSchema = shares.sharesSchema;
  }
  return {
    definition: {
      events: definition.events,
      message: definition.message,
      model: definition.model,
      name: definition.name,
      props: definition.props,
      receives: shares?.receivesSchema ?? Schema.Never,
      ...extra,
    },
  };
};

/**
 * The `LoggedComponent` view the recorder stamps on every entry.
 *
 * @internal
 */
export const loggedComponentOf = (
  definition: Component.DefinitionAny
): MessageLog.LoggedComponent => {
  const shares = sharesOf(definition);
  const reads = readsOf(definition);
  const extra: OptionalDefinitionFields = {};
  if (shares?.sharesSchema !== undefined) {
    extra.sharesSchema = shares.sharesSchema;
  }
  if (reads.length > 0) {
    extra.reads = reads.map((read) => ({
      name: read.name,
      owner: shallowComponentOf(read.owner),
    }));
  }
  return {
    definition: {
      events: definition.events,
      message: definition.message,
      model: definition.model,
      name: definition.name,
      props: definition.props,
      receives: shares?.receivesSchema ?? Schema.Never,
      ...extra,
    },
  };
};

const toLoggedCommands = (
  commands: readonly Command.Command<unknown, never>[]
): readonly MessageLog.LoggedCommand[] =>
  commands.map((command) => {
    if (command._tag === "Interrupt") {
      return {
        _tag: "Interrupt" as const,
        args: undefined,
        argsSchema: Schema.Unknown,
        groupKey: command.groupKey,
        name: command.name,
      };
    }
    return {
      _tag: command._tag,
      args: command.args,
      argsSchema: command.argsSchema,
      groupKey: command.groupKey,
      name: command.name,
    };
  });

/** Optional `LoggedDefinition` fields, built by statement so absent fields stay absent. */
interface OptionalDefinitionFields {
  sharesSchema?: Schema.Top | undefined;
  reads?: readonly MessageLog.LoggedRead[] | undefined;
}

/** An entry draft under construction: optional fields are added by statement. */
interface MutableDraft {
  _tag: string;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- entry drafts carry arbitrary fields; the recorder stamps the known ones.
  [field: string]: unknown;
}

const recordUpdate = (
  rec: InstanceRecord,
  source: DispatchSource,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- update messages are author-defined; the update API validates them before use.
  message: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- update models are author-defined snapshots; recorded verbatim into the draft.
  model: unknown,
  commands: readonly Command.Command<unknown, never>[],
  events: readonly unknown[],
  viewTransition: readonly string[] | undefined,
  sends: readonly Component.StepSend[],
  shared: MessageLog.SharedRecord | undefined,
  lists: readonly Component.ListIssue[] = [],
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- query results are author-defined snapshots keyed by name; recorded verbatim.
  queries: Record<string, unknown> | undefined = undefined
): number => {
  if (!kernelHasLog(rec.kernel)) {
    return -1;
  }
  const draft: MutableDraft = {
    _tag: "Update",
    commands: toLoggedCommands(commands),
    events,
    lists: lists.map((list) => ({ name: list.name, op: list.op })),
    message,
    model,
    props: rec.props,
    sends: sends.map((send) => {
      // A send owner is a headless component: the definition rides on the
      // function, the same identity `reads` normalizes and `applySends` resolves.
      let owner: Component.DefinitionAny;
      if (send.owner === "self") {
        owner = rec.definition;
      } else {
        const carried: unknown =
          "definition" in send.owner ? send.owner.definition : send.owner;
        // SAFETY: headless owners carry the definition on the function or as the definition itself; reads normalizes the same identity.
        owner = carried as Component.DefinitionAny;
      }
      return { message: send.message, owner: loggedComponentOf(owner) };
    }),
    // SAFETY: DispatchSource is recorded opaquely; the log decodes it by _tag.
    source: source as unknown,
  };
  if (shared !== undefined) {
    draft.shared = shared;
  }
  if (queries !== undefined) {
    draft.queries = queries;
  }
  if (viewTransition !== undefined) {
    draft.viewTransition = viewTransition;
  }
  return recordEntry(rec, draft) ?? -1;
};

const recordMounted = (
  rec: InstanceRecord,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- mounted models are author-defined snapshots; recorded verbatim into the draft.
  model: unknown,
  commands: readonly Command.Command<unknown, never>[],
  events: readonly unknown[],
  adopted: boolean,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- query results are author-defined snapshots keyed by name; recorded verbatim.
  queries?: Record<string, unknown> | undefined
): number => {
  if (!kernelHasLog(rec.kernel)) {
    return -1;
  }
  const draft: MutableDraft = {
    _tag: "Mounted",
    adopted,
    commands: toLoggedCommands(commands),
    events,
    model,
    props: rec.props,
  };
  if (queries !== undefined) {
    draft.queries = queries;
  }
  return recordEntry(rec, draft) ?? -1;
};

interface FailureExtra {
  readonly name?: string | undefined;
  readonly issued?: MessageLog.Issued | undefined;
  readonly message?: unknown | undefined;
  readonly source?: DispatchSource | undefined;
}

const recordFailed = (
  rec: InstanceRecord,
  where: MessageLog.FailedIn,
  cause: Cause.Cause<unknown>,
  extra?: FailureExtra | undefined
): void => {
  if (!kernelHasLog(rec.kernel)) {
    return;
  }
  const draft: MutableDraft = {
    _tag: "Failed",
    cause,
    in: where,
    props: rec.props,
  };
  if (extra?.name !== undefined) {
    draft.name = extra.name;
  }
  if (extra?.issued !== undefined) {
    draft.issued = extra.issued;
  }
  if (extra?.message !== undefined) {
    draft.update = { message: extra.message, source: extra.source ?? rec };
  }
  recordEntry(rec, draft);
};

const finishClose = (rec: InstanceRecord): void => {
  rec.kernel.records.delete(rec.path);
  rec.kernel.fibers.delete(rec.fiber);
  for (const release of rec.atomReleases.splice(0)) {
    try {
      release();
    } catch {
      // Atom releases must not break unmount.
    }
  }
  for (const hook of rec.onClose) {
    try {
      hook();
    } catch {
      // Close hooks must not break unmount.
    }
  }
};

/**
 * Close a record: interrupt its runs, stop its subscriptions, drop it from
 * the kernel. Closes descendants by path prefix first, so a parent's close
 * never orphans a forwarded child. Idempotent.
 *
 * @internal
 */
export const closeRecord = (
  rec: InstanceRecord,
  reason: MessageLog.InterruptReason
): void => {
  if (rec.status === "closed") {
    return;
  }
  const prefix = `${rec.path}/`;
  for (const [path, child] of rec.kernel.records) {
    if (path.startsWith(prefix) && child.status !== "closed") {
      closeRecord(child, reason);
    }
  }
  rec.status = "closed";
  // oxlint-disable-next-line unicorn/no-useless-spread -- stopRun splices rec.runs via removeRun; the snapshot prevents skips.
  for (const run of [...rec.runs]) {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    stopRun(rec, run, reason);
  }
  for (const sub of rec.subs.values()) {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    stopSub(rec, sub);
  }
  leaveShared(rec);
  finishClose(rec);
};

/**
 * Tear down a whole island: close every record (even parked keep-alive
 * records: the island is gone), dispose the query cache and its browser
 * signals, and drop the kernel from the live set.
 */
const teardownIsland = (kernel: IslandKernel): void => {
  for (const rec of kernel.records.values()) {
    if (rec.status !== "closed") {
      closeRecord(rec, "unmount");
    }
  }
  disposeQueryIsland(kernel);
  liveKernels.delete(kernel);
};

/** Hook island teardown to the runtime's close, once per island. */
const hookedRuntimes = new WeakSet<AtomRegistry>();
const ensureIslandTeardown = (
  kernel: IslandKernel,
  runtime: IlhaRuntime
): void => {
  if (hookedRuntimes.has(kernel.registry)) {
    return;
  }
  hookedRuntimes.add(kernel.registry);
  onRuntimeClose(runtime, () => teardownIsland(kernel));
};

const closeChildren = (rec: InstanceRecord): void => {
  for (const path of rec.children) {
    const child = rec.kernel.records.get(path);
    if (child !== undefined && child.parent === rec) {
      closeRecord(child, "unmount");
    }
  }
  rec.children = new Set();
};

const markFailed = (
  rec: InstanceRecord,
  where: MessageLog.FailedIn,
  cause: unknown,
  extra?: FailureExtra | undefined
): void => {
  if (rec.status === "closed") {
    return;
  }
  if (rec.status === "failed") {
    return;
  }
  rec.status = "failed";
  rec.failureCause = toCause(cause);
  // oxlint-disable-next-line unicorn/no-useless-spread -- stopRun splices rec.runs via removeRun; the snapshot prevents skips.
  for (const run of [...rec.runs]) {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    stopRun(rec, run, "unmount");
  }
  for (const sub of rec.subs.values()) {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    stopSub(rec, sub);
  }
  stopAllMounts(rec);
  closeChildren(rec);
  recordFailed(rec, where, rec.failureCause, extra);
  if (rec.parent === undefined) {
    rec.fiber.runtime.onError?.(toError(cause));
  } else {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    scheduleOnFailure(rec);
  }
};

const scheduleOnFailure = (rec: InstanceRecord): void => {
  queueMicrotask(() => {
    // SAFETY: composedOf holds the composer's record when a composed child fails; set by the composition runtime.
    const composer = rec.extensions.get("composedOf") as
      | InstanceRecord
      | undefined;
    if (composer !== undefined) {
      if (composer.status !== "live") {
        return;
      }
      // SAFETY: onFailure is the author's optional failure callback; the undefined check below guards the call.
      const onFailure = rec.callProps.onFailure as
        // oxlint-disable-next-line anti-slop/no-unknown-returns -- onFailure returns the author's failure message; the update path validates it.
        ((failure: AsyncResult.Failure<never, unknown>) => unknown) | undefined;
      if (onFailure === undefined) {
        return;
      }
      let message: unknown;
      try {
        message = onFailure(
          AsyncResult.failure(rec.failureCause ?? Cause.die("unknown failure"))
        );
      } catch (error) {
        // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
        failOutside(composer, "onFailure", error);
        return;
      }
      if (message !== undefined) {
        // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
        dispatch(composer, rec, message);
      }
      return;
    }
    const { author } = rec;
    if (
      author === undefined ||
      author === rec ||
      author.status !== "live" ||
      author.fiber.closed
    ) {
      return;
    }
    // SAFETY: onFailure is the author's optional failure callback; the undefined check below guards the call.
    const onFailure = rec.callProps.onFailure as
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- onFailure returns the author's failure message; the update path validates it.
      ((failure: AsyncResult.Failure<never, unknown>) => unknown) | undefined;
    if (onFailure === undefined) {
      return;
    }
    let message: unknown;
    try {
      message = onFailure(
        AsyncResult.failure(rec.failureCause ?? Cause.die("unknown failure"))
      );
    } catch (error) {
      // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
      failOutside(author, "onFailure", error);
      return;
    }
    if (message !== undefined) {
      // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
      dispatch(author, rec, message);
    }
  });
};

const renderFallback = (rec: InstanceRecord): View => {
  // SAFETY: fallback is the author's optional failure view; the undefined check below guards the call.
  const fallback = rec.callProps.fallback as ChildProps["fallback"];
  if (fallback === undefined) {
    return "";
  }
  try {
    return fallback(
      AsyncResult.failure(rec.failureCause ?? Cause.die("unknown failure"))
    );
  } catch (error) {
    recordFailed(rec, "fallback", toCause(error));
    return "";
  }
};
/**
 * Fail an instance from inside its render: mark it, close its scope and
 * children, report, and answer with the author's `fallback`.
 */
const failView = (
  rec: InstanceRecord,
  where: MessageLog.FailedIn,
  cause: unknown,
  extra?: FailureExtra | undefined
): View => {
  markFailed(rec, where, cause, extra);
  bumpSignal(rec);
  return renderFallback(rec);
};

/**
 * Fail an instance from outside its render (a Command, Subscription or
 * scheduled callback): mark it and rerender with the fallback.
 *
 * @internal
 */
export const failOutside = (
  rec: InstanceRecord,
  where: MessageLog.FailedIn,
  cause: unknown,
  extra?: FailureExtra | undefined
): void => {
  markFailed(rec, where, cause, extra);
  bumpSignal(rec);
};

const runUpdateHandler = (
  rec: InstanceRecord,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- update messages are author-defined; dispatched to the author's update handler.
  message: unknown
): Component.Step<unknown, never> => {
  // SAFETY: queriesForUpdate returns the bound query results for this record; undefined when the component declares none.
  const queries = componentBindingOf()?.run.queriesForUpdate(rec) as
    | Component.QueryResults<Component.QuerySpec>
    | undefined;
  const reads = readsRecord(rec);
  // SAFETY: implementation.update is the author's update function or per-tag record; the typeof branch below selects the matching use.
  const update = rec.implementation.update as
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- author's update function returns a step or a value the update API wraps into one.
    | ((...args: readonly unknown[]) => unknown)
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- author's update record maps tags to handlers returning steps or values the API wraps.
    | Record<string, (...args: readonly unknown[]) => unknown>;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- branching on the author's update shape (function vs per-tag record), which has no Schema.
  if (typeof update === "function") {
    // SAFETY: makeUpdateApi takes the message opaquely for set(); never is the API's contravariant slot.
    const api = makeUpdateApi<unknown, never, unknown>(
      // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
      modelForUpdate(rec),
      rec.props,
      undefined,
      reads,
      queries,
      message as never
    );
    // SAFETY: update returns the author's step or a value the update API wraps; unknown only widens the union.
    const out = update(api, message) as
      | Component.Step<unknown, never>
      | unknown;
    // SAFETY: isStep narrows the author's step; api.set wraps any other value into a step.
    return (isStep(out) ? out : api.set(out)) as Component.Step<unknown, never>;
  }
  // SAFETY: author messages are tagged records; missing _tag throws below.
  const tag = (message as { readonly _tag?: unknown })._tag;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- branching on the author's update shape (function vs per-tag record), which has no Schema.
  if (typeof tag !== "string") {
    throw new TypeError(
      `${rec.path} got a message with no _tag, but its update is a per-tag record`
    );
  }
  // SAFETY: update holds the author's per-tag handlers when it is not a function; the function check above selected this branch.
  const handler =
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- per-tag handlers are author functions returning steps or values the update API wraps.
    (update as Record<string, (...args: readonly unknown[]) => unknown>)[tag];
  if (handler === undefined) {
    throw new Error(`${rec.path} has no update handler for "${tag}"`);
  }
  // SAFETY: makeUpdateApi takes the message opaquely for set(); never is the API's contravariant slot.
  const tagged = makeUpdateApi<unknown, never, unknown>(
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    modelForUpdate(rec),
    rec.props,
    tag,
    reads,
    queries,
    message as never
  );
  // SAFETY: handler results are author steps or values the update API wraps; unknown only widens the union.
  const out = handler(tagged, message) as
    | Component.Step<unknown, never>
    | unknown;
  // SAFETY: isStep narrows the author's step; api.set wraps any other value into a step.
  return (isStep(out) ? out : tagged.set(out)) as Component.Step<
    unknown,
    never
  >;
};

/**
 * Deliver a message to an instance: run `update`, apply the Model, issue
 * Commands, emit to the author. Drops the message when the instance is
 * failed or closed. Synchronous; emit chains recurse with a loop guard.
 *
 * @internal
 */
export const dispatch = (
  rec: InstanceRecord,
  source: DispatchSource,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- dispatch delivers author messages; the update API validates them before use.
  message: unknown,
  depth = 0,
  flush?: Flush
): void => {
  if (rec.status !== "live" || (rec.fiber.closed && !isKeptParked(rec))) {
    return;
  }
  if (depth > 100) {
    failOutside(
      rec,
      "update",
      new Error(
        `${rec.path} exceeded 100 nested emits: check for an emit ping-pong between parent and child`
      )
    );
    return;
  }
  let step: Component.Step<unknown, never>;
  try {
    step = runUpdateHandler(rec, message);
  } catch (error) {
    failOutside(rec, "update", error, { message, source });
    return;
  }
  if (rec.status !== "live") {
    return;
  }
  const shared =
    readsOf(rec.definition).length > 0 ? readsRecord(rec) : undefined;
  if (rec.status !== "live") {
    return;
  }
  const ctx = flush ?? {
    active: false,
    sendCounts: new Map(),
    types: undefined,
  };
  ctx.sendCounts ??= new Map();
  if (step.viewTransitionTypes !== undefined) {
    ctx.types ??= new Set();
    for (const type of step.viewTransitionTypes) {
      ctx.types.add(type);
    }
  }
  // SAFETY: step.commands are the author's issued Commands; recordUpdate logs them structurally.
  const seq = recordUpdate(
    rec,
    source,
    message,
    step.model,
    step.commands as readonly Command.Command<unknown, never>[],
    step.events,
    step.viewTransitionTypes,
    step.sends,
    shared,
    step.lists,
    componentBindingOf()?.run.logResults(rec)
  );
  const apply = (): void => {
    if (rec.status !== "live" || (rec.fiber.closed && !isKeptParked(rec))) {
      return;
    }
    rec.model.set(step.model);
    refreshOwner(rec, seq);
    // A keyed provide reads the new Model here, so Commands issued below run
    // against the fresh selection (or wait for its build).
    reselectProvide(rec);
    // oxlint-disable-next-line eslint/no-use-before-define -- SAFETY: issueCommands only interrupts live runs; calls run after module init.
    issueCommands(
      rec,
      step.commands as readonly Command.Command<unknown, never>[],
      seq
    );
    componentBindingOf()?.run.applyLists(rec, step.lists);
    applySends(rec, step.sends, seq, ctx.sendCounts, (owner, outgoing) =>
      dispatch(
        owner,
        { _tag: "Send", path: rec.path, seq },
        outgoing,
        depth + 1,
        ctx
      )
    );
    if (rec.status !== "live") {
      return;
    }
    for (const event of step.events) {
      // SAFETY: composedOf holds the composer's record when a composed child fails; set by the composition runtime.
      const composer = rec.extensions.get("composedOf") as
        | InstanceRecord
        | undefined;
      if (composer !== undefined) {
        // SAFETY: the author's onEmit is the handler the child vnode's call options carry; routeEmit validates the event.
        const outgoing = routeEmit(
          rec.callProps.onEmit as never,
          event as never
        );
        if (outgoing !== undefined) {
          dispatch(composer, rec, outgoing, depth + 1, ctx);
        }
        continue;
      }
      const { author } = rec;
      if (author === undefined || author === rec) {
        continue;
      }
      // The handlers live on the child's own call options: the author wrote
      // them into this vnode, so they arrive in `rec.callProps`, not in the
      // author's own call options (those belong to the author's parent).
      // SAFETY: the author's onEmit is the handler the child vnode's call options carry; routeEmit validates the event.
      const outgoing = routeEmit(rec.callProps.onEmit as never, event as never);
      if (outgoing !== undefined) {
        dispatch(author, rec, outgoing, depth + 1, ctx);
      }
    }
    // SAFETY: composedOf holds the composer's record when a composed child fails; set by the composition runtime.
    const composer = rec.extensions.get("composedOf") as
      | InstanceRecord
      | undefined;
    if (composer !== undefined && composer.status === "live") {
      bumpSignal(composer);
    }
  };
  if (
    flush === undefined &&
    !ctx.active &&
    ctx.types !== undefined &&
    canTransition()
  ) {
    ctx.active = true;
    // The transition callback may run later: stage the Model now so a
    // dispatch that lands before it applies reads fresh state instead of
    // clobbering this update.
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    pendingTransitionModels.set(rec, step.model);
    try {
      startTransition([...ctx.types], () => {
        try {
          apply();
        } finally {
          // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
          pendingTransitionModels.delete(rec);
        }
      });
    } finally {
      ctx.active = false;
    }
  } else {
    apply();
  }
};

const serviceName = (tag: Context.Key<never, unknown>): string => {
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: Context keys carry a debug key; the unknown-service fallback covers opaque keys.
  const keyed = tag as unknown as { readonly key?: unknown };
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- selecting the debug name for log output, not branching on domain semantics.
  return typeof keyed.key === "string" ? keyed.key : "unknown service";
};

/**
 * The effective env of a record: every ancestor delta merged outermost-first,
 * so the nearest record wins. Provided Layers land in the providing record's
 * delta on settle, which is why descendants see them without re-mounting.
 * Exported for Feature and Query, which resolve services from a view.
 */
export const resolveEnv = (rec: InstanceRecord): Context.Context<never> => {
  const chain: InstanceRecord[] = [];
  for (
    let at: InstanceRecord | undefined = rec;
    at !== undefined;
    at = at.parent
  ) {
    chain.unshift(at);
  }
  // SAFETY: the island starts with no Layer environment; Context.empty is the neutral element merges build on.
  let out = Context.empty() as Context.Context<never>;
  for (const at of chain) {
    out = Context.merge(out, at.env);
  }
  return out;
};

const hasService = (
  rec: InstanceRecord,
  tag: Context.Key<never, unknown>
): boolean => Option.isSome(Context.getOption(resolveEnv(rec), tag));

/**
 * No Command runs on the server. `init` Commands are dropped silently (the
 * client runs them on adopt); `update` Commands log `CommandDropped` and
 * report a `ServerCommandIssued` problem.
 */
const dropServerCommands = (
  rec: InstanceRecord,
  commands: readonly Command.Command<unknown, never>[],
  seq: number,
  origin: "init" | "update"
): void => {
  let index = 0;
  for (const command of commands) {
    const issued = { index, seq };
    index += 1;
    if (command._tag === "Interrupt") {
      continue;
    }
    if (command._tag !== "Effect" && command._tag !== "Stream") {
      continue;
    }
    // `init` Commands run again on the client after adoption; only `update`
    // Commands are reported.
    if (origin === "init") {
      continue;
    }
    if (kernelHasLog(rec.kernel)) {
      recordEntry(rec, {
        _tag: "CommandDropped",
        issued,
        name: command.name,
        reason: "server",
      });
    }
    rec.kernel.problems.push({
      _tag: "ServerCommandIssued",
      command: command.name,
      message: `[@ilha/model] ${rec.path}'s Command ${command.name} was issued during the server render and dropped`,
      path: rec.path,
    });
  }
};

/**
 * No Command runs on a closed fiber (unmounted, or parked by keep-alive).
 * Every dropped Command logs `CommandDropped` so a parked record's silence
 * is visible instead of a mystery.
 */
const dropClosedCommands = (
  rec: InstanceRecord,
  commands: readonly Command.Command<unknown, never>[],
  seq: number,
  startIndex: number
): void => {
  let index = startIndex;
  for (const command of commands) {
    const issued = { index, seq };
    index += 1;
    if (command._tag === "Interrupt") {
      continue;
    }
    if (command._tag !== "Effect" && command._tag !== "Stream") {
      continue;
    }
    if (kernelHasLog(rec.kernel)) {
      recordEntry(rec, {
        _tag: "CommandDropped",
        issued,
        name: command.name,
        reason: "closed",
      });
    }
  }
};

/**
 * Issue update Commands in array order, stopping if the instance closes
 * mid-loop. A Command issued by a closed instance is ignored.
 *
 * @internal
 */
export const issueCommands = (
  rec: InstanceRecord,
  commands: readonly Command.Command<unknown, never>[],
  seq: number,
  origin: "init" | "update" = "update"
): void => {
  if (rec.fiber.runtime.ssr) {
    dropServerCommands(rec, commands, seq, origin);
    return;
  }
  let index = 0;
  for (const command of commands) {
    if (rec.status !== "live" || rec.fiber.closed) {
      // A closed or parked fiber takes no Commands: log what never ran,
      // including the Command that tripped the check.
      dropClosedCommands(rec, commands.slice(index), seq, index);
      return;
    }
    const issued = { index, seq };
    index += 1;
    if (command._tag === "Interrupt") {
      const decision = schedule(rec.runs, command);
      for (const entry of decision.interrupt) {
        // oxlint-disable-next-line eslint/no-use-before-define -- SAFETY: schedule only yields live runs of this record; the cast recovers the scheduler's opaque entry type.
        stopRun(rec, entry as RunControl, "interrupt");
      }
      continue;
    }
    const decision = schedule(rec.runs, command);
    for (const entry of decision.interrupt) {
      // oxlint-disable-next-line eslint/no-use-before-define -- SAFETY: schedule only yields live runs of this record; the cast recovers the scheduler's opaque entry type.
      stopRun(
        rec,
        entry as RunControl,
        command.mode === "switch" ? "switch" : "interrupt"
      );
    }
    if (rec.status !== "live" || rec.fiber.closed) {
      return;
    }
    if (decision.action === "start") {
      // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
      startRun(rec, command, issued, origin);
    } else if (decision.action === "queue") {
      let token: unknown;
      try {
        // SAFETY: schedule only queues Effect/Stream commands, which carry the issued args beginRun consumes.
        token = componentBindingOf()?.run.beginRun(
          rec,
          command as Command.Issued<unknown, never>
        );
      } catch (error) {
        failOutside(rec, origin, error, { issued, name: command.name });
        return;
      }
      const queued: RunControl = {
        allNoop: true,
        command,
        elementCount: 0,
        interruptFiber: undefined,
        issued,
        key: command.groupKey,
        mode: command.mode,
        name: command.name,
        pendingMessage: undefined,
        query: token,
        readyWait: undefined,
        spanId: undefined,
        status: "queued",
        stopReason: undefined,
        stopped: false,
        traceId: undefined,
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: RunControl.value is a self-reference assigned on the next line; the cast seeds the initialization cycle.
        value: undefined as unknown as RunControl,
        wait: undefined,
      };
      queued.value = queued;
      rec.runs.push(queued);
      bumpSignal(rec);
    }
  }
};

const removeRun = (rec: InstanceRecord, control: RunControl): void => {
  const at = rec.runs.indexOf(control);
  if (at !== -1) {
    rec.runs.splice(at, 1);
  }
  bumpSignal(rec);
};

const promoteNext = (rec: InstanceRecord, control: RunControl): void => {
  if (rec.status !== "live") {
    return;
  }
  if (rec.fiber.closed) {
    // A parked record's fiber is closed: queued runs can never start on it,
    // so interrupt them and clear `isRunning` instead of orphaning them.
    if (isKeptParked(rec)) {
      // oxlint-disable-next-line node/callback-return -- SAFETY: schedule.next selects the run after control, not a Node callback; the cast recovers the scheduler's opaque entry type.
      const queued = next(rec.runs, control) as RunControl | undefined;
      if (queued !== undefined && queued.status === "queued") {
        // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
        stopRun(rec, queued, "unmount");
      }
    }
    return;
  }
  // oxlint-disable-next-line node/callback-return -- SAFETY: schedule.next selects the run after control, not a Node callback; the cast recovers the scheduler's opaque entry type.
  const started = next(rec.runs, control) as RunControl | undefined;
  if (started !== undefined) {
    // Promoted runs go through the same service check and provider stash as
    // freshly issued ones: a provider may have started building since the
    // run queued.
    const { serviceTag } = started.command;
    if (serviceTag !== undefined && !hasService(rec, serviceTag)) {
      if (stashProvideCommand(rec, started.command, started.issued)) {
        return;
      }
      // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
      failMissingService(rec, serviceTag, started);
      removeRun(rec, started);
      promoteNext(rec, started);
      return;
    }
    started.status = "running";
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    startFiber(rec, started);
  }
};

const recordStarted = (rec: InstanceRecord, control: RunControl): void => {
  if (!kernelHasLog(rec.kernel)) {
    return;
  }
  recordEntry(rec, {
    _tag: "CommandStarted",
    issued: control.issued,
    name: control.name,
    spanId: control.spanId ?? "",
    traceId: control.traceId ?? "",
  });
};

const recordEnded = (
  rec: InstanceRecord,
  control: RunControl,
  silentEnd: boolean,
  wait?:
    | {
        readonly waitEnded: MessageLog.WaitEnded;
        readonly outstanding: readonly MessageLog.AwaitedEntry[];
      }
    | undefined
): void => {
  if (!kernelHasLog(rec.kernel)) {
    return;
  }
  const draft: MutableDraft = {
    _tag: "CommandEnded",
    issued: control.issued,
    name: control.name,
    silent: silentEnd,
    spanId: control.spanId,
    traceId: control.traceId,
  };
  if (wait !== undefined) {
    draft.waitEnded = wait.waitEnded;
    draft.outstanding = wait.outstanding;
  }
  recordEntry(rec, draft);
};

const recordInterrupted = (rec: InstanceRecord, control: RunControl): void => {
  if (!kernelHasLog(rec.kernel)) {
    return;
  }
  recordEntry(rec, {
    _tag: "CommandInterrupted",
    issued: control.issued,
    name: control.name,
    reason: control.stopReason ?? "self",
    spanId: control.spanId,
    traceId: control.traceId,
  });
};

/**
 * Stop a run: mark it stopping and interrupt its fiber, or remove a queued
 * run immediately. A stopping run still holds its group until its fiber
 * exits.
 */
const stopRun = (
  rec: InstanceRecord,
  run: RunControl,
  reason: MessageLog.InterruptReason
): void => {
  if (run.status === "stopping") {
    return;
  }
  if (run.status === "queued" && run.interruptFiber === undefined) {
    run.status = "stopping";
    run.stopped = true;
    run.stopReason = reason;
    componentBindingOf()?.run.cancelRun(run.query);
    removeRun(rec, run);
    recordInterrupted(rec, run);
    promoteNext(rec, run);
    return;
  }
  if (run.wait !== undefined || run.pendingMessage !== undefined) {
    run.wait?.cancel();
    run.wait = undefined;
    const message = run.pendingMessage;
    const waited = run.readyWait;
    run.pendingMessage = undefined;
    run.readyWait = undefined;
    removeRun(rec, run);
    if (
      message === undefined ||
      rec.status !== "live" ||
      rec.fiber.closed ||
      reason === "unmount"
    ) {
      if (message === undefined) {
        recordInterrupted(rec, run);
      } else {
        recordEnded(rec, run, false, {
          outstanding: componentBindingOf()?.run.outstanding(run.query) ?? [],
          waitEnded: "closed",
        });
      }
      promoteNext(rec, run);
      return;
    }
    if (waited === undefined) {
      recordEnded(rec, run, false);
    } else {
      recordEnded(rec, run, false, {
        outstanding: componentBindingOf()?.run.outstanding(run.query) ?? [],
        waitEnded: reason === "switch" ? "switch" : "interrupt",
      });
    }
    promoteNext(rec, run);
    dispatch(
      rec,
      {
        _tag: "Command",
        issued: run.issued,
        name: run.name,
        spanId: run.spanId,
        traceId: run.traceId,
      },
      message
    );
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    pumpDeliverable(rec, run);
    return;
  }
  run.status = "stopping";
  run.stopped = true;
  run.stopReason = reason;
  run.interruptFiber?.();
  bumpSignal(rec);
};

const failMissingService = (
  rec: InstanceRecord,
  serviceTag: Context.Key<never, unknown>,
  control: {
    readonly command: Command.Issued<unknown, never>;
    readonly issued: MessageLog.Issued;
  }
): void => {
  const name = serviceName(serviceTag);
  // SAFETY: Client is the reserved client-only service tag; identity comparison detects it for the hint.
  const hint =
    serviceTag === (Client as unknown)
      ? " Wrap it in Component.clientOnly."
      : "";
  failOutside(
    rec,
    "command",
    new Error(`${rec.path} requires ${name}, but nothing provides it.${hint}`),
    { issued: control.issued, name: control.command.name }
  );
};

const startRun = (
  rec: InstanceRecord,
  command: Command.Issued<unknown, never>,
  issued: MessageLog.Issued,
  origin: "init" | "update" = "update"
): void => {
  if (rec.fiber.closed) {
    return;
  }
  const { serviceTag } = command;
  if (serviceTag !== undefined && !hasService(rec, serviceTag)) {
    // A provider above still builds: hold the Command until it settles.
    if (stashProvideCommand(rec, command, issued)) {
      return;
    }
    failMissingService(rec, serviceTag, { command, issued });
    return;
  }
  let token: unknown;
  try {
    token = componentBindingOf()?.run.beginRun(rec, command);
  } catch (error) {
    failOutside(rec, origin, error, { issued, name: command.name });
    return;
  }

  const control: RunControl = {
    allNoop: true,
    command,
    elementCount: 0,
    interruptFiber: undefined,
    issued,
    key: command.groupKey,
    mode: command.mode,
    name: command.name,
    pendingMessage: undefined,
    query: token,
    readyWait: undefined,
    spanId: undefined,
    status: "running",
    stopReason: undefined,
    stopped: false,
    traceId: undefined,
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: RunControl.value is a self-reference assigned on the next line; the cast seeds the initialization cycle.
    value: undefined as unknown as RunControl,
    wait: undefined,
  };
  control.value = control;
  rec.runs.push(control);
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  startFiber(rec, control);
  bumpSignal(rec);
};
const isStreamCommand = (
  command: Command.Issued<unknown, never>
): command is Command.Issued<unknown, never> & {
  readonly stream: Stream.Stream<unknown, unknown, never>;
} => command._tag === "Stream";

const startFiber = (rec: InstanceRecord, control: RunControl): void => {
  const { command } = control;
  const childScope = Scope.forkUnsafe(rec.fiber.scope);
  const scoped = (
    work: Effect.Effect<unknown, unknown, never>
  ): Effect.Effect<unknown, unknown, never> =>
    Effect.provideService(
      Effect.provide(work, resolveEnv(rec)),
      Scope.Scope,
      childScope
    );
  // SAFETY: commands are Effect or Stream commands by the isStreamCommand branch; each side asserts its own effect shape.
  const work: Effect.Effect<unknown, unknown, never> =
    isStreamCommand(command) && command.stream !== undefined
      ? (Stream.runForEach(command.stream, (element) =>
          Effect.sync(() => {
            control.elementCount += 1;
            const message = command.resolve(element);
            if (isNoop(message)) {
              return;
            }
            control.allNoop = false;
            if (rec.status !== "live" || rec.fiber.closed || control.stopped) {
              return;
            }
            dispatch(
              rec,
              {
                _tag: "Command",
                issued: control.issued,
                name: command.name,
                spanId: control.spanId,
                traceId: control.traceId,
              },
              message
            );
          })
        ) as Effect.Effect<unknown, unknown, never>)
      : (command.effect as Effect.Effect<unknown, unknown, never>);
  const run = componentBindingOf()?.run;
  // SAFETY: runBody threads the query run token through the command body; never is the API's contravariant slot.
  const body =
    run === undefined || control.query === undefined
      ? work
      : run.runBody(control.query, work, command.writes as never);
  // SAFETY: matchCauseEffect delivers the command's failure cause; never is the empty error channel of a closing scope.
  const tracked = Effect.withSpan(
    Effect.uninterruptibleMask((restore) =>
      // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.flatMap takes the effect and mapping function, not an Array thisArg.
      Effect.flatMap(Effect.currentSpan, (span) =>
        Effect.andThen(
          Effect.sync(() => {
            control.spanId = span.spanId;
            control.traceId = span.traceId;
            recordStarted(rec, control);
            run?.startRun(control.query);
          }),
          Effect.matchCauseEffect(
            Effect.andThen(restore(Effect.yieldNow), scoped(body)),
            {
              onFailure: (cause) =>
                Effect.andThen(
                  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
                  Effect.sync(() => handleCommandExit(rec, control, cause)),
                  Scope.close(
                    childScope,
                    Exit.failCause(cause as Cause.Cause<never>)
                  )
                ),
              onSuccess: (value) =>
                Effect.andThen(
                  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
                  Effect.sync(() => handleCommandSuccess(rec, control, value)),
                  Scope.close(childScope, Exit.succeed(value))
                ),
            }
          )
        )
      )
    ),
    command.name,
    { attributes: { mode: command.mode, path: rec.path } }
  );
  // No `onOk`: the tracked effect already dispatches its own outcome, and
  // an `onOk` would hold the island's pending count (and every test
  // helper's `settled()`) for the whole run, serializing switch/queue and
  // breaking interrupts issued from a second click.
  control.interruptFiber = rec.fiber.run(tracked);
};

const handleCommandExit = (
  rec: InstanceRecord,
  control: RunControl,
  cause: Cause.Cause<unknown>
): void => {
  if (rec.status !== "live" || rec.fiber.closed) {
    if (!Cause.hasInterruptsOnly(cause)) {
      Effect.runFork(
        Effect.logError(
          `${rec.path} is gone, and its Command ${control.name} failed`
        )
      );
    }
    removeRun(rec, control);
    recordEnded(rec, control, false);
    promoteNext(rec, control);
    return;
  }
  if (Cause.hasInterruptsOnly(cause) || control.stopped) {
    if (!control.stopped) {
      control.stopped = true;
      control.stopReason = "self";
    } else if (!Cause.hasInterruptsOnly(cause)) {
      rec.kernel.problems.push({
        _tag: "CleanupFailed",
        cause,
        command: control.name,
        message: `[@ilha/model] ${rec.path}'s Command ${control.name} was stopped, and it died before its fiber exited.`,
        path: rec.path,
      });
    }
    removeRun(rec, control);
    recordInterrupted(rec, control);
    promoteNext(rec, control);
    return;
  }
  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure)) {
    const { reject } = control.command;
    if (reject !== undefined) {
      let message: unknown;
      try {
        message = reject(failure.value);
      } catch (error) {
        failOutside(rec, "command", error, {
          issued: control.issued,
          name: control.name,
        });
        removeRun(rec, control);
        promoteNext(rec, control);
        return;
      }
      if (message === undefined || isNoop(message)) {
        removeRun(rec, control);
        recordEnded(rec, control, true);
        promoteNext(rec, control);
      } else {
        // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
        deliverCommandMessage(rec, control, message);
      }
      return;
    }
    failOutside(rec, "command", cause, {
      issued: control.issued,
      name: control.name,
    });
    removeRun(rec, control);
    promoteNext(rec, control);
    return;
  }
  failOutside(rec, "command", cause, {
    issued: control.issued,
    name: control.name,
  });
  removeRun(rec, control);
  promoteNext(rec, control);
};

const handleCommandSuccess = (
  rec: InstanceRecord,
  control: RunControl,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- command results are author values; resolve() validates them into messages.
  value: unknown
): void => {
  if (rec.status !== "live" || rec.fiber.closed) {
    removeRun(rec, control);
    recordEnded(rec, control, false);
    promoteNext(rec, control);
    return;
  }
  if (control.stopped) {
    removeRun(rec, control);
    recordInterrupted(rec, control);
    promoteNext(rec, control);
    return;
  }
  if (isStreamCommand(control.command)) {
    removeRun(rec, control);
    recordEnded(rec, control, control.elementCount > 0 && control.allNoop);
    promoteNext(rec, control);
    return;
  }
  let message: unknown;
  try {
    message = control.command.resolve(value);
  } catch (error) {
    failOutside(rec, "command", error, {
      issued: control.issued,
      name: control.name,
    });
    removeRun(rec, control);
    promoteNext(rec, control);
    return;
  }
  if (isNoop(message)) {
    removeRun(rec, control);
    recordEnded(rec, control, true);
    promoteNext(rec, control);
    return;
  }
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  holdForRefetch(rec, control, message);
};

/**
 * Hold a run's success for its `afterRefetch` wait when the run invalidated
 * watched entries, else deliver it. A held run stays in `rec.runs` with
 * `awaiting` status, so `h.isRunning` stays true through the wait.
 */
const holdForRefetch = (
  rec: InstanceRecord,
  control: RunControl,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- held successes are author messages; validated when the wait ends and they dispatch.
  message: unknown
): void => {
  const hooks = componentBindingOf()?.run;
  if (control.query === undefined || hooks === undefined) {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    deliverCommandMessage(rec, control, message);
    return;
  }
  const awaited = hooks.awaited(control.query);
  // SAFETY: Service commands declare the optional afterRefetch window; absent on plain commands.
  const { afterRefetch } = control.command as {
    readonly afterRefetch?: Duration.Duration | undefined;
  };
  if (afterRefetch === undefined || awaited === undefined) {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    deliverCommandMessage(rec, control, message);
    return;
  }
  control.status = "awaiting";
  control.pendingMessage = message;
  promoteNext(rec, control);
  if (kernelHasLog(rec.kernel)) {
    recordEntry(rec, {
      _tag: "CommandAwaiting",
      entries: awaited,
      issued: control.issued,
      name: control.name,
    });
  }
  if (awaited.length === 0) {
    control.readyWait = { outstanding: [], waitEnded: "nothing" };
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    pumpDeliverable(rec, control);
    return;
  }
  if (hooks.outstanding(control.query).length === 0) {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    deliverAfterWait(rec, control, "settled");
    return;
  }
  const budgetMs = Duration.toMillis(afterRefetch);
  const remaining =
    budgetMs === Infinity
      ? Infinity
      : Math.max(0, budgetMs - hooks.sinceApplied(control.query));
  if (remaining === 0) {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    deliverAfterWait(rec, control, "budget");
    return;
  }
  const off = hooks.onRefetched(control.query, () =>
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    deliverAfterWait(rec, control, "settled")
  );
  const timer =
    remaining === Infinity
      ? undefined
      : // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
        setTimeout(() => deliverAfterWait(rec, control, "budget"), remaining);
  control.wait = {
    cancel: () => {
      off();
      clearTimeout(timer);
    },
  };
  bumpSignal(rec);
};

/**
 * End a held `afterRefetch` wait and deliver the success when its turn
 * comes under `queue`.
 */
const deliverAfterWait = (
  rec: InstanceRecord,
  control: RunControl,
  waitEnded: MessageLog.WaitEnded
): void => {
  const run = componentBindingOf()?.run;
  const { wait } = control;
  control.wait = undefined;
  if (wait === undefined || control.status !== "awaiting") {
    return;
  }
  wait.cancel();
  control.readyWait = {
    outstanding: run?.outstanding(control.query) ?? [],
    waitEnded,
  };
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  pumpDeliverable(rec, control);
};

/**
 * Deliver the next ready run result: under `queue`, the group's oldest
 * awaiting run with an ended wait (preserving issue order); otherwise the
 * run itself. Nothing delivers until its own wait has ended.
 */
const pumpDeliverable = (rec: InstanceRecord, control: RunControl): void => {
  for (;;) {
    // oxlint-disable-next-line eslint/no-shadow, anti-slop/no-chained-type-assertions -- SAFETY: deliverable selects the ready run; the predicate only passes runs holding a deliverable message.
    const next = deliverable(
      rec.runs,
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: control is the live run being delivered; the scheduler types its entry opaquely.
      control as unknown as Parameters<typeof deliverable>[1],
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- deliverable probes arbitrary run values for deliverability; the predicate narrows them.
      (value: unknown) => {
        // SAFETY: the predicate only passes runs holding a deliverable message; the cast recovers the run identity.
        const run = value as RunControl;
        return run.pendingMessage !== undefined && run.wait === undefined;
      }
    ) as unknown as RunControl | undefined;
    if (next === undefined) {
      return;
    }
    const message = next.pendingMessage;
    const waited = next.readyWait;
    next.pendingMessage = undefined;
    next.readyWait = undefined;
    removeRun(rec, next);
    if (waited === undefined) {
      recordEnded(rec, next, false);
    } else {
      recordEnded(rec, next, false, waited);
    }
    promoteNext(rec, next);
    if (rec.status !== "live" || rec.fiber.closed) {
      return;
    }
    dispatch(
      rec,
      {
        _tag: "Command",
        issued: next.issued,
        name: next.name,
        spanId: next.spanId,
        traceId: next.traceId,
      },
      message
    );
  }
};
/**
 * Queue a run's result for delivery, preserving issue order under `queue`.
 * Marks a fresh result `awaiting` and promotes the next queued run first,
 * so the scheduler's `deliverable` can select it (SPEC §8 ordering).
 */
const deliverCommandMessage = (
  rec: InstanceRecord,
  control: RunControl,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- delivered results are author messages; the update API validates them on dispatch.
  message: unknown
): void => {
  control.pendingMessage = message;
  if (control.status === "running") {
    control.status = "awaiting";
    promoteNext(rec, control);
  }
  pumpDeliverable(rec, control);
};

/**
 * Re-run `subscriptions` and diff by key: removed keys stop first, new keys
 * start next, an existing key never restarts. An ended Stream stays stopped
 * until its key leaves and comes back. Duplicate keys fail the instance.
 * Never runs on the server.
 */
const syncSubscriptions = (rec: InstanceRecord): void => {
  const { subscriptions } = rec.implementation;
  if (subscriptions === undefined) {
    return;
  }
  let declared: readonly (
    | Subscription.Subscription<unknown, never>
    | false
    | null
    | undefined
  )[];
  try {
    // SAFETY: subscriptions() returns the author's declared subscriptions; the Array.isArray check and filter below validate the shape.
    declared = subscriptions({
      model: rec.model(),
      props: rec.props,
      queries: componentBindingOf()?.run.queriesForUpdate(
        rec
      ) as Component.QueryResults<Component.QuerySpec>,
    }) as readonly (
      | Subscription.Subscription<unknown, never>
      | false
      | null
      | undefined
    )[];
  } catch (error) {
    failOutside(rec, "subscription", error);
    return;
  }
  if (!Array.isArray(declared)) {
    failOutside(
      rec,
      "subscription",
      new Error(`${rec.path} subscriptions must return an array`)
    );
    return;
  }
  const list = declared.filter(
    (entry) => entry !== false && entry !== null && entry !== undefined
  );
  const seen = new Set<string>();
  for (const entry of list) {
    if (seen.has(entry.key)) {
      failOutside(rec, "subscription", duplicateKey(rec.path, entry.key));
      return;
    }
    seen.add(entry.key);
  }
  const wanted = new Set(list.map((entry) => entry.key));
  for (const control of rec.subs.values()) {
    if (!wanted.has(control.key)) {
      // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
      stopSub(rec, control);
    }
  }
  if (rec.status !== "live") {
    return;
  }
  // A provider above still builds: removed keys stop now, new keys start on
  // settle (the rerender then re-runs this sync).
  const settled = provideSettled(rec);
  for (const entry of list) {
    const existing = rec.subs.get(entry.key);
    if (existing !== undefined) {
      if (existing.ended) {
        continue;
      }
      existing.latest = isDirect(entry) ? entry.directState : undefined;
      continue;
    }
    if (!settled) {
      continue;
    }
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    startSub(rec, entry);
    if (rec.status !== "live") {
      return;
    }
  }
};

const stopSub = (rec: InstanceRecord, control: SubControl): void => {
  if (control.stopped) {
    return;
  }
  control.stopped = true;
  control.ended = false;
  rec.subs.delete(control.key);
  try {
    control.detach?.();
  } catch {
    // Detach must not break unmount.
  }
  control.detach = undefined;
  control.interrupt?.();
  control.interrupt = undefined;
  if (kernelHasLog(rec.kernel)) {
    recordEntry(rec, {
      _tag: "SubscriptionStopped",
      deps: control.deps,
      key: control.key,
      name: control.name,
    });
  }
};

const startSub = (
  rec: InstanceRecord,
  sub: Subscription.Subscription<unknown, never>
): void => {
  const control: SubControl = {
    declaration: sub,
    deps: sub.deps,
    detach: undefined,
    ended: false,
    interrupt: undefined,
    key: sub.key,
    latest: isDirect(sub) ? sub.directState : undefined,
    name: sub.name,
    stopped: false,
  };
  rec.subs.set(sub.key, control);
  if (kernelHasLog(rec.kernel)) {
    recordEntry(rec, {
      _tag: "SubscriptionStarted",
      deps: sub.deps,
      key: sub.key,
      name: sub.name,
    });
  }
  if (isDirect(sub)) {
    try {
      control.detach = sub.directAttach(resolveEnv(rec), {
        emit: (message, accepted) => {
          if (rec.status !== "live" || rec.fiber.closed || control.stopped) {
            return;
          }
          dispatch(
            rec,
            {
              _tag: "Subscription",
              deps: sub.deps,
              key: sub.key,
              name: sub.name,
            },
            message
          );
          accepted?.();
        },
        enter: (f) => {
          f(control.latest);
        },
        fail: (cause) => {
          failOutside(rec, "subscription", cause, { name: sub.name });
        },
      });
    } catch (error) {
      failOutside(rec, "subscription", error, { name: sub.name });
    }
    return;
  }
  // Like Commands, the Stream runs with the instance's resolved env (a
  // `Component.provide` Layer, `Dom.Refs`, the query cache) and the forked
  // child Scope: without both the body dies on a missing-service defect.
  const childScope = Scope.forkUnsafe(rec.fiber.scope);
  const scoped = (
    work: Effect.Effect<unknown, unknown, never>
  ): Effect.Effect<unknown, unknown, never> =>
    Effect.provideService(
      Effect.provide(work, resolveEnv(rec)),
      Scope.Scope,
      childScope
    );
  // SAFETY: stream subscriptions declare an Effect stream; the branch above selected the Stream command shape.
  const tracked = Effect.uninterruptibleMask((restore) =>
    Effect.andThen(
      Effect.yieldNow,
      Effect.matchCauseEffect(
        Effect.ensuring(
          restore(
            scoped(
              Stream.runForEach(
                sub.stream as Stream.Stream<unknown, unknown, never>,
                (element) =>
                  Effect.sync(() => {
                    if (
                      rec.status !== "live" ||
                      rec.fiber.closed ||
                      control.stopped ||
                      control.ended
                    ) {
                      return;
                    }
                    if (!rec.subs.has(sub.key)) {
                      return;
                    }
                    dispatch(
                      rec,
                      {
                        _tag: "Subscription",
                        deps: sub.deps,
                        key: sub.key,
                        name: sub.name,
                      },
                      element
                    );
                  })
              ) as Effect.Effect<unknown, unknown, never>
            )
          ),
          Scope.close(childScope, Exit.void)
        ),
        {
          onFailure: (cause) =>
            Effect.sync(() => {
              if (
                Cause.hasInterruptsOnly(cause) ||
                control.stopped ||
                rec.status !== "live" ||
                rec.fiber.closed
              ) {
                return;
              }
              failOutside(rec, "subscription", cause, { name: sub.name });
            }),
          onSuccess: () =>
            Effect.sync(() => {
              control.ended = true;
            }),
        }
      )
    )
  );
  control.interrupt = rec.fiber.run(tracked);
};

/**
 * Record one entry draft and return its seq. Used by mounts, whose later
 * messages carry their `MountStarted` seq in the source.
 */
export const logDraft = (
  rec: InstanceRecord,
  draft: Draft
): number | undefined => recordEntry(rec, draft);

/**
 * Stop every Command run of an instance. Used by keyed `provide` reselect.
 */
export const stopAllRuns = (
  rec: InstanceRecord,
  reason: MessageLog.InterruptReason
): void => {
  // oxlint-disable-next-line unicorn/no-useless-spread -- stopRun splices rec.runs via removeRun; the snapshot prevents skips.
  for (const run of [...rec.runs]) {
    stopRun(rec, run, reason);
  }
};

/**
 * Stop every Subscription of an instance. Used by keyed `provide` reselect.
 */
export const stopAllSubs = (rec: InstanceRecord): void => {
  for (const control of rec.subs.values()) {
    stopSub(rec, control);
  }
};

/**
 * The record whose view is running on the calling fiber, if any. Used by
 * Feature (and Query) to resolve services from a view.
 */
export const recordOfCaller = (): InstanceRecord | undefined => {
  let fiber: FiberLocal | undefined;
  try {
    fiber = getFiber();
  } catch {
    return undefined;
  }
  for (
    let at: FiberLocal | undefined = fiber;
    at !== undefined;
    at = at.parent
  ) {
    const kernel = kernelOf(at.registry);
    const rec = kernel.fibers.get(at);
    if (rec !== undefined) {
      return rec;
    }
    // Same shallow-copy caveat as `nearestRecord`: element-nested views
    // render on a copy sharing the parent hole's props box.
    const box = at.propsBox;
    if (box !== undefined) {
      const viaBox = kernel.boxOwners.get(box);
      if (viaBox !== undefined) {
        return viaBox;
      }
    }
  }
  return undefined;
};

/**
 * The `send`/`isRunning`/`id` closures both `h` and `p` share, bound to
 * one record. Extracted so headless `parts` runs with the same helpers.
 */
const baseHelpers = (rec: InstanceRecord) => {
  const send =
    (
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- send delivers author messages; the update API validates them before use.
      message: unknown,
      options?: Component.SendOptions | undefined
      // oxlint-disable-next-line anti-slop/no-unknown-returns, anti-slop/no-unknown-parameters -- send returns the DOM handler closure; its event arrives untyped and the mapper validates what it reads.
    ): ((event: unknown) => void) =>
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- DOM events arrive untyped; the mapper validates what it reads.
    (event: unknown) => {
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: DOM events are untyped in this runtime; only type and preventDefault are read.
      const domEvent = event as unknown as
        | {
            readonly type?: string | undefined;
            readonly preventDefault?: (() => void) | undefined;
          }
        | undefined;
      const produced =
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- branching on the author's message shape (mapper function vs literal), which has no Schema.
        typeof message === "function"
          ? // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: message-as-function is the author's event mapper; the update path validates its output.
            (message as (event: unknown) => unknown)(event)
          : message;
      const prevent = options?.preventDefault ?? false;
      if (
        prevent === "always" ||
        (prevent === true && produced !== undefined)
      ) {
        try {
          domEvent?.preventDefault?.();
        } catch {
          // A synthetic event without preventDefault still dispatches.
        }
      }
      if (produced !== undefined) {
        dispatch(
          rec,
          { _tag: "DomEvent", name: domEvent?.type ?? "event" },
          produced
        );
      }
    };
  const isRunning = (
    definition: Command.Definition.Any,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- isRunning groups are author-defined; compared by canonical JSON, never parsed.
    group?: unknown
  ): boolean => {
    rec.signal();
    const name = nameOf(definition);
    if (group === undefined) {
      return rec.runs.some((run) => run.name === name);
    }
    const key = groupKeyOf(definition, group);
    return rec.runs.some((run) => run.name === name && run.key === key);
  };
  const id = (name: string, key?: string | number | undefined): string =>
    `${escapeId(rec.path)}-${escapeId(name)}${key === undefined ? "" : `-${escapeId(String(key))}`}`;
  return { id, isRunning, send };
};

const buildHelper = (rec: InstanceRecord): Component.Helper<unknown, never> => {
  const base = baseHelpers(rec);
  const mount = (issued: Mount.Any): ((node: Element | null) => void) =>
    mountRef(rec, issued);
  const ref =
    <Node extends Element>(
      r: Dom.Ref<Node>
    ): ((node: Element | null) => void) =>
    (node) =>
      registerRef(rec.env, r.key, node);
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: fn wraps coreH with the record's helpers; the cast recovers the HFn contract.
  const fn = ((...args: readonly unknown[]) =>
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: coreH is Ilha's hyperscript factory; the cast recovers its call signature for the helper wrapper.
    (coreH as unknown as (...call: readonly unknown[]) => View)(
      ...args
    )) as unknown as HFn;
  const liveView = componentBindingOf()?.run.viewOf(rec);
  // Queries held past an unsettled provide have no state yet: open the same
  // Initial results `viewOf` would show from empty results, so views that
  // read `h.queries` render Loading instead of crashing. Once `mounted`
  // runs, the live view takes over.
  let unmounted: typeof liveView;
  if (liveView === undefined) {
    // SAFETY: boundOf returns the query binding for components declaring queries; undefined when it declares none.
    const bound = boundOf(rec.definition) as
      | {
          readonly empty: unknown;
          readonly context: (
            // oxlint-disable-next-line anti-slop/no-unknown-parameters -- query contexts receive author models, props and results; the binding validates them.
            model: unknown,
            // oxlint-disable-next-line anti-slop/no-unknown-parameters -- query contexts receive author models, props and results; the binding validates them.
            props: unknown,
            // oxlint-disable-next-line anti-slop/no-unknown-parameters -- query contexts receive author models, props and results; the binding validates them.
            results: unknown
          ) => NonNullable<typeof liveView>;
        }
      | undefined;
    if (bound !== undefined) {
      try {
        const context = bound.context(rec.model(), rec.props, bound.empty);
        unmounted = {
          patched: context.patched,
          previous: context.previous,
          queries: context.queries,
        };
      } catch {
        unmounted = undefined;
      }
    }
  }
  const queryView = liveView ?? unmounted;
  const helpers = {
    // SAFETY: children is the author's vnode for this record's subtree; the view walk validates it.
    children: rec.callProps.children as View,
    id: base.id,
    isRunning: base.isRunning,
    keepAlive: keepAliveHelper(rec),
    mount,
    props: rec.props,
    reads: readsRecord(rec),
    ref,
    send: base.send,
    slots: slotHelpers(rec),
  };
  if (queryView !== undefined) {
    Object.assign(helpers, queryView);
  }
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: helpers carries the author's view helpers; the cast recovers the Helper contract Object.assign builds.
  return Object.assign(fn, helpers) as unknown as Component.Helper<
    unknown,
    never
  >;
};
/**
 * Walk an author's view for model-component children: check duplicate
 * paths, stamp the author's authorship on each vnode (first walk wins, so
 * forwarded vnodes keep their writer), and record the walk for mounting
 * children. Throws when two children share a path.
 */
const walkAndStamp = (
  rec: InstanceRecord,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the walk decodes any author value; each branch below establishes its domain.
  view: unknown,
  stampAuthor: InstanceRecord = rec
): WalkedChild[] => {
  const stamp = (vnode: VNode): void => {
    if (rec.kernel.writtenBy.get(vnode) === undefined) {
      rec.kernel.writtenBy.set(vnode, stampAuthor);
    }
  };
  collectChildren(view, stamp);
  if (
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    declaresSlots(rec) ||
    rec.callProps.slots !== undefined ||
    stampAuthor !== rec
  ) {
    checkSlotPlacements(rec, view, (vnode) => rec.kernel.writtenBy.get(vnode));
  }
  if (keepsAlive(rec) || (stampAuthor !== rec && keepsAlive(stampAuthor))) {
    checkKeepAliveDouble(stampAuthor, view, (vnode) =>
      rec.kernel.writtenBy.get(vnode)
    );
  }
  const calls = checkChildPaths(rec.path, view, stamp);
  const walked: WalkedChild[] = calls.map((call) => ({
    author: rec.kernel.writtenBy.get(call.vnode) ?? stampAuthor,
    key: call.key,
    name: call.name,
    path: call.path,
    vnode: call.vnode,
  }));
  rec.lastWalk = walked;
  return walked;
};

// SAFETY: headless definitions declare the optional slots list; absent on plain components.
const declaresSlots = (rec: InstanceRecord): boolean =>
  ((rec.definition as { readonly slots?: readonly string[] | undefined }).slots
    ?.length ?? 0) > 0;
/**
 * Find the instance that wrote a mounting child's vnode: the parent's last
 * walk entry with the same name and key, or the parent itself when the
 * child was never walked (its own subtree content, or a plain-intermediate
 * edge the walk can't see).
 */
const authorOf = (
  parent: InstanceRecord,
  name: string,
  key: string
): InstanceRecord => {
  const found = parent.lastWalk.find(
    (entry) => entry.name === name && entry.key === key
  );
  return found === undefined ? parent : found.author;
};
/**
 * Mount queries deferred past an unsettled provide. The instance's own
 * settle rerenders it (the settle bumps the signal), while a child's
 * queries mount when an ancestor's rerender sweeps it — equal props may
 * leave the child itself unrerendered. Commands and Subscriptions wait for
 * the same condition through the stash and the sync skip; queries have no
 * path inside their own runtime, so the kernel holds their mount instead
 * of failing the instance before the build settles.
 */
const mountDeferredQueries = (rec: InstanceRecord): void => {
  const run = componentBindingOf()?.run;
  if (run === undefined) {
    return;
  }
  const mountOne = (target: InstanceRecord): void => {
    if (target.status !== "live" || target.fiber.closed) {
      return;
    }
    if (
      target.extensions.get("queries") !== undefined ||
      boundOf(target.definition) === undefined
    ) {
      return;
    }
    if (!provideSettled(target)) {
      return;
    }
    try {
      run.mounted(target);
    } catch (error) {
      failView(target, "init", error);
    }
  };
  mountOne(rec);
  if (rec.status !== "live") {
    return;
  }
  for (const path of rec.children) {
    const child = rec.kernel.records.get(path);
    if (child !== undefined && child.parent === rec) {
      mountOne(child);
    }
    if (rec.status !== "live") {
      return;
    }
  }
};
const renderViewAndWalk = (rec: InstanceRecord): View => {
  if (isHeadlessImpl(rec.implementation)) {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    return renderHeadless(rec);
  }
  if (slotOutletOf(rec.definition) !== undefined) {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    return renderOutletView(rec);
  }
  resetPlacements(rec);
  refreshOwner(rec);
  if (rec.status !== "live") {
    return renderFallback(rec);
  }
  // Every live render reads the signal, so failures and run-state changes
  // outside renders (`failOutside`, `stopRun`) repaint even when the view
  // never calls `h.isRunning`.
  rec.signal();
  const helper = buildHelper(rec);
  let view: View;
  try {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: implementation.view is the author's view function; helper and model are passed directly.
    view = (rec.implementation.view as (h: unknown, model: unknown) => View)(
      helper,
      rec.model()
    );
  } catch (error) {
    return failView(rec, "view", error);
  }
  if (rec.status !== "live") {
    return renderFallback(rec);
  }
  let calls: readonly WalkedChild[];
  try {
    calls = walkAndStamp(rec, view);
  } catch (error) {
    return failView(rec, "view", error);
  }
  if (rec.status !== "live") {
    return renderFallback(rec);
  }
  if (declaresSlots(rec)) {
    rec.extensions.set("slots.lastView", view);
  }
  if (keepsAlive(rec)) {
    processKept(rec, calls);
  }
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  closeDiff(rec, calls);
  try {
    mountDeferredQueries(rec);
    if (rec.status !== "live") {
      return renderFallback(rec);
    }
    componentBindingOf()?.run.synced(rec);
  } catch (error) {
    return failView(rec, "subscription", error);
  }
  if (rec.status !== "live") {
    return renderFallback(rec);
  }
  if (rec.fiber.runtime.ssr) {
    return view;
  }
  try {
    syncSubscriptions(rec);
  } catch (error) {
    return failView(rec, "subscription", error);
  }
  return rec.status === "live" ? view : renderFallback(rec);
};

/**
 * Close children that left the view, except kept (parked) children, which
 * stay live past their fiber's close, and composed children, which the
 * next `parts` run reconciles.
 */
const closeDiff = (
  rec: InstanceRecord,
  calls: readonly WalkedChild[]
): void => {
  const seen = new Set(calls.map((call) => call.path));
  for (const kept of keptPaths(rec)) {
    seen.add(kept);
  }
  // SAFETY: composed holds live composed children by path; set by the parts runtime.
  const composed = rec.extensions.get("composed") as
    | Map<string, InstanceRecord>
    | undefined;
  if (composed !== undefined) {
    for (const path of composed.keys()) {
      seen.add(path);
    }
  }
  for (const path of rec.children) {
    if (!seen.has(path)) {
      const child = rec.kernel.records.get(path);
      if (child !== undefined && child.parent === rec) {
        closeRecord(child, "unmount");
      }
    }
  }
  rec.children = seen;
};

/**
 * Render a headless instance: run `parts(p, model)` for the owner, then
 * the consumer's `view` closure as the instance's view, owned by the
 * consumer. A `parts` throw fails this component (`"view"`); a closure
 * throw fails it with `"content"`; walk errors fail the consumer.
 */
const renderHeadless = (rec: InstanceRecord): View => {
  const consumer = rec.author ?? rec;
  refreshOwner(rec);
  if (rec.status !== "live") {
    return renderFallback(rec);
  }
  dueReports(rec);
  const base = baseHelpers(rec);
  rec.extensions.set("composedSeen", new Set<string>());
  let parts: unknown;
  try {
    // SAFETY: headless implementations carry the parts factory; the undefined check below guards the call.
    const partsFn = (
      rec.implementation as {
        // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- headless parts receive the owner's parts box and model; the mapper's return flows through untouched.
        readonly parts?: (p: unknown, model: unknown) => unknown;
      }
    ).parts;
    const p = makePartsHelper(rec, {
      // The mapper's return flows through untouched (`runComposedParts`
      // returns it), so the arrow recovers `Out` with a cast.
      child: <C extends Component.Headless.Any, Out>(
        component: C,
        options: Component.ComposedChildOptions<
          Component.Headless.Parts<C>,
          Out
        >
        // oxlint-disable-next-line eslint/no-use-before-define, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: composed children mount through the parts runtime; Out is the mapper's own return.
      ): Out => mountComposedChild(rec, component, options) as Out,
      id: base.id,
      isRunning: base.isRunning,
    });
    parts = partsFn === undefined ? {} : partsFn(p, rec.model());
  } catch (error) {
    return failView(rec, "view", error);
  }
  if (rec.status !== "live") {
    return renderFallback(rec);
  }
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  reconcileComposed(rec);
  const closure = rec.callProps.view ?? (() => "");
  let view: View;
  try {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: the consumer closure receives the owner's parts result; parts() built it.
    view = (closure as (parts: unknown) => View)(parts);
  } catch (error) {
    return failView(rec, "content", error);
  }
  if (rec.status !== "live") {
    return renderFallback(rec);
  }
  let calls: readonly WalkedChild[];
  try {
    calls = walkAndStamp(rec, view, consumer);
  } catch (error) {
    if (consumer === rec) {
      return failView(rec, "view", error);
    }
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    failOutside(consumer, "view", error);
    return "";
  }
  if (rec.status !== "live" || consumer.status !== "live") {
    return renderFallback(rec);
  }
  if (keepsAlive(rec) || keepsAlive(consumer)) {
    processKept(rec, calls);
  }
  closeDiff(rec, calls);
  if (rec.fiber.runtime.ssr) {
    return view;
  }
  try {
    syncSubscriptions(rec);
  } catch (error) {
    return failView(rec, "subscription", error);
  }
  return rec.status === "live" ? view : renderFallback(rec);
};

/**
 * Render an outlet record: its view is the placed slot content, walked
 * with the writer's authorship kept (first walk wins). A mistake in
 * content fails the parent that wrote it, not the placer.
 */
const renderOutletView = (rec: InstanceRecord): View => {
  // SAFETY: slotContent is the author's placed vnode (or empty for default outlets); walked as view content below.
  const view = (rec.callProps.slotContent ?? "") as View;
  let calls: readonly WalkedChild[];
  try {
    calls = walkAndStamp(rec, view);
  } catch (error) {
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    failOutside(contentWriterOf(rec, view), "view", error);
    return "";
  }
  if (rec.status !== "live") {
    return renderFallback(rec);
  }
  closeDiff(rec, calls);
  return view;
};

const contentWriterOf = (
  rec: InstanceRecord,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the walk decodes any author value; each branch below establishes its domain.
  view: unknown
): InstanceRecord => {
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  const found = firstModelVNode(view);
  if (found === undefined) {
    return rec.author ?? rec;
  }
  return rec.kernel.writtenBy.get(found) ?? rec.author ?? rec;
};

// oxlint-disable-next-line anti-slop/no-object-parameters -- the walk passes any view value; the brand check below establishes the vnode contract.
const isModelVNode = (node: object): node is VNode => {
  if (!("$$ilha" in node)) {
    return false;
  }
  // SAFETY: the brand check above established this is a vnode; the cast reads its brand.
  return (node as { readonly $$ilha?: unknown }).$$ilha === 1;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the walk decodes any author value; each branch below establishes its domain.
const firstModelVNode = (node: unknown): object | undefined => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- narrowing the author's view value before the shape check; view values have no Schema.
  if (node === null || node === undefined || typeof node !== "object") {
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = firstModelVNode(item);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (!isModelVNode(node)) {
    return undefined;
  }
  if (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- branching on the vnode's tag kind (function vs host), which has no Schema.
    typeof node.type === "function" &&
    definitionNameOf(node.type) !== undefined
  ) {
    return node;
  }
  // SAFETY: the shape check above established the model vnode; children is its reconciled subtree list.
  for (const child of (node as VNode).children) {
    const found = firstModelVNode(child);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

// The definition Schemas are erased; decoding only runs their own parsing.
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- decodeProps decodes author input through the component's own Schema; the Schema validates it.
const decodeProps = (schema: Schema.Schema<unknown>, input: unknown): unknown =>
  Schema.decodeUnknownSync(
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: definition Schemas are erased; decoding runs their own parsing, which validates the input.
    schema as unknown as Schema.ConstraintDecoder<unknown>
  )(input);

/**
 * Fail a mounting instance whose path is already owned by a live record on
 * another fiber (usually a missing `key`). The owner keeps running: the
 * newcomer is marked failed and renders its fallback, so the collision is
 * loud instead of silently closing the owner.
 */
const failDuplicatePath = (
  kernel: IslandKernel,
  fiber: FiberLocal,
  definition: Component.DefinitionAny,
  implementation: Component.MakeImpl<unknown, unknown, never>,
  parent: InstanceRecord | undefined,
  author: InstanceRecord | undefined,
  path: string,
  call: ChildProps,
  rawCall: Component.CallOptions<unknown, never>
): View => {
  const rec: InstanceRecord = {
    atomReleases: [],
    author,
    callProps: call,
    callRaw: rawCall,
    children: new Set(),
    definition,
    env: baseEnv(fiber),
    extensions: new Map(),
    failureCause: undefined,
    fiber,
    implementation,
    kernel,
    kind: "record",
    lastWalk: [],
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: the model handle is installed by holdRecordAtom/slotFreeHandle below; the cast seeds the record.
    model: undefined as unknown as AtomHandle<unknown>,
    name: definition.name,
    onClose: [],
    parent,
    path,
    props: undefined,
    runs: [],
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: the signal handle is installed by holdRecordAtom/slotFreeHandle below; the cast seeds the record.
    signal: undefined as unknown as AtomHandle<number>,
    status: "live",
    subs: new Map(),
  };
  const signalState = Atom.make(0);
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  holdRecordAtom(rec, signalState);
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  rec.signal = slotFreeHandle(rec, signalState);
  try {
    rec.props = decodeProps(definition.props, call.props ?? {});
  } catch {
    rec.props = undefined;
  }
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Atom.make takes an explicit initial value; the model starts empty.
  const modelState = Atom.make<unknown>(undefined);
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  holdRecordAtom(rec, modelState);
  // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
  rec.model = slotFreeHandle(rec, modelState);
  return failView(
    rec,
    "view",
    new Error(
      `${path}: two live ${definition.name} instances share a path. Give each its own key.`
    )
  );
};

/**
 * Fold a previous record at this path into the render: adopt a kept record
 * back onto the new fiber, fail a live collision, or close a dead record.
 * Returns the collision failure when the newcomer must not mount.
 */
const reconcileExistingRecord = (
  kernel: IslandKernel,
  fiber: FiberLocal,
  definition: Component.DefinitionAny,
  implementation: Component.MakeImpl<unknown, unknown, never>,
  existing: InstanceRecord,
  parent: InstanceRecord | undefined,
  key: string,
  path: string,
  call: ChildProps,
  rawCall: Component.CallOptions<unknown, never>
): View | undefined => {
  if (existing.fiber === fiber) {
    return undefined;
  }
  if (
    (existing.status === "live" || existing.status === "failed") &&
    existing.extensions.get("kept.entry") !== undefined
  ) {
    existing.fiber = fiber;
    kernel.fibers.set(fiber, existing);
    if (fiber.propsBox !== undefined) {
      kernel.boxOwners.set(fiber.propsBox, existing);
    }
    // The redraw fiber closes the old hole's fiber eventually; the record
    // follows the new one from here, so hook the new fiber too.
    onFiberClose(fiber, () => {
      if (!isKeptParked(existing)) {
        closeRecord(existing, "unmount");
      }
    });
    // SAFETY: kept.entry holds the parked flag set by the keep-alive runtime; absent once reattached.
    const entry = existing.extensions.get("kept.entry") as
      | { parked: boolean }
      | undefined;
    if (entry !== undefined) {
      entry.parked = false;
      existing.extensions.delete("kept.entry");
    }
    if (kernelHasLog(kernel)) {
      recordEntry(existing, { _tag: "Drawn" });
    }
    return undefined;
  }
  if (existing.status === "live" || existing.status === "failed") {
    // A live record at this path belongs to another fiber: two instances
    // share a path (usually a missing `key`). The newcomer fails instead
    // of silently closing the instance that owns the path.
    return failDuplicatePath(
      kernel,
      fiber,
      definition,
      implementation,
      parent,
      parent === undefined ? undefined : authorOf(parent, definition.name, key),
      path,
      call,
      rawCall
    );
  }
  closeRecord(existing, "unmount");
  return undefined;
};

/**
 * Render a model component inside its Ilha fiber: mount on first render
 * (init, snapshot, `init` Commands, subscriptions, child walk), update on
 * rerender (props, view, subscriptions, child diff), fallback while failed.
 *
 * @internal
 */
export const renderModelComponent = (
  fiber: FiberLocal,
  definition: Component.DefinitionAny,
  implementation: Component.MakeImpl<unknown, unknown, never>,
  callProps: Component.CallOptions<unknown, never>
): View => {
  const kernel = kernelOf(fiber.registry);
  ensureIslandTeardown(kernel, fiber.runtime);
  const parent = nearestRecord(kernel, fiber.parent);
  const key = discoverKey(parent, fiber);
  const { name } = definition;
  // A keyed list straight under a plain root has no model parent, so the
  // key is the only thing separating the rows' paths: fold it into the
  // root path itself. Unkeyed roots keep the bare `/${name}` path, and
  // rows sharing one key still collide below for the duplicate failure.
  let path: string;
  if (parent === undefined) {
    path = key === "" ? `/${name}` : segmentOf(name, key);
  } else {
    path = `${parent.path}${segmentOf(name, key)}`;
  }
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: CallOptions carries the author's raw options bag; readCallProps normalizes defaults.
  const call = readCallProps(callProps as unknown as PropBag);
  const existing = kernel.records.get(path);
  if (existing !== undefined) {
    const collision = reconcileExistingRecord(
      kernel,
      fiber,
      definition,
      implementation,
      existing,
      parent,
      key,
      path,
      call,
      callProps
    );
    if (collision !== undefined) {
      return collision;
    }
  }
  const rec =
    existing !== undefined && existing.fiber === fiber ? existing : undefined;
  if (rec === undefined || rec.status === "closed") {
    const author =
      parent === undefined ? undefined : authorOf(parent, definition.name, key);
    // oxlint-disable-next-line eslint/no-use-before-define -- kernel lifecycle closures are mutually recursive; every call runs after module init.
    return mountRecord(
      kernel,
      fiber,
      definition,
      implementation,
      parent,
      author,
      path,
      call,
      callProps
    );
  }
  let props: unknown;
  try {
    props = decodeProps(definition.props, call.props ?? {});
  } catch (error) {
    return failView(rec, "init", error);
  }
  const prevProps = rec.props;
  const prevCall = rec.callProps;
  // A self-driven rerender (model, signal, query) reuses the painter's
  // props bag; only a parent-driven rerender brings a fresh one, which is
  // the only rerender the slot-only path below may answer.
  const freshCall = rec.callRaw !== callProps;
  rec.props = props;
  rec.callProps = call;
  rec.callRaw = callProps;
  // A keyed provide reads the new props here; Model-driven reselects already
  // ran in `dispatch`, so this is a no-op for them.
  if (rec.status === "live") {
    reselectProvide(rec);
  }
  if (rec.status === "failed") {
    try {
      const fallback = renderFallback(rec);
      const calls = walkAndStamp(rec, fallback);
      rec.children = new Set(calls.map((entry) => entry.path));
      return fallback;
    } catch (error) {
      recordFailed(rec, "fallback", toCause(error));
      return "";
    }
  }
  // Slot hosts whose own inputs are unchanged answer with the last view
  // with fresh outlets spliced in, so the outlets patch without re-running
  // the child's view. Kept records still walk: parking reads the walk.
  const slotView = keepsAlive(rec)
    ? undefined
    : patchSlotOutlets(rec, prevProps, prevCall, freshCall);
  if (slotView !== undefined) {
    // The view subscribes to the signal (and the model) every render, so
    // running-state, failure and model updates repaint even when the view
    // never reads them: keep those subscriptions on the skipped render.
    rec.signal();
    rec.model();
    return slotView;
  }
  return renderViewAndWalk(rec);
};

/**
 * A slot-free state handle: the atom lives on the island registry (held
 * until the record closes), and reads subscribe the rendering fiber through
 * a tracked read instead of an order-based primitive slot. A `p.child` that
 * first appears on a later render therefore gets its own Model instead of
 * its composer's slots.
 */
export const slotFreeHandle = <A>(
  rec: InstanceRecord,
  state: Atom.Atom<A>
): AtomHandle<A, A> => {
  const { registry } = rec.kernel;
  const guard = (): void => {
    let active: FiberLocal | undefined;
    try {
      active = getFiber();
    } catch {
      return;
    }
    if (active.registry !== registry) {
      throw new Error(
        `[@ilha/model] ${rec.path} state used from another island`
      );
    }
  };
  const get = (): A => {
    guard();
    return readTracked(state, registry);
  };
  return Object.assign(get, {
    $$atom: 1 as const,
    atom: state,
    set: (nextValue: A) => {
      guard();
      if (Atom.isWritable(state)) {
        registry.set(state, nextValue);
      }
    },
    update: (f: (current: A) => A) => {
      guard();
      if (Atom.isWritable(state)) {
        registry.update(state, f);
      }
    },
  });
};

/** Hold a record's state atom on the island registry until the record closes. */
const holdRecordAtom = (
  rec: InstanceRecord,
  state: Atom.Atom<unknown>
): void => {
  if (!rec.fiber.runtime.ssr) {
    rec.atomReleases.push(rec.kernel.registry.mount(state));
  }
};

interface RecordSeed {
  readonly tag: "@ilha/model/seed";
  readonly path: string;
  readonly value: unknown;
}

const isRecordSeed = (value: unknown, path: string): value is RecordSeed => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  // SAFETY: the object/null guard above ensures property access is safe; the tag and path checks below validate the shape.
  const seed = value as { readonly tag?: unknown; readonly path?: unknown };
  return seed.tag === "@ilha/model/seed" && seed.path === path;
};

/**
 * Push a record's SSR snapshot seed, tagged by record path so hydration
 * restores it by path instead of an island-wide slot index. A `clientOnly`
 * or `lazy` sibling that takes no slot on one side no longer misaligns the
 * other side.
 */
export const pushSeed = (
  rec: InstanceRecord,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- seeds carry the author's model; the codec encodes it and hydration decodes it back.
  value: unknown,
  codec?: Schema.ConstraintCodec<unknown, unknown> | undefined
): void => {
  const { runtime } = rec.fiber;
  if (!runtime.ssr) {
    return;
  }
  const seed: RecordSeed = {
    path: rec.path,
    tag: "@ilha/model/seed",
    value: codec === undefined ? value : Schema.encodeSync(codec)(value),
  };
  runtime.ssrValues.push(seed);
};

interface SeedTake {
  readonly found: boolean;
  readonly value: unknown;
}

/**
 * Take a record's hydration seed when the next snapshot entry is tagged for
 * this record's path. Entries for other records stay for their own mounts.
 */
export const takeSeed = (
  rec: InstanceRecord,
  codec?: Schema.ConstraintCodec<unknown, unknown> | undefined
): SeedTake => {
  const { runtime } = rec.fiber;
  if (runtime.ssr || runtime.hydrateValues === undefined) {
    return { found: false, value: undefined };
  }
  const seed = runtime.hydrateValues[runtime.hydrateI];
  if (!isRecordSeed(seed, rec.path)) {
    return { found: false, value: undefined };
  }
  runtime.hydrateI += 1;
  if (codec === undefined) {
    return { found: true, value: seed.value };
  }
  const decoded = Schema.decodeUnknownOption(Schema.toCodecJson(codec))(
    seed.value
  );
  if (Option.isSome(decoded)) {
    return { found: true, value: decoded.value };
  }
  return { found: false, value: undefined };
};

/**
 * The Model an update reads while a view transition is pending: the pending
 * Model when one is staged (so a dispatch that lands before the transition
 * applies reads fresh state), else the live Model.
 */
const pendingTransitionModels = new WeakMap<InstanceRecord, unknown>();
// oxlint-disable-next-line anti-slop/no-unknown-returns -- the pending model is the author's staged model; the update path consumes it opaquely.
const modelForUpdate = (rec: InstanceRecord): unknown =>
  pendingTransitionModels.has(rec)
    ? pendingTransitionModels.get(rec)
    : rec.model();

// oxlint-disable-next-line eslint/complexity -- mount runs init, seeding, provide boot, commands, sends and events in order; splitting it would scatter the mount lifecycle.
const mountRecord = (
  kernel: IslandKernel,
  fiber: FiberLocal,
  definition: Component.DefinitionAny,
  implementation: Component.MakeImpl<unknown, unknown, never>,
  parent: InstanceRecord | undefined,
  author: InstanceRecord | undefined,
  path: string,
  call: ChildProps,
  rawCall: Component.CallOptions<unknown, never>
): View => {
  const rec: InstanceRecord = {
    atomReleases: [],
    author,
    callProps: call,
    callRaw: rawCall,
    children: new Set(),
    definition,
    // Each record owns its env delta: the island's `Client` service, the
    // browser event sources and a fresh `Refs` store on client mounts,
    // nothing on the server. The effective env merges the whole parent line
    // (`resolveEnv`), with the nearest record winning, so a record's own
    // `Refs` store always shadows its ancestors'. Slices merge their
    // per-record contributions into this field at mount; `provide` replaces
    // it on settle.
    env: baseEnv(fiber),
    extensions: new Map(),
    failureCause: undefined,
    fiber,
    implementation,
    kernel,
    kind: "record",
    lastWalk: [],
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: the model handle is installed by slotFreeHandle below; the cast seeds the record.
    model: undefined as unknown as AtomHandle<unknown>,
    name: definition.name,
    onClose: [],
    parent,
    path,
    props: undefined,
    runs: [],
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: the signal handle is installed by slotFreeHandle below; the cast seeds the record.
    signal: undefined as unknown as AtomHandle<number>,
    status: "live",
    subs: new Map(),
  };
  const signalState = Atom.make(0);
  holdRecordAtom(rec, signalState);
  rec.signal = slotFreeHandle(rec, signalState);
  kernel.records.set(path, rec);
  kernel.fibers.set(fiber, rec);
  if (fiber.propsBox !== undefined) {
    kernel.boxOwners.set(fiber.propsBox, rec);
  }
  ensureIslandTeardown(kernel, fiber.runtime);
  onFiberClose(fiber, () => {
    if (isKeptParked(rec)) {
      // A parked record outlives its fiber: queued runs can never start on
      // a closed fiber, so drop them and clear `isRunning`.
      // oxlint-disable-next-line unicorn/no-useless-spread -- stopRun splices rec.runs via removeRun; the snapshot prevents skips.
      for (const run of [...rec.runs]) {
        if (run.status === "queued") {
          stopRun(rec, run, "unmount");
        }
      }
      return;
    }
    closeRecord(rec, "unmount");
  });
  if (call.slots !== undefined && isHeadlessImpl(implementation)) {
    return failView(
      rec,
      "init",
      new Error(`${path} takes no slots: it is headless`)
    );
  }
  let props: unknown;
  try {
    props = decodeProps(definition.props, call.props ?? {});
  } catch (error) {
    return failView(rec, "init", error);
  }
  rec.props = props;
  const { ssr } = fiber.runtime;
  const hydrating = !ssr && fiber.runtime.hydrateValues !== undefined;
  if (hydrating && !kernel.hydrationDone) {
    // The first hydrating mount schedules the end of the hydration phase:
    // components mounted after the first paint settles run init sends and
    // emits normally instead of dropping them as adopted.
    kernel.hydrationDone = true;
    fiber.runtime.later(() => {
      fiber.runtime.hydrateValues = undefined;
    });
  }
  if (parent === undefined && kernel.app.startsWith("island-")) {
    kernel.app = definition.name;
  }
  let initModel: unknown;
  let initCommands: readonly Command.Command<unknown, never>[] = [];
  let initEvents: readonly unknown[] = [];
  let initSends: readonly Component.StepSend[] = [];
  try {
    const initOut =
      // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: implementation.init is the author's init function; props pass through directly and the step check below validates its return.
      (implementation.init as (init: unknown, props: unknown) => unknown)(
        {
          props,
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- init set() takes the author's model opaquely; initStepOf wraps it into a step.
          set: (model: unknown) => initStepOf(model),
        },
        props
      );
    if (isStep(initOut)) {
      // SAFETY: isStep narrows the author's step; the cast recovers the step contract.
      const step = initOut as Component.Step<unknown, never>;
      if (step.model === undefined) {
        throw new Error(
          `init of ${path} must set a Model: return a Model or call $.set(...)`
        );
      }
      initModel = step.model;
      // SAFETY: step.commands are the author's issued Commands; issueCommands validates them at dispatch.
      initCommands = step.commands as readonly Command.Command<
        unknown,
        never
      >[];
      initEvents = step.events;
      initSends = step.sends;
    } else {
      initModel = initOut;
    }
  } catch (error) {
    return failView(rec, "init", error);
  }
  const redacted = isRedactedState(definition.model);
  if (redacted && !kernel.warnedRedacted.has(definition.name)) {
    kernel.warnedRedacted.add(definition.name);
    console.warn(
      `[@ilha/model] ${definition.name} holds a Schema.Redacted and is never snapshotted: it renders on the server from init and rebuilds on the client.`
    );
  }
  // SAFETY: modelCodecOf returns the definition's own model codec; redacted models stay undefined.
  const codec = (redacted ? undefined : modelCodecOf(definition.model)) as
    | Schema.ConstraintCodec<unknown, unknown>
    | undefined;
  let modelValue = initModel;
  if (ssr) {
    if (!redacted) {
      pushSeed(rec, initModel, codec);
    }
  } else if (!redacted) {
    const seed = takeSeed(rec, codec);
    if (seed.found) {
      modelValue = seed.value;
    }
  }
  const modelState = Atom.make(modelValue);
  holdRecordAtom(rec, modelState);
  rec.model = slotFreeHandle(rec, modelState);
  baselineCollects(rec);
  // Boot provided Layers before queries mount: a query whose fetcher comes
  // from this instance's own provide would otherwise fail before the build
  // settles (its services are not in the env yet). Commands issued below
  // still wait for the build through the stash. Nothing builds on the
  // server: queries there resolve from already-settled ancestors.
  if (!ssr) {
    bootProvide(rec, props, initModel);
  }
  // While a provider above still builds, hold the query mount: the
  // settle rerender mounts it (see `mountDeferredQueries`). Mounting now
  // would fail the instance for a fetcher that is still on its way.
  if (provideSettled(rec)) {
    mountDeferredQueries(rec);
  }
  if (rec.status !== "live") {
    return renderFallback(rec);
  }

  if (ssr) {
    return renderViewAndWalk(rec);
  }
  const isOutlet = slotOutletOf(definition) !== undefined;
  const seq = isOutlet
    ? -1
    : recordMounted(
        rec,
        initModel,
        initCommands,
        initEvents,
        hydrating,
        componentBindingOf()?.run.logResults(rec)
      );
  issueCommands(rec, initCommands, seq, "init");
  if (rec.status !== "live") {
    return renderFallback(rec);
  }
  if (!hydrating) {
    applySends(rec, initSends, seq, new Map(), (owner, message) =>
      dispatch(owner, { _tag: "Send", path: rec.path, seq }, message)
    );
  }
  if (!hydrating) {
    for (const event of initEvents) {
      const { author: composer } = rec;
      if (composer === undefined || composer === rec) {
        continue;
      }
      // Same as update emits: the handlers are this child's call options.
      // SAFETY: onEmit is the child's own emit handler and event is its own init event; routeEmit validates the event.
      const outgoing = routeEmit(rec.callProps.onEmit as never, event as never);
      if (outgoing !== undefined) {
        dispatch(composer, rec, outgoing);
      }
    }
  }
  if (rec.status !== "live") {
    return renderFallback(rec);
  }
  return renderViewAndWalk(rec);
};

/**
 * Stop a kept child's fiber-bound subscriptions when it parks: non-direct
 * subscriptions are tied to the old fiber and restart on re-draw, direct
 * ones stay attached and pause on their own closed-fiber guard.
 *
 * @internal
 */
export const parkSubscriptions = (rec: InstanceRecord): void => {
  // oxlint-disable-next-line unicorn/no-useless-spread -- stopSub removes the control via rec.subs.delete; the snapshot prevents skips.
  for (const control of [...rec.subs.values()]) {
    if (control.stopped) {
      continue;
    }
    if (isDirect(control.declaration)) {
      continue;
    }
    stopSub(rec, control);
  }
};

const composedOf = (parent: InstanceRecord): Map<string, InstanceRecord> => {
  // SAFETY: composed holds the composer's live children by path; mountComposedChild sets it.
  let composed = parent.extensions.get("composed") as
    | Map<string, InstanceRecord>
    | undefined;
  if (composed === undefined) {
    composed = new Map();
    parent.extensions.set("composed", composed);
  }
  return composed;
};

/**
 * Run a composed child's `parts` with a `p` bound to it, then map the
 * result through the `p.child` mapper. Throws propagate to the composing
 * parent's `parts`, failing it with `"view"`.
 */
const runComposedParts = (
  rec: InstanceRecord,
  implementation: Component.MakeImpl<unknown, unknown, never>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the mapper's return flows through untouched; runComposedParts calls it with the child's parts.
  mapper: (childParts: unknown) => unknown
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the mapper's return flows through untouched.
): unknown => {
  const base = baseHelpers(rec);
  const p = makePartsHelper(rec, {
    // The mapper's return flows through untouched (see above).
    child: <C extends Component.Headless.Any, Out>(
      component: C,
      options: Component.ComposedChildOptions<Component.Headless.Parts<C>, Out>
      // oxlint-disable-next-line eslint/no-use-before-define, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: composed children mount through the parts runtime; Out is the mapper's own return.
    ): Out => mountComposedChild(rec, component, options) as Out,
    id: base.id,
    isRunning: base.isRunning,
  });
  const partsFn =
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- SAFETY: parts is the author's optional composed-child view; p and model pass through directly.
    (
      implementation as {
        // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- p and model pass through directly and the mapper's return flows untouched.
        readonly parts?: (p: unknown, model: unknown) => unknown;
      }
    ).parts;
  const parts = partsFn === undefined ? {} : partsFn(p, rec.model());
  return mapper(parts);
};

/**
 * Mount (or reuse) a `p.child` composed headless child under its composer.
 * The child belongs to the composer: `onEmit`/`onFailure` return the
 * composer's messages, dispatches bump the composer so `parts` re-runs,
 * and the composer closing closes the child. Takes no `view`, `slots` or
 * `fallback` (each throws).
 *
 * @internal
 */
// oxlint-disable-next-line eslint/complexity -- composed mount mirrors mountRecord's init/provide/command/send/event order; splitting it would scatter the composed lifecycle.
export const mountComposedChild = <P>(
  parent: InstanceRecord,
  component: Component.Headless.Any,
  options: Component.ComposedChildOptions<P>
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the mapper's return flows through untouched.
): unknown => {
  checkChildCall(
    parent,
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: options is the composer's own child call; checkChildCall validates the forbidden view/slots/fallback keys.
    options as unknown as {
      readonly view?: unknown;
      readonly slots?: unknown;
      readonly fallback?: unknown;
    }
  );
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: definition is the component's own erased definition; decodeProps validates props through its Schema.
  const definition = component.definition as unknown as Component.DefinitionAny;
  // `Headless.Any` is narrower than every `make` result (a full
  // `HeadlessComponent<...>` rejects concrete components), so recover the
  // implementation here: every component reaching this function is a `make`
  // result with an implementation at runtime.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: Headless.Any is narrower than every make result; the cast recovers the component's own identity.
  const full = component as unknown as Component.HeadlessComponent<
    unknown,
    never,
    never,
    never,
    unknown
  >;
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: every component reaching this function is a make result; the cast recovers its implementation.
  const implementation = full.implementation as unknown as Component.MakeImpl<
    unknown,
    unknown,
    never
  >;
  const key = options.key ?? "";
  const path = `${parent.path}${segmentOf(definition.name, key)}`;
  const call: ChildProps = {
    children: undefined,
    fallback: undefined,
    // SAFETY: onEmit and onFailure are the composer's optional handlers; composed dispatches validate them.
    onEmit: options.onEmit as ChildProps["onEmit"],
    // SAFETY: the composer's optional failure handler; composed dispatches validate it.
    onFailure: options.onFailure as ChildProps["onFailure"],
    props: options.props,
  };
  // SAFETY: composedSeen tracks the latest parts run's p.child calls; set by the parts runtime.
  const seen = parent.extensions.get("composedSeen") as Set<string> | undefined;
  const existing = parent.kernel.records.get(path);
  if (
    existing !== undefined &&
    existing.status === "live" &&
    existing.extensions.get("composedOf") === parent &&
    existing.definition === definition
  ) {
    try {
      existing.props = decodeProps(definition.props, call.props ?? {});
    } catch (error) {
      failOutside(existing, "init", error);
      throw error;
    }
    existing.callProps = call;
    seen?.add(path);
    return runComposedParts(
      existing,
      implementation,
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: the mapper's return flows through untouched; runComposedParts calls it with the child's parts.
      options.parts as unknown as (childParts: unknown) => unknown
    );
  }
  if (existing !== undefined) {
    closeRecord(existing, "unmount");
  }
  let props: unknown;
  try {
    props = decodeProps(definition.props, call.props ?? {});
  } catch (error) {
    failOutside(parent, "init", error);
    throw error;
  }
  const rec: InstanceRecord = {
    atomReleases: [],
    author: parent,
    callProps: call,
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: CallOptions carries the author's raw options bag; the record keeps it for fresh-call detection.
    callRaw: {
      onEmit: options.onEmit,
      onFailure: options.onFailure,
      props: options.props,
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: CallOptions carries the author's raw options bag; the record keeps it for fresh-call detection.
    } as unknown as Component.CallOptions<unknown, never>,
    children: new Set(),
    definition,
    env: baseEnv(parent.fiber),
    extensions: new Map(),
    failureCause: undefined,
    fiber: parent.fiber,
    implementation,
    kernel: parent.kernel,
    kind: "record",
    lastWalk: [],
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: the model handle is installed by slotFreeHandle below; the cast seeds the record.
    model: undefined as unknown as AtomHandle<unknown>,
    name: definition.name,
    onClose: [],
    parent,
    path,
    props,
    runs: [],
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: the signal handle is installed by slotFreeHandle below; the cast seeds the record.
    signal: undefined as unknown as AtomHandle<number>,
    status: "live",
    subs: new Map(),
  };
  rec.extensions.set("composedOf", parent);
  const composedSignal = Atom.make(0);
  holdRecordAtom(rec, composedSignal);
  rec.signal = slotFreeHandle(rec, composedSignal);
  parent.kernel.records.set(path, rec);
  parent.children.add(path);
  composedOf(parent).set(path, rec);
  seen?.add(path);
  parent.onClose.push(() => {
    if (rec.status === "live" || rec.status === "failed") {
      closeRecord(rec, "unmount");
    }
  });
  let initModel: unknown;
  let initCommands: readonly Command.Command<unknown, never>[] = [];
  let initEvents: readonly unknown[] = [];
  let initSends: readonly Component.StepSend[] = [];
  try {
    const initOut =
      // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: implementation.init is the author's init function; props pass through directly and the step check below validates its return.
      (implementation.init as (init: unknown, props: unknown) => unknown)(
        {
          props,
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- init set() takes the author's model opaquely; initStepOf wraps it into a step.
          set: (model: unknown) => initStepOf(model),
        },
        props
      );
    if (isStep(initOut)) {
      // SAFETY: isStep narrows the author's step; the cast recovers the step contract.
      const step = initOut as Component.Step<unknown, never>;
      if (step.model === undefined) {
        throw new Error(
          `init of ${path} must set a Model: return a Model or call $.set(...)`
        );
      }
      // SAFETY: step.commands are the author's issued Commands; issueCommands validates them at dispatch.
      initCommands = step.commands as readonly Command.Command<
        unknown,
        never
      >[];
      initEvents = step.events;
      initSends = step.sends;
    } else {
      initModel = initOut;
    }
  } catch (error) {
    markFailed(rec, "init", error);
    throw error;
  }
  const composedState = Atom.make(initModel);
  holdRecordAtom(rec, composedState);
  rec.model = slotFreeHandle(rec, composedState);
  baselineCollects(rec);
  if (!parent.fiber.runtime.ssr) {
    bootProvide(rec, props, initModel);
  }
  if (parent.fiber.runtime.ssr) {
    return runComposedParts(
      rec,
      implementation,
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: the mapper's return flows through untouched; runComposedParts calls it with the child's parts.
      options.parts as unknown as (childParts: unknown) => unknown
    );
  }
  const seq = recordMounted(rec, initModel, initCommands, initEvents, false);
  issueCommands(rec, initCommands, seq, "init");
  if (rec.status !== "live") {
    throw new Error(`init of ${path} failed`);
  }
  applySends(rec, initSends, seq, new Map(), (owner, message) =>
    dispatch(owner, { _tag: "Send", path: rec.path, seq }, message)
  );
  if (rec.status !== "live") {
    throw new Error(`init of ${path} failed`);
  }
  for (const event of initEvents) {
    // SAFETY: onEmit is the composer's optional emit handler and event is its own init event; routeEmit validates the event.
    const outgoing = routeEmit(rec.callProps.onEmit as never, event as never);
    if (outgoing !== undefined) {
      dispatch(parent, rec, outgoing);
    }
  }
  if (rec.status !== "live") {
    throw new Error(`init of ${path} failed`);
  }
  return runComposedParts(
    rec,
    implementation,
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- SAFETY: the mapper's return flows through untouched; runComposedParts calls it with the child's parts.
    options.parts as unknown as (childParts: unknown) => unknown
  );
};

/**
 * Close composed children the latest `parts` run dropped: `p.child`
 * registers each call in `composedSeen`, and anything left over no longer
 * belongs to the composer.
 */
const reconcileComposed = (rec: InstanceRecord): void => {
  // SAFETY: composed holds the composer's live children by path; mountComposedChild sets it.
  const composed = rec.extensions.get("composed") as
    | Map<string, InstanceRecord>
    | undefined;
  // SAFETY: composedSeen tracks the latest parts run's p.child calls; set by the parts runtime.
  const seen = rec.extensions.get("composedSeen") as Set<string> | undefined;
  if (composed === undefined) {
    return;
  }
  // oxlint-disable-next-line unicorn/no-useless-spread -- closeRecord removes the child via composed.delete; the snapshot prevents skips.
  for (const [path, child] of [...composed]) {
    if (seen?.has(path) !== true && child.status !== "closed") {
      composed.delete(path);
      closeRecord(child, "unmount");
    }
  }
};

bindOutletRenderer((definition, implementation, options) =>
  renderModelComponent(getFiber(), definition, implementation, options)
);
bindKeepAliveH(
  (...args: readonly unknown[]) =>
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- SAFETY: coreH is Ilha's hyperscript factory; the casts recover its call signature and VNode result.
    (coreH as unknown as (...call: readonly unknown[]) => View)(
      ...args
    ) as unknown as VNode
);
bindKeepAliveFail((author, cause) => {
  failView(author, "view", cause);
});
bindKeepAliveCloser((rec) => closeRecord(rec, "unmount"));
bindKeptRunKernel({ kernelHasLog, parkSubscriptions, recordEntry });
bindMountRunKernel({ dispatch, failOutside, logDraft, resolveEnv });
bindPartsRunKernel({ dispatch });
bindLayerRunKernel({
  dispatch,
  failOutside,
  issueCommands,
  logDraft,
  stopAllRuns,
  stopAllSubs,
});
bindLazyKernel({ recordOfCaller, refreshForQuery });
bindQueryRunKernel({
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
});
bindRecorderKernel({ loggedComponentOf });
bindSharedRunKernel({ dispatch, failOutside, kernelHasLog, recordEntry });
bindModelRenderer(renderModelComponent);
