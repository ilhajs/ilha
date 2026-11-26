import { afterEach, describe, expect, it } from "bun:test";

import { mount } from "ilha";

import type {
  ModelFramesResult,
  ModelSessionSummary,
} from "../src/protocol.ts";
import { createApp } from "../src/spa/app.tsx";
import type { PanelConnection } from "../src/spa/app.tsx";
import { fixtureFrames, fixtureSession, settle } from "./helpers.tsx";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  document.body.innerHTML = "";
});

const frames = [...fixtureFrames("interrupted")];
const session = fixtureSession("interrupted");

/** A panel channel that serves the recorded fixture instead of a live page. */
const stubChannel = (): PanelConnection & {
  calls: Record<string, readonly (readonly unknown[])[]>;
} => {
  let pausedAt: number | undefined;
  const calls: Record<string, readonly (readonly unknown[])[]> = {};
  const record = (name: string, args: readonly unknown[]): void => {
    calls[name] = [...(calls[name] ?? []), args];
  };
  const channel = {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the stub mirrors the panel channel signature; args are decoded per case below.
    call: (name: string, ...args: unknown[]) => {
      record(name, args);
      switch (name) {
        case "inspect": {
          return [];
        }
        case "highlight": {
          return true;
        }
        case "setAtom": {
          return { ok: true };
        }
        case "modelSessions": {
          return [
            {
              app: "Workspace",
              controllable: true,
              entries: frames.length,
              first: frames[0]?.seq,
              last: frames.at(-1)?.seq,
              paused: pausedAt,
              session,
            },
          ] satisfies ModelSessionSummary[];
        }
        case "modelFrames": {
          // SAFETY: modelFrames is always called with (session, since); the stub mirrors that call shape.
          const [id, since] = args as [string, number];
          const kept = frames.filter(
            (frame) => frame.session === id && frame.seq > since
          );
          return { frames: kept, ok: true } satisfies ModelFramesResult;
        }
        case "modelMessageSchema": {
          return { ok: false, reason: "no schema" };
        }
        case "modelShowEntry": {
          // SAFETY: modelShowEntry is always called with (session, seq); the stub mirrors that call shape.
          const [, seq] = args as [string, number];
          pausedAt = seq;
          return { ok: true, seq, session };
        }
        case "modelResume": {
          pausedAt = undefined;
          return { ok: true, session };
        }
        case "modelDispatch": {
          // SAFETY: modelDispatch is always called with (session, instance, message); the stub mirrors that call shape.
          const [, instance, message] = args as [string, number, unknown];
          return { instance, message, ok: true, session };
        }
        default: {
          throw new Error(`unexpected call ${name}`);
        }
      }
    },
    close: () => {},
    sharedState: {
      get: () =>
        Promise.resolve({
          on: () => {},
          value: () => ({ json: "[]" }),
        }),
    },
    whenConnected: async () => {},
  };
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- the stub is a structural fake of the panel channel; the unknown hop is the only sound cast.
  return { ...channel, calls } as unknown as PanelConnection & {
    calls: Record<string, readonly unknown[][]>;
  };
};

const openPanel = async () => {
  const panelHost = document.createElement("div");
  document.body.append(panelHost);
  const unmount = mount(panelHost, createApp(stubChannel));
  cleanups.push(unmount);
  await settle(100);
  return panelHost;
};

const timelineLabels = (panelHost: HTMLElement): string[] =>
  [...panelHost.querySelectorAll("ol.timeline button")].map(
    (button) => button.textContent ?? ""
  );

const clickRow = (panelHost: HTMLElement, label: string): void => {
  const row = [...panelHost.querySelectorAll("ol.timeline button")].find(
    (button) => (button.textContent ?? "").includes(label)
  );
  if (!(row instanceof HTMLButtonElement)) {
    throw new TypeError(`timeline row ${label} missing`);
  }
  row.click();
};

const clickTab = (panelHost: HTMLElement, label: string): void => {
  const tab = [...panelHost.querySelectorAll('[role="tab"]')].find(
    (button) => button.textContent === label
  );
  if (!(tab instanceof HTMLButtonElement)) {
    throw new TypeError(`tab ${label} missing`);
  }
  tab.click();
};

