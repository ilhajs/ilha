/**
 * Ported from `Inspector.test.ts` in `Effect-TS/ui` (`packages/ui-devtools`),
 * plus coverage for the state-history fold that time travel reads.
 *
 * The `Failed`-narrows-the-run case upstream drives a live `TestHost`; here
 * the same entries are written by hand, since `@ilha/model` belongs to
 * another slice. Everything else replays the recorded `two-editor` traces.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";

import type * as Schema from "effect/Schema";

import type {
  History,
  Inspector,
  Link,
  Session,
  Summary,
} from "../src/inspector.ts";
import { diff, make, makeHistory } from "../src/inspector.ts";
import type { InterruptReason, Issued, WireEntry } from "../src/wire.ts";

type Capture = "interrupted" | "open" | "closed" | "switched";
type Update = Extract<WireEntry, { readonly _tag: "Update" }>;

const raw: unknown = JSON.parse(
  fs.readFileSync(
    new URL("fixtures/two-editor-traces.wire-v1.json", import.meta.url),
    "utf-8"
  )
);
// oxlint-disable-next-line anti-slop/no-runtime-typeof -- fixture parse guard; the cast below names the checked-in shape.
if (typeof raw !== "object" || raw === null) {
  throw new Error("two-editor traces fixture is not an object");
}
interface FixtureFrame {
  readonly _tag: string;
}
// SAFETY: the fixture file is checked in; each capture holds frames the recorder wrote as WireEntry.
const traces = raw as Record<string, FixtureFrame[]>;

const frames = (capture: Capture): readonly WireEntry[] => {
  const list = traces[capture];
  if (list === undefined) {
    throw new Error(`missing capture ${capture}`);
  }
  // SAFETY: the filter drops Hello frames; the recorder wrote the rest as WireEntry.
  return list.filter((frame) => frame._tag !== "Hello") as WireEntry[];
};

const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) {
    throw new Error(`expected ${what}`);
  }
  return value;
};

interface Loaded {
  readonly commandReasons: (label: string) => (string | undefined)[];
  readonly entries: readonly WireEntry[];
  readonly entry: <Tag extends WireEntry["_tag"]>(
    seq: number | undefined,
    tag: Tag
  ) => Extract<WireEntry, { readonly _tag: Tag }>;
  readonly inspector: Inspector;
  readonly instanceOf: (label: string) => Summary;
  readonly session: Session;
  readonly updates: (label: string, message: string) => Update[];
}

const load = (capture: Capture, size?: number): Loaded => {
  const inspector = make(size === undefined ? undefined : { size });
  inspector.ingest(frames(capture));
  const session = must(inspector.sessions()[0], "a session");
  const entries = session.entries();
  const instanceOf = (label: string): Summary => {
    const found = session
      .instances()
      .find((instance) => instance.path.endsWith(label));
    const summary =
      found === undefined ? undefined : session.summary(found.instance);
    return must(summary, `instance ${label}`);
  };
  const updates = (label: string, message: string): Update[] =>
    entries.filter(
      (entry): entry is Update =>
        entry._tag === "Update" &&
        entry.path.endsWith(label) &&
        // SAFETY: the entry is narrowed to Update above; the predicate compares its message tag.
        (entry.message as { _tag: string })._tag === message
    );
  const entry = <Tag extends WireEntry["_tag"]>(
    seq: number | undefined,
    tag: Tag
  ): Extract<WireEntry, { readonly _tag: Tag }> => {
    const resolved = session.resolve(must(seq, "a seq"));
    expect(resolved._tag).toBe(tag);
    // SAFETY: the expect above verified resolved._tag is Tag; the cast narrows to that member.
    return resolved as Extract<WireEntry, { readonly _tag: Tag }>;
  };
  const commandReasons = (label: string): (string | undefined)[] =>
    session
      .records(instanceOf(label).instance)
      .filter((record) => record.kind === "command")
      .map((record) => record.reason);
  return {
    commandReasons,
    entries,
    entry,
    inspector,
    instanceOf,
    session,
    updates,
  };
};

const runs = (session: Session): unknown[] =>
  session
    .records()
    .map((record) => [
      record.name,
      record.issued?.index,
      record.end,
      record.reason,
    ]);
const paths = (summaries: readonly Summary[]): string[] =>
  summaries.map((summary) => summary.path);
const numbers = (summaries: readonly Summary[]): number[] =>
  summaries.map((summary) => summary.instance);
const root = (seq: number, model: Schema.Json): WireEntry => ({
  _tag: "Mounted",
  adopted: false,
  at: seq,
  commands: [],
  component: "App",
  events: [],
  instance: 1,
  model,
  path: "/App",
  props: { title: "t" },
  seq,
  session: "s",
});
const historyUpdate = (seq: number, model: Schema.Json): WireEntry => ({
  _tag: "Update",
  at: seq,
  commands: [],
  component: "App",
  events: [],
  instance: 1,
  lists: [],
  message: { _tag: "Moved" },
  model,
  path: "/App",
  props: {},
  sends: [],
  seq,
  session: "s",
  source: { _tag: "Dispatch" },
});
describe("Inspector", () => {
  it("follows Editor[n2]'s Save to the Escape that interrupted it, and back", () => {
    const { commandReasons, entry, instanceOf, session, updates } =
      load("interrupted");
    const n2 = instanceOf("Editor[n2]");

    expect(session.app).toBe("Workspace");
    expect(commandReasons("Editor[n1]")).toEqual(["ended"]);
    expect(commandReasons("Editor[n2]")).toEqual(["interrupt"]);
    expect(instanceOf("Editor[n1]").unmounted).toBeUndefined();

    const [save] = updates("Editor[n2]", "ClickedSave");
    const clicked = must(save, "the ClickedSave update");
    expect(clicked.source).toEqual({ _tag: "DomEvent", name: "click" });
    expect(clicked.commands[0]?.name).toBe("notes/SaveNote");
    const run = must(session.run({ index: 0, seq: clicked.seq }), "the run");
    const started = entry(run.start, "CommandStarted");
    expect(started.spanId).toMatch(/^[0-9a-f]{16}$/u);
    const interrupted = entry(run.end, "CommandInterrupted");
    expect(interrupted.reason).toBe("interrupt");
    expect(run.reason).toBe("interrupt");

    const escape = entry(interrupted.causedBy, "Update");
    expect(escape.message).toEqual({ _tag: "PressedEscape" });
    expect(escape.instance).toBe(n2.instance);
    expect(escape.commands).toEqual([
      {
        _tag: "Interrupt",
        args: null,
        group: must(clicked.commands[0], "the issue").group,
        name: "notes/SaveNote",
      },
    ]);
    const source = session
      .back(escape.seq)
      .find((link) => link.rel === "source");
    const subscription = entry(source?.seq, "SubscriptionStarted");
    expect(subscription.instance).toBe(n2.instance);
    expect(subscription.name).toBe("@effect/ui/html/document");
    expect(subscription.deps).toEqual(["keydown"]);

    expect(entry(interrupted.issued.seq, "Update")).toBe(clicked);
    expect(session.forward(clicked.seq)).toEqual([
      { rel: "causedBy", seq: started.seq },
      { index: 0, rel: "issued", seq: started.seq },
      { index: 0, rel: "issued", seq: interrupted.seq },
    ]);
    expect(session.forward(escape.seq)).toEqual([
      {
        rel: "causedBy",
        seq: interrupted.seq,
      },
    ]);

    const previous = must(session.previous(clicked.seq), "a previous entry");
    const before = entry(previous.seq, "Update");
    expect(before.message).toEqual({
      _tag: "UpdatedDraft",
      text: "Follow the command",
    });
    expect(previous.changed).toBe(true);
    expect(diff(before.model, clicked.model)).toEqual([
      { after: "Saving", before: "Dirty", kind: "changed", path: ["status"] },
    ]);
    expect(diff(before.props, clicked.props)).toEqual([
      {
        after: { "~redacted": true },
        before: { "~redacted": true },
        kind: "unknown",
        path: ["token"],
      },
    ]);

    const lifecycle = session
      .records(n2.instance)
      .filter((record) => record.kind !== "command");
    expect(
      lifecycle.map((record) => [record.kind, record.name, record.reason])
    ).toEqual([
      ["layer", "Editor", "ready"],
      ["subscription", "@effect/ui/html/document", "unmount"],
      ["mount", "FocusBody", "completed"],
    ]);
    expect(lifecycle[1]?.end).toBe(n2.unmounted);
    entry(n2.unmounted, "Unmounted");
  });

  it("reads the other captures as unmount, switch and still running", () => {
    const closed = load("closed");
    const [closedSave] = closed.updates("Editor[n2]", "ClickedSave");
    const save = must(closedSave, "the closed ClickedSave update");
    const unmounted = closed.entry(
      closed.session.run({ index: 0, seq: save.seq })?.end,
      "CommandInterrupted"
    );
    expect(unmounted.reason).toBe("unmount");
    expect(closed.entry(unmounted.causedBy, "Update").message).toEqual({
      _tag: "ClickedClose",
      noteId: "n2",
    });
    expect(
      closed.entry(closed.instanceOf("Editor[n2]").unmounted, "Unmounted")
        .causedBy
    ).toBe(unmounted.causedBy);

    const switched = load("switched");
    const [first, second] = switched.updates("Editor[n2]", "ClickedSave");
    const firstSave = must(first, "the first ClickedSave update");
    const cut = switched.entry(
      switched.session.run({ index: 0, seq: firstSave.seq })?.end,
      "CommandInterrupted"
    );
    expect(cut.reason).toBe("switch");
    expect(cut.causedBy).toBe(
      must(second, "the second ClickedSave update").seq
    );
    expect(switched.commandReasons("Editor[n2]")).toEqual([
      "switch",
      undefined,
    ]);

    const open = load("open");
    const [hung] = open.updates("Editor[n2]", "ClickedSave");
    const hungSave = must(hung, "the open ClickedSave update");
    const run = must(
      open.session.run({ index: 0, seq: hungSave.seq }),
      "the open run"
    );
    expect(open.entry(run.start, "CommandStarted").spanId).toMatch(
      /^[0-9a-f]{16}$/u
    );
    expect(run.end).toBeUndefined();
    expect(run.reason).toBeUndefined();
  });

  it("keeps each interruption reason, and gives no start to a run the log has none for", () => {
    const base = { component: "App", instance: 1, path: "/App", session: "s" };
    const reasons = [
      "interrupt",
      "switch",
      "unmount",
      "layer",
      "self",
    ] as const;
    const command = {
      _tag: "Effect" as const,
      args: null,
      group: null,
      name: "Save",
    };
    const issue: WireEntry = {
      ...base,
      _tag: "Update",
      at: 0,
      commands: [...reasons.map(() => command), command],
      events: [],
      lists: [],
      message: null,
      model: null,
      props: null,
      sends: [],
      seq: 1,
      source: { _tag: "Dispatch" },
    };
    const started: WireEntry = {
      ...base,
      _tag: "CommandStarted",
      at: 1,
      issued: { index: 0, seq: 1 },
      name: "Save",
      seq: 2,
      spanId: "a",
      traceId: "b",
    };
    const interrupted = (
      seq: number,
      issued: Issued,
      reason: InterruptReason
    ): WireEntry => ({
      ...base,
      _tag: "CommandInterrupted",
      at: 2,
      issued,
      name: "Save",
      reason,
      seq,
      spanId: issued.index === 0 ? "a" : null,
      traceId: issued.index === 0 ? "b" : null,
    });
    const inspector = make();
    inspector.ingest([
      issue,
      started,
      ...reasons.map((reason, index) =>
        interrupted(3 + index, { index, seq: 1 }, reason)
      ),
      interrupted(8, { index: 0, seq: 0 }, "interrupt"),
    ]);
    const session = must(inspector.sessions()[0], "a session");

    expect(
      session
        .records(1)
        .map((record) => [
          record.issued?.index,
          record.start,
          record.end,
          record.reason,
        ])
    ).toEqual([
      [0, 2, 3, "interrupt"],
      [1, undefined, 4, "switch"],
      [2, undefined, 5, "unmount"],
      [3, undefined, 6, "layer"],
      [4, undefined, 7, "self"],
      [5, undefined, undefined, undefined],
    ]);
    expect(session.run({ index: 0, seq: 0 })).toBeUndefined();
  });

  it("ends only the run a Failed names, of two running the same Command", () => {
    const base = { component: "App", instance: 1, path: "/App", session: "s" };
    const save = {
      _tag: "Effect" as const,
      args: null,
      group: null,
      name: "test/Save",
    };
    const mounted: WireEntry = {
      ...base,
      _tag: "Mounted",
      adopted: false,
      at: 0,
      commands: [save, save],
      events: [],
      model: null,
      props: {},
      seq: 1,
    };
    const started: WireEntry = {
      ...base,
      _tag: "CommandStarted",
      at: 1,
      issued: { index: 0, seq: 1 },
      name: "test/Save",
      seq: 2,
      spanId: "a",
      traceId: "b",
    };
    const failed: WireEntry = {
      ...base,
      _tag: "Failed",
      at: 2,
      cause: { pretty: "boom", reasons: [] },
      in: "command",
      issued: { index: 1, seq: 1 },
      name: "test/Save",
      props: {},
      seq: 3,
    };
    const linked: Link = { index: 1, rel: "issued", seq: failed.seq };

    const inspector = make();
    inspector.ingest([mounted, started, failed]);
    const session = must(inspector.sessions()[0], "a session");
    expect(runs(session)).toEqual([
      ["test/Save", 0, undefined, undefined],
      ["test/Save", 1, failed.seq, "failed"],
    ]);
    expect(session.back(failed.seq)).toContainEqual({
      index: 1,
      rel: "issued",
      seq: mounted.seq,
    });
    expect(session.forward(mounted.seq)).toContainEqual(linked);

    inspector.ingest([
      {
        ...base,
        _tag: "CommandInterrupted",
        at: 3,
        issued: { index: 0, seq: 1 },
        name: "test/Save",
        reason: "unmount",
        seq: 4,
        spanId: "a",
        traceId: "b",
      },
      { ...base, _tag: "Unmounted", at: 4, seq: 5 },
    ]);
    const other = must(session.run({ index: 0, seq: mounted.seq }), "run 0");
    expect([
      session.resolve(must(other.end, "an end"))._tag,
      other.reason,
    ]).toEqual(["CommandInterrupted", "unmount"]);
    expect(session.run({ index: 1, seq: mounted.seq })?.end).toBe(failed.seq);

    // SAFETY: failed was built as the Failed member above; dropping issued tests the unlinked path.
    const { issued: _issued, ...unlinked } = failed as Extract<
      WireEntry,
      { readonly _tag: "Failed" }
    >;
    expect(_issued).toEqual({ index: 1, seq: 1 });
    const unnamed = make();
    unnamed.ingest([mounted, started, unlinked]);
    const unnamedSession = must(unnamed.sessions()[0], "a session");
    expect(runs(unnamedSession)).toEqual([
      ["test/Save", 0, undefined, undefined],
      ["test/Save", 1, undefined, undefined],
    ]);
    expect(unnamedSession.forward(mounted.seq)).not.toContainEqual(linked);
  });

  it("drops entries past its size and keeps what is still open", () => {
    const { entries, inspector, instanceOf, session } = load("interrupted", 6);
    const n1 = instanceOf("Editor[n1]");

    expect(entries.map((entry) => entry.seq)).toEqual([24, 25, 26, 27, 28, 29]);
    expect(session.resolve(21)).toEqual({ _tag: "Outside", seq: 21 });
    expect(session.forward(21)).toEqual([
      {
        index: 0,
        rel: "issued",
        seq: 27,
      },
    ]);
    expect(
      session
        .records(n1.instance)
        .map((record) => [record.kind, record.start, record.end, record.reason])
    ).toEqual([
      ["subscription", 5, undefined, undefined],
      ["command", 19, 24, "ended"],
    ]);

    inspector.ingest(frames("interrupted"));
    expect(session.entries().length).toBe(6);

    session.clear();
    expect(session.entries()).toEqual([]);
    expect(session.instances().map((instance) => instance.path)).toEqual([
      "/Workspace",
      "/Workspace/Editor[n1]",
    ]);
    expect(
      session.records().map((record) => [record.kind, record.start])
    ).toEqual([["subscription", 5]]);
  });

  it("compares a Model only with a state entry the buffer holds", () => {
    const full = load("interrupted");
    const [last] = full.updates("Editor[n1]", "PressedEscape");
    const latest = must(last, "the last PressedEscape update");
    const later = (seq: number): WireEntry => ({ ...latest, seq });

    const small = load("interrupted", 3);
    expect(small.session.resolve(latest.seq)).toEqual({
      _tag: "Outside",
      seq: latest.seq,
    });
    small.inspector.ingest([later(30), later(31)]);
    expect(small.session.previous(30)).toEqual({ seq: latest.seq });
    expect(small.session.previous(31)).toEqual({
      changed: false,
      seq: 30,
    });
    small.inspector.ingest([later(32), later(33)]);
    expect(small.session.resolve(30)).toEqual({ _tag: "Outside", seq: 30 });
    expect(small.session.previous(31)).toEqual({
      changed: false,
      seq: 30,
    });

    full.session.clear();
    expect(full.session.resolve(latest.seq)).toEqual({
      _tag: "Outside",
      seq: latest.seq,
    });
    full.inspector.ingest([later(30)]);
    expect(full.session.previous(30)).toEqual({
      changed: false,
      model: latest.model,
      props: latest.props,
      seq: latest.seq,
    });
  });

  it("coalesces excluded updates per instance without evicting shown entries", () => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- the mounted/update factories below capture base; keeping the cluster together reads as one fixture.
    const base = (instance: number, path: string, component: string) => ({
      component,
      instance,
      path,
      session: "s",
    });
    const mounted = (
      seq: number,
      instance: number,
      path: string,
      component: string,
      model: Schema.Json
    ): WireEntry => ({
      ...base(instance, path, component),
      _tag: "Mounted",
      adopted: false,
      at: seq,
      commands: [],
      events: [],
      model,
      props: {},
      seq,
    });
    const update = (
      seq: number,
      instance: number,
      path: string,
      component: string,
      tag: string,
      model: Schema.Json,
      causedBy?: number | undefined
    ): WireEntry => ({
      ...base(instance, path, component),
      _tag: "Update",
      at: seq,
      ...(causedBy === undefined ? undefined : { causedBy }),
      commands: [],
      events: [],
      lists: [],
      message: { _tag: tag },
      model,
      props: {},
      sends: [],
      seq,
      source: { _tag: "Dispatch" },
    });

    const inspector = make({ exclude: ["Moved"], size: 3 });
    inspector.ingest([
      mounted(1, 1, "/A", "A", { n: 0, x: 0 }),
      mounted(2, 2, "/B", "B", { y: 0 }),
      update(3, 1, "/A", "A", "Clicked", { n: 1, x: 0 }),
    ]);
    const session = must(inspector.sessions()[0], "a session");
    expect(session.entries().map((entry) => entry.seq)).toEqual([1, 2, 3]);

    for (let i = 1; i <= 20; i += 1) {
      inspector.ingest([update(3 + i, 1, "/A", "A", "Moved", { n: 1, x: i })]);
    }
    inspector.ingest([update(24, 2, "/B", "B", "Moved", { y: 5 }, 4)]);
    expect(session.entries().map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(session.resolve(4)).toEqual({ _tag: "Outside", seq: 4 });
    expect(session.resolve(23)._tag).toBe("Update");
    expect(session.back(24)).toEqual([{ rel: "causedBy", seq: 4 }]);

    inspector.ingest([update(25, 2, "/B", "B", "Clicked", { y: 6 })]);
    inspector.ingest([update(26, 1, "/A", "A", "Moved", { n: 1, x: 99 })]);
    expect(session.resolve(23)._tag).toBe("Update");
    expect(session.resolve(26)._tag).toBe("Update");
    expect(session.entries().map((entry) => entry.seq)).toEqual([2, 3, 25]);

    inspector.ingest([update(27, 1, "/A", "A", "Clicked", { n: 2, x: 99 })]);
    expect(session.entries().map((entry) => entry.seq)).toEqual([3, 25, 27]);
    expect(session.previous(27)).toEqual({ changed: true, seq: 26 });
    // SAFETY: an Update was recorded at seq 26 above, so the resolve hits it.
    expect((session.resolve(26) as Update).model).toEqual({ n: 1, x: 99 });

    inspector.ingest([update(28, 1, "/A", "A", "Moved", { n: 2, x: 100 })]);
    session.clear();
    expect(session.entries()).toEqual([]);
    inspector.ingest([update(29, 1, "/A", "A", "Clicked", { n: 3, x: 100 })]);
    expect(session.previous(29)).toEqual({
      changed: true,
      model: { n: 2, x: 100 },
      props: {},
      seq: 28,
    });

    const quiet = make({ size: 2 });
    quiet.ingest([
      mounted(1, 1, "/A", "A", { a: 0 }),
      mounted(2, 2, "/B", "B", { b: 0 }),
      update(3, 2, "/B", "B", "Clicked", { b: 1 }),
    ]);
    const quietSession = must(quiet.sessions()[0], "a session");
    expect(quietSession.resolve(1)).toEqual({ _tag: "Outside", seq: 1 });
    quietSession.clear();
    expect(quietSession.resolve(1)).toEqual({ _tag: "Outside", seq: 1 });
    quiet.ingest([update(4, 1, "/A", "A", "Clicked", { a: 1 })]);
    expect(quietSession.previous(4)).toEqual({
      changed: true,
      model: { a: 0 },
      props: {},
      seq: 1,
    });

    const late = make({ exclude: ["Moved"] });
    late.ingest([
      update(10, 1, "/A", "A", "Moved", { a: 1 }),
      update(11, 2, "/B", "B", "Moved", { b: 1 }),
      update(12, 1, "/A", "A", "Moved", { a: 2 }),
    ]);
    expect(
      late
        .sessions()[0]
        ?.instances()
        .map((instance) => instance.path)
    ).toEqual(["/A", "/B"]);
  });

  it("summarizes instances as entries arrive and leave", () => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- the mounted/update factories below capture base; keeping the cluster together reads as one fixture.
    const base = (seq: number, instance: number, path: string) => ({
      at: seq,
      component:
        /(?<component>[^/[]+)\[[^\]]*\]$/u.exec(path)?.groups?.["component"] ??
        path.slice(1),
      instance,
      path,
      seq,
      session: "s",
    });
    const mounted = (
      seq: number,
      instance: number,
      path: string,
      commands: string[] = []
    ): WireEntry => ({
      ...base(seq, instance, path),
      _tag: "Mounted",
      adopted: false,
      commands: commands.map((name) => ({
        _tag: "Effect",
        args: null,
        group: null,
        name,
      })),
      events: [],
      model: null,
      props: {},
    });
    const update = (
      seq: number,
      instance: number,
      path: string,
      tag: string
    ): WireEntry => ({
      ...base(seq, instance, path),
      _tag: "Update",
      commands: [],
      events: [],
      lists: [],
      message: { _tag: tag },
      model: null,
      props: {},
      sends: [],
      source: { _tag: "Dispatch" },
    });
    const save = { index: 0, seq: 4 };
    const inspector = make({ exclude: ["Moved"] });
    inspector.ingest([
      mounted(1, 1, "/App"),
      mounted(2, 2, "/App/List[]"),
      mounted(3, 3, "/App/List[]/Group[g]"),
      mounted(4, 4, "/App/List[]/Group[g]/Row[r1]", ["test/Save"]),
      {
        ...base(5, 4, "/App/List[]/Group[g]/Row[r1]"),
        _tag: "CommandStarted",
        issued: save,
        name: "test/Save",
        spanId: "",
        traceId: "",
      },
    ]);
    const session = must(inspector.sessions()[0], "a session");

    expect(session.instanceCount()).toBe(4);
    expect(must(session.summary(1), "App summary").below).toEqual({
      failing: 0,
      instances: 3,
      running: 1,
    });

    inspector.ingest([
      update(6, 2, "/App/List[]", "Clicked"),
      {
        ...base(7, 4, "/App/List[]/Group[g]/Row[r1]"),
        _tag: "CommandDropped",
        issued: save,
        name: "test/Save",
        reason: "server",
      },
      update(8, 3, "/App/List[]/Group[g]", "Moved"),
    ]);
    const row = must(session.summary(4), "row summary");
    expect([row.waiting, row.running, row.ended, row.latest]).toEqual([
      0,
      0,
      [{ count: 1, reason: "server" }],
      7,
    ]);
    expect(must(session.summary(1), "App summary").below).toEqual({
      failing: 1,
      instances: 3,
      running: 0,
    });
    expect(paths(session.active())).toEqual([
      "/App/List[]/Group[g]/Row[r1]",
      "/App/List[]",
    ]);
    expect(numbers(session.children())).toEqual([1]);
    expect(numbers(session.children(2))).toEqual([3]);
    expect(paths(session.find("row[R"))).toEqual([
      "/App/List[]/Group[g]/Row[r1]",
    ]);
    expect(paths(session.find("group"))).toEqual(["/App/List[]/Group[g]"]);

    session.clear();
    expect(session.active()).toEqual([]);
    expect(must(session.summary(4), "row summary").ended).toEqual([]);
    expect(must(session.summary(4), "row summary").latest).toBeUndefined();
    expect(must(session.summary(1), "App summary").below).toEqual({
      failing: 0,
      instances: 3,
      running: 0,
    });

    inspector.ingest([
      mounted(9, 5, "/App/Doc[a/b]"),
      mounted(10, 6, "/App/Doc[a/b]/[body]/Note[n]"),
      { ...base(11, 4, "/App/List[]/Group[g]/Row[r1]"), _tag: "Unmounted" },
      { ...base(12, 3, "/App/List[]/Group[g]"), _tag: "Unmounted" },
      mounted(13, 7, "/App/List[]/Group[g]"),
      mounted(14, 8, "/App/List[]/Group[g]/Row[r2]"),
    ]);
    expect(numbers(session.children())).toEqual([1]);
    expect(numbers(session.children(1))).toEqual([2, 5]);
    expect(numbers(session.children(5))).toEqual([6]);
    expect(numbers(session.children(2))).toEqual([3, 7]);
    expect(numbers(session.children(3))).toEqual([4]);
    expect(numbers(session.children(7))).toEqual([8]);
    expect(must(session.summary(8), "row summary").parent).toBe(7);
    expect(must(session.summary(7), "group summary").below.instances).toBe(1);
    expect(must(session.summary(1), "App summary").below.instances).toBe(7);
    expect(numbers(session.find("doc[a/b]"))).toEqual([5]);
    expect(numbers(session.find("note["))).toEqual([6]);
  });

  it("diffs nested values by key and by index", () => {
    expect(
      diff(
        { draft: { text: "a" }, open: ["n1", "n2"], saved: null },
        { draft: { size: 1, text: "a" }, open: ["n1"], viewers: 2 }
      )
    ).toEqual([
      { after: 1, kind: "added", path: ["draft", "size"] },
      { before: "n2", kind: "removed", path: ["open", 1] },
      { before: null, kind: "removed", path: ["saved"] },
      { after: 2, kind: "added", path: ["viewers"] },
    ]);
  });
});

describe("History", () => {
  it("folds each instance's Model, props and queries at a seq", () => {
    const history: History = makeHistory(100);
    history.record(root(1, { count: 0 }));
    history.record({
      _tag: "QueryChanged",
      at: 2,
      component: "App",
      instance: 1,
      name: "notes",
      path: "/App",
      result: ["n1"],
      seq: 2,
      session: "s",
    });
    history.record({
      _tag: "Update",
      at: 3,
      commands: [],
      component: "App",
      events: [],
      instance: 1,
      lists: [],
      message: { _tag: "Clicked" },
      model: { count: 1 },
      path: "/App",
      props: { title: "t" },
      sends: [],
      seq: 3,
      session: "s",
      source: { _tag: "Dispatch" },
    });
    history.record({
      _tag: "PropsChanged",
      at: 4,
      component: "App",
      instance: 1,
      path: "/App",
      props: { title: "next" },
      seq: 4,
      session: "s",
    });

    expect(history.holds("s", 1)).toBe(true);
    expect(history.at("s", 1)?.("/App")).toEqual({
      model: { count: 0 },
      props: { title: "t" },
      queries: undefined,
    });
    expect(history.at("s", 3)?.("/App")).toEqual({
      model: { count: 1 },
      props: { title: "t" },
      queries: { notes: ["n1"] },
    });
    expect(history.at("s", 4)?.("/App")).toEqual({
      model: { count: 1 },
      props: { title: "next" },
      queries: { notes: ["n1"] },
    });
    expect(history.instanceAt("s", 4, 1)).toEqual({
      model: { count: 1 },
      path: "/App",
      props: { title: "next" },
      queries: { notes: ["n1"] },
    });
    expect(history.instanceAt("s", 9, 2)).toBeUndefined();
  });

  it("drops unmounted instances from the repaint but keeps them marked while folding", () => {
    const history: History = makeHistory(100);
    history.record(root(1, { count: 0 }));
    history.record({
      _tag: "Mounted",
      adopted: false,
      at: 2,
      commands: [],
      component: "Child",
      events: [],
      instance: 2,
      model: { open: true },
      path: "/App/Child",
      props: {},
      seq: 2,
      session: "s",
    });
    history.record({
      _tag: "Unmounted",
      at: 3,
      component: "Child",
      instance: 2,
      path: "/App/Child",
      seq: 3,
      session: "s",
    });

    expect(history.at("s", 2)?.("/App/Child")).toEqual({
      model: { open: true },
      props: {},
      queries: undefined,
    });
    expect(history.at("s", 3)?.("/App/Child")).toBeUndefined();
    expect(history.at("s", 3)?.("/App")).toBeDefined();
    expect(history.instanceAt("s", 3, 2)).toEqual({
      model: { open: true },
      path: "/App/Child",
      props: {},
      queries: undefined,
      unmounted: 3,
    });
  });

  it("repaints a late child mount whose cause is at or before the seq", () => {
    const history: History = makeHistory(100);
    history.record(root(1, { count: 0 }));
    history.record({
      _tag: "Update",
      at: 2,
      commands: [],
      component: "App",
      events: [],
      instance: 1,
      lists: [],
      message: { _tag: "Clicked" },
      model: { count: 1 },
      path: "/App",
      props: { title: "t" },
      sends: [],
      seq: 2,
      session: "s",
      source: { _tag: "Dispatch" },
    });
    history.record({
      _tag: "Mounted",
      adopted: false,
      at: 3,
      causedBy: 2,
      commands: [],
      component: "Child",
      events: [],
      instance: 2,
      model: { open: true },
      path: "/App/Child",
      props: {},
      seq: 3,
      session: "s",
    });

    expect(history.at("s", 2)?.("/App/Child")).toEqual({
      model: { open: true },
      props: {},
      queries: undefined,
    });
  });

  it("coalesces excluded updates and evicts past its size", () => {
    const history: History = makeHistory(2);
    history.record(root(1, { count: 0 }));
    history.record(historyUpdate(2, { count: 1 }), true);
    history.record(historyUpdate(3, { count: 2 }), true);

    expect(history.holds("s", 2)).toBe(false);
    expect(history.holds("s", 3)).toBe(false);
    expect(history.instanceAt("s", 3, 1)).toEqual({
      model: { count: 2 },
      path: "/App",
      props: {},
      queries: undefined,
    });

    history.record(root(4, { count: 3 }));
    history.record(root(5, { count: 4 }));
    expect(history.holds("s", 1)).toBe(false);
    expect(history.at("s", 1)).toBeUndefined();
    expect(history.instanceAt("s", 0, 1)).toBe("outside");
    expect(history.instanceAt("s", 1, 1)).toEqual({
      model: { count: 0 },
      path: "/App",
      props: { title: "t" },
      queries: undefined,
    });
    expect(history.at("s", 5)?.("/App")).toEqual({
      model: { count: 4 },
      props: { title: "t" },
      queries: undefined,
    });

    history.clear("s", 4);
    expect(history.holds("s", 4)).toBe(false);
    expect(history.instanceAt("s", 5, 1)).toEqual({
      model: { count: 4 },
      path: "/App",
      props: { title: "t" },
      queries: undefined,
    });

    history.drop("s");
    expect(history.holds("s", 5)).toBe(false);
    expect(history.instanceAt("s", 5, 1)).toBeUndefined();
    expect(history.at("s", 5)).toBeUndefined();
  });
});
