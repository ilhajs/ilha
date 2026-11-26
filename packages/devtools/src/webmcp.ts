/**
 * Agent tools over the browser's WebMCP model context. The island tools
 * mirror the page functions; the `ilha_model_*` tools expose the
 * `@ilha/model` message log through the page-side `Inspector` and `History`
 * from `inspector.ts`. A no-op when the browser provides no model context.
 */
import * as Schema from "effect/Schema";
import type { Json } from "effect/Schema";

import { diff, make, makeHistory } from "./inspector";
import type { HeldState, History, Inspector, Session } from "./inspector";
import type { ModelFramesResult, ModelSchemaResult } from "./protocol";
import type { WireEntry } from "./wire";

export type { HeldState } from "./inspector";

export interface PageTools {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- channel boundary; payloads are validated by each tool handler.
  readonly inspect: () => unknown;
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- channel boundary; payloads are validated by each tool handler.
  readonly highlight: (id: string | null) => unknown;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- channel boundary; the atom value is decoded as AtomJson by the handler.
  readonly setAtom: (id: string, index: number, value: unknown) => unknown;
}

interface WebMcpResult {
  readonly content: readonly { readonly text: string; readonly type: "text" }[];
}

interface ToolSchema {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- JSON Schema properties are inherently open; validated by the model host.
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly type: "object";
}

interface WebMcpTool {
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly title?: string;
  };
  readonly description: string;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-returns -- tool args are open JSON validated per tool; results are serialized payloads.
  readonly execute: (args: Record<string, unknown>) => unknown;
  readonly inputSchema: ToolSchema;
  readonly name: string;
}

interface ModelContextLike {
  registerTool: (
    tool: WebMcpTool,
    options?: { readonly signal?: AbortSignal | undefined }
  ) => { unregister?: () => void } | undefined;
}

/** What WebMCP drafts add to `document` and `navigator`. */
interface ModelContextHost {
  modelContext?: ModelContextLike;
}

const noop = (): void => {
  /* nothing to undo */
};

// oxlint-disable-next-line anti-slop/no-unknown-returns -- any function returns an unchecked value; call sites validate before use.
const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === "function";

const isModelContext = (
  value: ModelContextLike | undefined
): value is ModelContextLike =>
  value !== undefined && isFunction(value.registerTool);

/** `document.modelContext` (current draft), else `navigator.modelContext`. */
const resolveModelContext = (): ModelContextLike | undefined => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- document may be absent in the panel; the guard establishes the host contract.
  if (typeof document === "object" && document !== null) {
    // SAFETY: the guard above established document is a non-null object; the host draft adds modelContext.
    const documentContext = (document as ModelContextHost).modelContext;
    if (isModelContext(documentContext)) {
      return documentContext;
    }
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- navigator may be absent in the panel; the guard establishes the host contract.
  if (typeof navigator === "object" && navigator !== null) {
    // SAFETY: the guard above established navigator is a non-null object; the host draft adds modelContext.
    const navigatorContext = (navigator as ModelContextHost).modelContext;
    if (isModelContext(navigatorContext)) {
      return navigatorContext;
    }
  }
  return undefined;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- tool results are arbitrary JSON payloads serialized here at the boundary.
const text = (value: unknown): WebMcpResult => ({
  content: [{ text: JSON.stringify(value, null, 2), type: "text" }],
});

const fail = (message: string): WebMcpResult => ({
  content: [
    { text: JSON.stringify({ error: message }, null, 2), type: "text" },
  ],
});

const isString = (value: unknown): value is string => typeof value === "string";

const isNumber = (value: unknown): value is number => typeof value === "number";

/** A thrown tool failure; serializes as `{ error: message }`. */
export class ToolError extends Error {
  override readonly name = "ToolError";
  readonly _tag = "ToolError";
}
// oxlint-disable-next-line eslint/func-style -- TS 7 narrows never-returning calls only on function declarations; the arrow form leaves failTool call sites un-narrowed.
function failTool(message: string): never {
  throw new ToolError(message);
}

/** A short timer the `wait` tool polls on. */
const sleep = async (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(resolve, ms);
  await promise;
};

// ---------------------------------------------------------------------------
// Read helpers over Wire entries (timeline labels, filters, chains).
// ---------------------------------------------------------------------------

/** Timeline filter: `messages` keeps updates, mounts and failures. */
export type EntryFilter = "messages" | "commands" | "all";

// oxlint-disable-next-line anti-slop/no-known-value-widening -- the keys are the fixed timeline tag set; membership reads stay boolean.
const updateTags: Record<string, true> = {
  Failed: true,
  LayerFailed: true,
  Mounted: true,
  PropsChanged: true,
  QueryChanged: true,
  Update: true,
  Waiting: true,
};

// oxlint-disable-next-line anti-slop/no-known-value-widening -- the keys are the fixed command tag set; membership reads stay boolean.
const commandTags: Record<string, true> = {
  CommandAwaiting: true,
  CommandDropped: true,
  CommandEnded: true,
  CommandInterrupted: true,
  CommandStarted: true,
  Failed: true,
  LayerFailed: true,
  Mounted: true,
  Update: true,
  Waiting: true,
};

/** One field of a decoded Wire value; Wire frames are JSON, so any object qualifies. */
type FieldBag = Record<string, Json>;

const bagOf = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- wire frames arrive as decoded JSON; tag readers validate the fields they use.
  value: unknown
): FieldBag | undefined =>
  // SAFETY: the guard establishes a non-null JSON object; its fields are JSON values.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- wire payload narrowed at the inspector boundary before tag readers run.
  typeof value === "object" && value !== null ? (value as FieldBag) : undefined;

const fieldOf = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- wire frames arrive as decoded JSON; callers validate the field they read.
  value: unknown,
  key: string
): Json | undefined => bagOf(value)?.[key];

/** Whether an entry shows under `filter` in the timeline. */
export const matchesFilter = (
  entry: WireEntry,
  filter: EntryFilter
): boolean => {
  // oxlint-disable-next-line eslint/default-case -- the switch is exhaustive over EntryFilter; every arm returns.
  switch (filter) {
    case "all": {
      return true;
    }
    case "messages": {
      return updateTags[entry._tag] === true;
    }
    case "commands": {
      return commandTags[entry._tag] === true;
    }
  }
};

/** The message `_tag` of an `Update`, if its message carries one. */
export const tagOfMessage = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- messages arrive as decoded JSON; the tag read below validates the shape.
  message: unknown
): string | undefined => {
  const tag = fieldOf(message, "_tag");
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows this decoded JSON field immediately; unknown is the boundary parser's input contract.
  return isString(tag) ? tag : undefined;
};

