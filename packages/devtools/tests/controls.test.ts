/**
 * Time travel and gated dispatch over a backend with a fake live-runtime
 * bridge. The bridge owns a happy-dom stand-in for the page: pausing hides
 * the live node and mounts a static historical copy, resuming restores it.
 */
import { afterEach, describe, expect, it } from "bun:test";

import { Schema } from "effect";

import type { HeldState } from "../src/inspector.ts";
import { createModelBackend, modelToolHandlers } from "../src/webmcp.ts";
import type {
  ModelBackend,
  ModelRuntimeBridge,
  ToolArgs,
  ToolHandlers,
} from "../src/webmcp.ts";
import type { WireEntry } from "../src/wire.ts";
import { fixtureFrames, fixtureSession } from "./helpers.tsx";

interface Feed {
  backend: ModelBackend;
  handlers: ToolHandlers;
  session: string;
}

interface CallResult<T> {
  result: T;
}

const EditorMessage = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("UpdatedDraft"), text: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("ClickedSave") }),
  Schema.Struct({ _tag: Schema.Literal("PressedEscape") }),
]);

const feed = (options?: { dispatch?: boolean }): Feed => {
  const backend = createModelBackend(options);
  backend.ingest(fixtureFrames("interrupted"));
  return {
    backend,
    handlers: modelToolHandlers(backend),
    session: fixtureSession("interrupted"),
  };
};

const call = async <T>(
  handlers: ToolHandlers,
  name: string,
  args: ToolArgs = {}
): Promise<CallResult<T>> => {
  const handler = handlers[name];
  if (handler === undefined) {
    throw new Error(`unknown tool ${name}`);
  }
  // SAFETY: every tool resolves `{ result }` or throws ToolError; the caller names the payload shape via T.
  return (await handler(args)) as CallResult<T>;
};

const fails = async <T>(task: () => Promise<T>): Promise<string> => {
  try {
    await task();
  } catch (error) {
    // SAFETY: tools signal misuse by throwing ToolError; the message carries the failure under test.
    return (error as Error).message;
  }
  throw new Error("expected the tool to fail");
};

const instanceAtPath = (
  backend: ModelBackend,
  session: string,
  path: string
): number => {
  const found = backend.inspector
    .sessions()
    .find((held) => held.id === session)
    ?.instances()
    .find((held) => held.path === path);
  if (found === undefined) {
    throw new Error(`no instance at ${path}`);
  }
  return found.instance;
};

interface FakePage {
  bridge: ModelRuntimeBridge;
  copies: Map<
    string,
    { lookup: { stateOf: (path: string) => HeldState | undefined } }
  >;
  dispatched: { message: unknown; path: string; session: string }[];
  live: HTMLElement;
  pauses: { seq: number; session: string }[];
}

const fakePage = (): FakePage => {
  const live = document.createElement("div");
  live.textContent = "live island";
  document.body.append(live);
  const resumes = new Map<string, () => void>();
  const copies: FakePage["copies"] = new Map();
  const dispatched: FakePage["dispatched"] = [];
  const pauses: FakePage["pauses"] = [];
  const bridge: ModelRuntimeBridge = {
    dispatch: (session, path, message) => {
      dispatched.push({ message, path, session });
      return true;
    },
    isControllable: () => true,
    pause: (session, seq, lookup) => {
      pauses.push({ seq, session });
      live.style.display = "none";
      const copy = document.createElement("div");
      copy.dataset.ilhaDevtoolsHistorical = "true";
      copy.setAttribute("inert", "");
      copy.textContent = JSON.stringify(
        ["/Workspace", "/Workspace/Editor[n1]", "/Workspace/Editor[n2]"].map(
          (path) => ({
            model: lookup.stateOf(path)?.model,
            path,
          })
        )
      );
      live.parentElement?.insertBefore(copy, live.nextSibling);
      const resume = (): void => {
        copies.delete(session);
        resumes.delete(session);
        copy.remove();
        live.style.display = "";
      };
      copies.set(session, { lookup });
      resumes.set(session, resume);
      return { resume };
    },
    resume: (session) => {
      resumes.get(session)?.();
    },
  };
  return { bridge, copies, dispatched, live, pauses };
};
afterEach(() => {
  document.body.innerHTML = "";
});

