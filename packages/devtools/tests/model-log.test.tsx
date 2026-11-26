import { afterEach, describe, expect, it } from "bun:test";

import { attachModelRecorder, Command, defineComponent } from "@ilha/model";
import { Effect, Option, Schema } from "effect";
import type { Component } from "ilha";
import { atomsOf, inspect } from "ilha/debug";

import { createModelLog, MODEL_LOG_CAP } from "../src/model-log.ts";
import { mountHost, settle } from "./helpers.tsx";

const Msg = Schema.TaggedUnion({
  AddBonus: { amount: Schema.Number },
  FetchBonus: {},
  Increment: {},
});

const FetchBonus = Command.make("FetchBonus", () =>
  Effect.succeed(Msg.cases.AddBonus.make({ amount: 10 }))
);

const counter = defineComponent({
  message: Msg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "Counter",
}).make({
  init: () => ({ count: 0 }),
  update: {
    AddBonus: ($, { amount }) => $.evolve({ count: (n) => n + amount }),
    FetchBonus: ($) => $.run(FetchBonus()),
    Increment: ($) => $.evolve({ count: (n) => n + 1 }),
  },
  view: (h, model) => (
    <div>
      <p>{model.count}</p>
      <button type="button" onclick={h.send(Msg.cases.Increment.make({}))}>
        inc
      </button>
      <button type="button" onclick={h.send(Msg.cases.FetchBonus.make({}))}>
        bonus
      </button>
    </div>
  ),
});

const TickMsg = Schema.TaggedUnion({ Tick: {} });

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    cleanup();
  }
});

/** Mount `component` with a fresh log attached; read it the way the page script does. */
const mountLogged = async (component: Component) => {
  const log = createModelLog();
  cleanups.push(attachModelRecorder(log.record));
  const { host, unmount } = await mountHost(component);
  cleanups.push(() => {
    unmount();
    host.remove();
  });

  const click = async (index = 0): Promise<void> => {
    host.querySelectorAll("button")[index]?.click();
    await settle(5);
  };

  const read = () => {
    const [node] = inspect(host);

    return log.read(atomsOf(node?.id ?? "") ?? []);
  };

  return { click, host, read };
};

const poll = async (
  done: () => boolean,
  deadline = Date.now() + 2000
): Promise<void> => {
  if (done()) {
    return;
  }

  if (Date.now() > deadline) {
    expect(done()).toBe(true);

    return;
  }

  await Bun.sleep(5);
  await poll(done, deadline);
};

describe("model message log", () => {
  it("records ordered entries with field diffs and command counts", async () => {
    const { click, host, read } = await mountLogged(counter);
    await click();
    await click(1);
    await poll(() => host.textContent === "11incbonus");
    const entries = read();
    expect(entries?.map((entry) => entry.message)).toEqual([
      { _tag: "Increment" },
      { _tag: "FetchBonus" },
      { _tag: "AddBonus", amount: 10 },
    ]);
    expect(entries?.map((entry) => entry.commands)).toEqual([0, 1, 0]);
    expect(entries?.map((entry) => entry.diff)).toEqual([
      { _tag: "fields", changed: { count: { after: 1, before: 0 } } },
      { _tag: "fields", changed: {} },
      { _tag: "fields", changed: { count: { after: 11, before: 1 } } },
    ]);
  });

  it("keeps only the newest entries past the cap", async () => {
    const flood = defineComponent({
      message: TickMsg,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Flood",
    }).make({
      init: () => ({ n: 0 }),
      update: {
        Tick: ($) => $.evolve({ n: (n) => n + 1 }),
      },
      view: (h, model) => (
        <button
          type="button"
          onclick={() => {
            const send = h.send(TickMsg.cases.Tick.make({}));

            for (let i = 0; i < MODEL_LOG_CAP + 5; i += 1) {
              send();
            }
          }}
        >
          {model.n}
        </button>
      ),
    });

    const { click, read } = await mountLogged(flood);
    await click();
    const entries = read();
    expect(entries?.length).toBe(MODEL_LOG_CAP);
    expect(entries?.[0]?.diff).toEqual({
      _tag: "fields",
      changed: { n: { after: 6, before: 5 } },
    });
    expect(entries?.at(-1)?.diff).toEqual({
      _tag: "fields",
      changed: { n: { after: MODEL_LOG_CAP + 5, before: MODEL_LOG_CAP + 4 } },
    });
  });

  it("snapshots non-record models whole", async () => {
    const scalar = defineComponent({
      message: TickMsg,
      model: Schema.Number,
      name: "Scalar",
    }).make({
      init: () => 0,
      update: {
        Tick: ($) => $.set($.model + 1),
      },
      view: (h, model) => (
        <button type="button" onclick={h.send(TickMsg.cases.Tick.make({}))}>
          {model}
        </button>
      ),
    });

    const { click, read } = await mountLogged(scalar);
    await click();
    expect(read()?.[0]?.diff).toEqual({
      _tag: "snapshot",
      after: 1,
      before: 0,
    });
  });

  it("summarizes errors, options, and cycles, and survives unserializable messages", async () => {
    interface Cyclic {
      readonly err: Error;
      readonly opt: Option.Option<number>;
      self?: Cyclic;
    }

    const cyclic: Cyclic = { err: new Error("boom"), opt: Option.some(3) };
    cyclic.self = cyclic;

    const poison = {
      get tag(): string {
        throw new Error("touched");
      },
    };

    const RichMsg = Schema.TaggedUnion({
      Poison: { value: Schema.Unknown },
      Rich: { value: Schema.Unknown },
    });

    const rich = defineComponent({
      message: RichMsg,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Rich",
    }).make({
      init: () => ({ n: 0 }),
      update: {
        Poison: ($) => $.evolve({ n: (n) => n + 1 }),
        Rich: ($) => $.evolve({ n: (n) => n + 1 }),
      },
      view: (h, model) => (
        <div>
          <p>{model.n}</p>
          <button
            type="button"
            onclick={h.send(RichMsg.cases.Rich.make({ value: cyclic }))}
          >
            rich
          </button>
          <button
            type="button"
            onclick={h.send(RichMsg.cases.Poison.make({ value: poison }))}
          >
            bad
          </button>
        </div>
      ),
    });

    const { click, host, read } = await mountLogged(rich);
    await click();
    await click(1);
    expect(host.textContent).toBe("2richbad");
    expect(read()?.map((entry) => entry.message)).toEqual([
      {
        _tag: "Rich",
        value: {
          err: "<Error: boom>",
          opt: { _tag: "Some", value: 3 },
          self: "<circular>",
        },
      },
      "<unserializable>",
    ]);
  });

  it("keeps islands apart and reads nothing for islands that never dispatched", async () => {
    const first = await mountLogged(counter);
    const second = await mountLogged(counter);
    await first.click();
    expect(first.read()?.length).toBe(1);
    expect(second.read()).toBeUndefined();
  });
});