/** Whether the timeline hides an `Update` under the `exclude` option. */
export const isExcluded = (
  entry: WireEntry,
  exclude: ReadonlySet<string>
): boolean => {
  if (entry._tag !== "Update") {
    return false;
  }
  const tag = tagOfMessage(fieldOf(entry, "message"));
  return tag !== undefined && exclude.has(tag);
};

/** The source tag of an `Update`, for chain summaries. */
const tagOfSource = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- sources arrive as decoded JSON; the tag read below validates the shape.
  source: unknown
): string => {
  const tag = fieldOf(source, "_tag");
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows this decoded JSON field immediately; unknown is the boundary parser's input contract.
  return isString(tag) ? tag : "unknown";
};

/** The issuing `{ seq, index }` of a Command run entry, when it carries one. */
const issuedOf = (
  entry: WireEntry
): { index: number; seq: number } | undefined => {
  const bag = bagOf(fieldOf(entry, "issued"));
  if (bag === undefined) {
    return undefined;
  }
  const { index, seq } = bag;
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows these decoded JSON fields immediately; unknown is the boundary parser's input contract.
  return isNumber(seq) && isNumber(index) ? { index, seq } : undefined;
};

/** Milliseconds between two entry `at` times, for chain run summaries. */
const atMs = (
  from: Json | undefined,
  to: Json | undefined
): number | undefined =>
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows these decoded JSON fields immediately; unknown is the boundary parser's input contract.
  isNumber(from) && isNumber(to) ? to - from : undefined;

export interface EntryLabel {
  readonly detail?: string | undefined;
  readonly text: string;
  readonly tone?: "bad" | "open" | undefined;
}

/** One-line summary of an entry for timeline rows and chain steps. */
// oxlint-disable-next-line eslint/complexity -- entry-type label switch; splitting it would churn the timeline labels.
export const labelOf = (entry: WireEntry): EntryLabel => {
  switch (entry._tag) {
    case "Update": {
      return { text: tagOfMessage(entry.message) ?? "Update" };
    }
    case "SessionStarted": {
      return { detail: entry.app, text: "SessionStarted" };
    }
    case "FetchStarted": {
      return { detail: entry.query, text: "FetchStarted" };
    }
    case "QueryChanged": {
      return { detail: entry.name, text: "QueryChanged" };
    }
    case "Failed": {
      return {
        detail:
          entry.name === undefined ? entry.in : `${entry.in} ${entry.name}`,
        text: "Failed",
        tone: "bad",
      };
    }
    case "LayerFailed": {
      return { text: "LayerFailed", tone: "bad" };
    }
    case "SubscriptionStarted":
    case "SubscriptionStopped": {
      const { deps } = entry;
      return {
        detail:
          deps === null ? entry.name : `${entry.name} ${JSON.stringify(deps)}`,
        text: entry._tag,
      };
    }
    case "MountStarted": {
      return { detail: entry.name, text: "MountStarted" };
    }
    case "MountEnded": {
      return {
        detail: entry.name,
        text: "MountEnded",
        tone: entry.reason === "failed" ? "bad" : undefined,
      };
    }
    case "CommandStarted": {
      return { detail: "started", text: entry.name };
    }
    case "CommandAwaiting": {
      return { detail: "waiting", text: entry.name, tone: "open" };
    }
    case "CommandEnded": {
      return { detail: "ended", text: entry.name };
    }
    case "CommandInterrupted": {
      return { detail: entry.reason, text: entry.name, tone: "bad" };
    }
    case "CommandDropped": {
      return { detail: "server", text: entry.name, tone: "bad" };
    }
    case "SendDropped": {
      return { detail: entry.owner, text: "SendDropped", tone: "bad" };
    }
    default: {
      return { text: entry._tag };
    }
  }
};

/** The `instance` number of an entry, when it is about an instance. */
export const instanceOf = (entry: WireEntry): number | undefined => {
  const instance = fieldOf(entry, "instance");
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows the JSON field to a number immediately; no evidence escapes.
  return isNumber(instance) ? instance : undefined;
};

/** Whether an entry counts as a failure for the panel's failure count. */
export const isFailureEntry = (entry: WireEntry): boolean =>
  entry._tag === "Failed" ||
  entry._tag === "LayerFailed" ||
  (entry._tag === "MountEnded" && entry.reason === "failed");

/** Short status text of an instance's Command runs. */
export const runStatusOf = (summary: {
  ended: readonly { count: number; reason: string }[];
  running: number;
  waiting: number;
}): string | undefined => {
  const parts: string[] = [];
  for (const { count, reason } of summary.ended) {
    parts.push(`${count} ${reason}`);
  }
  if (summary.running > 0) {
    parts.push(`${summary.running} running`);
  }
  if (summary.waiting > 0) {
    parts.push(`${summary.waiting} waiting`);
  }
  return parts.length === 0 ? undefined : parts.join(", ");
};

export interface ChainStep {
  readonly afterMs?: number | undefined;
  readonly detail?: string | undefined;
  readonly index?: number | undefined;
  readonly seq: number;
  readonly step: string;
  readonly summary: string;
}

/**
 * The causal chain of an entry: what sent its message, the Commands it
 * issued, when each started and how it ended, and what names it. Every step
 * carries the `seq` it points at, so the panel can link back and forward.
 */
