/**
 * Page script: runs in the app, answers panels and agents. Import it only in
 * development; it pulls in `ilha/debug` and `devframe/in-page-channel`.
 */
import { createPageScriptChannel } from "devframe/in-page-channel";
import type { PageScriptChannel } from "devframe/in-page-channel";
import { element, inspect, onChange, setAtom } from "ilha/debug";

import { ILHA_DEVTOOLS_CHANNEL, ILHA_DEVTOOLS_PANEL_PATH } from "./protocol";
import type { AtomJson, IlhaDevtoolsProtocol } from "./protocol";
import { registerWebMcpTools } from "./webmcp";

export type { AtomJson, IlhaDevtoolsProtocol } from "./protocol";

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
}

export interface IlhaDevtoolsHandle {
  channel: PageScriptChannel<IlhaDevtoolsProtocol>;
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
 * Start answering `inspect`, `highlight`, and `setAtom` for this page, and
 * mirror the island tree into the channel's shared state. Calling it again
 * replaces the previous install.
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
      setAtom: {
        agent: {
          description:
            "Replace one atom's value in a live component with a JSON value, then let the island rerender. Use ids and indexes from inspect. Derived and Effect atoms are read-only and return a reason.",
          safety: "action",
          title: "Set an Ilha atom",
        },
        handler: (id: string, index: number, value: AtomJson) =>
          setAtom(id, index, value),
        jsonSerializable: true,
        type: "action",
      },
    },
    name: ILHA_DEVTOOLS_CHANNEL,
    window: options.window ?? (hasWindow ? window : false),
  });

  const disposers: (() => void)[] = [highlighter.clear];
  let active = true;

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
    disposers.push(registerWebMcpTools({ highlight, inspect, setAtom }));
  }

  const handle: IlhaDevtoolsHandle = {
    channel,
    dispose: () => {
      active = false;
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
        ? window.open(url, "ilha-devtools", "popup,width=420,height=640")
        : null,
  };
  current = handle;
  return handle;
};