describe("model panel", () => {
  it("lists message entries newest first", async () => {
    const panelHost = await openPanel();
    const labels = timelineLabels(panelHost);
    expect(labels.length).toBeGreaterThan(5);
    expect(labels.every((label) => !label.includes("CommandStarted"))).toBe(
      true
    );
    const seqs = labels.map((label) => Number(label.slice(1).split(" ")[0]));
    expect([...seqs].toSorted((a, b) => b - a)).toEqual(seqs);
  });

  it("shows command runs under Everything", async () => {
    const panelHost = await openPanel();
    const select = panelHost.querySelector("select");
    if (!select) {
      throw new Error("filter select missing");
    }
    select.value = "all";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(50);
    expect(
      timelineLabels(panelHost).some((label) => label.includes("started"))
    ).toBe(true);
  });

  it("shows entry tabs with the model diff and the raw frame", async () => {
    const panelHost = await openPanel();
    clickRow(panelHost, "#18 ClickedSave");
    await settle(50);
    expect(panelHost.textContent).toContain("Entry #18");
    expect(panelHost.textContent).toContain("status");

    clickTab(panelHost, "Message");
    await settle(20);
    expect(panelHost.textContent).toContain("ClickedSave");

    clickTab(panelHost, "Raw");
    await settle(20);
    expect(panelHost.textContent).toContain("Copy frame");

    clickTab(panelHost, "Commands");
    await settle(20);
    expect(panelHost.textContent).toContain("notes/SaveNote");
  });

  it("links the causal chain back and forward", async () => {
    const panelHost = await openPanel();
    clickRow(panelHost, "#18 ClickedSave");
    await settle(50);
    expect(panelHost.textContent).toContain("Causal chain");
    const forward = [...panelHost.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").includes("#19")
    );
    if (!(forward instanceof HTMLButtonElement)) {
      throw new TypeError("forward link to #19 missing");
    }
    forward.click();
    await settle(50);
    expect(panelHost.textContent).toContain("Entry #19");
  });

  it("finds an instance and filters the timeline to it", async () => {
    const panelHost = await openPanel();
    const find = panelHost.querySelector('input[aria-label="Find instances"]');
    if (!(find instanceof HTMLInputElement)) {
      throw new TypeError("find input missing");
    }
    find.value = "Editor[n2]";
    find.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(50);
    const treeButtons = [
      ...panelHost.querySelectorAll("div.columns button.node"),
    ].filter((button) => (button.textContent ?? "").includes("Editor"));
    expect(treeButtons.length).toBeGreaterThan(0);
    const [firstButton] = treeButtons;
    if (!(firstButton instanceof HTMLButtonElement)) {
      throw new TypeError("tree button missing");
    }
    firstButton.click();
    await settle(50);
    const labels = timelineLabels(panelHost);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((label) => label.includes("#12"))).toBe(false);
  });

  it("goes back to the previous entry", async () => {
    const panelHost = await openPanel();
    clickRow(panelHost, "#18 ClickedSave");
    await settle(20);
    clickRow(panelHost, "#21 ClickedSave");
    await settle(20);
    expect(panelHost.textContent).toContain("Entry #21");
    const back = [...panelHost.querySelectorAll("button")].find(
      (button) => button.textContent === "Back"
    );
    if (!(back instanceof HTMLButtonElement)) {
      throw new TypeError("Back button missing");
    }
    back.click();
    await settle(20);
    expect(panelHost.textContent).toContain("Entry #18");
  });

  it("excludes message tags on apply", async () => {
    const panelHost = await openPanel();
    expect(
      timelineLabels(panelHost).some((label) => label.includes("PressedEscape"))
    ).toBe(true);
    const exclude = panelHost.querySelector(
      'input[aria-label="Exclude message tags"]'
    );
    if (!(exclude instanceof HTMLInputElement)) {
      throw new TypeError("exclude input missing");
    }
    exclude.value = "PressedEscape";
    exclude.dispatchEvent(new Event("change", { bubbles: true }));
    const apply = [...panelHost.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply"
    );
    if (!(apply instanceof HTMLButtonElement)) {
      throw new TypeError("Apply button missing");
    }
    apply.click();
    await settle(50);
    expect(
      timelineLabels(panelHost).some((label) => label.includes("PressedEscape"))
    ).toBe(false);
  });

  it("clears the timeline but keeps the instances", async () => {
    const panelHost = await openPanel();
    expect(timelineLabels(panelHost).length).toBeGreaterThan(0);
    const clear = [...panelHost.querySelectorAll("button")].find(
      (button) => button.textContent === "Clear"
    );
    if (!(clear instanceof HTMLButtonElement)) {
      throw new TypeError("Clear button missing");
    }
    clear.click();
    await settle(50);
    expect(timelineLabels(panelHost)).toHaveLength(0);
    expect(panelHost.textContent).toContain("Workspace");
  });

  it("pauses at the selected entry and resumes from the banner", async () => {
    const stub = stubChannel();
    const panelHost = document.createElement("div");
    document.body.append(panelHost);
    const unmount = mount(
      panelHost,
      createApp(() => stub)
    );
    cleanups.push(unmount);
    await settle(100);
    clickRow(panelHost, "#18 ClickedSave");
    await settle(20);
    const pause = [...panelHost.querySelectorAll("button")].find(
      (button) => button.textContent === "Pause here"
    );
    if (!(pause instanceof HTMLButtonElement)) {
      throw new TypeError("Pause here button missing");
    }
    pause.click();
    await settle(100);
    expect(stub.calls["modelShowEntry"]).toEqual([[session, 18]]);
    expect(panelHost.textContent).toContain("Paused at #18");
    const resume = [...panelHost.querySelectorAll("button")].find(
      (button) => button.textContent === "Resume"
    );
    if (!(resume instanceof HTMLButtonElement)) {
      throw new TypeError("Resume button missing");
    }
    resume.click();
    await settle(100);
    expect(stub.calls["modelResume"]).toEqual([[session]]);
    expect(panelHost.textContent).not.toContain("Paused at #18");
  });

  it("dispatches the typed message to the selected instance", async () => {
    const stub = stubChannel();
    const panelHost = document.createElement("div");
    document.body.append(panelHost);
    const unmount = mount(
      panelHost,
      createApp(() => stub)
    );
    cleanups.push(unmount);
    await settle(100);
    clickRow(panelHost, "#18 ClickedSave");
    await settle(20);
    const input = panelHost.querySelector(
      'input[aria-label="Dispatch message JSON"]'
    );
    if (!(input instanceof HTMLInputElement)) {
      throw new TypeError("dispatch input missing");
    }
    input.value = '{"_tag":"ClickedSave"}';
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(20);
    const send = [...panelHost.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").startsWith("Dispatch to instance")
    );
    if (!(send instanceof HTMLButtonElement)) {
      throw new TypeError("dispatch button missing");
    }
    expect(send.textContent).toContain("2");
    send.click();
    await settle(100);
    expect(stub.calls["modelDispatch"]).toEqual([
      [session, 2, { _tag: "ClickedSave" }],
    ]);
  });
});