/** A new live frame: an entry cloned one `seq` past the session's last. */
const bump = (
  backend: ModelBackend,
  session: string,
  fromSeq?: number | undefined,
  model?: Schema.Json | undefined
): WireEntry => {
  const entries =
    backend.inspector
      .sessions()
      .find((held) => held.id === session)
      ?.entries() ?? [];
  const last = entries.at(-1);
  const frame =
    fromSeq === undefined
      ? last
      : entries.find((entry) => entry.seq === fromSeq);
  if (last === undefined || frame === undefined) {
    throw new Error("fixture has no entries");
  }
  if (model === undefined) {
    return { ...frame, seq: last.seq + 1 };
  }
  // SAFETY: the caller only passes a model for frames whose entry carries one (Mounted/Update/Failed); the spread keeps the entry's own tag and fields.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the model-carrying entry union has no single-step assertion from the full WireEntry union.
  return { ...frame, model, seq: last.seq + 1 } as unknown as WireEntry;
};

describe("time travel", () => {
  it("pauses an earlier entry and reports the pause", async () => {
    const { backend, handlers, session } = feed();
    const { bridge, copies, live, pauses } = fakePage();
    backend.bridge = bridge;
    const { result } = await call(handlers, "ilha_model_show_entry", {
      seq: 18,
      session,
    });
    expect(result).toEqual({ paused: true, seq: 18, session });
    expect(backend.pausedAt.get(session)).toBe(18);
    expect(pauses).toEqual([{ seq: 18, session }]);
    expect(live.style.display).toBe("none");

    const listed = await call<
      { controllable: boolean; paused?: number; session: string }[]
    >(handlers, "ilha_model_list_sessions");
    expect(listed.result).toHaveLength(1);
    expect(listed.result[0]).toMatchObject({
      controllable: true,
      paused: 18,
      session,
    });

    const instance = instanceAtPath(backend, session, "/Workspace/Editor[n1]");
    const { result: state } = await call<{ model: unknown }>(
      handlers,
      "ilha_model_get_state",
      {
        at: 18,
        instance,
        session,
      }
    );
    const shown = copies
      .get(session)
      ?.lookup.stateOf("/Workspace/Editor[n1]")?.model;
    expect(shown).toEqual(state.model);
  });

  it("lets live entries keep flowing while paused", async () => {
    const { backend, handlers, session } = feed();
    backend.bridge = fakePage().bridge;
    await call(handlers, "ilha_model_show_entry", { seq: 18, session });
    const before = await call<{ rows: { seq: number }[]; total: number }>(
      handlers,
      "ilha_model_list_entries",
      {
        session,
      }
    );
    const copyText = document.querySelector(
      "[data-ilha-devtools-historical]"
    )?.textContent;
    const next = bump(backend, session);
    backend.ingest([next]);
    const after = await call<{ rows: { seq: number }[]; total: number }>(
      handlers,
      "ilha_model_list_entries",
      {
        session,
      }
    );
    expect(after.result.total).toBe(before.result.total + 1);
    expect(after.result.rows.at(-1)?.seq).toBe(next.seq);
    expect(backend.pausedAt.get(session)).toBe(18);
    expect(
      document.querySelector("[data-ilha-devtools-historical]")?.textContent
    ).toBe(copyText);
  });

  it("mounts an inert copy of the paused state, not the live one", async () => {
    const { backend, handlers, session } = feed();
    backend.bridge = fakePage().bridge;
    await call(handlers, "ilha_model_show_entry", { seq: 18, session });
    const copy = document.querySelector("[data-ilha-devtools-historical]");
    if (!(copy instanceof HTMLElement)) {
      throw new TypeError("historical copy missing");
    }
    expect(copy.getAttribute("inert")).toBe("");
    expect(copy.outerHTML).not.toContain("onclick");
    const instance = instanceAtPath(backend, session, "/Workspace/Editor[n1]");
    const { result: then } = await call<{ model: unknown }>(
      handlers,
      "ilha_model_get_state",
      {
        at: 18,
        instance,
        session,
      }
    );
    expect(copy.textContent ?? "").toContain(JSON.stringify(then.model));
    // The live island keeps running: a newer state is not in the copy.
    backend.ingest([
      bump(backend, session, 18, {
        // SAFETY: the fixture wrote this Editor model as a JSON object; the spread clones it for the future-state entry.
        ...(then.model as object),
        status: "future-state",
      }),
    ]);
    const { result: now } = await call<{ model: unknown }>(
      handlers,
      "ilha_model_get_state",
      {
        instance,
        session,
      }
    );
    expect(now.model).toEqual({
      // SAFETY: same cloned Editor model as the ingested future-state entry above.
      ...(then.model as object),
      status: "future-state",
    });
    expect(copy.textContent ?? "").not.toContain("future-state");
  });

  it("resumes by removing the copy and restoring live", async () => {
    const { backend, handlers, session } = feed();
    const { bridge, live } = fakePage();
    backend.bridge = bridge;
    await call(handlers, "ilha_model_show_entry", { seq: 18, session });
    const { result } = await call(handlers, "ilha_model_resume", { session });
    expect(result).toEqual({ resumed: true, session });
    expect(
      document.querySelector("[data-ilha-devtools-historical]")
    ).toBeNull();
    expect(live.style.display).toBe("");
    expect(backend.pausedAt.has(session)).toBe(false);
    const listed = await call<{ paused?: number }[]>(
      handlers,
      "ilha_model_list_sessions"
    );
    expect(listed.result[0]?.paused).toBeUndefined();
  });

  it("fails pause and resume precisely", async () => {
    const { backend, handlers, session } = feed();
    backend.bridge = fakePage().bridge;
    expect(
      await fails(() => call(handlers, "ilha_model_show_entry", { session }))
    ).toContain("seq is required");
    expect(
      await fails(() =>
        call(handlers, "ilha_model_show_entry", { seq: 999, session })
      )
    ).toContain("Entry #999 is not in the session's buffer");
    expect(
      await fails(() => call(handlers, "ilha_model_resume", { session }))
    ).toContain("is not paused");

    const bridgeless = feed();
    expect(
      await fails(() =>
        call(bridgeless.handlers, "ilha_model_show_entry", { seq: 18, session })
      )
    ).toContain("not controllable");

    const off = feed();
    off.backend.bridge = { ...fakePage().bridge, isControllable: () => false };
    expect(
      await fails(() =>
        call(off.handlers, "ilha_model_show_entry", { seq: 18, session })
      )
    ).toContain("not controllable");
  });

  it("forgets the pause when the session clears", async () => {
    const { backend, handlers, session } = feed();
    backend.bridge = fakePage().bridge;
    await call(handlers, "ilha_model_show_entry", { seq: 18, session });
    backend.clear(session);
    expect(backend.pausedAt.has(session)).toBe(false);
  });
});

