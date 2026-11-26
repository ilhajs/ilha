import type { PanelChannel } from "devframe/in-page-channel";
import type { Json } from "effect/Schema";
import { atom, watch } from "ilha";

import { diff as diffJson } from "../inspector";
import type { Session } from "../inspector";
import { parseTree } from "../protocol";
import type {
  AtomJson,
  IlhaDevtoolsProtocol,
  IlhaInspectNode,
  ModelSessionSummary,
} from "../protocol";
import {
  chainOf,
  createModelBackend,
  instanceOf,
  isFailureEntry,
  labelOf,
  matchesFilter,
  runStatusOf,
} from "../webmcp";
import type { EntryFilter } from "../webmcp";
import type { WireEntry } from "../wire";

export type PanelConnection = PanelChannel<IlhaDevtoolsProtocol>;

type Status = "connecting" | "connected" | "missing";

type Tab =
  | "model"
  | "message"
  | "props"
  | "commands"
  | "events"
  | "lifecycle"
  | "raw";

const CONNECT_TIMEOUT_MS = 3000;
const POLL_MS = 1000;

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "message", label: "Message" },
  { id: "props", label: "Props" },
  { id: "commands", label: "Commands" },
  { id: "events", label: "Events" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "raw", label: "Raw" },
];

const findNode = (
  nodes: readonly IlhaInspectNode[],
  id: string | null
): IlhaInspectNode | undefined => {
  for (const node of nodes) {
    const hit = node.id === id ? node : findNode(node.children, id);
    if (hit) {
      return hit;
    }
  }
  return undefined;
};

const fieldOf = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- panel payloads arrive as decoded JSON; each tab validates the field it reads.
  value: unknown,
  key: string
): Json | undefined => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON object guard before the field lookup.
  if (typeof value === "object" && value !== null) {
    // SAFETY: the guard above established a JSON object; the lookup yields a JSON value or undefined.
    return (value as Record<string, Json>)[key];
  }
  return undefined;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- display boundary: JSON.stringify accepts any runtime value; entries and change payloads arrive as decoded JSON.
const asJson = (value: unknown): string => JSON.stringify(value, null, 2);

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- display boundary: forwards decoded JSON or wire entries to asJson for rendering.
const renderJson = (value: unknown) => <pre>{asJson(value)}</pre>;

const changedMark = (session: Session, seq: number): string => {
  const changed = session.previous(seq)?.changed;
  if (changed === true) {
    return "•";
  }
  if (changed === "unknown") {
    return "?";
  }
  return "";
};

/**
 * The panel: the island tree with atom editing on top, and the `@ilha/model`
 * timeline below it. The timeline reads Wire frames from the page script's
 * `modelSessions`/`modelFrames` functions into its own backend, so it keeps
 * working while the page logs more. Time travel pauses through the page's
 * `modelShowEntry`/`modelResume` calls and gated dispatch through
 * `modelDispatch`; the panel only renders their results.
 */