// oxlint-disable-next-line eslint/complexity -- causal-chain builder over every entry type; splitting it would churn the timeline summaries.
export const chainOf = (
  session: Session,
  entry: WireEntry
): readonly ChainStep[] => {
  const steps: ChainStep[] = [];
  const at = (seq: number): string => {
    const resolved = session.resolve(seq);
    return resolved._tag === "Outside"
      ? `#${seq} (outside the buffer)`
      : `#${seq} ${labelOf(resolved).text}`;
  };
  const issuingSeq = issuedOf(entry);
  if (entry._tag === "Update") {
    const sourceTag = tagOfSource(fieldOf(entry, "source"));
    const back = session.back(entry.seq).find((link) => link.rel === "source");
    steps.push({
      detail: JSON.stringify(fieldOf(entry, "source")),
      seq: back?.seq ?? entry.seq,
      step: "source",
      summary:
        back === undefined
          ? `source ${sourceTag}`
          : `source ${sourceTag} at ${at(back.seq)}`,
    });
  } else {
    const causedBy = fieldOf(entry, "causedBy");
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows the JSON field to a number immediately; no evidence escapes.
    if (isNumber(causedBy)) {
      steps.push({
        seq: causedBy,
        step: "causedBy",
        summary: `caused by ${at(causedBy)}`,
      });
    }
  }
  if (entry._tag === "Update" || entry._tag === "Mounted") {
    const issued = fieldOf(entry, "commands");
    if (Array.isArray(issued)) {
      for (const [index, command] of issued.entries()) {
        const name = fieldOf(command, "name");
        steps.push({
          detail: `index ${index}`,
          index,
          seq: entry.seq,
          step: "command",
          // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows the JSON field to a string immediately; no evidence escapes.
          summary: `command ${isString(name) ? name : "unknown"}`,
        });
        const run = session.run({ index, seq: entry.seq });
        if (run?.start !== undefined) {
          steps.push({
            seq: run.start,
            step: "started",
            summary: `run started at ${at(run.start)}`,
          });
        }
        if (run?.end !== undefined) {
          steps.push({
            seq: run.end,
            step: "end",
            summary: `run ended at ${at(run.end)}${run.reason === undefined ? "" : ` (${run.reason})`}`,
          });
        } else if (run !== undefined) {
          steps.push({
            seq: entry.seq,
            step: "running",
            summary: "run is still open",
          });
        }
      }
    }
  }
  if (issuingSeq !== undefined) {
    const issuing = session.resolve(issuingSeq.seq);
    steps.push({
      detail: `index ${issuingSeq.index}`,
      index: issuingSeq.index,
      seq: issuingSeq.seq,
      step: "issued",
      summary: `issued by ${at(issuingSeq.seq)}${issuing._tag === "Outside" ? "" : ` (${labelOf(issuing).text})`}`,
    });
    const run = session.run(issuingSeq);
    if (run?.start !== undefined) {
      steps.push({
        seq: run.start,
        step: "started",
        summary: `run started at ${at(run.start)}`,
      });
    }
    if (run?.end !== undefined) {
      const end = session.resolve(run.end);
      steps.push({
        afterMs: atMs(fieldOf(issuing, "at"), fieldOf(end, "at")),
        seq: run.end,
        step: "end",
        summary: `run ended at ${at(run.end)}${run.reason === undefined ? "" : ` (${run.reason})`}`,
      });
    } else if (run !== undefined) {
      steps.push({
        seq: issuingSeq.seq,
        step: "running",
        summary: "run is still open",
      });
    }
  }
  steps.push({
    detail: JSON.stringify(labelOf(entry)),
    seq: entry.seq,
    step: "entry",
    summary: `#${entry.seq} ${labelOf(entry).text}`,
  });
  for (const link of session.forward(entry.seq)) {
    steps.push({
      detail: link.rel,
      seq: link.seq,
      step: "named by",
      summary: `${link.rel} at ${at(link.seq)}`,
    });
  }
  return steps;
};

// ---------------------------------------------------------------------------
// Backend: the page-side Inspector, History and component schemas.
// ---------------------------------------------------------------------------

/**
 * One instance's recorded state at a paused `seq`, from `History.at`.
 * The page script turns these into the inert historical copy.
 */
export interface HistoryLookup {
  readonly stateOf: (path: string) => HeldState | undefined;
}

/** What a paused session holds until resume. */
export interface PauseHandle {
  readonly resume: () => void;
}

/** The DOM half of a pause, implemented by the page script. */
export interface PauseHost {
  /** Hide the live island containers; the live runtime keeps running. */
  readonly hideLive: () => void;
  /**
   * Mount the inert historical copy rendered from these states. Resolves
   * `false` when the copy fails to render, after restoring live.
   */
  readonly showHistorical: (
    states: ReadonlyMap<string, HeldState>
    // oxlint-disable-next-line typescript/no-invalid-void-type -- the pause-host contract shares void with the page script; undefined would churn the public bridge API.
  ) => void | Promise<boolean>;
  /** Remove the copy and reveal the live containers. */
  readonly restoreLive: () => void;
}

/**
 * The live-model control seam. Devtools never touches the runtime
 * directly: `pause` hides the live island (which keeps running) and mounts
 * an inert historical copy, `resume` removes the copy and restores live,
 * and `dispatch` delivers an already schema-decoded message through the
 * normal runtime update and logging. The page script adapts `@ilha/model`'s
 * Devtools seam to this interface; tests and custom runtimes implement it.
 */
export interface ModelRuntimeBridge {
  /** Whether `session` has a live runtime this bridge can control. */
  readonly isControllable: (session: string) => boolean;
  /**
   * Pause `session` at `seq`: hide the live island (which keeps running)
   * and mount the inert historical copy painted from `lookup`'s states.
   * Calling it on an already-paused session replaces its copy. The bridge
   * owns the DOM half of the pause (see `PauseHost`).
   */
  readonly pause: (
    session: string,
    seq: number,
    lookup: HistoryLookup
  ) => PauseHandle | Promise<PauseHandle>;
  /** Resume a paused `session`, removing its historical copy. */
  readonly resume: (session: string) => void | Promise<void>;
  /**
   * Deliver an already schema-decoded message to the instance at `path`,
   * through the normal runtime update and logging. Returns `false` when
   * the path is missing or closed.
   */
  readonly dispatch: (
    session: string,
    path: string,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- dispatch delivers an already schema-decoded message; the bridge owns validation.
    message: unknown
  ) => boolean | Promise<boolean>;
}

/** Frames the page keeps are Wire entries decoded from JSON. */
export type WireFrames = readonly WireEntry[];

export interface ModelBackendOptions {
  /** Entries kept per session; 1,000 by default. */
  readonly size?: number | undefined;
  /** Message `_tag`s hidden from the timeline. */
  readonly exclude?: readonly string[] | undefined;
  /** Register the destructive `ilha_model_dispatch` tool. Default `false`. */
  readonly dispatch?: boolean | undefined;
}

