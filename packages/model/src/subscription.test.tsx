// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Effect, Schema } from "effect";
import * as Stream from "effect/Stream";
import { renderToString } from "ilha";
import { render } from "ilha/test";

import { defineComponent, Subscription } from "./index";

// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
const Msg = Schema.TaggedUnion({
  GoOff: {},
  Ticked: { seen: Schema.Number },
  Toggle: {},
});
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
type Msg = typeof Msg.Type;

interface Model {
  readonly n: number;
  readonly off: boolean;
  readonly ticks: number;
}

let builds = 0;
const Ticks = Subscription.make(
  "ticks",
  (model: Model) => model.n,
  (n) => {
    builds += 1;
    return Stream.make(Msg.cases.Ticked.make({ seen: n }));
  }
);

const Toggler = defineComponent({
  message: Msg,
  model: Schema.Struct({
    n: Schema.Number,
    off: Schema.Boolean,
    ticks: Schema.Number,
  }),
  name: "Toggler",
}).make({
  init: () => ({ n: 0, off: false, ticks: 0 }),
  subscriptions: (model) => (model.off ? [] : [Ticks]),
  update: {
    GoOff: ($) => $.evolve({ off: true }),
    Ticked: ($, { seen }) =>
      seen === $.model.n ? $.evolve({ ticks: (t) => t + 1 }) : $,
    Toggle: ($) => $.evolve({ n: (n) => n + 1 }),
  },
  view: (h, model) => (
    <div>
      <output>
        {model.n}/{model.ticks}
      </output>
      <button data-testid="toggle" onclick={h.send(Msg.cases.Toggle.make({}))}>
        toggle
      </button>
      <button data-testid="off" onclick={h.send(Msg.cases.GoOff.make({}))}>
        off
      </button>
    </div>
  ),
});

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

describe("subscriptions", () => {
  it("starts on the client and restarts when deps change", async () => {
    builds = 0;
    const ui = render(() => <Toggler />);
    await poll(() => ui.text().includes("0/1"));
    expect(builds).toBe(1);
    await ui.click('[data-testid="toggle"]');
    await poll(() => ui.text().includes("1/2"));
    expect(builds).toBe(2);
    await ui.click('[data-testid="toggle"]');
    await poll(() => ui.text().includes("2/3"));
    expect(builds).toBe(3);
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("stops the stream when the entry is removed", async () => {
    const SlowMsg = Schema.TaggedUnion({ Off: {}, Tock: {} });
    let runs = 0;
    const Slow = Subscription.make(
      "slow",
      () => 0,
      () => {
        runs += 1;
        return Stream.fromEffect(
          Effect.delay(
            Effect.succeed(SlowMsg.cases.Tock.make({})),
            "150 millis"
          )
        );
      }
    );
    const Stopper = defineComponent({
      message: SlowMsg,
      model: Schema.Struct({ off: Schema.Boolean, ticks: Schema.Number }),
      name: "Stopper",
    }).make({
      init: () => ({ off: false, ticks: 0 }),
      subscriptions: (model) => (model.off ? [] : [Slow]),
      update: {
        Off: ($) => $.evolve({ off: true }),
        Tock: ($) => $.evolve({ ticks: (t) => t + 1 }),
      },
      view: (h, model) => (
        <div>
          <output>{model.ticks}</output>
          <button
            data-testid="off"
            onclick={h.send(SlowMsg.cases.Off.make({}))}
          >
            off
          </button>
        </div>
      ),
    });
    runs = 0;
    const ui = render(() => <Stopper />);
    await ui.settled();
    expect(runs).toBe(1);
    await ui.click('[data-testid="off"]');
    await Bun.sleep(300);
    expect(ui.text()).toContain("0");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("does not run during server rendering", async () => {
    builds = 0;
    const html = await renderToString(() => <Toggler />);
    expect(html).toContain("0/0");
    expect(builds).toBe(0);
  });

  it("throws on duplicate subscription names", async () => {
    const Dup = Subscription.make(
      "dup",
      Stream.make(Msg.cases.Toggle.make({}))
    );
    const Doubled = defineComponent({
      message: Msg,
      model: Schema.Struct({
        n: Schema.Number,
        off: Schema.Boolean,
        ticks: Schema.Number,
      }),
      name: "Doubled",
    }).make({
      init: () => ({ n: 0, off: false, ticks: 0 }),
      subscriptions: () => [Dup, Dup],
      update: {
        GoOff: ($) => $,
        Ticked: ($) => $,
        Toggle: ($) => $,
      },
      view: (_h, model) => <p>{model.n}</p>,
    });
    const ui = render(() => <Doubled />);
    await ui.settled();
    expect(ui.errors.length).toBe(1);
    expect(String(ui.errors[0]?.message)).toMatch(/duplicate subscription/u);
    ui.unmount();
  });
});
