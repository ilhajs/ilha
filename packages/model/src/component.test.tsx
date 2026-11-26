// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Schema } from "effect";
import { render } from "ilha/test";

import { defineComponent } from "./index";

// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
const ChildMsg = Schema.TaggedUnion({
  Add: { amount: Schema.Number },
  Nudge: {},
});
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
type ChildMsg = typeof ChildMsg.Type;

// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
const ChildEvent = Schema.TaggedUnion({
  Reached: { count: Schema.Number },
});
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
type ChildEvent = typeof ChildEvent.Type;

const Child = defineComponent({
  events: ChildEvent,
  message: ChildMsg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "Child",
  props: Schema.Struct({ label: Schema.String }),
}).make({
  init: () => ({ count: 0 }),
  update: {
    Add: ($, { amount }) => {
      const count = $.model.count + amount;
      return $.set({ count }).emit(ChildEvent.cases.Reached.make({ count }));
    },
    Nudge: ($) => $.evolve({ count: (c) => c + 1 }),
  },
  view: (h, model) => (
    <div>
      <span>
        {h.props.label}:{model.count}
      </span>
      <button
        data-testid="add"
        onclick={h.send(ChildMsg.cases.Add.make({ amount: 1 }))}
      >
        add
      </button>
      <button
        data-testid="nudge"
        onclick={h.send(ChildMsg.cases.Nudge.make({}))}
      >
        nudge
      </button>
    </div>
  ),
});

// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
const PageMsg = Schema.TaggedUnion({
  ParentBump: {},
  Reached: { count: Schema.Number },
});
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
type PageMsg = typeof PageMsg.Type;

let parentViews = 0;

const Page = defineComponent({
  message: PageMsg,
  model: Schema.Struct({ bumps: Schema.Number, total: Schema.Number }),
  name: "Page",
}).make({
  init: () => ({ bumps: 0, total: 0 }),
  update: {
    ParentBump: ($) => $.evolve({ bumps: (b) => b + 1 }),
    Reached: ($, { count }) => $.evolve({ total: (t) => t + count }),
  },
  view: (h, model) => {
    parentViews += 1;
    return (
      <div>
        <p>
          {model.total}/{model.bumps}
        </p>
        <button
          data-testid="parent"
          onclick={h.send(PageMsg.cases.ParentBump.make({}))}
        >
          parent
        </button>
        <Child
          props={{ label: "kid" }}
          onEmit={h.send((event: ChildEvent) =>
            PageMsg.cases.Reached.make({ count: event.count })
          )}
        />
      </div>
    );
  },
});

describe("parent and child", () => {
  it("forwards props and emits back to the parent", async () => {
    parentViews = 0;
    const ui = render(() => <Page />);
    await ui.settled();
    expect(ui.text()).toContain("kid:0");
    await ui.click('[data-testid="add"]');
    expect(ui.text()).toContain("kid:1");
    expect(ui.text()).toContain("1/0");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("re-renders the child without re-running the parent", async () => {
    parentViews = 0;
    const ui = render(() => <Page />);
    await ui.settled();
    const views = parentViews;
    await ui.click('[data-testid="nudge"]');
    expect(ui.text()).toContain("kid:1");
    expect(parentViews).toBe(views);
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("keeps child state when the parent re-renders", async () => {
    parentViews = 0;
    const ui = render(() => <Page />);
    await ui.settled();
    await ui.click('[data-testid="nudge"]');
    expect(ui.text()).toContain("kid:1");
    await ui.click('[data-testid="parent"]');
    expect(ui.text()).toContain("kid:1");
    expect(ui.text()).toContain("0/1");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });
});
