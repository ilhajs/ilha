/**
 * Devtools against a real model island with no injected `bridge`: the page
 * resolves `@ilha/model/devtools` itself, so the session reports
 * controllable and pause, resume and dispatch work through the live runtime.
 */
import { afterEach, describe, expect, it } from "bun:test";

import { defineComponent } from "@ilha/model";
import * as Schema from "effect/Schema";
import { mount } from "ilha";

import type { ModelSessionSummary } from "../src/protocol.ts";
import { connectPair, selectorOf, settle } from "./helpers.tsx";

const CounterDef = defineComponent({
  events: Schema.Never,
  message: Schema.Union([Schema.TaggedStruct("Increment", {})]),
  model: Schema.Struct({ count: Schema.Number }),
  name: "ModelCounter",
  props: Schema.Struct({}),
});

const ModelCounter = CounterDef.make({
  init: () => ({ count: 0 }),
  update: {
    Increment: ($) => $.set({ count: $.model.count + 1 }),
  },
  view: (h, model) => (
    <div>
      <span id="mcount">{String(model.count)}</span>
      <button id="minc" onclick={h.send({ _tag: "Increment" })}>
        inc
      </button>
    </div>
  ),
});

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  document.body.innerHTML = "";
});

const setup = async () => {
  const pair = connectPair({ dispatch: true, webmcp: false, window: false });
  const host = document.createElement("div");
  host.id = "model-host";
  document.body.append(host);
  const unmount = mount(host, () => <ModelCounter props={{}} />);
  cleanups.push(pair.panel.close, pair.handle.dispose, unmount);
  await pair.panel.whenConnected(1000);
  // The page loads `@ilha/model` asynchronously, attaches its sink, then
  // resolves the Devtools seam; wait until the session is controllable.
  const start = Date.now();
  let sessions: readonly ModelSessionSummary[] = [];
  while (Date.now() - start < 5000) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling probe: each call must settle before the next check.
    sessions = await pair.panel.call("modelSessions");
    if (sessions.length > 0 && sessions[0]?.controllable === true) {
      break;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling backoff: sleeps must run sequentially between probes.
    await settle(25);
  }
  return { ...pair, host, sessions };
};

describe("real model bridge", () => {
  it("reports the live session as controllable with no injected bridge", async () => {
    const { sessions } = await setup();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ controllable: true });
    expect(sessions[0]?.paused).toBeUndefined();
  });

  it("pauses an entry into an inert copy and resumes live", async () => {
    const { host, panel, sessions } = await setup();
    const session = sessions[0]?.session ?? "";
    const frames = await panel.call("modelFrames", session, 0);
    if (!frames.ok) {
      throw new Error(`no frames: ${frames.reason}`);
    }
    const seq = frames.frames.at(-1)?.seq;
    if (seq === undefined) {
      throw new Error("session logged no entries");
    }
    const paused = await panel.call("modelShowEntry", session, seq);
    expect(paused).toMatchObject({ ok: true, seq, session });
    expect(host.style.display).toBe("none");
    const copy = document.querySelector("[data-ilha-devtools-historical]");
    if (!(copy instanceof HTMLElement)) {
      throw new TypeError("historical copy missing");
    }
    expect(copy.getAttribute("inert")).toBe("");
    const after = await panel.call("modelSessions");
    expect(after[0]).toMatchObject({ paused: seq });
    const resumed = await panel.call("modelResume", session);
    expect(resumed).toMatchObject({ ok: true, session });
    expect(
      document.querySelector("[data-ilha-devtools-historical]")
    ).toBeNull();
    expect(host.style.display).toBe("");
  });

  it("dispatches a decoded message through the live island", async () => {
    const { handle, host, panel, sessions } = await setup();
    const session = sessions[0]?.session ?? "";
    const instance = handle.backend.inspector
      .sessions()
      .find((held) => held.id === session)
      ?.instances()
      .find((found) => found.component === "ModelCounter")?.instance;
    if (instance === undefined) {
      throw new Error("ModelCounter instance missing from the session");
    }
    const delivered = await panel.call("modelDispatch", session, instance, {
      _tag: "Increment",
    });
    expect(delivered).toMatchObject({ instance, ok: true, session });
    await settle(100);
    expect(host.querySelector("#mcount")?.textContent).toBe("1");
  });

  it("refuses setAtom on the live model island", async () => {
    const { host, panel } = await setup();
    const nodes = await panel.call("inspect");
    const root = nodes.find((node) => node.host === selectorOf(host));
    const refused = await panel.call("setAtom", root?.id ?? "", 0, {
      count: 99,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toContain("modelDispatch");
    }
  });
});
