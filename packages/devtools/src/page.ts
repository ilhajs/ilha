import type { MessageLog } from "@ilha/model";
/**
 * Page script: runs in the app, answers panels and agents. Import it only in
 * development; it pulls in `ilha/debug` and `devframe/in-page-channel`.
 *
 * The `@ilha/model` pipeline attaches a `MessageLog` sink through
 * `MessageLog.attach` (page-global) and encodes live entries to Wire frames
 * with `MessageLog.makeEncoder`. The frames feed the page-side backend from
 * `webmcp.ts`, which the panel polls and the `ilha_model_*` agent tools read.
 */
import { createPageScriptChannel } from "devframe/in-page-channel";
import type { PageScriptChannel } from "devframe/in-page-channel";
import { h, renderToString } from "ilha";
import { element, inspect, onChange, setAtom } from "ilha/debug";

import { ILHA_DEVTOOLS_CHANNEL, ILHA_DEVTOOLS_PANEL_PATH } from "./protocol";
import type {
  AtomJson,
  IlhaDevtoolsProtocol,
  IlhaInspectNode,
  ModelControlResult,
  ModelFramesResult,
  ModelSchemaResult,
  ModelSessionSummary,
  SetAtomResult,
} from "./protocol";
import {
  createModelBackend,
  framesAfter,
  messageSchemaOf,
  modelToolHandlers,
  registerWebMcpTools,
  ToolError,
} from "./webmcp";
import type {
  HeldState,
  ModelBackend,
  ModelRuntimeBridge,
  PauseHost,
} from "./webmcp";

export type {
  AtomJson,
  IlhaDevtoolsProtocol,
  ModelControlResult,
  ModelFramesResult,
  ModelSchemaResult,
  ModelSessionSummary,
} from "./protocol";

export interface InstallOptions {
  /**
   * Window that receives panel handshakes. Pass `false` to skip the
   * handshake and attach panels yourself with `channel.addPanelPort()`.
   * Defaults to the global `window`.
   */
  window?: Window | false;
  /** Register `ilha_*` tools on the browser's WebMCP model context. Default `true`. */
  webmcp?: boolean;
  /** Where `openPanel()` opens the panel. Default `/__ilha-devtools/`. */
  panelUrl?: string;
  /** Wire entries kept per session; 1,000 by default. */
  size?: number;
  /** Message `_tag`s hidden from the timeline, across every component. */
  exclude?: readonly string[];
  /** Wire truncation budget per entry, in bytes. */
  maxEntryBytes?: number;
  /**
   * Register the destructive `ilha_model_dispatch` tool and answer the
   * `modelDispatch` page call. Dispatch schema-decodes the message and
   * delivers it through the normal runtime update and logging.
   * Default `false`.
   */
  dispatch?: boolean | undefined;
  /**
   * Override the live-model control bridge behind `show_entry`, `resume`
   * and `dispatch`. Defaults to `@ilha/model`'s Devtools seam once it
   * loads; without a bridge those calls report the session as
   * not controllable.
   */
  bridge?: ModelRuntimeBridge | undefined;
}

export interface IlhaDevtoolsHandle {
  channel: PageScriptChannel<IlhaDevtoolsProtocol>;
  /** The page-side model backend: ingest frames or attach a bridge in tests. */
  backend: ModelBackend;
  /** Open the panel in a popup that can find this page. Returns `null` if blocked. */
  openPanel: (url?: string) => Window | null;
  /** Remove the channel, overlay, WebMCP tools, and change listener. */
  dispose: () => void;
}

