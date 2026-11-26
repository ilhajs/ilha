/**
 * Calling a child: call options, `onEmit` forms, `onFailure`/`fallback` and
 * authorship through forwarding. Ported from Effect UI's `Child.test.ts`
 * (the `View.Child`-node assertions don't apply: model children are Ilha
 * vnodes, and `provide`/headless/feature children belong to other slices).
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import { defineComponent, isComponent } from "./component.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const RowMessage = TaggedEnum({ Typed: { text: Schema.String } });
const RowEvents = TaggedEnum({ Changed: { text: Schema.String } });

const RowDef = defineComponent({
  events: RowEvents,
  message: RowMessage,
  model: Schema.String,
  name: "ChildRow",
  props: Schema.Struct({ id: Schema.String }),
});

const Row = RowDef.make({
  init: () => "",
  update: ($) => $.model,
  view: (h, text) => (
    <li>
      {h.props.id}:{text}
    </li>
  ),
});

const waitFor = async (
  what: () => boolean,
  timeoutMs = 3000
): Promise<void> => {
  const start = Date.now();
  while (!what()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- polls an async condition; each sleep must follow the previous check.
    await Effect.runPromise(Effect.sleep("5 millis"));
  }
};

describe("a component call", () => {
  it("is a function that keeps the component's fields", () => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- asserts the component call is a plain function, not a vnode object.
    expect(typeof Row).toBe("function");
    expect(Row.definition === RowDef).toBe(true);
    expect(Row.definition.name).toBe("ChildRow");
    expect(Row.name).not.toBe("ChildRow");
    expect(isComponent(Row)).toBe(true);
    expect(isComponent(() => "x")).toBe(false);
  });

  it("nests the component props under props", async () => {
    const ui = render(() => <Row props={{ id: "a" }} />);
    await ui.settled();
    expect(ui.html()).toContain("a:");
    ui.unmount();
  });

  it("routes a function onEmit to the author", async () => {
    const ParentDef = defineComponent({
      message: TaggedEnum({ Changed: { text: Schema.String } }),
      model: Schema.Struct({ last: Schema.String }),
      name: "ChildFnPage",
      props: Schema.Struct({}),
    });
    const Emitting = defineComponent({
      events: TaggedEnum({ Changed: { text: Schema.String } }),
      message: TaggedEnum({ Fire: {} }),
      model: Schema.Struct({ n: Schema.Number }),
      name: "ChildEmitting",
      props: Schema.Struct({}),
    }).make({
      init: () => ({ n: 0 }),
      update: {
        Fire: ($) => $.set({ n: 1 }).emit({ _tag: "Changed", text: "hi" }),
      },
      view: (h) => (
        <button id="fire" onclick={h.send({ _tag: "Fire" })}>
          fire
        </button>
      ),
    });
    const Parent = ParentDef.make({
      init: () => ({ last: "" }),
      update: { Changed: ($, { text }) => $.set({ last: text }) },
      view: (_h, model) => (
        <div>
          <output id="last">{model.last}</output>
          <Emitting
            props={{}}
            onEmit={(event) => ({ _tag: "Changed", text: event.text })}
          />
        </div>
      ),
    });
    const ui = render(() => <Parent props={{}} />);
    await ui.settled();
    await ui.click("#fire");
    await waitFor(() => ui.query("#last")?.textContent === "hi");
    ui.unmount();
  });

  it("dispatches a per-tag onEmit on event._tag and ignores unknown events", async () => {
    const ParentDef = defineComponent({
      message: TaggedEnum({ Changed: { text: Schema.String } }),
      model: Schema.Struct({ last: Schema.String }),
      name: "ChildRecordPage",
      props: Schema.Struct({}),
    });
    const Emitting = defineComponent({
      events: TaggedEnum({ Changed: { text: Schema.String }, Ignored: {} }),
      message: TaggedEnum({ Fire: {}, Other: {} }),
      model: Schema.Null,
      name: "ChildRecordEmitting",
      props: Schema.Struct({}),
    }).make({
      init: () => null,
      update: {
        Fire: ($) => $.emit({ _tag: "Changed", text: "tagged" }),
        Other: ($) => $.emit({ _tag: "Ignored" }),
      },
      view: (h) => (
        <div>
          <button id="fire" onclick={h.send({ _tag: "Fire" })}>
            fire
          </button>
          <button id="other" onclick={h.send({ _tag: "Other" })}>
            other
          </button>
        </div>
      ),
    });
    const Parent = ParentDef.make({
      init: () => ({ last: "" }),
      update: { Changed: ($, { text }) => $.set({ last: text }) },
      view: (_h, model) => (
        <div>
          <output id="last">{model.last}</output>
          <Emitting
            props={{}}
            onEmit={{ Changed: ({ text }) => ({ _tag: "Changed", text }) }}
          />
        </div>
      ),
    });
    const ui = render(() => <Parent props={{}} />);
    await ui.settled();
    await ui.click("#other");
    await ui.click("#fire");
    await waitFor(() => ui.query("#last")?.textContent === "tagged");
    ui.unmount();
  });

  it("routes emits to the writer through h.children", async () => {
    const MiddleDef = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "ChildMiddle",
      props: Schema.Struct({}),
    });
    const Middle = MiddleDef.make({
      init: () => ({}),
      update: ($) => $,
      view: (h) => <div id="middle">{h.children}</div>,
    });
    const ShellDef = defineComponent({
      message: TaggedEnum({ Bump: { count: Schema.Number } }),
      model: Schema.Struct({ total: Schema.Number }),
      name: "ChildShell",
      props: Schema.Struct({}),
    });
    const CounterDef = defineComponent({
      events: TaggedEnum({ Changed: { count: Schema.Number } }),
      message: TaggedEnum({ Increment: {} }),
      model: Schema.Struct({ count: Schema.Number }),
      name: "ChildCounter",
      props: Schema.Struct({ initial: Schema.Number }),
    });
    const Counter = CounterDef.make({
      init: (_, props) => ({ count: props.initial }),
      update: {
        Increment: ($) =>
          $.set({ count: $.model.count + 1 }).emit({
            _tag: "Changed",
            count: $.model.count + 1,
          }),
      },
      view: (h, model) => (
        <button id="inc" onclick={h.send({ _tag: "Increment" })}>
          {model.count}
        </button>
      ),
    });
    const Shell = ShellDef.make({
      init: () => ({ total: 0 }),
      update: { Bump: ($, message) => $.set({ total: message.count }) },
      view: (_h, model) => (
        <div>
          <output id="total">{String(model.total)}</output>
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
    await ui.click("#inc");
    await waitFor(() => ui.query("#total")?.textContent === "11");
    ui.unmount();
  });

  it("shows the author's fallback and maps onFailure while the child stays failed", async () => {
    const BrokenDef = defineComponent({
      message: TaggedEnum({ Boom: {} }),
      model: Schema.Null,
      name: "ChildBroken",
      props: Schema.Struct({}),
    });
    const Broken = BrokenDef.make({
      init: () => null,
      update: () => {
        throw new Error("boom");
      },
      view: (h) => (
        <button id="boom" onclick={h.send({ _tag: "Boom" })}>
          boom
        </button>
      ),
    });
    const ParentDef = defineComponent({
      message: TaggedEnum({ FailedChild: {} }),
      model: Schema.Struct({ heard: Schema.Boolean }),
      name: "ChildFailurePage",
      props: Schema.Struct({}),
    });
    const Parent = ParentDef.make({
      init: () => ({ heard: false }),
      update: { FailedChild: ($) => $.set({ heard: true }) },
      view: (_h, model) => (
        <div>
          <output id="heard">{String(model.heard)}</output>
          <Broken
            props={{}}
            fallback={() => <output id="fallback">unavailable</output>}
            onFailure={() => ({ _tag: "FailedChild" })}
          />
        </div>
      ),
    });
    const ui = render(() => <Parent props={{}} />);
    await ui.settled();
    await ui.click("#boom");
    await waitFor(() => ui.query("#fallback")?.textContent === "unavailable");
    await waitFor(() => ui.query("#heard")?.textContent === "true");
    ui.unmount();
  });
});