/** The page-side model state the tools and the panel read. */
export interface ModelBackend {
  /** Component name to its live message Schema (`Schema.Top` at runtime). */
  readonly componentSchemas: Map<string, unknown>;
  /** Whether the destructive `ilha_model_dispatch` tool is registered. */
  readonly dispatchEnabled: boolean;
  /**
   * The live-runtime control seam. Set by the page script once `@ilha/model`
   * loads; `undefined` in pure-log readers such as the panel backend.
   */
  bridge: ModelRuntimeBridge | undefined;
  /** Message `_tag`s hidden from the timeline. */
  readonly excludeTags: ReadonlySet<string>;
  readonly history: History;
  readonly inspector: Inspector;
  /** Sessions paused for time travel: session id to the shown `seq`. */
  readonly pausedAt: Map<string, number>;
  /** Entries kept per session. */
  readonly size: number;
  /** Forget a session and every entry of it. */
  readonly clear: (session: string) => void;
  /** Fold Wire frames into the Inspector and the History. */
  readonly ingest: (frames: WireFrames) => void;
  /** Remember a live component's message Schema for `get_message_schema`. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- noteComponent stores the live message Schema; the panel reads it back through Schema codecs.
  readonly noteComponent: (component: string, message: unknown) => void;
}

/** Make the page-side backend: an Inspector plus a History per session. */
export const createModelBackend = (
  options?: ModelBackendOptions | undefined
): ModelBackend => {
  const size = Math.max(1, options?.size ?? 1000);
  const excludeTags = new Set<string>(options?.exclude);
  const inspector = make({ exclude: [...excludeTags], size });
  const history = makeHistory(size);
  const componentSchemas = new Map<string, unknown>();
  const pausedAt = new Map<string, number>();
  return {
    bridge: undefined,
    clear: (session) => {
      const kept = inspector.sessions().find((held) => held.id === session);
      const last = kept?.entries().at(-1)?.seq;
      kept?.clear();
      if (last === undefined) {
        history.drop(session);
      } else {
        history.clear(session, last);
      }
      pausedAt.delete(session);
    },
    componentSchemas,
    dispatchEnabled: options?.dispatch ?? false,
    excludeTags,
    history,
    ingest: (frames) => {
      inspector.ingest(frames);
      for (const frame of frames) {
        history.record(frame, isExcluded(frame, excludeTags));
      }
    },
    inspector,
    noteComponent: (component, message) => {
      componentSchemas.set(component, message);
    },
    pausedAt,
    size,
  };
};

// ---------------------------------------------------------------------------
// Tool implementations: pure over a backend, raising ToolError on misuse.
// ---------------------------------------------------------------------------

const OUTLINE_BUDGET = 24_000;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- sizeOf measures any JSON payload for the outline budget.
const sizeOf = (value: unknown): number => JSON.stringify(value)?.length ?? 0;

const selectPath = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- path selection walks decoded JSON; the result stays a JSON subtree.
  value: unknown,
  path: readonly (string | number)[] | undefined
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- path selection walks decoded JSON; the result stays a JSON subtree.
): unknown => {
  let selected = value;
  for (const key of path ?? []) {
    const bag = bagOf(selected);
    if (bag === undefined) {
      failTool(`Path [${(path ?? []).join(", ")}] does not exist.`);
    }
    selected = bag[key];
    if (selected === undefined) {
      failTool(`Path [${(path ?? []).join(", ")}] does not exist.`);
    }
  }
  return selected;
};

const previewKeys = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- outline previews list any JSON value's keys.
  value: unknown
): readonly string[] | undefined => {
  if (Array.isArray(value)) {
    return [`length ${value.length}`];
  }
  const bag = bagOf(value);
  return bag === undefined ? undefined : Object.keys(bag).slice(0, 8);
};

/**
 * Results over 24 KB come back as an outline; pass `path` to read a subtree.
 */
interface FitOutline {
  readonly bytes: number;
  readonly keys?: readonly string[] | undefined;
  readonly note: string;
  readonly "~outline": true;
}

/**
 * Results over 24 KB come back as an outline; pass `path` to read a subtree.
 */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- fit returns the selected JSON subtree untouched, or an outline of it.
export const fit = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- tool results are arbitrary JSON subtrees; path selects within them.
  value: unknown,
  path?: readonly (string | number)[] | undefined
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- fit returns the selected JSON subtree untouched, or an outline of it.
): unknown => {
  const selected = selectPath(value, path);
  if (sizeOf(selected) <= OUTLINE_BUDGET) {
    return selected;
  }
  const keys = previewKeys(selected);
  const outline: FitOutline = {
    bytes: sizeOf(selected),
    note: `Result is over ${OUTLINE_BUDGET} bytes. Pass path to read a subtree.`,
    "~outline": true,
  };
  return keys === undefined ? outline : { ...outline, keys };
};

// SAFETY: fromEntries rebuilds the same keys minus nullish ones; the shape stays within Partial<A>.
const omitNull = <A extends Record<string, unknown>>(record: A): Partial<A> =>
  Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => value !== undefined && value !== null
    )
  ) as Partial<A>;

const newestSession = (backend: ModelBackend): Session => {
  const sessions = backend.inspector.sessions();
  const newest = sessions.at(-1);
  if (newest === undefined) {
    failTool(
      "No session has connected yet. Mount the app with the devtools page script installed."
    );
  }
  return newest;
};

const sessionOf = (
  backend: ModelBackend,
  session: string | undefined
): Session => {
  if (session !== undefined) {
    const found = backend.inspector
      .sessions()
      .find((held) => held.id === session);
    if (found === undefined) {
      failTool(`No session ${session}. Call ilha_model_list_sessions.`);
    }
    return found;
  }
  return newestSession(backend);
};

const entryOf = (session: Session, seq: number): WireEntry => {
  const entry = session.resolve(seq);
  if (entry._tag === "Outside") {
    failTool(`Entry #${seq} is not in the session's buffer.`);
  }
  return entry;
};

interface EntryRow {
  readonly causedBy?: number | undefined;
  readonly changed?: boolean | "unknown" | undefined;
  readonly instance?: number | undefined;
  readonly label?: string | undefined;
  readonly path?: string | undefined;
  readonly seq?: number | undefined;
  readonly tag?: string | undefined;
}

const rowOf = (session: Session, entry: WireEntry): EntryRow => {
  const label = labelOf(entry);
  const causedBy = fieldOf(entry, "causedBy");
  const path = fieldOf(entry, "path");
  return omitNull({
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows the JSON field to a number immediately; no evidence escapes.
    causedBy: isNumber(causedBy) ? causedBy : undefined,
    changed: session.previous(entry.seq)?.changed,
    instance: instanceOf(entry),
    label: [label.text, label.detail].filter(Boolean).join(" "),
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows the JSON field to a string immediately; no evidence escapes.
    path: isString(path) ? path : undefined,
    seq: entry.seq,
    tag: entry._tag,
  });
};

const openRuns = (
  session: Session,
  params: {
    readonly instance?: number | undefined;
    readonly run?: { readonly index: number; readonly seq: number } | undefined;
    readonly since?: number | undefined;
  }
) =>
  session
    .records(params.instance)
    .filter(
      (record) =>
        record.kind === "command" &&
        record.end === undefined &&
        record.issued !== undefined &&
        (params.since === undefined || record.issued.seq > params.since) &&
        (params.run === undefined ||
          (record.issued.seq === params.run.seq &&
            record.issued.index === params.run.index))
    );

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- checkString is the boundary parser for string arguments; unknown is its input contract.
const checkString = (value: unknown, name: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isString(value)) {
    failTool(`${name} must be a string.`);
  }
  return value;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- checkNumber is the boundary parser for numeric arguments; unknown is its input contract.