const HIGHLIGHT_ATTR = "data-ilha-devtools-highlight";
const HIGHLIGHT_MS = 5000;
const HIGHLIGHT_STYLE = [
  "position:fixed",
  "pointer-events:none",
  "z-index:2147483647",
  "outline:2px solid #3b82f6",
  "background:rgba(59,130,246,.15)",
  "transition:all .1s",
].join(";");

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Union of the rects of `el`, or of its children when it has no box of its own. */
const boxOf = (el: Element): Box | undefined => {
  const rects =
    getComputedStyle(el).display === "contents"
      ? [...el.children].map((child) => child.getBoundingClientRect())
      : [el.getBoundingClientRect()];
  const sized = rects.filter((r) => r.width > 0 || r.height > 0);
  if (sized.length === 0) {
    return undefined;
  }
  return {
    bottom: Math.max(...sized.map((r) => r.bottom)),
    left: Math.min(...sized.map((r) => r.left)),
    right: Math.max(...sized.map((r) => r.right)),
    top: Math.min(...sized.map((r) => r.top)),
  };
};

const createHighlighter = () => {
  let overlay: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = (): void => {
    clearTimeout(timer);
    overlay?.remove();
    overlay = undefined;
  };
  const show = (el: Element): boolean => {
    clear();
    const box = boxOf(el);
    if (!box) {
      return false;
    }
    overlay = document.createElement("div");
    overlay.setAttribute(HIGHLIGHT_ATTR, "");
    overlay.style.cssText = `${HIGHLIGHT_STYLE};left:${box.left}px;top:${box.top}px;width:${box.right - box.left}px;height:${box.bottom - box.top}px`;
    document.body.append(overlay);
    timer = setTimeout(clear, HIGHLIGHT_MS);
    return true;
  };
  return { clear, show };
};

let current: IlhaDevtoolsHandle | undefined;

/**
 * The `@ilha/model` surface the page script needs, restated structurally so
 * the page loads without it: `@ilha/model` is an optional peer, and a static
 * import would fail to resolve on pages that do not install it.
 */
interface ModelDevtoolsSeam {
  readonly listSessions: () => readonly {
    readonly registry: unknown;
    readonly app: string | undefined;
    readonly session: string;
    readonly paused: boolean;
    /** The island's host element, once mounted; absent pre-mount. */
    readonly host: Element | undefined;
  }[];
  readonly pauseSession: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- opaque peer token, passed through untouched.
    registry: unknown,
    lookup: {
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- peer-owned state shape, consumed opaquely by the seam.
      readonly stateOf: (path: string) => unknown;
    },
    host: {
      readonly hideLive: () => void;
      readonly showHistorical: (states: ReadonlyMap<string, unknown>) => void;
      readonly restoreLive: () => void;
    }
  ) => { readonly resume: () => void };
  readonly dispatchMessage: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- opaque peer token, passed through untouched.
    registry: unknown,
    path: string,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- decoded against the component schema by the peer before dispatch.
    message: unknown
  ) => boolean;
}

interface ModelBridge {
  readonly MessageLog: {
    readonly attach: (log: {
      readonly enabled: boolean;
      readonly record: (entry: MessageLog.Entry) => void;
    }) => () => void;
    readonly makeEncoder: (options?: {
      readonly maxEntryBytes?: number | undefined;
    }) => {
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- wire bytes owned by the peer encoder, forwarded untouched.
      readonly encode: (entry: MessageLog.Entry) => unknown;
    };
  };
}

const isSeam = (
  value: Partial<ModelDevtoolsSeam> | undefined
): value is ModelDevtoolsSeam =>
  typeof value?.listSessions === "function" &&
  typeof value?.pauseSession === "function" &&
  typeof value?.dispatchMessage === "function";

/** The attribute marking the inert historical copy a pause mounts. */
const HISTORICAL_ATTR = "data-ilha-devtools-historical";

const HistoricalSnapshot = ({
  rows,
}: {
  rows: readonly { path: string; model: unknown }[];
}) =>
  h(
    "div",
    null,
    ...rows.map((row) =>
      h(
        "section",
        null,
        h("h2", null, row.path),
        h("pre", null, JSON.stringify(row.model, null, 2) ?? "unknown")
      )
    )
  );

