/**
 * Smoke test for the wave-1 component runtime: the launch-article Counter
 * renders, clicks update the model, and a Page/Counter pair routes emits
 * through the author's `onEmit`.
 */
import { describe, expect, it } from "bun:test";

import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import { defineComponent } from "./index.ts";

const CounterDef = defineComponent({
  events: Schema.Union([
    Schema.TaggedStruct("Changed", { count: Schema.Number }),
  ]),
  message: Schema.Union([
    Schema.TaggedStruct("Increment", {}),
    Schema.TaggedStruct("Decrement", {}),
  ]),
  model: Schema.Struct({ count: Schema.Number }),
  name: "Counter",
  props: Schema.Struct({ initial: Schema.Number }),
});

const Counter = CounterDef.make({
  init: ($, props) => $.set({ count: props.initial }),
  update: {
    Decrement: ($) => $.set({ count: $.model.count - 1 }),
    Increment: ($) =>
      $.set({ count: $.model.count + 1 }).emit({
        _tag: "Changed",
        count: $.model.count + 1,
      }),
  },
  view: (h, model) => (
    <div>
      <span id="count">{String(model.count)}</span>
      <button id="inc" onclick={h.send({ _tag: "Increment" })}>
        +
      </button>
      <button id="dec" onclick={h.send({ _tag: "Decrement" })}>
        -
      </button>
    </div>
  ),
});

const PageDef = defineComponent({
  events: Schema.Never,
  message: Schema.Union([
    Schema.TaggedStruct("Bump", { count: Schema.Number }),
  ]),
  model: Schema.Struct({ total: Schema.Number }),
  name: "Page",
  props: Schema.Struct({}),
});

const Page = PageDef.make({
  init: () => ({ total: 0 }),
  update: {
    Bump: ($, message) => $.set({ total: message.count }),
  },
  view: (_h, model) => (
    <div>
      <span id="total">{String(model.total)}</span>
      <Counter
        props={{ initial: 10 }}
        onChanged={(event) => ({ _tag: "Bump", count: event.count })}
      />
    </div>
  ),
});

describe("Counter", () => {
  it("renders the initial model and updates on click", async () => {
    const ui = render(() => <Counter props={{ initial: 1 }} />);
    await ui.settled();
    expect(ui.html()).toContain(">1<");
    await ui.click("#inc");
    expect(ui.html()).toContain(">2<");
    await ui.click("#dec");
    await ui.click("#dec");
    expect(ui.html()).toContain(">0<");
    ui.unmount();
  });

  it("routes child emits to the author's onEmit", async () => {
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    expect(ui.html()).toContain(">10<");
    await ui.click("#inc");
    expect(ui.html()).toContain(">11<");
    ui.unmount();
  });
});

describe("forwarding", () => {
  it("routes emits to the writer through h.children", async () => {
    const MiddleDef = defineComponent({
      events: Schema.Never,
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "Middle",
      props: Schema.Struct({}),
    });
    const Middle = MiddleDef.make({
      init: () => ({}),
      update: ($) => $,
      view: (h) => <div id="middle">{h.children}</div>,
    });
    const ShellDef = defineComponent({
      events: Schema.Never,
      message: Schema.Union([
        Schema.TaggedStruct("Bump", { count: Schema.Number }),
      ]),
      model: Schema.Struct({ total: Schema.Number }),
      name: "Shell",
      props: Schema.Struct({}),
    });
    const Shell = ShellDef.make({
      init: () => ({ total: 0 }),
      update: {
        Bump: ($, message) => $.set({ total: message.count }),
      },
      view: (_h, model) => (
        <div>
          <span id="total">{String(model.total)}</span>
          <Middle>
            <Counter
              props={{ initial: 10 }}
              onChanged={(event) => ({ _tag: "Bump", count: event.count })}
            />
          </Middle>
        </div>
      ),
    });
    const ui = render(() => <Shell props={{}} />);
    await ui.settled();
    expect(ui.html()).toContain(">10<");
    await ui.click("#inc");
    expect(ui.html()).toContain(">11<");
    ui.unmount();
  });
});