const checkNumber = (value: unknown, name: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isNumber(value)) {
    failTool(`${name} must be a number.`);
  }
  return value;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- checkLimit is the boundary parser for limit arguments; unknown is its input contract.
const checkLimit = (value: unknown): number => {
  const limit = value === undefined ? 50 : value;
  if (
    !isNumber(limit) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 500
  ) {
    failTool("limit must be an integer between 1 and 500.");
  }
  return limit;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- checkTimeout is the boundary parser for timeout arguments; unknown is its input contract.
const checkTimeout = (value: unknown): number => {
  const timeout = value === undefined ? 5000 : value;
  if (!isNumber(timeout) || timeout < 0 || timeout > 60_000) {
    failTool("timeout must be a number of milliseconds between 0 and 60000.");
  }
  return timeout;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- checkFilter is the boundary parser for filter arguments; unknown is its input contract.
const checkFilter = (value: unknown): EntryFilter => {
  if (value === undefined) {
    return "all";
  }
  if (value !== "messages" && value !== "commands" && value !== "all") {
    failTool('filter must be "messages", "commands" or "all".');
  }
  return value;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- checkPath is the boundary parser for path arguments; unknown is its input contract.
const checkPath = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- checkPath is the boundary parser for path arguments; unknown is its input contract.
  value: unknown
): readonly (string | number)[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows this decoded JSON field immediately; unknown is the boundary parser's input contract.
    value.some((key: Json) => !isString(key) && !isNumber(key))
  ) {
    failTool("path must be an array of strings and numbers.");
  }
  return value.filter(
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows this decoded JSON field immediately; unknown is the boundary parser's input contract.
    (key: Json): key is string | number => isString(key) || isNumber(key)
  );
};

/** The argument every `ilha_model_*` tool takes; handlers validate the rest. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- tool args arrive as decoded JSON; each handler validates the fields it reads.
export type ToolArgs = Record<string, unknown>;

/** One tool result: `{ result }`, or a thrown `ToolError` as `{ error }`. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-returns -- the tool table is keyed by tool name; each handler validates its own args and results are serialized payloads.
export type ToolHandlers = Readonly<
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-returns -- the tool table is keyed by tool name; each handler validates its own args and results are serialized payloads.
  Record<string, (args: ToolArgs) => unknown | Promise<unknown>>
>;

const narrowSchema = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- schema documents arrive as decoded JSON; fields are read structurally below.
  document: unknown,
  tag: string
): Json | undefined => {
  const envelope = fieldOf(document, "schema") ?? document;
  const anyOf = fieldOf(envelope, "anyOf");
  if (!Array.isArray(anyOf)) {
    return undefined;
  }
  return anyOf.find((branch) => {
    const tagSchema = fieldOf(fieldOf(branch, "properties"), "_tag");
    const single = fieldOf(tagSchema, "const");
    const options = fieldOf(tagSchema, "enum");
    return single === tag || (Array.isArray(options) && options.includes(tag));
  });
};
/**
 * The `ilha_model_*` tool implementations over a backend. `dispatch` is
 * only registered when the backend was created with `{ dispatch: true }`;
 * `show_entry` and `resume` need a live-runtime bridge on the backend and
 * fail precisely without one.
 */
export const modelToolHandlers = (backend: ModelBackend): ToolHandlers => {
  const dispatchHandlers: ToolHandlers = backend.dispatchEnabled
    ? {
        ilha_model_dispatch: async (args) => {
          const session = sessionOf(
            backend,
            checkString(args["session"], "session")
          );
          const instance = checkNumber(args["instance"], "instance");
          if (instance === undefined) {
            failTool("instance is required.");
          }
          const found = session
            .instances()
            .find((held) => held.instance === instance);
          if (found === undefined) {
            failTool(`Instance ${instance} is not in the session's buffer.`);
          }
          const schema = backend.componentSchemas.get(found.component);
          if (schema === undefined) {
            failTool(
              `No message schema recorded for component ${found.component}. The schema arrives with the instance's next live entry.`
            );
          }
          const input = args["message"];
          if (input === undefined) {
            failTool("message is required.");
          }
          let decoded: unknown;
          try {
            // SAFETY: noteComponent stores the component's live message Schema; decodeUnknownSync validates the input against it.
            decoded = Schema.decodeUnknownSync(
              schema as Schema.ConstraintDecoder<unknown>
            )(input);
          } catch (error) {
            failTool(
              `Message failed to decode against ${found.component}'s message schema: ${error instanceof Error ? error.message : String(error)}`
            );
          }
          const { bridge } = backend;
          if (bridge === undefined || !bridge.isControllable(session.id)) {
            failTool(
              `Session ${session.id} is not controllable. Dispatch needs its live runtime bridge.`
            );
          }
          const delivered = await bridge.dispatch(
            session.id,
            found.path,
            decoded
          );
          if (!delivered) {
            failTool(
              `Instance ${instance} at ${found.path} is missing or closed.`
            );
          }
          return {
            result: {
              dispatched: true,
              instance,
              path: found.path,
              session: session.id,
            },
          };
        },
      }
    : {};
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the tool table is keyed by tool name; each handler validates its own args.
  const handlers: ToolHandlers = {
    ilha_model_count_entries: (args) => {
      const session = sessionOf(
        backend,
        checkString(args["session"], "session")
      );
      const instance = checkNumber(args["instance"], "instance");
      const entries: Record<string, number> = {};
      const messages: Record<string, number> = {};
      for (const entry of session.entries()) {
        if (instance !== undefined && instanceOf(entry) !== instance) {
          continue;
        }
        entries[entry._tag] = (entries[entry._tag] ?? 0) + 1;
        if (entry._tag === "Update") {
          const tag = tagOfMessage(entry.message);
          if (tag !== undefined) {
            messages[tag] = (messages[tag] ?? 0) + 1;
          }
        }
      }
      return { result: { entries, messages } };
    },
    ilha_model_diff_state: (args) => {
      const session = sessionOf(
        backend,
        checkString(args["session"], "session")
      );
      const seq = checkNumber(args["seq"], "seq");
      if (seq === undefined) {
        failTool("seq is required.");
      }
      const entry = entryOf(session, seq);
      if (
        entry._tag !== "Waiting" &&
        entry._tag !== "Mounted" &&
        entry._tag !== "Update"
      ) {
        failTool(`#${seq} is not a Waiting, Mounted or Update entry held.`);
      }
      const instance = fieldOf(entry, "instance");
      const entryPath = fieldOf(entry, "path");
      const entryModel = fieldOf(entry, "model");
      if (
        // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows the JSON instance field to a number immediately.
        !isNumber(instance) ||
        // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows the JSON path field to a string immediately.
        !isString(entryPath) ||
        entryModel === undefined
      ) {
        failTool(`#${seq} is not a Waiting, Mounted or Update entry held.`);
      }
      const from = checkNumber(args["from"], "from");
      let before: unknown;
      let base: number | undefined = from;
      if (from === undefined) {
        const previous = session.previous(seq);
        if (previous === undefined) {
          return {
            result: {
              changes: [],
              first: true,
              instance,
            },
          };
        }
        base = previous.seq;
        const earlier = session.resolve(previous.seq);
        before =
          earlier._tag === "Waiting" ||
          earlier._tag === "Mounted" ||
          earlier._tag === "Update"
            ? fieldOf(earlier, "model")
            : previous.model;
        if (before === undefined) {
          failTool(`The state entry before #${seq} is no longer held.`);
        }
      } else {
        const held = backend.history.instanceAt(session.id, from, instance);
        if (held === undefined || held === "outside") {
          failTool(`Instance ${instance} has no state at #${from}.`);
        }
        before = held.model;
      }
      return {
        result: {
          // SAFETY: before is the held entry Model or replayed History state, both decoded JSON; entryModel was narrowed to JSON above.
          changes: diff(before as Json, entryModel),
          from: base,
          instance,
          path: entryPath,
          to: seq,
        },
      };
    },
    ...dispatchHandlers,
    ilha_model_get_chain: (args) => {
      const session = sessionOf(
        backend,
        checkString(args["session"], "session")
      );
      const seq = checkNumber(args["seq"], "seq");
      if (seq === undefined) {
        failTool("seq is required.");
      }
      return {
        result: fit(
          chainOf(session, entryOf(session, seq)).map((step) =>
            omitNull({ ...step })
          )
        ),
      };
    },
    ilha_model_get_entry: (args) => {
      const session = sessionOf(
        backend,
        checkString(args["session"], "session")
      );
      const seq = checkNumber(args["seq"], "seq");
      if (seq === undefined) {
        failTool("seq is required.");
      }
      return { result: fit(entryOf(session, seq), checkPath(args["path"])) };
    },
    ilha_model_get_message_schema: (args) => {
      const session = sessionOf(
        backend,
        checkString(args["session"], "session")
      );
      const instance = checkNumber(args["instance"], "instance");
      if (instance === undefined) {
        failTool("instance is required.");
      }
      const found = session
        .instances()
        .find((held) => held.instance === instance);
      if (found === undefined) {
        failTool(`Instance ${instance} is not in the session's buffer.`);
      }
      const message = backend.componentSchemas.get(found.component);
      if (message === undefined) {
        failTool(
          `No message schema recorded for component ${found.component}. The schema arrives with the instance's next live entry.`
        );
      }
      const tag = checkString(args["tag"], "tag");
      // SAFETY: backend.componentSchemas only holds recorded message Schemas; the codec read below validates the shape.
      const codec = Schema.toCodecJson(message as Schema.Top);
      const document = Schema.toJsonSchemaDocument(codec);
      if (tag === undefined) {
        return { result: document };
      }
      const narrowed = narrowSchema(document, tag);
      if (narrowed === undefined) {
        failTool(
          `Message tag ${tag} is not in ${found.component}'s message schema.`
        );
      }
      return { result: narrowed };
    },
    ilha_model_get_state: (args) => {
      const session = sessionOf(
        backend,
        checkString(args["session"], "session")
      );
      const instance = checkNumber(args["instance"], "instance");
      if (instance === undefined) {
        failTool("instance is required.");
      }
      const at =
        checkNumber(args["at"], "at") ?? session.entries().at(-1)?.seq ?? -1;
      const held = backend.history.instanceAt(session.id, at, instance);
      if (held === "outside") {
        failTool(
          `#${at} is older than the last ${backend.size} entries the page keeps to paint from.`
        );
      }
      if (held === undefined) {
        failTool(`Instance ${instance} has no state at #${at}.`);
      }
      const state = omitNull({
        at,
        instance,
        model: held.model,
        path: held.path,
        props: held.props,
        queries: held.queries,
        unmounted:
          held.unmounted === undefined
            ? undefined
            : `unmounted at #${held.unmounted}`,
      });
      return { result: fit(state, checkPath(args["path"])) };
    },
    ilha_model_list_entries: (args) => {
      const session = sessionOf(
        backend,
        checkString(args["session"], "session")
      );
      const instance = checkNumber(args["instance"], "instance");
      const filter = checkFilter(args["filter"]);
      const tag = checkString(args["tag"], "tag");
      const after = checkNumber(args["after"], "after");
      const limit = checkLimit(args["limit"]);
      const rows = session
        .entries()
        .filter(
          (entry) =>
            matchesFilter(entry, filter) &&
            (instance === undefined || instanceOf(entry) === instance) &&
            (after === undefined || entry.seq > after) &&
            (tag === undefined ||
              entry._tag === tag ||
              (entry._tag === "Update" && tagOfMessage(entry.message) === tag))
        );
      const shown =
        after === undefined ? rows.slice(-limit) : rows.slice(0, limit);
      return {
        result: {
          rows: shown.map((entry) => rowOf(session, entry)),
          total: rows.length,
        },
      };
    },
    ilha_model_list_instances: (args) => {
      const session = sessionOf(
        backend,
        checkString(args["session"], "session")
      );
      return {
        result: session.instances().map((instance) =>
          omitNull({
            ...instance,
            status: runStatusOf(
              session.summary(instance.instance) ?? {
                ended: [],
                running: 0,
                waiting: 0,
              }
            ),
          })
        ),
      };
    },
    ilha_model_list_sessions: () => ({
      result: backend.inspector.sessions().map((session) => {
        const entries = session.entries();
        return omitNull({
          app: session.app,
          connected: true,
          controllable: backend.bridge?.isControllable(session.id) ?? false,
          entries: entries.length,
          first: entries[0]?.seq,
          instances: session.instances().length,
          last: entries.at(-1)?.seq,
          paused: backend.pausedAt.get(session.id),
          session: session.id,
        });
      }),
    }),
    ilha_model_resume: async (args) => {
      const session = sessionOf(
        backend,
        checkString(args["session"], "session")
      );
      if (!backend.pausedAt.has(session.id)) {
        failTool(`Session ${session.id} is not paused.`);
      }
      const { bridge } = backend;
      if (bridge === undefined || !bridge.isControllable(session.id)) {
        failTool(
          `Session ${session.id} is not controllable. Resume needs its live runtime bridge.`
        );
      }
      await bridge.resume(session.id);
      backend.pausedAt.delete(session.id);
      return { result: { resumed: true, session: session.id } };
    },
    ilha_model_show_entry: async (args) => {
      const session = sessionOf(
        backend,
        checkString(args["session"], "session")
      );
      const seq = checkNumber(args["seq"], "seq");
      if (seq === undefined) {
        failTool("seq is required.");
      }
      // Validates the entry is still held; History.at replays its exact state.
      entryOf(session, seq);
      const states = backend.history.at(session.id, seq);
      if (states === undefined) {
        failTool(`Entry #${seq} is not held for time travel.`);
      }
      const { bridge } = backend;
      if (bridge === undefined || !bridge.isControllable(session.id)) {
        failTool(
          `Session ${session.id} is not controllable. Pause needs its live runtime bridge.`
        );
      }
      await bridge.pause(session.id, seq, {
        stateOf: (path) => states(path),
      });
      backend.pausedAt.set(session.id, seq);
      return { result: { paused: true, seq, session: session.id } };
    },
    ilha_model_wait: async (args) => {
      const session = sessionOf(
        backend,
        checkString(args["session"], "session")
      );
      const since = checkNumber(args["since"], "since");
      const instance = checkNumber(args["instance"], "instance");
      const { run } = args;
      let runRef: { readonly index: number; readonly seq: number } | undefined;
      if (run !== undefined) {
        const seq = fieldOf(run, "seq");
        const index = fieldOf(run, "index");
        // oxlint-disable-next-line anti-slop/no-known-value-widening -- the guard narrows both JSON fields to numbers immediately; no evidence escapes.
        if (!isNumber(seq) || !isNumber(index)) {
          failTool("run must be { seq, index }.");
        }
        runRef = { index, seq };
      }
      const timeout = checkTimeout(args["timeout"]);
      const params = { instance, run: runRef, since };
      const deadline = Date.now() + timeout;
      for (;;) {
        const open = openRuns(session, params);
        if (open.length === 0) {
          return {
            result: {
              last: session.entries().at(-1)?.seq,
              settled: true,
            },
          };
        }
        if (Date.now() >= deadline) {
          return {
            result: omitNull({
              last: session.entries().at(-1)?.seq,
              open: open.map((record) => omitNull({ ...record })),
              settled: false,
            }),
          };
        }
        // oxlint-disable-next-line no-await-in-loop -- the wait tool polls until runs settle or the deadline passes; each iteration reads fresh state.
        await sleep(10);
      }
    },
  };
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the tool table is keyed by tool name; each handler validates its own args.
  return handlers;
};

// ---------------------------------------------------------------------------
// WebMCP registration.
// ---------------------------------------------------------------------------

const buildIslandTools = (tools: PageTools): WebMcpTool[] => [
  {
    annotations: { readOnlyHint: true, title: "Inspect Ilha islands" },
    description:
      "List every live Ilha island on this page as a JSON tree: component names, atom values by slot index, child components, and host selectors. Call this first to learn which ids exist.",
    execute: () => text(tools.inspect()),
    inputSchema: { properties: {}, type: "object" },
    name: "ilha_inspect",
  },
  {
    annotations: { readOnlyHint: false, title: "Highlight an Ilha component" },
    description:
      "Outline a component's element on the page. Pass an id from ilha_inspect, or null to clear the outline.",
    execute: ({ id }) =>
      id === null || isString(id)
        ? text({ found: tools.highlight(id) })
        : fail("id must be a string from ilha_inspect, or null."),
    inputSchema: {
      properties: { id: { type: ["string", "null"] } },
      required: ["id"],
      type: "object",
    },
    name: "ilha_highlight",
  },
  {
    annotations: { readOnlyHint: false, title: "Set an Ilha atom" },
    description:
      "Replace one atom's value in a live component with a JSON value and let it rerender. Use the id and atom index from ilha_inspect. Derived and Effect atoms are read-only. Model islands are read-only here; change them with ilha_model_dispatch.",
    execute: ({ id, index, value }) =>
      isString(id) && isNumber(index) && value !== undefined
        ? text(tools.setAtom(id, index, value))
        : fail("Pass id (string), index (number), and value (JSON)."),
    inputSchema: {
      properties: {
        id: { type: "string" },
        index: { type: "integer" },
        value: {},
      },
      required: ["id", "index", "value"],
      type: "object",
    },
    name: "ilha_set_atom",
  },
];

// oxlint-disable-next-line anti-slop/no-known-value-widening -- the keys are the fixed ilha_model_* tool set; descriptions are looked up by tool name.
const TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  ilha_model_count_entries:
    "Counts the entries the session holds by entry _tag, and Update entries by message _tag.",
  ilha_model_diff_state:
    "Lists what an Update, Mounted or Waiting entry changed in its instance's Model, compared with the instance's state entry before it, or with its state at from. A change involving a placeholder is \"unknown\".",
  ilha_model_dispatch:
    "Delivers a message to a live instance through the normal runtime update and logging. The message is decoded against the instance's message schema first. Only registered when the page installs devtools with dispatch: true.",
  ilha_model_get_chain:
    "Returns the causal chain of an entry: what sent its message, the Commands it issued, when each started and how it ended, and what each run sent back.",
  ilha_model_get_entry:
    "Returns one entry as its Wire frame: the message, Model, props, Commands and source of an Update, the init Model and Commands of a Mounted. Redacted values are shown as placeholders.",
  ilha_model_get_message_schema:
    "Returns the JSON Schema of the messages an instance accepts.",
  ilha_model_get_state:
    "Returns an instance's Model, props and query results now, or as they were at an entry.",
  ilha_model_list_entries:
    'Lists log entries as rows without payloads, oldest first. Without after, returns the newest limit rows. filter "messages" keeps updates, mounts and failures, "commands" adds Command runs. Read one entry with get_entry, its causal chain with get_chain.',
  ilha_model_list_instances:
    "Lists the component instances of a session with their instance number, path, the seq of their Mounted and Unmounted entries, and the state of their Command runs.",
  ilha_model_list_sessions:
    "Lists the sessions the page holds. A session is one mounted root. Reports whether each session is controllable and the seq it is paused at. Start with this and list_instances.",
  ilha_model_resume:
    "Removes the inert historical copy a show_entry mounted and restores the live island, which kept running while paused.",
  ilha_model_show_entry:
    "Pauses a session at an entry: hides the live island (it keeps running) and mounts an inert server-rendered copy of each instance's state at that entry from History. Resume restores live.",
  ilha_model_wait:
    "Waits until the Command runs issued after since have ended, or the timeout passes. Scope it with instance or run so a long-lived stream does not hold it up. Returns the runs still open on timeout.",
};

