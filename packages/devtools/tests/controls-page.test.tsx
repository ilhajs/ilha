/**
 * The page protocol for time travel and gated dispatch, with a fake
 * live-runtime bridge. Frames are ingested straight into the page backend;
 * the bridge hides a marker node and mounts a static copy from History.
 */
import { afterEach, describe, expect, it } from "bun:test";

import { Schema } from "effect";

import type { HeldState } from "../src/inspector.ts";
import { createPauseHost } from "../src/page.ts";
import type { IlhaDevtoolsHandle } from "../src/page.ts";
import type { PanelConnection } from "../src/spa/app.tsx";
import type { ModelRuntimeBridge } from "../src/webmcp.ts";
import {
  connectPair,
  fixtureFrames,
  fixtureSession,
  settle,
} from "./helpers.tsx";

const EditorMessage = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("UpdatedDraft"), text: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("ClickedSave") }),
  Schema.Struct({ _tag: Schema.Literal("PressedEscape") }),
]);

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  document.body.innerHTML = "";
});

const lookupEntries = (lookup: {
  stateOf: (path: string) => HeldState | undefined;
}): [string, HeldState][] => {
  const rows: [string, HeldState][] = [];
  for (const path of [
    "/Workspace",
    "/Workspace/Editor[n1]",
    "/Workspace/Editor[n2]",
  ]) {
    const held = lookup.stateOf(path);
    if (held !== undefined) {
      rows.push([path, held]);
    }
  }
  return rows;
};
const fakeBridge = (live: HTMLElement) => {
  const copies = new Map<string, () => void>();
  const dispatched: { message: unknown; path: string; session: string }[] = [];
  const bridge: ModelRuntimeBridge = {
    dispatch: (session, path, message) => {
      dispatched.push({ message, path, session });
      return true;
    },
    isControllable: () => true,
    pause: (session, _seq, lookup) => {
      live.style.display = "none";
      const copy = document.createElement("div");
      copy.dataset.ilhaDevtoolsHistorical = "true";
      copy.setAttribute("inert", "");
      copy.textContent = JSON.stringify(
        [...lookupEntries(lookup)].map(([path, held]) => ({
          model: held.model,
          path,
        }))
      );
      live.parentElement?.insertBefore(copy, live.nextSibling);
      const resume = (): void => {
        copies.delete(session);
        copy.remove();
        live.style.display = "";
      };
      copies.set(session, resume);
      return { resume };
    },
    resume: (session) => {
      copies.get(session)?.();
    },
  };
  return { bridge, dispatched };
};

const setup = async (options?: {
  dispatch?: boolean;
}): Promise<{
  bridge: ModelRuntimeBridge;
  dispatched: { message: unknown; path: string; session: string }[];
  handle: IlhaDevtoolsHandle;
  live: HTMLElement;
  panel: PanelConnection;
  session: string;
}> => {
  const live = document.createElement("div");
  live.textContent = "live island";
  document.body.append(live);
  const { bridge, dispatched } = fakeBridge(live);
  const pair = connectPair({
    bridge,
    dispatch: options?.dispatch,
    webmcp: false,
    window: false,
  });
  cleanups.push(pair.panel.close, pair.handle.dispose);
  await pair.panel.whenConnected(1000);
  const session = fixtureSession("interrupted");
  pair.handle.backend.ingest(fixtureFrames("interrupted"));
  pair.handle.backend.noteComponent("Editor", EditorMessage);
  return { ...pair, bridge, dispatched, live, session };
};

