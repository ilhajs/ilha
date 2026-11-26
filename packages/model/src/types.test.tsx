// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Context, Effect, Layer, Schema } from "effect";
import { render } from "ilha/test";

import { Command, defineComponent } from "./index";
import { Story } from "./test";

// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
const Msg = Schema.TaggedUnion({
  Add: { amount: Schema.Number },
  Reset: {},
});
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
type Msg = typeof Msg.Type;

interface Model {
  readonly count: number;
}

const Counter = defineComponent({
  message: Msg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "TypedCounter",
  props: Schema.Struct({ label: Schema.String }),
}).make({
  init: () => ({ count: 0 }),
  update: {
    Add: ($, { amount }) => $.evolve({ count: (c) => c + amount }),
    Reset: ($) => $.set({ count: 0 }),
  },
  view: (h, model) => (
    <div>
      <span>{h.props.label}</span>
      <output>{model.count}</output>
      <button onclick={h.send(Msg.cases.Add.make({ amount: 1 }))}>+1</button>
    </div>
  ),
});

const Bare = defineComponent({
  message: Msg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "Bare",
}).make({
  init: () => ({ count: 0 }),
  update: {
    Add: ($, { amount }) => $.evolve({ count: (c) => c + amount }),
    Reset: ($) => $.set({ count: 0 }),
  },
  view: (_h, model) => <output>{model.count}</output>,
});

const MissingTag = defineComponent({
  message: Msg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "MissingTag",
}).make({
  init: () => ({ count: 0 }),
  // @ts-expect-error -- update must handle every tag
  update: {
    Add: ($: { model: Model }, { amount }: { amount: number }) => ({
      count: $.model.count + amount,
    }),
  },
  view: (_h, model: Model) => <output>{model.count}</output>,
});
void MissingTag;

const BadMessage = defineComponent({
  message: Msg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "BadMessage",
}).make({
  init: () => ({ count: 0 }),
  update: {
    // @ts-expect-error -- Add carries amount, not missing
    Add: ($, { amount: _amount }: { amount: string }) => $.evolve({ count: 1 }),
    Reset: () => ({ count: 0 }),
  },
  view: (_h, model: Model) => <output>{model.count}</output>,
});
void BadMessage;

const Greeter = Context.Service<{ greet: (name: string) => string }>(
  "TypeGreeter"
);

const NeedsGreeter = Command.make("NeedsGreeter", () =>
  Greeter.pipe(
    Effect.map((greet) => {
      void greet;
      return Msg.cases.Reset.make({});
    })
  )
);

const NoLayer = defineComponent({
  message: Msg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "NoLayer",
  // @ts-expect-error -- Greeter is not in a layer
}).make({
  init: () => ({ count: 0 }),
  update: {
    Add: ($, { amount }) => $.evolve({ count: (c) => c + amount }),
    Reset: ($) => $.run(NeedsGreeter()),
  },
  view: (_h, model: Model) => <output>{model.count}</output>,
});
void NoLayer;

const WithLayer = defineComponent({
  message: Msg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "WithLayer",
}).make({
  init: () => ({ count: 0 }),
  layer: Layer.succeed(Greeter, { greet: (name) => `hi ${name}` }),
  update: {
    Add: ($, { amount }) => $.evolve({ count: (c) => c + amount }),
    Reset: ($) => $.run(NeedsGreeter()),
  },
  view: (_h, model: Model) => <output>{model.count}</output>,
});
void WithLayer;

describe("types", () => {
  it("renders a typed app and requires props", async () => {
    const ui = render(() => <Counter props={{ label: "x" }} />);
    await ui.settled();
    expect(ui.text()).toContain("x");
    // @ts-expect-error -- props are required when a props schema is given
    render(() => <Counter />);
    render(() => <Bare />);
    const withProps = Story.make(Counter, { label: "x" });
    expect(withProps.model).toEqual({ count: 0 });
    expect(() =>
      // @ts-expect-error -- props are required when a props schema is given
      Story.make(Counter)
    ).toThrow();
    const bare = Story.make(Bare);
    expect(bare.model).toEqual({ count: 0 });
    ui.unmount();
  });
});