/**
 * The DOM half of a pause: hides one live island container (the live
 * runtime keeps running), mounts an inert server-rendered copy of the
 * paused states after the hidden host, and restores live on resume. Without
 * a known anchor it falls back to every island host `inspect()` reports.
 * Every method is idempotent, so a runtime seam that also restores stays safe.
 */
export const createPauseHost = (
  anchorOf?: (() => Element | undefined) | undefined
): PauseHost => {
  const hidden: { el: Element; display: string }[] = [];
  let copy: HTMLElement | undefined;
  let token = 0;
  const restoreLive = (): void => {
    token += 1;
    copy?.remove();
    copy = undefined;
    for (const { el, display } of hidden.splice(0)) {
      // SAFETY: targets() only collects HTMLElements; `el` is Element for inspect() compat.
      (el as HTMLElement).style.display = display;
    }
  };
  const targets = (): Element[] => {
    const anchor = anchorOf?.();
    if (anchor !== undefined) {
      return [anchor];
    }
    const els: Element[] = [];
    for (const node of inspect()) {
      if (node.host === undefined) {
        continue;
      }
      const el = document.querySelector(node.host);
      if (el instanceof HTMLElement) {
        els.push(el);
      }
    }
    return els;
  };
  return {
    hideLive: () => {
      if (copy !== undefined || hidden.length > 0) {
        return;
      }
      for (const el of targets()) {
        // SAFETY: targets() only collects HTMLElements; `el` is Element for inspect() compat.
        hidden.push({ display: (el as HTMLElement).style.display, el });
        // SAFETY: targets() only collects HTMLElements; `el` is Element for inspect() compat.
        (el as HTMLElement).style.display = "none";
      }
    },
    restoreLive,
    showHistorical: (states) => {
      token += 1;
      const seen = token;
      return (async (): Promise<boolean> => {
        let html: string;
        try {
          html = await renderToString(() =>
            HistoricalSnapshot({
              rows: [...states].map(([path, held]) => ({
                model: held.model,
                path,
              })),
            })
          );
        } catch {
          if (seen === token) {
            restoreLive();
          }
          return false;
        }
        if (seen !== token) {
          return false;
        }
        copy?.remove();
        const mount = document.createElement("div");
        mount.setAttribute(HISTORICAL_ATTR, "true");
        mount.setAttribute("inert", "");
        mount.innerHTML = html;
        const anchor = hidden[0]?.el;
        if (
          anchor?.parentElement !== undefined &&
          anchor.parentElement !== null
        ) {
          anchor.parentElement.insertBefore(mount, anchor.nextSibling);
        } else {
          document.body.prepend(mount);
        }
        copy = mount;
        return true;
      })();
    },
  };
};

/**
 * Adapt `@ilha/model`'s Devtools seam to the bridge the tools drive. Each
 * pause builds its own DOM half anchored at the session's host element, so
 * only that island hides while the rest of the page stays live.
 */
const seamBridgeOf = (seam: ModelDevtoolsSeam): ModelRuntimeBridge => {
  const live = new Map<string, () => void>();
  const entryOf = (
    session: string
  ): { registry: unknown; host: Element | undefined } => {
    const found = seam.listSessions().find((held) => held.session === session);
    if (found === undefined) {
      throw new Error(`Session ${session} has no live runtime.`);
    }
    return found;
  };
  return {
    dispatch: (session, path, message) =>
      seam.dispatchMessage(entryOf(session).registry, path, message),
    isControllable: (session) =>
      seam.listSessions().some((held) => held.session === session),
    pause: async (session, seq, lookup) => {
      live.get(session)?.();
      const entry = entryOf(session);
      const inner = createPauseHost(
        entry.host === undefined ? undefined : () => entry.host
      );
      let shown: Promise<boolean> | undefined;
      const { resume } = seam.pauseSession(entry.registry, lookup, {
        hideLive: inner.hideLive,
        restoreLive: inner.restoreLive,
        showHistorical: (states: ReadonlyMap<string, unknown>): void => {
          // The seam falls back to the raw live Model for paths the lookup
          // has no history for; wrap those so the copy paints HeldStates.
          const normalized = new Map<string, HeldState>();
          for (const [path, value] of states) {
            normalized.set(
              path,
              lookup.stateOf(path) ?? { model: value, props: undefined }
            );
          }
          const result = inner.showHistorical(normalized);
          shown = result ?? Promise.resolve(true);
        },
      });
      const resumeAll = (): void => {
        live.delete(session);
        resume();
        inner.restoreLive();
      };
      const painted = await shown;
      if (painted !== true) {
        resumeAll();
        throw new ToolError(
          `Session ${session} has no paintable state at #${seq}: the historical copy failed to render, so live stays up.`
        );
      }
      live.set(session, resumeAll);
      return { resume: resumeAll };
    },
    resume: (session) => {
      const resume = live.get(session);
      if (resume === undefined) {
        throw new Error(`Session ${session} is not paused.`);
      }
      live.delete(session);
      resume();
    },
  };
};

