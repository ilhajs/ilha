import { describe, expect, it } from "bun:test";

import { Context, Effect, Layer, Logger, Schema } from "effect";
import { render } from "ilha/test";

import { attachModelRecorder, Command, defineComponent } from "./index";

// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
const Msg = Schema.TaggedUnion({
  AddSoon: { amount: Schema.Number },
  AddedBonus: { amount: Schema.Number },
  BlowUp: {},
  Inc: {},
  SetSoon: { v: Schema.Number },
  SetVal: { v: Schema.Number },
});
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
type Msg = typeof Msg.Type;

const poll = async (
  done: () => boolean,
  deadline = Date.now() + 3000
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

const SlowAdd = Command.make("SlowAdd", (amount: number) =>
  Effect.sleep("40 millis").pipe(
    Effect.as(Msg.cases.AddedBonus.make({ amount }))
  )
);
const SetSoon = Command.make("SetSoon", { mode: "switch" }, (v: number) =>
  Effect.sleep("150 millis").pipe(Effect.as(Msg.cases.SetVal.make({ v })))
);
const Boom = Command.make("Boom", () => Effect.die(new Error("boom")));

const Counter = defineComponent({
  message: Msg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "CmdCounter",
}).make({
  init: () => ({ count: 0 }),
  update: {
    AddSoon: ($, { amount }) => $.run(SlowAdd(amount)),
    AddedBonus: ($, { amount }) => $.evolve({ count: (c) => c + amount }),
    BlowUp: ($) => $.run(Boom()),
    Inc: ($) => $.evolve({ count: (c) => c + 1 }),
    SetSoon: ($, { v }) => $.run(SetSoon(v)),
    SetVal: ($, { v }) => $.set({ count: v }),
  },
  view: (h, model) => (
    <div>
      <output>{model.count}</output>
      <button
        data-testid="add1"
        onclick={h.send(Msg.cases.AddSoon.make({ amount: 1 }))}
      >
        add1
      </button>
      <button
        data-testid="add10"
        onclick={h.send(Msg.cases.AddSoon.make({ amount: 10 }))}
      >
        add10
      </button>
      <button
        data-testid="set1"
        onclick={h.send(Msg.cases.SetSoon.make({ v: 1 }))}
      >
        set1
      </button>
      <button
        data-testid="set2"
        onclick={h.send(Msg.cases.SetSoon.make({ v: 2 }))}
      >
        set2
      </button>
      <button
        data-testid="slow"
        onclick={h.send(Msg.cases.AddSoon.make({ amount: 5 }))}
      >
        slow
      </button>
      <button
        data-testid="boom"
        disabled={h.isRunning(SlowAdd)}
        onclick={h.send(Msg.cases.BlowUp.make({}))}
      >
        boom
      </button>
      <button data-testid="inc" onclick={h.send(Msg.cases.Inc.make({}))}>
        inc
      </button>
    </div>
  ),
});

describe("commands", () => {
  it("runs concurrent issues independently", async () => {
    const ui = render(() => <Counter />);
    await ui.settled();
    await ui.click('[data-testid="add1"]');
    await ui.click('[data-testid="add10"]');
    await poll(() => ui.query("output")?.textContent === "11");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("lets a switch issue interrupt the running one", async () => {
    const seen: unknown[] = [];
    const detach = attachModelRecorder((record) => seen.push(record.message));
    const ui = render(() => <Counter />);
    await ui.settled();
    await ui.click('[data-testid="set1"]');
    await ui.click('[data-testid="set2"]');
    await poll(() => ui.query("output")?.textContent === "2");
    detach();
    const sets = seen.filter((m) => {
      // SAFETY: the recorder stores decoded messages carrying a `_tag`.
      const { _tag } = m as { readonly _tag: string };
      return _tag === "SetVal";
    });
    expect(sets).toHaveLength(1);
    expect(sets[0]).toEqual(Msg.cases.SetVal.make({ v: 2 }));
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("reports isRunning while an issue runs", async () => {
    const ui = render(() => <Counter />);
    await ui.settled();
    await ui.click('[data-testid="slow"]');
    // SAFETY: the boom button exists while the counter is mounted.
    await poll(
      () =>
        (ui.query('[data-testid="boom"]') as HTMLButtonElement).disabled ===
        true
    );
    await poll(() => ui.query("output")?.textContent === "5");
    // SAFETY: the boom button exists while the counter is mounted.
    expect(
      (ui.query('[data-testid="boom"]') as HTMLButtonElement).disabled
    ).toBe(false);
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("logs a defect and stays interactive", async () => {
    const logged: unknown[] = [];
    const testLogger = Logger.make((options) => {
      logged.push(options.message);
    });
    const Bomb = defineComponent({
      message: Msg,
      model: Schema.Struct({ count: Schema.Number }),
      name: "Bomb",
    }).make({
      init: () => ({ count: 0 }),
      layer: Logger.layer([testLogger]),
      update: {
        AddSoon: ($) => $,
        AddedBonus: ($) => $,
        BlowUp: ($) => $.run(Boom()),
        Inc: ($) => $.evolve({ count: (c) => c + 1 }),
        SetSoon: ($) => $,
        SetVal: ($) => $,
      },
      view: (h, model) => (
        <div>
          <output>{model.count}</output>
          <button
            data-testid="boom"
            onclick={h.send(Msg.cases.BlowUp.make({}))}
          >
            boom
          </button>
          <button data-testid="inc" onclick={h.send(Msg.cases.Inc.make({}))}>
            inc
          </button>
        </div>
      ),
    });
    const ui = render(() => <Bomb />);
    await ui.settled();
    await ui.click('[data-testid="boom"]');
    await poll(() => logged.length === 1);
    expect(String(logged[0])).toContain("boom");
    await ui.click('[data-testid="inc"]');
    expect(ui.text()).toContain("1");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("provides the layer to commands", async () => {
    const Greeter = Context.Service<{ greet: (name: string) => string }>(
      "CmdGreeter"
    );
    const GreetMsg = Schema.TaggedUnion({
      Fetch: {},
      Greeted: { text: Schema.String },
    });
    const FetchGreet = Command.make("FetchGreet", () =>
      Greeter.pipe(
        Effect.map((greet) =>
          GreetMsg.cases.Greeted.make({ text: greet.greet("yo") })
        )
      )
    );
    const Greeted = defineComponent({
      message: GreetMsg,
      model: Schema.Struct({ count: Schema.Number }),
      name: "Greeted",
    }).make({
      init: () => ({ count: 0 }),
      layer: Layer.succeed(Greeter, { greet: (name) => `hi ${name}` }),
      update: {
        Fetch: ($) => $.run(FetchGreet()),
        Greeted: ($, { text }) => $.set({ count: text.length }),
      },
      view: (h, model) => (
        <div>
          <output>{model.count}</output>
          <button
            data-testid="fetch"
            onclick={h.send(GreetMsg.cases.Fetch.make({}))}
          >
            fetch
          </button>
        </div>
      ),
    });
    const ui = render(() => <Greeted />);
    await ui.settled();
    await ui.click('[data-testid="fetch"]');
    await poll(() => ui.query("output")?.textContent === "5");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });
});
