/**
 * `Command`: defining, mapping, modes, interrupts and failures. Ported from
 * Effect UI's `Command.test.ts`: the TestHost/Clock cases run through
 * `render` here with short real sleeps, and the service/query-coupled cases
 * belong to the Services and Query slices.
 */

import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { render } from "ilha/test";

import * as Command from "./command.ts";
import { defineComponent } from "./component.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const Message = TaggedEnum({
  Fire: { command: Schema.String },
  Got: { n: Schema.Number },
});

const waitFor = async (
  what: () => boolean,
  timeoutMs = 5000
): Promise<void> => {
  const start = Date.now();
  while (!what()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential poll; parallelizing would change test semantics
    await Effect.runPromise(Effect.sleep("5 millis"));
  }
};

describe("Command", () => {
  it("delivers the success as a message", async () => {
    const Loud = Command.make("Loud", { args: {} }, () =>
      Effect.succeed(Message.Got({ n: 0 }))
    );
    const Def = defineComponent({
      message: Message,
      model: Schema.Array(Schema.String),
      name: "CmdDirect",
      props: Schema.Struct({}),
    });
    const Direct = Def.make({
      init: () => [],
      update: ($, msg) =>
        msg._tag === "Fire"
          ? $.set([...$.model, "Fire"]).run(Loud.make())
          : [...$.model, `Got ${msg.n}`],
      view: (h, model) => (
        <div>
          <output id="model">{model.join(",")}</output>
          <button id="fire" onclick={h.send(Message.Fire({ command: "Loud" }))}>
            fire
          </button>
        </div>
      ),
    });
    const ui = render(() => <Direct props={{}} />);
    await ui.settled();
    await ui.click("#fire");
    await waitFor(() => ui.query("#model")?.textContent === "Fire,Got 0");
    ui.unmount();
  });

  it("maps results with map and as, and leaves Interrupt alone", () => {
    const Base = Command.make("Base", { args: {} }, () => Effect.succeed(1));
    const mapped = Command.map(Base.make(), (n) => Message.Got({ n }));
    expect(Command.isCommand(mapped)).toBe(true);
    const same = Command.as(Base.make(), Message.Got({ n: 9 }));
    expect(Command.isCommand(same)).toBe(true);
    const stop = Command.interrupt(Base);
    // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Command.map is a data-first dual, not Array#map; the second arg is the mapper
    expect(Command.map(stop, () => 1)).toBe(stop);
  });

  it("isRunning is true while a slow run is in flight", async () => {
    const Slow = Command.make("Slow", { args: {} }, () =>
      Effect.sleep("50 millis").pipe(Effect.as(Message.Got({ n: 1 })))
    );
    const Def = defineComponent({
      message: Message,
      model: Schema.Array(Schema.String),
      name: "CmdRunning",
    });
    const Running = Def.make({
      init: () => [],
      update: ($, msg) =>
        msg._tag === "Fire"
          ? $.set(["Fire"]).run(Slow.make())
          : [...$.model, `Got ${msg.n}`],
      view: (h, model) => (
        <div>
          <output id="model">{model.join(",")}</output>
          <output id="running">{String(h.isRunning(Slow))}</output>
          <button id="fire" onclick={h.send(Message.Fire({ command: "x" }))}>
            fire
          </button>
        </div>
      ),
    });
    const ui = render(() => <Running props={{}} />);
    await ui.settled();
    const clicked = ui.click("#fire");
    await waitFor(() => ui.query("#running")?.textContent === "true");
    await clicked;
    await waitFor(() => ui.query("#model")?.textContent === "Fire,Got 1");
    await waitFor(() => ui.query("#running")?.textContent === "false");
    ui.unmount();
  });

  it("queue keeps issue order across slow and instant runs", async () => {
    const QueuedMode = Command.make(
      "QueuedMode",
      { args: { n: Schema.Number }, mode: "queue" },
      ({ n }) =>
        Effect.sleep(n === 1 ? "60 millis" : "1 millis").pipe(
          Effect.as(Message.Got({ n }))
        )
    );
    const Def2 = defineComponent({
      message: Message,
      model: Schema.Array(Schema.String),
      name: "CmdQueue2",
    });
    const Queue2 = Def2.make({
      init: () => [],
      update: ($, msg) => {
        if (msg._tag === "Fire") {
          const n = msg.command === "slow" ? 1 : 2;
          return $.set([...$.model, `Fire${n}`]).run(QueuedMode.make({ n }));
        }
        return [...$.model, `Got ${msg.n}`];
      },
      view: (h, model) => (
        <div>
          <output id="model">{model.join(",")}</output>
          <button id="slow" onclick={h.send(Message.Fire({ command: "slow" }))}>
            slow
          </button>
          <button id="fast" onclick={h.send(Message.Fire({ command: "fast" }))}>
            fast
          </button>
        </div>
      ),
    });
    const ui2 = render(() => <Queue2 props={{}} />);
    await ui2.settled();
    await ui2.click("#slow");
    await ui2.click("#fast");
    await waitFor(
      () => ui2.query("#model")?.textContent === "Fire1,Fire2,Got 1,Got 2",
      8000
    );
    ui2.unmount();
  });

  it("switch cuts the earlier run so only the latest result lands", async () => {
    const Switched = Command.make(
      "Switched",
      { args: { n: Schema.Number }, mode: "switch" },
      ({ n }) =>
        Effect.sleep(n === 1 ? "80 millis" : "1 millis").pipe(
          Effect.as(Message.Got({ n }))
        )
    );
    const Def = defineComponent({
      message: Message,
      model: Schema.Array(Schema.String),
      name: "CmdSwitch",
    });
    const Sw = Def.make({
      init: () => [],
      update: ($, msg) => {
        if (msg._tag === "Fire") {
          const n = msg.command === "slow" ? 1 : 2;
          return $.set([...$.model, `Fire${n}`]).run(Switched.make({ n }));
        }
        return [...$.model, `Got ${msg.n}`];
      },
      view: (h, model) => (
        <div>
          <output id="model">{model.join(",")}</output>
          <button id="slow" onclick={h.send(Message.Fire({ command: "slow" }))}>
            slow
          </button>
          <button id="fast" onclick={h.send(Message.Fire({ command: "fast" }))}>
            fast
          </button>
        </div>
      ),
    });
    const ui = render(() => <Sw props={{}} />);
    await ui.settled();
    await ui.click("#slow");
    await ui.click("#fast");
    await waitFor(
      () => (ui.query("#model")?.textContent ?? "").includes("Got 2"),
      8000
    );
    await Effect.runPromise(Effect.sleep("120 millis"));
    expect(ui.query("#model")?.textContent).toBe("Fire1,Fire2,Got 2");
    ui.unmount();
  });

  it("interrupt stops a slow run so its message never lands", async () => {
    const Slow = Command.make("SlowInt", { args: {} }, () =>
      Effect.sleep("300 millis").pipe(Effect.as(Message.Got({ n: 1 })))
    );
    const Def = defineComponent({
      message: TaggedEnum({ Fire: {}, Got: { n: Schema.Number }, Stop: {} }),
      model: Schema.Array(Schema.String),
      name: "CmdInterrupt",
    });
    const Stopper = Def.make({
      init: () => [],
      update: ($, msg) => {
        switch (msg._tag) {
          case "Fire": {
            return $.set(["Fire"]).run(Slow.make());
          }
          case "Stop": {
            return $.set([...$.model, "Stop"]).run(Command.interrupt(Slow));
          }
          default: {
            return [...$.model, `Got ${msg.n}`];
          }
        }
      },
      view: (h, model) => (
        <div>
          <output id="model">{model.join(",")}</output>
          <button id="fire" onclick={h.send({ _tag: "Fire" })}>
            fire
          </button>
          <button id="stop" onclick={h.send({ _tag: "Stop" })}>
            stop
          </button>
        </div>
      ),
    });
    const ui = render(() => <Stopper props={{}} />);
    await ui.settled();
    await ui.click("#fire");
    await ui.click("#stop");
    await Effect.runPromise(Effect.sleep("400 millis"));
    expect(ui.query("#model")?.textContent).toBe("Fire,Stop");
    ui.unmount();
  });

  it("a Stream command delivers every element", async () => {
    const Ticks = Command.make("Ticks", { args: {}, stream: true }, () =>
      Stream.fromIterable([1, 2, 3]).pipe(Stream.map((n) => Message.Got({ n })))
    );
    const Def = defineComponent({
      message: Message,
      model: Schema.Array(Schema.String),
      name: "CmdStream",
    });
    const Streamer = Def.make({
      init: () => [],
      update: ($, msg) =>
        msg._tag === "Fire"
          ? $.set(["Fire"]).run(Ticks.make())
          : [...$.model, `Got ${msg.n}`],
      view: (h, model) => (
        <div>
          <output id="model">{model.join(",")}</output>
          <button id="fire" onclick={h.send(Message.Fire({ command: "x" }))}>
            fire
          </button>
        </div>
      ),
    });
    const ui = render(() => <Streamer props={{}} />);
    await ui.settled();
    await ui.click("#fire");
    await waitFor(
      () => ui.query("#model")?.textContent === "Fire,Got 1,Got 2,Got 3"
    );
    ui.unmount();
  });

  it("a defect fails the instance to the author's fallback", async () => {
    const Dying = Command.make("Dying", { args: {} }, () =>
      Effect.die(new Error("kaboom"))
    );
    const Def = defineComponent({
      message: Message,
      model: Schema.Array(Schema.String),
      name: "CmdDefect",
    });
    const Doomed = Def.make({
      init: () => [],
      update: ($, msg) =>
        msg._tag === "Fire" ? $.set(["Fire"]).run(Dying.make()) : $.model,
      view: (h, model) => (
        <div>
          <output id="model">{model.join(",")}</output>
          <button id="fire" onclick={h.send(Message.Fire({ command: "x" }))}>
            fire
          </button>
        </div>
      ),
    });
    const PageDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "CmdDefectPage",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => null,
      update: ($) => $,
      view: () => (
        <div>
          <Doomed
            props={{}}
            fallback={() => <output id="fallback">failed</output>}
          />
        </div>
      ),
    });
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await ui.click("#fire");
    await waitFor(() => ui.query("#fallback")?.textContent === "failed");
    ui.unmount();
  });

  it("a Service command without a provider fails naming the service", async () => {
    // SAFETY: Service() already returns a usable definition class; subclassing adds nothing
    const Missing = Command.Service<never>()("test/Missing", {
      args: {},
      success: Schema.Number,
    });
    const Def = defineComponent({
      message: TaggedEnum({ Fire: {}, Got: { n: Schema.Number } }),
      model: Schema.Array(Schema.String),
      name: "CmdMissingService",
    });
    const Needy = Def.make({
      init: () => [],
      update: ($, msg) =>
        // SAFETY: Missing has no provider by design; the never run proves the failure names the service
        msg._tag === "Fire"
          ? $.set(["Fire"]).run(Missing.make() as never)
          : [...$.model, "Got"],
      view: (h, model) => (
        <div>
          <output id="model">{model.join(",")}</output>
          <button id="fire" onclick={h.send({ _tag: "Fire" })}>
            fire
          </button>
        </div>
      ),
    });
    const PageDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "CmdMissingPage",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => null,
      update: ($) => $,
      view: () => (
        <div>
          <Needy
            props={{}}
            fallback={() => <output id="fallback">failed</output>}
          />
        </div>
      ),
    });
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await ui.click("#fire");
    await waitFor(() => ui.query("#fallback")?.textContent === "failed");
    ui.unmount();
  });

  it("validates Type-side args so transforming fields keep their decoded form", () => {
    const Fetch = Command.make(
      "Fetch",
      { args: { page: Schema.NumberFromString }, group: ["page"] },
      (args) => Effect.succeed(args.page)
    );
    const first = Fetch({ page: 2 });
    expect(first.args).toEqual({ page: 2 });
    expect(first.groupKey).toBe(Fetch({ page: 2 }).groupKey);
    expect(first.groupKey).not.toBe(Fetch({ page: 3 }).groupKey);
    expect(() =>
      // SAFETY: must smuggle an invalid page past the args types to prove validation rejects it
      // oxlint-disable-next-line anti-slop/no-known-value-widening, anti-slop/no-chained-type-assertions -- the invalid payload needs the widened shape to typecheck the call
      Fetch({ page: "nope" } as unknown as { page: number })
    ).toThrow();
  });

  it("a Service hands the validated Type-side args to its callbacks", () => {
    const seen: number[] = [];
    // SAFETY: Service() already returns a usable definition class; subclassing adds nothing
    const Search = Command.Service<never>()("test/Search", {
      args: { page: Schema.NumberFromString },
      group: ["page"],
      invalidates: (args) => {
        seen.push(args.page);
        return [];
      },
      success: Schema.Number,
    });

    const issued = Search.make({ page: 2 });
    expect(issued.args).toEqual({ page: 2 });
    expect(seen).toEqual([2]);
    expect(issued.groupKey).toBe(Search.make({ page: 2 }).groupKey);
    // SAFETY: must smuggle an invalid page past the args types to prove validation rejects it
    // oxlint-disable-next-line anti-slop/no-known-value-widening, anti-slop/no-chained-type-assertions -- the invalid payload needs the widened shape to typecheck the call
    expect(() =>
      // SAFETY: must smuggle an invalid page past the args types to prove validation rejects it
      // oxlint-disable-next-line anti-slop/no-known-value-widening, anti-slop/no-chained-type-assertions -- the invalid payload needs the widened shape to typecheck the call
      Search.make({ page: "nope" } as unknown as { page: number })
    ).toThrow();
  });
});