export const createApp = (connect: () => PanelConnection) => {
  const App = () => {
    const nodes = atom<readonly IlhaInspectNode[]>([]);
    const selected = atom<string | null>(null);
    const status = atom<Status>("connecting");
    const problem = atom("");

    const channel = atom.lazy(connect, { snapshot: false });

    // Model timeline state. Frames and the backend live in one lazy store so
    // they survive re-renders; `revision` re-renders after each ingest.
    const store = atom.lazy(
      () => ({
        backend: createModelBackend(),
        clearedUpTo: new Map<string, number>(),
        sinceOf: new Map<string, number>(),
        stored: new Map<string, WireEntry[]>(),
      }),
      { snapshot: false }
    );
    const modelSessions = atom<readonly string[]>([]);
    const modelSummaries = atom<readonly ModelSessionSummary[]>([]);
    const dispatchText = atom("");
    const activeSession = atom<string | null>(null);
    const revision = atom(0);
    const selectedSeq = atom<number | null>(null);
    const backStack = atom<readonly number[]>([]);
    const filter = atom<EntryFilter>("messages");
    const findText = atom("");
    const onlyInstance = atom<number | null>(null);
    const tab = atom<Tab>("model");
    const follow = atom(true);
    const excludeText = atom("");
    const modelProblem = atom("");

    const lookupSession = (): Session | undefined => {
      const id = activeSession();
      if (id === null) {
        return undefined;
      }
      return store()
        .backend.inspector.sessions()
        .find((held) => held.id === id);
    };

    const visibleEntries = (session: Session | undefined): WireEntry[] => {
      if (session === undefined) {
        return [];
      }
      const only = onlyInstance();
      return session
        .entries()
        .filter(
          (entry) =>
            matchesFilter(entry, filter()) &&
            (only === null || instanceOf(entry) === only)
        );
    };

    const summaryOf = (
      session: Session | undefined
    ): ModelSessionSummary | undefined => {
      if (session === undefined) {
        return undefined;
      }
      return modelSummaries().find((held) => held.session === session.id);
    };

    const trackNewest = (session: Session | undefined): void => {
      // While paused the selection stays on the paused entry: the live
      // island keeps running and its newest entries must not yank it away.
      if (
        !follow() ||
        session === undefined ||
        summaryOf(session)?.paused !== undefined
      ) {
        return;
      }
      const entries = visibleEntries(session);
      const newest = entries.at(-1);
      if (newest !== undefined) {
        selectedSeq.set(newest.seq);
      }
    };

    // Frames the panel keeps for re-filtering, per session; the backend
    // ingests the same frames into its own bounded buffer.
    const FRAME_STORE_LIMIT = 1000;
    let refreshInFlight = false;

    // oxlint-disable-next-line eslint/complexity -- the poll loop sequences sessions, ingest, and pause state; splitting it would scatter the refresh.
    const refreshModel = async (): Promise<void> => {
      // The poll timer fires while a pass is still fetching. Without a guard
      // two passes fetch the same `since` and ingest every frame twice, so
      // the overlapping pass yields to the one in flight.
      if (refreshInFlight) {
        return;
      }
      refreshInFlight = true;
      try {
        let summaries;
        try {
          summaries = await channel().call("modelSessions");
        } catch {
          return;
        }
        modelSessions.set(summaries.map((summary) => summary.session));
        modelSummaries.set(summaries);
        if (activeSession() === null && summaries.length > 0) {
          activeSession.set(summaries[0]?.session ?? null);
        }
        let advanced = false;
        for (const summary of summaries) {
          let result;
          try {
            // oxlint-disable-next-line no-await-in-loop -- sessions fetch sequentially; each uses its own since cursor.
            result = await channel().call(
              "modelFrames",
              summary.session,
              store().sinceOf.get(summary.session) ?? 0
            );
          } catch {
            continue;
          }
          if (!result.ok || result.frames.length === 0) {
            continue;
          }
          const known = store().stored.get(summary.session) ?? [];
          const floor =
            known.at(-1)?.seq ?? store().sinceOf.get(summary.session) ?? 0;
          const fresh = result.frames.filter((frame) => frame.seq > floor);
          if (fresh.length === 0) {
            continue;
          }
          known.push(...fresh);
          store().stored.set(
            summary.session,
            known.length > FRAME_STORE_LIMIT
              ? known.slice(-FRAME_STORE_LIMIT)
              : known
          );
          store().backend.ingest(fresh);
          store().sinceOf.set(summary.session, fresh.at(-1)?.seq ?? floor);
          advanced = true;
        }
        if (advanced) {
          revision.set(revision() + 1);
          trackNewest(lookupSession());
        }
      } finally {
        refreshInFlight = false;
      }
    };
    const selectEntry = (seq: number): void => {
      const previous = selectedSeq();
      if (previous !== null && previous !== seq) {
        backStack.set([...backStack(), previous]);
      }
      selectedSeq.set(seq);
    };

    const goBack = (): void => {
      const stack = backStack();
      const seq = stack.at(-1);
      if (seq !== undefined) {
        backStack.set(stack.slice(0, -1));
        selectedSeq.set(seq);
      }
    };

    const clearSession = (): void => {
      const session = lookupSession();
      if (session === undefined) {
        return;
      }
      const last = session.entries().at(-1)?.seq;
      store().backend.clear(session.id);
      if (last !== undefined) {
        store().clearedUpTo.set(session.id, last);
      }
      selectedSeq.set(null);
      backStack.set([]);
      revision.set(revision() + 1);
    };

    const applyExclude = (): void => {
      const exclude = excludeText()
        .split(/[\s,]+/u)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
      const next = createModelBackend({ exclude, size: 1000 });
      for (const [id, frames] of store().stored) {
        const floor = store().clearedUpTo.get(id) ?? 0;
        next.ingest(frames.filter((frame) => frame.seq > floor));
      }
      store().backend = next;
      selectedSeq.set(null);
      backStack.set([]);
      revision.set(revision() + 1);
    };
    const pauseHere = async (sessionId: string, seq: number): Promise<void> => {
      let result;
      try {
        result = await channel().call("modelShowEntry", sessionId, seq);
      } catch {
        modelProblem.set("Pause failed: the page is unreachable.");
        return;
      }
      if (!result.ok) {
        modelProblem.set(`Pause failed: ${result.reason}`);
        return;
      }
      modelProblem.set("");
      selectedSeq.set(seq);
      await refreshModel();
    };

    const resumeSession = async (sessionId: string): Promise<void> => {
      let result;
      try {
        result = await channel().call("modelResume", sessionId);
      } catch {
        modelProblem.set("Resume failed: the page is unreachable.");
        return;
      }
      if (!result.ok) {
        modelProblem.set(`Resume failed: ${result.reason}`);
        return;
      }
      modelProblem.set("");
      await refreshModel();
    };

    const sendDispatch = async (
      sessionId: string,
      instance: number
    ): Promise<void> => {
      let message: unknown;
      try {
        message = JSON.parse(dispatchText());
      } catch {
        modelProblem.set("Dispatch message is not valid JSON.");
        return;
      }
      let result;
      try {
        result = await channel().call(
          "modelDispatch",
          sessionId,
          instance,
          message
        );
      } catch {
        modelProblem.set("Dispatch failed: the page is unreachable.");
        return;
      }
      if (!result.ok) {
        modelProblem.set(`Dispatch failed: ${result.reason}`);
        return;
      }
      modelProblem.set("");
      dispatchText.set("");
      await refreshModel();
    };

    watch.once(() => {
      const connection = channel();
      let open = true;
      const sync = async (): Promise<void> => {
        try {
          await connection.whenConnected(CONNECT_TIMEOUT_MS);
        } catch {
          if (open) {
            status.set("missing");
          }
          return;
        }
        const tree = await connection.sharedState.get("tree");
        if (!open) {
          return;
        }
        status.set("connected");
        nodes.set(parseTree(tree.value()));
        tree.on("updated", (full) => {
          nodes.set(parseTree(full));
        });
        await refreshModel();
      };
      void sync();
      const timer = setInterval(() => {
        void refreshModel();
      }, POLL_MS);
      const stop = (): void => {
        open = false;
        clearInterval(timer);
        connection.close();
      };
      return stop;
    });

    const edit = async (id: string, index: number, raw: string) => {
      let value: AtomJson;
      try {
        value = JSON.parse(raw);
      } catch {
        problem.set(`"${raw}" is not valid JSON.`);
        return;
      }
      const result = await channel().call("setAtom", id, index, value);
      problem.set(result.ok ? "" : result.reason);
    };

    const copyFrame = async (entry: WireEntry): Promise<void> => {
      try {
        await navigator.clipboard.writeText(asJson(entry));
      } catch {
        modelProblem.set("Copy failed: the clipboard is unavailable.");
      }
    };

    const row = (node: IlhaInspectNode) => (
      <li>
        <button
          type="button"
          class="node"
          aria-current={String(selected() === node.id)}
          onclick={() => selected.set(node.id)}
          onmouseenter={() => channel().call("highlight", node.id)}
          onmouseleave={() => channel().call("highlight", null)}
        >
          {node.component}
        </button>
        <ul>{node.children.map(row)}</ul>
      </li>
    );

    // oxlint-disable-next-line eslint/complexity -- entry tabs branch per tab; splitting them would scatter the panel layout.
    const renderEntryTabs = (session: Session, entry: WireEntry) => {
      const current = tab();
      const instance = instanceOf(entry);
      if (current === "raw") {
        return (
          <div>
            <button type="button" onclick={() => copyFrame(entry)}>
              Copy frame
            </button>
            {renderJson(entry)}
          </div>
        );
      }
      if (current === "message") {
        if (entry._tag !== "Update") {
          return <p class="muted">No message on a {entry._tag} entry.</p>;
        }
        return (
          <div>
            {renderJson(entry.message)}
            <h3>Source</h3>
            {renderJson(entry.source)}
          </div>
        );
      }
      if (current === "props") {
        const props = fieldOf(entry, "props");
        if (props === undefined) {
          return <p class="muted">No props on a {entry._tag} entry.</p>;
        }
        return renderJson(props);
      }
      if (current === "commands") {
        const issued = fieldOf(entry, "commands");
        const runs =
          instance === undefined
            ? []
            : session
                .records(instance)
                .filter((record) => record.kind === "command");
        return (
          <div>
            <h3>Issued by this entry</h3>
            {renderJson(issued ?? [])}
            <h3>Runs of this instance</h3>
            {runs.length === 0 ? (
              <p class="muted">No Command runs recorded.</p>
            ) : (
              <ul>
                {runs.map((run) => (
                  <li>
                    <code>{run.name}</code>
                    <span class="muted">
                      {` ${runStatusOf({ ended: run.end === undefined ? [] : [{ count: 1, reason: run.reason ?? "ended" }], running: run.start !== undefined && run.end === undefined ? 1 : 0, waiting: run.start === undefined && run.end === undefined ? 1 : 0 }) ?? "open"}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }
      if (current === "events") {
        const events = fieldOf(entry, "events");
        if (events === undefined) {
          return <p class="muted">No events on a {entry._tag} entry.</p>;
        }
        return renderJson(events);
      }
      if (current === "lifecycle") {
        const records =
          instance === undefined
            ? []
            : session
                .records(instance)
                .filter((record) => record.kind !== "command");
        if (records.length === 0) {
          return (
            <p class="muted">
              No Layer builds, Subscriptions or mounts recorded.
            </p>
          );
        }
        return (
          <ul>
            {records.map((record) => (
              <li>
                <code>{`${record.kind} ${record.name}`}</code>
                <span class="muted">
                  {record.key === undefined ? "" : ` ${record.key}`}
                  {record.end === undefined
                    ? " open"
                    : ` ended (${record.reason ?? "done"})`}
                </span>
              </li>
            ))}
          </ul>
        );
      }
      if (
        entry._tag !== "Update" &&
        entry._tag !== "Mounted" &&
        entry._tag !== "Waiting"
      ) {
        return <p class="muted">No Model state on a {entry._tag} entry.</p>;
      }
      const model = fieldOf(entry, "model");
      const before = session.previous(entry.seq)?.model;
      if (model === undefined) {
        return <p class="muted">No Model recorded.</p>;
      }
      if (before === undefined) {
        return (
          <div>
            <p class="muted">First state entry; nothing to compare with.</p>
            {renderJson(model)}
          </div>
        );
      }
      // SAFETY: History replays held entry Models, which are decoded JSON; diffJson reads them structurally.
      const changes = diffJson(before as Json, model);
      return (
        <div>
          {changes.length === 0 ? (
            <p class="muted">Model unchanged.</p>
          ) : (
            <ul>
              {changes.map((change) => (
                <li>
                  <code>{change.path.join(".")}</code>
                  <span class="muted">{` ${change.kind}`}</span>
                  <div>
                    {asJson({ after: change.after, before: change.before })}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {renderJson(model)}
        </div>
      );
    };

    const renderChain = (session: Session, entry: WireEntry) => {
      const steps = chainOf(session, entry);
      const back = session.back(entry.seq);
      const forward = session.forward(entry.seq);
      return (
        <div>
          <h3>Causal chain</h3>
          <ol>
            {steps.map((step) => (
              <li>
                {step.seq === entry.seq ? (
                  <span>{step.summary}</span>
                ) : (
                  <button
                    type="button"
                    class="node"
                    onclick={() => selectEntry(step.seq)}
                  >
                    {step.summary}
                  </button>
                )}
              </li>
            ))}
          </ol>
          <div>
            {back.map((link) => (
              <button
                type="button"
                class="node"
                onclick={() => selectEntry(link.seq)}
              >
                {`← ${link.rel} #${link.seq}`}
              </button>
            ))}
            {forward.map((link) => (
              <button
                type="button"
                class="node"
                onclick={() => selectEntry(link.seq)}
              >
                {`${link.rel} #${link.seq} →`}
              </button>
            ))}
          </div>
        </div>
      );
    };

    // oxlint-disable-next-line eslint/complexity -- the timeline toolbar branches per state; splitting it would scatter the panel layout.
    const renderTimeline = () => {
      revision();
      const session = lookupSession();
      if (session === undefined) {
        return (
          <p class="muted">
            No model session yet. Mount an island that uses `@ilha/model`.
          </p>
        );
      }
      const entries = [...visibleEntries(session)].toReversed();
      const failures = session.entries().filter(isFailureEntry).length;
      const selectedEntry = selectedSeq();
      const resolved =
        selectedEntry === null ? undefined : session.resolve(selectedEntry);
      const entry =
        resolved !== undefined && resolved._tag !== "Outside"
          ? resolved
          : undefined;
      const treeInstances =
        findText().trim() === ""
          ? session.children()
          : session.find(findText().trim());
      return (
        <div>
          <div class="toolbar">
            <label>
              Filter
              <select
                value={filter()}
                onchange={(event) =>
                  // SAFETY: the select only offers the three EntryFilter options, so its value is one.
                  filter.set(event.currentTarget.value as EntryFilter)
                }
              >
                <option value="messages">Messages</option>
                <option value="commands">Commands</option>
                <option value="all">Everything</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={follow()}
                onchange={(event) => follow.set(event.currentTarget.checked)}
              />
              Follow latest
            </label>
            <button
              type="button"
              disabled={backStack().length === 0}
              onclick={goBack}
            >
              Back
            </button>
            <button
              type="button"
              onclick={() => {
                refreshModel();
              }}
            >
              Refresh
            </button>
            <button type="button" onclick={clearSession}>
              Clear
            </button>
            {summaryOf(session)?.paused !== undefined && (
              <span>
                <span class="muted">{`Paused at #${summaryOf(session)?.paused}; the live island keeps running.`}</span>
                <button
                  type="button"
                  onclick={() => {
                    resumeSession(session.id);
                  }}
                >
                  Resume
                </button>
              </span>
            )}
            <span class="muted">{`${failures} ${failures === 1 ? "failure" : "failures"}`}</span>
          </div>
          <div class="toolbar">
            <label>
              Exclude message tags
              <input
                aria-label="Exclude message tags"
                value={excludeText()}
                onchange={(event) => excludeText.set(event.currentTarget.value)}
                placeholder="ClickedAdd, …"
              />
            </label>
            <button type="button" onclick={applyExclude}>
              Apply
            </button>
          </div>
          <div class="columns">
            <div>
              <h2>Instances</h2>
              <input
                aria-label="Find instances"
                value={findText()}
                oninput={(event) => findText.set(event.currentTarget.value)}
                placeholder="Find"
              />
              {onlyInstance() !== null && (
                <button type="button" onclick={() => onlyInstance.set(null)}>
                  {`Showing only instance ${onlyInstance()}; show all`}
                </button>
              )}
              <ul>
                {treeInstances.map((instance) => (
                  <li>
                    <button
                      type="button"
                      class="node"
                      aria-current={String(
                        onlyInstance() === instance.instance
                      )}
                      onclick={() => onlyInstance.set(instance.instance)}
                    >
                      {`${instance.component} #${instance.instance} ${instance.path}`}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2>Timeline</h2>
              {entries.length === 0 ? (
                <p class="muted">No entries under this filter yet.</p>
              ) : (
                <ol class="timeline">
                  {entries.map((rowEntry) => {
                    const label = labelOf(rowEntry);
                    return (
                      <li>
                        <button
                          type="button"
                          class="node"
                          aria-current={String(selectedSeq() === rowEntry.seq)}
                          onclick={() => selectEntry(rowEntry.seq)}
                        >
                          {`#${rowEntry.seq} ${label.text}${label.detail === undefined ? "" : ` ${label.detail}`}${changedMark(session, rowEntry.seq)}`}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
          {entry !== undefined && (
            <div>
              <h2>{`Entry #${entry.seq}`}</h2>
              <div class="toolbar">
                {summaryOf(session)?.paused === entry.seq ? (
                  <span class="muted">
                    Paused here; the live island keeps running. Showing the
                    inert historical copy.
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={summaryOf(session)?.controllable !== true}
                    title={
                      summaryOf(session)?.controllable === true
                        ? "Hide the live island (it keeps running) and show this entry's state"
                        : "The page has no live runtime bridge for this session"
                    }
                    onclick={() => {
                      pauseHere(session.id, entry.seq);
                    }}
                  >
                    Pause here
                  </button>
                )}
                {instanceOf(entry) !== undefined && (
                  <span>
                    <input
                      aria-label="Dispatch message JSON"
                      value={dispatchText()}
                      oninput={(event) =>
                        dispatchText.set(event.currentTarget.value)
                      }
                      placeholder='{"_tag": "…"}'
                    />
                    <button
                      type="button"
                      disabled={summaryOf(session)?.controllable !== true}
                      title="Decode the JSON against the instance's message schema and deliver it through the normal runtime update"
                      onclick={() => {
                        const at = instanceOf(entry);
                        if (at !== undefined) {
                          void sendDispatch(session.id, at);
                        }
                      }}
                    >
                      {`Dispatch to instance ${instanceOf(entry)}`}
                    </button>
                  </span>
                )}
              </div>
              <div class="toolbar" role="tablist">
                {TABS.map((entryTab) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={String(tab() === entryTab.id)}
                    onclick={() => tab.set(entryTab.id)}
                  >
                    {entryTab.label}
                  </button>
                ))}
              </div>
              {renderEntryTabs(session, entry)}
              {renderChain(session, entry)}
            </div>
          )}
          {resolved !== undefined && resolved._tag === "Outside" && (
            <p class="muted">That entry left the buffer; pick a newer one.</p>
          )}
          {modelProblem() !== "" && <p class="error">{modelProblem()}</p>}
        </div>
      );
    };

    const current = findNode(nodes(), selected());
    return (
      <main>
        <h1>Ilha islands</h1>
        {status() === "connecting" && (
          <p class="muted">Connecting to the page…</p>
        )}
        {status() === "missing" && (
          <p class="error">
            No page found. Call installIlhaDevtools().openPanel() in your app to
            open this panel.
          </p>
        )}
        {status() === "connected" && nodes().length === 0 && (
          <p class="muted">No islands are mounted.</p>
        )}
        <ul>{nodes().map(row)}</ul>
        {current && (
          <section>
            <h1>{current.component} atoms</h1>
            <dl>
              {current.atoms.map(({ index, value }) => (
                <>
                  <dt>#{index}</dt>
                  <dd>
                    <input
                      aria-label={`${current.component} atom ${index}`}
                      value={JSON.stringify(value)}
                      onchange={(event) =>
                        edit(current.id, index, event.currentTarget.value)
                      }
                    />
                  </dd>
                </>
              ))}
            </dl>
            {problem() && <p class="error">{problem()}</p>}
          </section>
        )}
        <section>
          <h1>Model timeline</h1>
          {modelSessions().length > 1 && (
            <label>
              Session
              <select
                value={activeSession() ?? ""}
                onchange={(event) => {
                  activeSession.set(event.currentTarget.value);
                  selectedSeq.set(null);
                  backStack.set([]);
                }}
              >
                {modelSessions().map((id) => (
                  <option value={id}>{id}</option>
                ))}
              </select>
            </label>
          )}
          {renderTimeline()}
        </section>
      </main>
    );
  };
  return App;
};