describe("gated dispatch", () => {
  it("decodes the message and delivers it through the bridge", async () => {
    const { backend, handlers, session } = feed({ dispatch: true });
    const { bridge, dispatched } = fakePage();
    backend.bridge = bridge;
    backend.noteComponent("Editor", EditorMessage);
    const instance = instanceAtPath(backend, session, "/Workspace/Editor[n1]");
    const path = "/Workspace/Editor[n1]";
    const { result } = await call(handlers, "ilha_model_dispatch", {
      instance,
      message: { _tag: "ClickedSave" },
      session,
    });
    expect(result).toEqual({ dispatched: true, instance, path, session });
    expect(dispatched).toEqual([
      { message: { _tag: "ClickedSave" }, path, session },
    ]);
  });

  it("stays unregistered unless the backend enables it", () => {
    expect(feed().handlers["ilha_model_dispatch"]).toBeUndefined();
    expect(
      feed({ dispatch: true }).handlers["ilha_model_dispatch"]
    ).not.toBeUndefined();
  });

  it("fails dispatch precisely", async () => {
    const { backend, handlers, session } = feed({ dispatch: true });
    backend.noteComponent("Editor", EditorMessage);
    const instance = instanceAtPath(backend, session, "/Workspace/Editor[n1]");
    expect(
      await fails(() =>
        call(handlers, "ilha_model_dispatch", { instance, session })
      )
    ).toContain("message is required");
    expect(
      await fails(() =>
        call(handlers, "ilha_model_dispatch", {
          instance,
          message: { _tag: "Nope" },
          session,
        })
      )
    ).toContain("failed to decode");
    expect(
      await fails(() =>
        call(handlers, "ilha_model_dispatch", {
          instance: 99,
          message: { _tag: "ClickedSave" },
          session,
        })
      )
    ).toContain("Instance 99 is not in the session's buffer");
    expect(
      await fails(() =>
        call(handlers, "ilha_model_dispatch", {
          instance,
          message: { _tag: "ClickedSave" },
          session,
        })
      )
    ).toContain("not controllable");

    const noschema = feed({ dispatch: true });
    noschema.backend.bridge = fakePage().bridge;
    expect(
      await fails(() =>
        call(noschema.handlers, "ilha_model_dispatch", {
          instance,
          message: { _tag: "ClickedSave" },
          session,
        })
      )
    ).toContain("No message schema recorded for component Editor");

    const closed = feed({ dispatch: true });
    closed.backend.noteComponent("Editor", EditorMessage);
    closed.backend.bridge = { ...fakePage().bridge, dispatch: () => false };
    expect(
      await fails(() =>
        call(closed.handlers, "ilha_model_dispatch", {
          instance,
          message: { _tag: "ClickedSave" },
          session,
        })
      )
    ).toContain("missing or closed");
  });
});