// oxlint-disable-next-line anti-slop/no-known-value-widening -- the keys are the fixed ilha_model_* action set; membership reads stay boolean.
const ACTION_TOOLS: Record<string, true> = {
  ilha_model_dispatch: true,
  ilha_model_resume: true,
  ilha_model_show_entry: true,
};

/** What each `ilha_model_*` tool accepts, so agents can discover the arguments. */
// oxlint-disable-next-line anti-slop/no-known-value-widening -- the keys are the fixed ilha_model_* tool set; schemas are looked up by tool name.
const INPUT_SCHEMAS: Readonly<Record<string, ToolSchema>> = {
  ilha_model_count_entries: {
    properties: {
      instance: { type: "integer" },
      session: { type: "string" },
    },
    type: "object",
  },
  ilha_model_diff_state: {
    properties: {
      from: { type: "integer" },
      seq: { type: "integer" },
      session: { type: "string" },
    },
    required: ["seq"],
    type: "object",
  },
  ilha_model_dispatch: {
    properties: {
      instance: { type: "integer" },
      message: {},
      session: { type: "string" },
    },
    required: ["instance", "message"],
    type: "object",
  },
  ilha_model_get_chain: {
    properties: { seq: { type: "integer" }, session: { type: "string" } },
    required: ["seq"],
    type: "object",
  },
  ilha_model_get_entry: {
    properties: {
      path: { items: { type: ["string", "integer"] }, type: "array" },
      seq: { type: "integer" },
      session: { type: "string" },
    },
    required: ["seq"],
    type: "object",
  },
  ilha_model_get_message_schema: {
    properties: {
      instance: { type: "integer" },
      session: { type: "string" },
      tag: { type: "string" },
    },
    required: ["instance"],
    type: "object",
  },
  ilha_model_get_state: {
    properties: {
      at: { type: "integer" },
      instance: { type: "integer" },
      path: { items: { type: ["string", "integer"] }, type: "array" },
      session: { type: "string" },
    },
    required: ["instance"],
    type: "object",
  },
  ilha_model_list_entries: {
    properties: {
      after: { type: "integer" },
      filter: { enum: ["messages", "commands", "all"], type: "string" },
      instance: { type: "integer" },
      limit: { maximum: 500, minimum: 1, type: "integer" },
      session: { type: "string" },
      tag: { type: "string" },
    },
    type: "object",
  },
  ilha_model_list_instances: {
    properties: { session: { type: "string" } },
    type: "object",
  },
  ilha_model_list_sessions: { properties: {}, type: "object" },
  ilha_model_resume: {
    properties: { session: { type: "string" } },
    type: "object",
  },
  ilha_model_show_entry: {
    properties: { seq: { type: "integer" }, session: { type: "string" } },
    required: ["seq"],
    type: "object",
  },
  ilha_model_wait: {
    properties: {
      instance: { type: "integer" },
      run: {
        properties: { index: { type: "integer" }, seq: { type: "integer" } },
        required: ["index", "seq"],
        type: "object",
      },
      session: { type: "string" },
      since: { type: "integer" },
      timeout: { maximum: 60_000, minimum: 0, type: "integer" },
    },
    type: "object",
  },
};