/**
 * Resolve `@ilha/model`'s Devtools seam through its published subpath. The
 * specifier is a literal so bundlers keep it as one chunk; `@ilha/model`
 * stays an optional peer, so a missing package settles to `undefined`
 * instead of throwing.
 */
const loadSeam = async (): Promise<ModelDevtoolsSeam | undefined> => {
  try {
    // SAFETY: the peer publishes this subpath; the shape is verified by isSeam below.
    const loaded = (await import("@ilha/model/devtools")) as
      | Partial<ModelDevtoolsSeam>
      | undefined;
    return isSeam(loaded) ? loaded : undefined;
  } catch {
    return undefined;
  }
};

/**
 * One shared load: every install attaches to the same module instance, and a
 * missing `@ilha/model` settles to `undefined` instead of throwing. Dynamic
 * because `@ilha/model` is an optional peer.
 */
let bridgePromise: Promise<ModelBridge | undefined> | undefined;

const loadOnce = async (): Promise<ModelBridge | undefined> => {
  try {
    // SAFETY: the peer publishes this entrypoint; the shape is verified by the MessageLog checks below.
    const loaded = (await import("@ilha/model")) as Partial<ModelBridge>;
    if (
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- optional-peer shape check on a dynamic import; no schema exists for the peer surface.
      typeof loaded.MessageLog?.attach !== "function" ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- optional-peer shape check on a dynamic import; no schema exists for the peer surface.
      typeof loaded.MessageLog?.makeEncoder !== "function"
    ) {
      return undefined;
    }
    // SAFETY: the MessageLog checks above establish the bridge shape.
    return loaded as ModelBridge;
  } catch {
    return undefined;
  }
};

const loadModelBridge = (): Promise<ModelBridge | undefined> =>
  (bridgePromise ??= loadOnce());

/**
 * Start resolving the optional peer as soon as the page script evaluates.
 * Install awaits the same cached loads, so on pages that install right
 * away the sink and the bridge attach in microtasks: ahead of islands
 * that mount synchronously after install, whose boot entries would
 * otherwise emit before the sink exists and be lost. Missing packages
 * still settle to `undefined`; this only moves the attempt earlier.
 */
void loadModelBridge();
void loadSeam();

/**
 * Start answering `inspect`, `highlight`, and `setAtom` for this page, and
 * mirror the island tree into the channel's shared state. Calling it again
 * replaces the previous install.
 *
 * With `@ilha/model` installed, it also attaches a message-log sink: every
 * entry the runtime records is encoded to a Wire frame and folded into the
 * page-side backend, which answers `modelSessions`, `modelFrames` and
 * `modelMessageSchema` for the panel and the `ilha_model_*` agent tools.
 */