describe("page control protocol", () => {
  it("reports controllable sessions with no pause", async () => {
    const { panel, session } = await setup();
    const summaries = await panel.call("modelSessions");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ controllable: true, session });
    expect(summaries[0]?.paused).toBeUndefined();
  });

  it("pauses an earlier entry, keeps the live log flowing, and resumes", async () => {
    const { handle, live, panel, session } = await setup({ dispatch: true });
    const paused = await panel.call("modelShowEntry", session, 18);
    expect(paused).toMatchObject({ ok: true, seq: 18, session });
    expect(live.style.display).toBe("none");
    const copy = document.querySelector("[data-ilha-devtools-historical]");
    if (!(copy instanceof HTMLElement)) {
      throw new TypeError("historical copy missing");
    }
    expect(copy.getAttribute("inert")).toBe("");
    expect(copy.textContent ?? "").toContain("Saving");

    const summaries = await panel.call("modelSessions");
    expect(summaries[0]).toMatchObject({ paused: 18 });

    // The live island keeps running: new frames still arrive while paused.
    const last = handle.backend.inspector
      .sessions()
      .find((held) => held.id === session)
      ?.entries()
      .at(-1);
    if (last === undefined) {
      throw new Error("fixture has no entries");
    }
    handle.backend.ingest([{ ...last, seq: last.seq + 1 }]);
    const frames = await panel.call("modelFrames", session, last.seq);
    expect(frames.ok).toBe(true);
    if (frames.ok) {
      expect(frames.frames.map((frame) => frame.seq)).toEqual([last.seq + 1]);
    }

    const resumed = await panel.call("modelResume", session);
    expect(resumed).toMatchObject({ ok: true, session });
    expect(
      document.querySelector("[data-ilha-devtools-historical]")
    ).toBeNull();
    expect(live.style.display).toBe("");
    const after = await panel.call("modelSessions");
    expect(after[0]?.paused).toBeUndefined();
  });

  it("refuses control calls precisely", async () => {
    const { panel, session } = await setup();
    expect(await panel.call("modelShowEntry", session, 999)).toMatchObject({
      ok: false,
    });
    const missing = await panel.call("modelResume", session);
    expect(missing).toMatchObject({ ok: false });
    if (!missing.ok) {
      expect(missing.reason).toContain("is not paused");
    }
    // Dispatch is off by default.
    const disabled = await panel.call("modelDispatch", session, 2, {
      _tag: "ClickedSave",
    });
    expect(disabled).toMatchObject({ ok: false });
    if (!disabled.ok) {
      expect(disabled.reason).toContain("dispatch: true");
    }
  });

  it("dispatches a decoded message when enabled, and decodes strictly", async () => {
    const { dispatched, panel, session } = await setup({ dispatch: true });
    const ok = await panel.call("modelDispatch", session, 2, {
      _tag: "ClickedSave",
    });
    expect(ok).toMatchObject({
      instance: 2,
      ok: true,
      path: "/Workspace/Editor[n1]",
    });
    expect(dispatched).toEqual([
      {
        message: { _tag: "ClickedSave" },
        path: "/Workspace/Editor[n1]",
        session,
      },
    ]);
    const bad = await panel.call("modelDispatch", session, 2, { _tag: "Nope" });
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) {
      expect(bad.reason).toContain("failed to decode");
    }
  });

  it("restores live islands on dispose", async () => {
    const { handle, live, panel, session } = await setup({ dispatch: true });
    await panel.call("modelShowEntry", session, 18);
    expect(live.style.display).toBe("none");
    handle.dispose();
    expect(
      document.querySelector("[data-ilha-devtools-historical]")
    ).toBeNull();
    expect(live.style.display).toBe("");
  });
});

describe("pause host", () => {
  it("hides one island and mounts an inert server-rendered copy", async () => {
    const live = document.createElement("div");
    live.textContent = "live island";
    document.body.append(live);
    const host = createPauseHost(() => live);
    host.hideLive();
    expect(live.style.display).toBe("none");
    host.showHistorical(
      new Map([
        ["/App", { model: { count: 1 }, props: {} }],
        ["/App/Badge", { model: { n: 2 }, props: {} }],
      ])
    );
    await settle(100);
    const copy = document.querySelector("[data-ilha-devtools-historical]");
    if (!(copy instanceof HTMLElement)) {
      throw new TypeError("historical copy missing");
    }
    expect(copy.getAttribute("inert")).toBe("");
    expect(copy.textContent ?? "").toContain("/App/Badge");
    expect(copy.textContent ?? "").toContain('"count": 1');
    expect(copy.querySelectorAll("*").length).toBeGreaterThan(0);
    host.restoreLive();
    expect(
      document.querySelector("[data-ilha-devtools-historical]")
    ).toBeNull();
    expect(live.style.display).toBe("");
  });
  it("lets a newer copy win when two renders overlap", async () => {
    const live = document.createElement("div");
    live.textContent = "live island";
    document.body.append(live);
    const host = createPauseHost(() => live);
    host.hideLive();
    const first = host.showHistorical(
      new Map([["/App", { model: { count: 1 }, props: {} }]])
    );
    const second = host.showHistorical(
      new Map([["/App", { model: { count: 2 }, props: {} }]])
    );
    const [loser, winner] = await Promise.all([first, second]);
    expect(loser).toBe(false);
    expect(winner).toBe(true);
    const copies = document.querySelectorAll("[data-ilha-devtools-historical]");
    expect(copies).toHaveLength(1);
    expect(copies[0]?.textContent ?? "").toContain('"count": 2');
    expect(live.style.display).toBe("none");
    host.restoreLive();
    expect(
      document.querySelector("[data-ilha-devtools-historical]")
    ).toBeNull();
    expect(live.style.display).toBe("");
  });
});