const buildModelTools = (backend: ModelBackend): WebMcpTool[] => {
  const handlers = modelToolHandlers(backend);
  return Object.entries(handlers).map(([name, handler]) => ({
    annotations: { readOnlyHint: ACTION_TOOLS[name] !== true, title: name },
    description: TOOL_DESCRIPTIONS[name] ?? name,
    execute: async (args: ToolArgs) => {
      try {
        return text(await handler(args));
      } catch (error) {
        return fail(
          error instanceof ToolError ? error.message : `Tool ${name} failed.`
        );
      }
    },
    inputSchema: INPUT_SCHEMAS[name] ?? { properties: {}, type: "object" },
    name,
  }));
};

/** Register the island tools plus the `ilha_model_*` tools. */
export const registerWebMcpTools = (
  tools: PageTools,
  backend?: ModelBackend | undefined
): (() => void) => {
  const context = resolveModelContext();
  if (!context) {
    return noop;
  }
  const controller = new AbortController();
  const registrations = [
    ...buildIslandTools(tools),
    ...(backend === undefined ? [] : buildModelTools(backend)),
  ].map((tool) => context.registerTool(tool, { signal: controller.signal }));
  return () => {
    controller.abort();
    for (const registration of registrations) {
      registration?.unregister?.();
    }
  };
};

