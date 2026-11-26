// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Effect, Schema } from "effect";
import { render } from "ilha/test";
import type { TestUi } from "ilha/test";

import { Command, defineComponent } from "./index";

// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
const Msg = Schema.TaggedUnion({
  ClickedAdd: { amount: Schema.Number },
  ClickedReset: {},
  CompletedReset: {},
  SetName: { name: Schema.String },
});

// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
type Msg = typeof Msg.Type;

const DelayReset = Command.make("DelayReset", { mode: "switch" }, () =>
  Effect.sleep("60 millis").pipe(Effect.as(Msg.cases.CompletedReset.make({})))
);

const Counter = defineComponent({
  message: Msg,
  model: Schema.Struct({ count: Schema.Number, name: Schema.String }),
  name: "Counter",
  props: Schema.Struct({ label: Schema.String }),
}).make({
  init: () => ({ count: 0, name: "n/a" }),
  update: {
    ClickedAdd: ($, { amount }) => $.evolve({ count: (c) => c + amount }),
    ClickedReset: ($) => $.run(DelayReset()),
    CompletedReset: ($) => $.evolve({ count: 10 }),
    SetName: ($, { name }) => $.set({ count: $.model.count, name }),
  },
  view: (h, model) => (
    <div>
      <span>{h.props.label}</span>
      <output>
        {model.count}:{model.name}
      </output>
      <button onclick={h.send(Msg.cases.ClickedAdd.make({ amount: 1 }))}>
        +1
      </button>
      <button
        disabled={h.isRunning(DelayReset)}
        onclick={h.send(Msg.cases.ClickedReset.make({}))}
      >
        Reset
      </button>
      <input
        oninput={h.send((event: Event) => {
          // SAFETY: this input handler runs only on the <input> element.
          const { value } = event.target as HTMLInputElement;

          return value === ""
            ? undefined
            : Msg.cases.SetName.make({ name: value });
        })}
      />
    </div>
  ),
});

const renderCounter = (): TestUi =>
  render(() => <Counter props={{ label: "Likes" }} />);

/** Wait for a condition effects the harness cannot track. */
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

describe("counter", () => {
  it("renders props and the init model", async () => {
    const ui = renderCounter();
    await ui.settled();
    expect(ui.text()).toContain("Likes");
    expect(ui.text()).toContain("0:n/a");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("evolves the model on messages", async () => {
    const ui = renderCounter();
    await ui.click("button");
    expect(ui.text()).toContain("1:n/a");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("maps event args through send, dropping undefined", async () => {
    const ui = renderCounter();
    await ui.input("input", "ann");
    expect(ui.text()).toContain("0:ann");
    await ui.input("input", "");
    expect(ui.text()).toContain("0:ann");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("runs the reset command and reports isRunning", async () => {
    const ui = renderCounter();
    await ui.click("button");
    await ui.click("button:nth-of-type(2)");
    // SAFETY: the reset button exists while the counter is mounted.
    await poll(
      () =>
        (ui.query("button:nth-of-type(2)") as HTMLButtonElement).disabled ===
        true
    );
    await poll(() => ui.text().includes("10:n/a"), Date.now() + 5000);
    // SAFETY: the reset button exists while the counter is mounted.
    expect(
      (ui.query("button:nth-of-type(2)") as HTMLButtonElement).disabled
    ).toBe(false);
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("routes view throws to onError", async () => {
    const errors: Error[] = [];

    const Broken = defineComponent({
      message: Msg,
      model: Schema.Struct({ count: Schema.Number }),
      name: "Broken",
    }).make({
      init: () => ({ count: 0 }),
      update: {
        ClickedAdd: ($) => $,
        ClickedReset: ($) => $,
        CompletedReset: ($) => $,
        SetName: ($) => $,
      },
      view: () => {
        throw new Error("view blew up");
      },
    });

    const ui = render(() => <Broken />, {
      onError: (error) => errors.push(error),
    });

    await ui.settled();
    expect(errors.length).toBe(1);
    expect(errors[0]?.message).toContain("view blew up");
    ui.unmount();
  });

  it("routes init throws to onError", async () => {
    const errors: Error[] = [];

    const BrokenInit = defineComponent({
      message: Msg,
      model: Schema.Struct({ count: Schema.Number }),
      name: "BrokenInit",
    }).make({
      init: () => {
        throw new Error("init blew up");
      },
      update: {
        ClickedAdd: ($) => $,
        ClickedReset: ($) => $,
        CompletedReset: ($) => $,
        SetName: ($) => $,
      },
      view: (_h, model) => <p>{model.count}</p>,
    });

    const ui = render(() => <BrokenInit />, {
      onError: (error) => errors.push(error),
    });

    await ui.settled();
    expect(errors.length).toBe(1);
    expect(errors[0]?.message).toContain("init blew up");
    ui.unmount();
  });
});
