import type { PanelChannel } from "devframe/in-page-channel";
import { atom, watch } from "ilha";

import { parseTree } from "../protocol";
import type {
  AtomJson,
  IlhaDevtoolsProtocol,
  IlhaInspectNode,
  ModelLogEntry,
} from "../protocol";

export type PanelConnection = PanelChannel<IlhaDevtoolsProtocol>;

type Status = "connecting" | "connected" | "missing";

const CONNECT_TIMEOUT_MS = 3000;

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

/**
 * The panel: a component tree on the left, the selected component's atoms
 * below it. `connect` opens the channel to the page script.
 */
export const createApp = (connect: () => PanelConnection) => {
  const App = () => {
    const nodes = atom<readonly IlhaInspectNode[]>([]);
    const selected = atom<string | null>(null);
    const status = atom<Status>("connecting");
    const problem = atom("");
    const log = atom<readonly ModelLogEntry[]>([]);

    const channel = atom.lazy(connect, { snapshot: false });

    const refreshLog = async (id: string | null): Promise<void> => {
      if (id === null) {
        log.set([]);
        return;
      }
      try {
        const result = await channel().call("modelLog", id);
        log.set(result.ok ? result.entries : []);
      } catch {
        // An older page script has no modelLog; the tree still works.
        log.set([]);
      }
    };

    watch(selected, (id) => {
      void refreshLog(id);
    });

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
          void refreshLog(selected());
        });
      };
      void sync();
      const stop = (): void => {
        open = false;
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
          <>
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
            {log().length > 0 && (
              <section>
                <h1>{current.component} messages</h1>
                <ol>
                  {log().map((entry) => (
                    <li>
                      <code>{JSON.stringify(entry.message)}</code>
                      <span class="muted">
                        {` ${entry.commands} ${entry.commands === 1 ? "command" : "commands"} · ${new Date(entry.at).toLocaleTimeString()}`}
                      </span>
                      {entry.diff._tag === "fields"
                        ? Object.entries(entry.diff.changed).map(
                            ([field, change]) => (
                              <div>
                                {`${field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`}
                              </div>
                            )
                          )
                        : `${JSON.stringify(entry.diff.before)} → ${JSON.stringify(entry.diff.after)}`}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </main>
    );
  };
  return App;
};
