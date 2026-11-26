/**
 * `defineComponent` and `Def` helpers: defaults, slices, `combine` and the
 * finish checks. Ported from Effect UI's `Define.test.ts` (the `Story`
 * parts run through `render` here).
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import * as Command from "./command.ts";
import { defineComponent, isStep } from "./component.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const Message = TaggedEnum({ Logged: { n: Schema.Number }, Step: {} });
const Events = TaggedEnum({ Stepped: { n: Schema.Number } });

const Log = Command.make("Log", { args: { n: Schema.Number } }, ({ n }) =>
  Effect.succeed(Message.Logged({ n }))
);

const CounterDef = defineComponent({
  events: Events,
  message: Message,
  model: Schema.Struct({ n: Schema.Number, seen: Schema.Array(Schema.String) }),
  name: "DefineCounter",
  props: Schema.Struct({ by: Schema.Number }),
});

// Changes the Model, runs a Command and emits, all from the Model it is given.
const bump = CounterDef.update(($, msg) => {
  const n = $.model.n + $.props.by;
  return $.set({ n, seen: [...$.model.seen, msg._tag] })
    .run(Log.make({ n }))
    .emit(Events.Stepped({ n }));
});

const Counter = CounterDef.make({
  init: () => ({ n: 0, seen: [] }),
  update: {
    Logged: ($, { n }) => $.evolve({ n, seen: [...$.model.seen, "Logged"] }),
    Step: ($, message) => bump($, message),
  },
  view: (h, model) => (
    <div>
      <output id="n">{String(model.n)}</output>
      <output id="seen">{model.seen.join(",")}</output>
      <output id="running">{String(h.isRunning(Log))}</output>
      <button id="step" onclick={h.send(Message.Step())}>
        step
      </button>
    </div>
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

describe("defineComponent", () => {
  it("uses Struct({}) props and Never events by default", () => {
    const Def = defineComponent({
      message: Message,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Bare",
    });
    expect(
      // SAFETY: Bare uses the default Struct({}) props; the cast recovers the empty-struct schema for decoding.
      // oxlint-disable-next-line typescript/no-empty-object-type, typescript/ban-types -- default props are the empty struct; {} states the empty shape.
      Schema.decodeUnknownSync(Def.props as Schema.Struct<{}>)({})
    ).toEqual({});
    const C = Def.make({
      init: () => ({ n: 0 }),
      update: { Logged: ($) => $.model, Step: ($) => $.model },
      view: () => "bare",
    });
    expect(C.definitionName).toBe("Bare");
    expect(C.definition.name).toBe("Bare");
  });

  it("keeps the function's own name untouched", () => {
    expect(Counter.name).not.toBe("DefineCounter");
  });

  it("runs slices, Commands and emits through the view", async () => {
    const seen: number[] = [];
    const PageDef = defineComponent({
      message: TaggedEnum({ Stepped: { n: Schema.Number } }),
      model: Schema.Struct({ last: Schema.Number }),
      name: "DefinePage",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => ({ last: -1 }),
      update: { Stepped: ($, { n }) => $.set({ last: n }) },
      view: (_h, model) => (
        <div>
          <output id="last">{String(model.last)}</output>
          <Counter
            props={{ by: 2 }}
            onStepped={({ n }) => ({ _tag: "Stepped", n })}
          />
        </div>
      ),
    });
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await ui.click("#step");
    await waitFor(() => ui.query("#n")?.textContent === "2");
    await waitFor(() => ui.query("#last")?.textContent === "2");
    expect(ui.query("#seen")?.textContent).toBe("Step,Logged");
    ui.unmount();
    expect(seen).toEqual([]);
  });

  it("types a whole-message update against the definition", () => {
    const whole = CounterDef.update(($, message) =>
      $.set({ n: 0, seen: [message._tag] })
    );
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- asserts update() returns a plain callable slice, not a step object.
    expect(typeof whole).toBe("function");
  });

  it("calls a slice by hand with a message other than the one it received", () => {
    const ByHandDef = defineComponent({
      message: Message,
      model: Schema.Struct({ n: Schema.Number }),
      name: "ByHand",
    });
    const onLogged = ByHandDef.update("Logged", ($) => $.set({ n: 7 }));
    const ByHand = ByHandDef.make({
      init: () => ({ n: 0 }),
      update: ($, message) => {
        const out = onLogged($, Message.Logged({ n: 0 }));
        return (isStep(out) ? out : $.set(out)).set({
          n: message._tag === "Step" ? 1 : 9,
        });
      },
      view: (h, model) => (
        <button id="go" onclick={h.send(Message.Step())}>
          {String(model.n)}
        </button>
      ),
    });
    return (async () => {
      const ui = render(() => <ByHand props={{}} />);
      await ui.settled();
      await ui.click("#go");
      expect(ui.query("#go")?.textContent).toBe("1");
      ui.unmount();
    })();
  });

  it("passes the dispatched message to functions combined inside a slice", async () => {
    const got: unknown[] = [];
    const CombineDef = defineComponent({
      message: Message,
      model: Schema.Struct({ n: Schema.Number }),
      name: "CombineMessage",
    });
    const Combine = CombineDef.make({
      init: () => ({ n: 0 }),
      update: {
        Logged: ($, { n }) => $.set({ n }),
        Step: ($) =>
          $.combine(
            ($2, m2) => {
              got.push(m2);
              return $2;
            },
            ($3, m3) => {
              got.push(m3);
              return $3.set({ n: 7 });
            }
          ),
      },
      view: (h, model) => (
        <button id="go" onclick={h.send(Message.Step())}>
          {String(model.n)}
        </button>
      ),
    });
    const ui = render(() => <Combine props={{}} />);
    await ui.settled();
    await ui.click("#go");
    await waitFor(() => ui.query("#go")?.textContent === "7");
    expect(got).toEqual([Message.Step(), Message.Step()]);
    ui.unmount();
  });

  it("throws when shares is set: only a headless component can share state", () => {
    const Def = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "Sharing",
      shares: () => "value",
    });
    expect(() =>
      Def.make({ init: () => null, update: ($) => $, view: () => "x" })
    ).toThrow("only a headless component can share state");
  });

  it("rejects a slice inside a whole-message combine at run time", async () => {
    const slice = CounterDef.update("Logged", ($) => $);
    const BadDef = defineComponent({
      message: Message,
      model: Schema.Struct({ n: Schema.Number }),
      name: "BadCombine",
    });
    const Bad = BadDef.make({
      init: () => ({ n: 0 }),
      // SAFETY: deliberately passes a slice into a whole-message combine to assert it fails at run time.
      update: ($, message) =>
        $.combine(slice as never, () =>
          $.set({ n: message._tag === "Step" ? 1 : 0 })
        ),
      view: (h, model) => (
        <div>
          <output id="n">{String(model.n)}</output>
          <button id="go" onclick={h.send(Message.Step())}>
            go
          </button>
        </div>
      ),
    });
    const FailingDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "BadCombinePage",
      props: Schema.Struct({}),
    });
    const Failing = FailingDef.make({
      init: () => null,
      update: ($) => $,
      view: () => (
        <div>
          <Bad
            props={{}}
            fallback={() => <output id="fallback">failed</output>}
          />
        </div>
      ),
    });
    const ui = render(() => <Failing props={{}} />);
    await ui.settled();
    await ui.click("#go");
    await waitFor(() => ui.query("#fallback")?.textContent === "failed");
    ui.unmount();
  });
});