export const installIlhaDevtools = (
  options: InstallOptions = {}
): IlhaDevtoolsHandle => {
  current?.dispose();
  const highlighter = createHighlighter();
  const hasWindow = "window" in globalThis;

  const highlight = (id: string | null): boolean => {
    if (id === null) {
      highlighter.clear();
      return true;
    }
    const el = element(id);
    return el === undefined ? false : highlighter.show(el);
  };

  const backend: ModelBackend = createModelBackend({
    dispatch: options.dispatch,
    exclude: options.exclude,
    size: options.size,
  });
  backend.bridge = options.bridge;
  const pauseHost = createPauseHost();
  let detachSink: (() => void) | undefined;

  const summarizeSessions = (): ModelSessionSummary[] =>
    backend.inspector.sessions().map((session) => {
      const entries = session.entries();
      const paused = backend.pausedAt.get(session.id);
      const base = {
        app: session.app,
        controllable: backend.bridge?.isControllable(session.id) ?? false,
        entries: entries.length,
        first: entries[0]?.seq,
        last: entries.at(-1)?.seq,
        session: session.id,
      };
      // Absent while live: the channel rejects `undefined` values.
      return paused === undefined ? base : { ...base, paused };
    });

  const modelSessions = (): ModelSessionSummary[] => summarizeSessions();

  const modelFrames = (session: string, since: number): ModelFramesResult =>
    framesAfter(backend, session, since);

  const modelMessageSchema = (
    component: string,
    tag?: string | undefined
  ): ModelSchemaResult => messageSchemaOf(backend, component, tag);

  const controlHandlers = modelToolHandlers(backend);
  const runControlled = async (
    name: "ilha_model_show_entry" | "ilha_model_resume" | "ilha_model_dispatch",
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- tool-call boundary; each handler validates its own args.
    args: Record<string, unknown>
  ): Promise<ModelControlResult> => {
    try {
      const handler = controlHandlers[name];
      if (handler === undefined) {
        return {
          ok: false,
          reason:
            "Dispatch is disabled for this page. Install with { dispatch: true } to enable it.",
        };
      }
      // SAFETY: control handlers resolve `{ result }` carrying at least the session; extras flow into the ok payload untouched.
      const { result } = (await handler(args)) as {
        // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- extra result fields are opaque payload, forwarded untouched.
        result: { session: string } & Record<string, unknown>;
      };
      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof ToolError
            ? error.message
            : `Control call ${name} failed.`,
      };
    }
  };

  const modelShowEntry = (
    session: string,
    seq: number
  ): Promise<ModelControlResult> =>
    runControlled("ilha_model_show_entry", { seq, session });

  const modelResume = (session: string): Promise<ModelControlResult> =>
    runControlled("ilha_model_resume", { session });

  const modelDispatch = (
    session: string,
    instance: number,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- wire payload validated against the component schema by the handler.
    message: unknown
  ): Promise<ModelControlResult> =>
    runControlled("ilha_model_dispatch", { instance, message, session });

  /** The live `@ilha/model` seam once it loads; `undefined` without the package. */
  let pageSeam: ModelDevtoolsSeam | undefined;

  /**
   * Component names the page knows as `@ilha/model` islands. Their state
   * atom is the message log's state: writing it would bypass Schema
   * decoding, `update` and the log, so refuse those writes and point at
   * `modelDispatch` instead.
   */
  const modelComponents = (): Set<string> =>
    new Set([
      ...backend.componentSchemas.keys(),
      ...backend.inspector
        .sessions()
        .flatMap((session) =>
          session.instances().map((instance) => instance.component)
        ),
    ]);

  const findNode = (
    nodes: readonly IlhaInspectNode[],
    id: string
  ): IlhaInspectNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) {
        return node;
      }
      const found = findNode(node.children, id);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  };

  /**
   * Mount hosts of the live `@ilha/model` islands the seam reports. Model
   * islands render through ilha Roots, so `inspect()` names them
   * "Root"/"render" instead of the model component: a write to an element
   * the island's mount host contains is a model write too.
   */
  const modelMountHosts = (): readonly Element[] => {
    try {
      return (
        pageSeam
          ?.listSessions()
          .flatMap((session) =>
            session.host instanceof Element ? [session.host] : []
          ) ?? []
      );
    } catch {
      return [];
    }
  };

  const guardedSetAtom = (
    id: string,
    index: number,
    value: AtomJson
  ): SetAtomResult => {
    const node = findNode(inspect(), id);
    if (node !== undefined) {
      const known = modelComponents();
      if (known.size > 0 && known.has(node.component)) {
        return {
          ok: false,
          reason: `Component "${node.component}" is a @ilha/model island: its state only changes through dispatched messages. Call modelDispatch with the instance's message schema instead.`,
        };
      }
      if (node.host !== undefined) {
        let el: Element | null = null;
        try {
          el = document.querySelector(node.host);
        } catch {
          el = null;
        }
        if (
          el !== null &&
          modelMountHosts().some((host) => host === el || host.contains(el))
        ) {
          return {
            ok: false,
            reason: `The island at "${node.host}" is a @ilha/model island: its state only changes through dispatched messages. Call modelDispatch with the instance's message schema instead.`,
          };
        }
      }
    }
    return setAtom(id, index, value);
  };
  const channel = createPageScriptChannel<IlhaDevtoolsProtocol>({
    functions: {
      highlight: {
        agent: {
          description:
            "Outline a component's element on the page so the user can see it. Pass an id from inspect, or null to clear. The outline clears itself after five seconds.",
          safety: "action",
          title: "Highlight an Ilha component",
        },
        handler: highlight,
        jsonSerializable: true,
        type: "action",
      },
      inspect: {
        agent: {
          description:
            "List every live Ilha island on this page as a JSON tree: component names, atom values by slot index, child components, and host selectors. Call this first to learn which ids exist before highlight or setAtom.",
          safety: "read",
          title: "Inspect Ilha islands",
        },
        handler: () => inspect(),
        jsonSerializable: true,
      },
      modelDispatch: {
        agent: {
          description:
            "Deliver a message to a live model instance through the normal runtime update and logging, decoded against the instance's message schema. Refused unless the page installed with dispatch: true.",
          safety: "action",
          title: "Dispatch a model message",
        },
        handler: modelDispatch,
        jsonSerializable: true,
        type: "action",
      },
      modelFrames: {
        agent: {
          description:
            "Read one `@ilha/model` session's Wire frames with seq above since, oldest first. Poll it to follow the live log.",
          safety: "read",
          title: "Read model Wire frames",
        },
        handler: modelFrames,
        jsonSerializable: true,
      },
      modelMessageSchema: {
        agent: {
          description:
            "Read the JSON Schema of the messages a model component accepts, narrowed by an optional message _tag. Pass a component name from a timeline entry.",
          safety: "read",
          title: "Read a component's message schema",
        },
        handler: modelMessageSchema,
        jsonSerializable: true,
      },
      modelResume: {
        agent: {
          description:
            "Remove a time-travel pause's inert historical copy and restore the live island, which kept running while paused.",
          safety: "action",
          title: "Resume a paused model session",
        },
        handler: modelResume,
        jsonSerializable: true,
        type: "action",
      },
      modelSessions: {
        agent: {
          description:
            "List the `@ilha/model` sessions the page holds: one mounted root each, with entry counts. Reports whether each session is controllable and the seq it is paused at. Call this first to learn which sessions modelFrames reads.",
          safety: "read",
          title: "List model sessions",
        },
        handler: modelSessions,
        jsonSerializable: true,
      },
      modelShowEntry: {
        agent: {
          description:
            "Pause a model session at an entry: hide the live island (it keeps running) and mount an inert server-rendered copy of each instance's state at that entry from History. Resume restores live.",
          safety: "action",
          title: "Pause a model session at an entry",
        },
        handler: modelShowEntry,
        jsonSerializable: true,
        type: "action",
      },
      setAtom: {
        agent: {
          description:
            "Replace one atom's value in a live component with a JSON value, then let the island rerender. Use ids and indexes from inspect. Derived and Effect atoms are read-only and return a reason. Model islands refuse writes; dispatch a message instead.",
          safety: "action",
          title: "Set an Ilha atom",
        },
        handler: (id: string, index: number, value: AtomJson) =>
          guardedSetAtom(id, index, value),
        jsonSerializable: true,
        type: "action",
      },
    },
    name: ILHA_DEVTOOLS_CHANNEL,
    window: options.window ?? (hasWindow ? window : false),
  });

  const disposers: (() => void)[] = [highlighter.clear];
  let active = true;

  const noteLiveEntry = (entry: MessageLog.Entry): void => {
    if (!("component" in entry) || entry.component === undefined) {
      return;
    }
    const { definition } = entry.component;
    backend.noteComponent(definition.name, definition.message);
  };

  // Recording starts once `@ilha/model` loads; entries logged before that are
  // simply not recorded. Without the package the tools stay, answering why.
  disposers.push(() => {
    detachSink?.();
  });
  void (async () => {
    const loaded = await loadModelBridge();
    if (!active) {
      return;
    }
    if (loaded === undefined) {
      return;
    }
    const encoder = loaded.MessageLog.makeEncoder({
      maxEntryBytes: options.maxEntryBytes,
    });
    detachSink = loaded.MessageLog.attach({
      enabled: true,
      record: (entry) => {
        // A bad frame must not break the runtime's log loop.
        try {
          noteLiveEntry(entry);
          // SAFETY: the peer encoder emits wire JSON; ingest validates frames before storing.
          backend.ingest([encoder.encode(entry) as never]);
        } catch {
          // The entry is dropped; the live log keeps flowing.
        }
      },
    });
    if (backend.bridge === undefined) {
      const seam = await loadSeam();
      if (active && seam !== undefined) {
        pageSeam = seam;
        if (backend.bridge === undefined) {
          backend.bridge = seamBridgeOf(seam);
        }
      }
    }
  })();

  const mirror = async (): Promise<void> => {
    let last = JSON.stringify(inspect());
    const state = await channel.sharedState.get("tree", {
      initialValue: { json: last },
    });
    let queued = false;
    const stop = onChange(() => {
      if (queued) {
        return;
      }
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const next = JSON.stringify(inspect());
        if (active && next !== last) {
          last = next;
          state.mutate((draft) => {
            draft.json = next;
          });
        }
      });
    });
    if (active) {
      disposers.push(stop);
    } else {
      stop();
    }
  };
  void mirror();

  if (options.webmcp !== false) {
    disposers.push(
      registerWebMcpTools(
        {
          highlight,
          inspect: () => inspect(),
          // SAFETY: the channel decodes args as AtomJson before the handler runs.
          setAtom: (id, index, value) =>
            guardedSetAtom(id, index, value as AtomJson),
        },
        backend
      )
    );
  }

  const handle: IlhaDevtoolsHandle = {
    backend,
    channel,
    dispose: () => {
      active = false;
      for (const session of backend.pausedAt.keys()) {
        try {
          const pending = backend.bridge?.resume(session);
          if (pending instanceof Promise) {
            // oxlint-disable-next-line promise/prefer-await-to-then -- dispose is sync; the rejection must be observed without awaiting.
            pending.catch(() => {
              // The runtime is gone; dropping the pause mark is enough.
            });
          }
        } catch {
          // The runtime is gone; dropping the pause mark is enough.
        }
        backend.pausedAt.delete(session);
      }
      pauseHost.restoreLive();
      for (const dispose of disposers.splice(0)) {
        dispose();
      }
      channel.close();
      if (current === handle) {
        current = undefined;
      }
    },
    openPanel: (url = options.panelUrl ?? ILHA_DEVTOOLS_PANEL_PATH) =>
      hasWindow
        ? window.open(url, "ilha-devtools", "popup,width=1024,height=640")
        : null,
  };
  current = handle;
  return handle;
};