/** Summaries for the panel's session picker. */
export const sessionSummaries = (
  backend: ModelBackend
): readonly { session: string }[] =>
  backend.inspector.sessions().map((session) => ({ session: session.id }));

/** Frames of one session after `since`, for the panel's poll loop. */
export const framesAfter = (
  backend: ModelBackend,
  session: string,
  since: number
): ModelFramesResult => {
  const found = backend.inspector
    .sessions()
    .find((held) => held.id === session);
  if (found === undefined) {
    return { ok: false as const, reason: `No session ${session}.` };
  }
  return {
    frames: found.entries().filter((entry) => entry.seq > since),
    ok: true as const,
  };
};

/** The message schema of a component for the panel's schema peek. */
export const messageSchemaOf = (
  backend: ModelBackend,
  component: string,
  tag?: string | undefined
): ModelSchemaResult => {
  const message = backend.componentSchemas.get(component);
  if (message === undefined) {
    return {
      ok: false,
      reason: `No message schema recorded for component ${component}.`,
    };
  }
  const document = Schema.toJsonSchemaDocument(
    // SAFETY: backend.componentSchemas only holds recorded message Schemas; the codec read below validates the shape.
    Schema.toCodecJson(message as Schema.Top)
  );
  if (tag === undefined) {
    return { ok: true, schema: document };
  }
  const narrowed = narrowSchema(document, tag);
  return narrowed === undefined
    ? {
        ok: false,
        reason: `Message tag ${tag} is not in ${component}'s message schema.`,
      }
    : { ok: true, schema: narrowed };
};
