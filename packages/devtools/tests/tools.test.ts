import { describe, expect, it } from "bun:test";

/**
 * The `ilha_model_*` tools over a backend fed with the recorded two-editor
 * Wire traces. No live model runtime is needed: the backend reads frames.
 */
import { Schema } from "effect";
import type { Json } from "effect/Schema";

import { createModelBackend, modelToolHandlers } from "../src/webmcp.ts";
import type { ModelBackend, ToolArgs, ToolHandlers } from "../src/webmcp.ts";
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

const feed = (capture: "interrupted" | "open" = "interrupted"): Feed => {
  const backend = createModelBackend();
  backend.ingest(fixtureFrames(capture));
  return {
    backend,
    handlers: modelToolHandlers(backend),
    session: fixtureSession(capture),
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

const EditorMessage = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("UpdatedDraft"), text: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("ClickedSave") }),
  Schema.Struct({ _tag: Schema.Literal("PressedEscape") }),
]);

describe("ilha_model_* tools", () => {
  it("lists the connected session", async () => {
    const { handlers } = feed();
    const { result } = await call<
      { app: string; entries: number; instances: number; session: string }[]
    >(handlers, "ilha_model_list_sessions");
    expect(result).toHaveLength(1);
    expect(result[0]?.app).toBe("Workspace");
    expect(result[0]?.instances).toBe(3);
    expect(result[0]?.entries).toBeGreaterThan(20);
    expect(result[0]?.session).toBe(fixtureSession("interrupted"));
  });

  it("fails without a session", async () => {
    const handlers = modelToolHandlers(createModelBackend());
    expect(
      await fails(() => call(handlers, "ilha_model_list_entries"))
    ).toContain("No session has connected yet");
    expect(
      await fails(() =>
        call(handlers, "ilha_model_list_entries", { session: "nope" })
      )
    ).toContain("No session nope");
  });

  it("lists instances with their paths", async () => {
    const { handlers, session } = feed();
    const { result } = await call<
      { component: string; instance: number; path: string }[]
    >(handlers, "ilha_model_list_instances", {
      session,
    });
    expect(result.map((instance) => instance.path)).toEqual([
      "/Workspace",
      "/Workspace/Editor[n1]",
      "/Workspace/Editor[n2]",
    ]);
    expect(result.map((instance) => instance.component)).toEqual([
      "Workspace",
      "Editor",
      "Editor",
    ]);
  });

  it("lists entries newest-first, or oldest-first after a cursor", async () => {
    const { handlers, session } = feed();
    const all = await call<{ rows: { seq: number }[]; total: number }>(
      handlers,
      "ilha_model_list_entries",
      {
        session,
      }
    );
    expect(all.result.total).toBeGreaterThan(20);
    expect(all.result.rows).toHaveLength(all.result.total);
    const seqs = all.result.rows.map((row) => row.seq);
    expect([...seqs].toSorted((a, b) => a - b)).toEqual(seqs);

    const messages = await call<{ rows: { tag: string }[]; total: number }>(
      handlers,
      "ilha_model_list_entries",
      {
        filter: "messages",
        session,
      }
    );
    expect(messages.result.total).toBeLessThan(all.result.total);
    expect(
      messages.result.rows.every((row) =>
        [
          "Update",
          "Mounted",
          "Waiting",
          "Failed",
          "LayerFailed",
          "PropsChanged",
          "QueryChanged",
        ].includes(row.tag)
      )
    ).toBe(true);

    const commands = await call<{ total: number }>(
      handlers,
      "ilha_model_list_entries",
      {
        filter: "commands",
        session,
      }
    );
    expect(commands.result.total).toBeGreaterThan(messages.result.total);

    const saves = await call<{ rows: { label: string }[]; total: number }>(
      handlers,
      "ilha_model_list_entries",
      {
        session,
        tag: "ClickedSave",
      }
    );
    expect(saves.result.total).toBe(2);
    expect(saves.result.rows[0]?.label).toContain("ClickedSave");

    const page = await call<{ rows: { seq: number }[]; total: number }>(
      handlers,
      "ilha_model_list_entries",
      {
        after: 20,
        limit: 3,
        session,
      }
    );
    expect(page.result.rows.map((row) => row.seq)).toEqual([21, 22, 23]);
  });

  it("validates entry listing params", async () => {
    const { handlers, session } = feed();
    expect(
      await fails(() =>
        call(handlers, "ilha_model_list_entries", { limit: 0, session })
      )
    ).toContain("limit must be an integer between 1 and 500");
    expect(
      await fails(() =>
        call(handlers, "ilha_model_list_entries", { limit: 501, session })
      )
    ).toContain("limit must be an integer between 1 and 500");
    expect(
      await fails(() =>
        call(handlers, "ilha_model_list_entries", { filter: "nope", session })
      )
    ).toContain('filter must be "messages", "commands" or "all"');
  });

  it("counts entries by tag and by message", async () => {
    const { handlers, session } = feed();
    const { result } = await call<{
      entries: Record<string, number>;
      messages: Record<string, number>;
    }>(handlers, "ilha_model_count_entries", {
      session,
    });
    expect(result.entries["Update"]).toBe(10);
    expect(result.entries["CommandStarted"]).toBe(2);
    expect(result.messages["ClickedSave"]).toBe(2);
    expect(result.messages["PressedEscape"]).toBe(2);

    const scoped = await call<{ entries: Record<string, number> }>(
      handlers,
      "ilha_model_count_entries",
      {
        instance: 2,
        session,
      }
    );
    expect(scoped.result.entries["Update"]).toBe(5);
  });

  it("returns one entry, or a subtree of it", async () => {
    const { handlers, session } = feed();
    const { result } = await call<{ _tag: string; message: { _tag: string } }>(
      handlers,
      "ilha_model_get_entry",
      {
        seq: 18,
        session,
      }
    );
    expect(result._tag).toBe("Update");
    expect(result.message).toEqual({ _tag: "ClickedSave" });

    const sub = await call<unknown>(handlers, "ilha_model_get_entry", {
      path: ["message"],
      seq: 18,
      session,
    });
    expect(sub.result).toEqual({ _tag: "ClickedSave" });

    expect(
      await fails(() =>
        call(handlers, "ilha_model_get_entry", { seq: 999, session })
      )
    ).toContain("Entry #999 is not in the session's buffer");
    expect(
      await fails(() =>
        call(handlers, "ilha_model_get_entry", {
          path: ["nope"],
          seq: 18,
          session,
        })
      )
    ).toContain("Path [nope] does not exist");
  });

  it("diffs an update against the previous state entry", async () => {
    const { handlers, session } = feed();
    const { result: diffed } = await call<{
      changes: { kind: string; path: (string | number)[] }[];
      from: number;
    }>(handlers, "ilha_model_diff_state", {
      seq: 18,
      session,
    });
    expect(diffed.from).toBe(17);
    expect(diffed.changes.length).toBeGreaterThan(0);
    expect(diffed.changes[0]?.path).toEqual(["status"]);
  });

  it("outlines results over 24 KB", async () => {
    const backend = createModelBackend();
    backend.ingest([
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- the literal is a complete Update frame; the unknown hop is the only sound cast.
      {
        _tag: "Update",
        at: 1,
        boundary: 1,
        causedBy: 1,
        commands: [],
        component: "Big",
        events: [],
        instance: 9,
        lists: [],
        message: { _tag: "Ping" },
        model: { blob: "x".repeat(30_000) },
        path: "/Big",
        props: {},
        queries: {},
        sends: [],
        seq: 100,
        session: "big",
        source: { _tag: "Dispatch" },
      } as unknown as WireEntry,
    ]);
    const handlers = modelToolHandlers(backend);
    const { result } = await call<Record<string, Json>>(
      handlers,
      "ilha_model_get_entry",
      {
        seq: 100,
        session: "big",
      }
    );
    expect(result["~outline"]).toBe(true);
    expect(result["bytes"]).toBeGreaterThan(24_000);
  });

  it("returns the causal chain of an issuing update", async () => {
    const { handlers, session } = feed();
    const { result } = await call<
      { seq: number; step: string; summary: string }[]
    >(handlers, "ilha_model_get_chain", {
      seq: 18,
      session,
    });
    const steps = result.map((step) => step.step);
    expect(steps).toContain("source");
    expect(steps).toContain("entry");
    expect(steps).toContain("command");
    expect(steps).toContain("started");
    expect(steps).toContain("end");
    const command = result.find((step) => step.step === "command");
    expect(command?.seq).toBe(18);

    const { result: run } = await call<
      { seq: number; step: string; summary: string }[]
    >(handlers, "ilha_model_get_chain", {
      seq: 19,
      session,
    });
    expect(run.map((step) => step.step)).toContain("issued");
    expect(run.find((step) => step.step === "issued")?.seq).toBe(18);
  });

  it("reads state at an entry and diffs it", async () => {
    const { handlers, session } = feed();
    const { result: state } = await call<{ model: unknown; path: string }>(
      handlers,
      "ilha_model_get_state",
      {
        instance: 2,
        session,
      }
    );
    expect(state.path).toBe("/Workspace/Editor[n1]");
    expect(state.model).toBeDefined();

    const gone = await call<{ unmounted?: string }>(
      handlers,
      "ilha_model_get_state",
      {
        at: 29,
        instance: 3,
        session,
      }
    );
    expect(gone.result.unmounted).toBe("unmounted at #29");

    const tiny = createModelBackend({ size: 5 });
    tiny.ingest(fixtureFrames("interrupted"));
    const tinyHandlers = modelToolHandlers(tiny);
    expect(
      await fails(() =>
        call(tinyHandlers, "ilha_model_get_state", {
          at: 1,
          instance: 2,
          session,
        })
      )
    ).toContain("is older than the last 5 entries");

    const { result: first } = await call<{ first: boolean }>(
      handlers,
      "ilha_model_diff_state",
      {
        seq: 3,
        session,
      }
    );
    expect(first.first).toBe(true);

    expect(
      await fails(() =>
        call(handlers, "ilha_model_diff_state", { seq: 19, session })
      )
    ).toContain("is not a Waiting, Mounted or Update entry held");
  });

  it("returns the message schema of an instance's component", async () => {
    const { backend, handlers, session } = feed();
    backend.noteComponent("Editor", EditorMessage);
    const { result } = await call<{ schema: { anyOf: unknown[] } }>(
      handlers,
      "ilha_model_get_message_schema",
      {
        instance: 2,
        session,
      }
    );
    expect(result.schema.anyOf).toHaveLength(3);

    const { result: narrowed } = await call<Record<string, Json>>(
      handlers,
      "ilha_model_get_message_schema",
      { instance: 2, session, tag: "ClickedSave" }
    );
    expect(JSON.stringify(narrowed)).toContain("ClickedSave");

    expect(
      await fails(() =>
        call(handlers, "ilha_model_get_message_schema", {
          instance: 2,
          session,
          tag: "Nope",
        })
      )
    ).toContain("Message tag Nope is not in Editor's message schema");
    expect(
      await fails(() =>
        call(handlers, "ilha_model_get_message_schema", {
          instance: 99,
          session,
        })
      )
    ).toContain("Instance 99 is not in the session's buffer");
  });

  it("waits for open runs, scoped or not", async () => {
    const open = feed("open");
    const waiting = await call<{ open: { name: string }[]; settled: boolean }>(
      open.handlers,
      "ilha_model_wait",
      {
        session: open.session,
        timeout: 50,
      }
    );
    expect(waiting.result.settled).toBe(false);
    expect(waiting.result.open).toHaveLength(1);
    expect(waiting.result.open[0]?.name).toBe("notes/SaveNote");

    const scoped = await call<{ settled: boolean }>(
      open.handlers,
      "ilha_model_wait",
      {
        instance: 1,
        session: open.session,
        timeout: 50,
      }
    );
    expect(scoped.result.settled).toBe(true);

    const done = feed("interrupted");
    const settled = await call<{ settled: boolean }>(
      done.handlers,
      "ilha_model_wait",
      {
        session: done.session,
        timeout: 50,
      }
    );
    expect(settled.result.settled).toBe(true);
  });

  it("hides excluded message tags from the timeline but keeps their state", async () => {
    const backend = createModelBackend({ exclude: ["PressedEscape"] });
    backend.ingest(fixtureFrames("interrupted"));
    const handlers = modelToolHandlers(backend);
    const session = fixtureSession("interrupted");
    const { result } = await call<{ total: number }>(
      handlers,
      "ilha_model_list_entries",
      {
        session,
        tag: "PressedEscape",
      }
    );
    expect(result.total).toBe(0);
    const { result: state } = await call<{ model: unknown }>(
      handlers,
      "ilha_model_get_state",
      {
        instance: 2,
        session,
      }
    );
    expect(state.model).toBeDefined();
  });
});
