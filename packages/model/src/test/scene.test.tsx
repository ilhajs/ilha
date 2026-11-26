/**
 * Scene tests: the ported interaction, child-step, click-sequence and
 * matcher cases whose features exist.
 */
// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { defineComponent, TaggedEnum } from "../index.ts";
import * as Locator from "./locator.ts";
import * as Scene from "./scene.ts";
import type { AnyComponent, PropsOf } from "./steps.ts";

const runScene = <C extends AnyComponent, A>(
  component: C,
  props: PropsOf<C>,
  fn: (scene: Scene.Steps<C>) => A
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(Effect.map(Scene.make(component, props), fn))
  );
const CounterMessage = TaggedEnum({
  Decrement: {},
  Increment: {},
});

const CounterDef = defineComponent({
  message: CounterMessage,
  model: Schema.Struct({ count: Schema.Number }),
  name: "Counter",
  props: Schema.Struct({ initial: Schema.Number }),
});

const Counter = CounterDef.make({
  init: ($, props) => $.set({ count: props.initial }),
  update: {
    Decrement: ($) => $.set({ count: $.model.count - 1 }),
    Increment: ($) => $.set({ count: $.model.count + 1 }),
  },
  view: (h, model) => (
    <div>
      <button onclick={h.send(CounterMessage.Decrement())}>-</button>
      <span>{String(model.count)}</span>
      <button onclick={h.send(CounterMessage.Increment())}>+</button>
    </div>
  ),
});
// A step shared by any component keeps the caller's type: every step returns
// its own cursor.
const clickPlus = <S extends Scene.Steps.Any>(scene: S): S =>
  // SAFETY: steps return `this`, so expectIgnored returns the same cursor it was called on.
  scene.fire(Locator.text("+"), "click").expectIgnored() as S;

describe("Scene counter", () => {
  // Plain buttons have no pointer handlers or default actions, so firing
  // their click handler directly delivers the same message `click` would.

  it("counts by clicking", async () => {
    await runScene(Counter, { initial: 1 }, (scene) => {
      scene.fire(Locator.text("+"), "click").expectIgnored();
      scene.fire(Locator.text("+"), "click").expectIgnored();
      scene.fire(Locator.text("-"), "click").expectIgnored();
      scene.expect(Locator.tag("span")).toHaveText("2");
    });
  });

  it("given starts from any model, and a cursor function is a shared setup", async () => {
    const twice = (scene: Scene.Steps<typeof Counter>) =>
      scene
        .fire(Locator.text("+"), "click")
        .expectIgnored()
        .fire(Locator.text("+"), "click")
        .expectIgnored();
    await runScene(Counter, { initial: 1 }, (scene) => {
      scene.given({ count: 10 }).pipe(twice);
      scene.expect(Locator.tag("span")).toHaveText("12");
    });
  });

  it("steps run as separate statements on one cursor", async () => {
    await runScene(Counter, { initial: 0 }, (scene) => {
      scene.fire(Locator.text("+"), "click").expectIgnored();
      scene.fire(Locator.text("+"), "click").expectIgnored();
      scene.expect(Locator.tag("span")).toHaveText("2");
    });
  });

  it("a step shared by any component keeps the caller's type", async () => {
    await runScene(Counter, { initial: 0 }, (scene) => {
      scene.pipe(clickPlus).expect(Locator.tag("span")).toHaveText("1");
    });
  });

  it("the record answers locator queries over the view", () => {
    const scene = Scene.start(Counter, { initial: 3 }).current;
    expect(Locator.textOf(scene.get(Locator.tag("span")))).toBe("3");
    expect(scene.all(Locator.tag("button"))).toHaveLength(2);
    expect(scene.query(Locator.text("missing"))).toBeUndefined();
  });
});

describe("Scene events", () => {
  const Message = TaggedEnum({
    Pressed: {},
    Typed: { value: Schema.String },
  });
  const FormDef = defineComponent({
    message: Message,
    model: Schema.Struct({ presses: Schema.Number, value: Schema.String }),
    name: "Form",
  });
  const Form = FormDef.make({
    init: () => ({ presses: 0, value: "" }),
    update: {
      Pressed: ($) => $.set({ ...$.model, presses: $.model.presses + 1 }),
      Typed: ($, { value }) => $.set({ ...$.model, value }),
    },
    view: (h, model) => (
      <div>
        <input
          data-testid="name"
          oninput={h.send((payload) =>
            Message.Typed({
              // SAFETY: the harness delivers the synthetic input event the type step built, which always carries value.
              value: (payload as { readonly value: string }).value,
            })
          )}
        />
        <button onclick={h.send(Message.Pressed())}>
          <span>Save</span>
        </button>
        <p>Save draft</p>
        <p>plain</p>
        <output data-testid="value">{model.value}</output>
        <output data-testid="presses">{String(model.presses)}</output>
      </div>
    ),
  });

  it("fire sends the payload to the element the locator matches", async () => {
    await runScene(Form, {}, (scene) => {
      scene
        .fire(Locator.testId("name"), "input", { value: "Ada" })
        .expectIgnored();
      scene.expect(Locator.testId("value")).toHaveText("Ada");
    });
  });

  it("click bubbles from the matched element to the nearest ancestor that handles it", async () => {
    await runScene(Form, {}, (scene) => {
      // `fire` with "click" takes the same bubbling handler path `click` would.
      scene
        .fire(Locator.text("Save", { exact: true }), "click")
        .expectIgnored();
      scene.fire(Locator.tag("span"), "click").expectIgnored();
      scene.expect(Locator.testId("presses")).toHaveText("2");
    });
  });

  it("a locator that matches nothing or several elements throws", () => {
    expect(() => Scene.start(Form, {}).click("Save")).toThrow(
      '2 elements match text "Save"'
    );
    expect(() => Scene.start(Form, {}).click("missing")).toThrow(
      'nothing matches text "missing"'
    );
  });

  it("an element nothing handles the event for throws", () => {
    expect(() => Scene.start(Form, {}).click("plain")).toThrow(
      'nothing handles "click" at text "plain"'
    );
    expect(() =>
      Scene.start(Form, {}).fire(Locator.testId("name"), "change")
    ).toThrow('nothing handles "change"');
  });
});

describe("Scene defaultPrevented", () => {
  const Sent = TaggedEnum({ Send: {} });
  const ComposerDef = defineComponent({
    message: Sent,
    model: Schema.Number,
    name: "Composer",
  });
  const Composer = ComposerDef.make({
    init: () => 0,
    update: ($) => $.model + 1,
    view: (h, sent) => (
      <div>
        <textarea
          onkeydown={h.send(
            (payload) =>
              // SAFETY: the harness delivers the synthetic keydown event the key step built, which always carries key.
              (payload as { readonly key: string }).key === "Enter"
                ? Sent.Send()
                : undefined,
            { preventDefault: true }
          )}
        />
        <form onsubmit={h.send(() => {})}>
          <button>Ignored</button>
        </form>
        <form>
          <button>Unhandled</button>
        </form>
        <p oncontextmenu={h.send(() => {}, { preventDefault: "always" })}>
          Menu
        </p>
        <output>{String(sent)}</output>
      </div>
    ),
  });
  const keyDown = (key: string) => (scene: Scene.Steps<typeof Composer>) =>
    scene.fire(Locator.tag("textarea"), "keydown", { key });

  it("reports a cancelled default until the next step that makes a record", async () => {
    await runScene(Composer, {}, (scene) => {
      scene.pipe(keyDown("Enter")).expectIgnored();
      scene.expect(Locator.tag("output")).toHaveText("1");
      expect(scene.defaultPrevented).toBe(true);
      scene.props({});
      expect(scene.defaultPrevented).toBe(false);
      scene
        .pipe(keyDown("Enter"))
        .expectIgnored()
        .pipe(keyDown("a"))
        .expectIgnored();
      expect(scene.defaultPrevented).toBe(false);
      // A form's submission is always cancelled, whatever its handler returns.
      scene.fire(Locator.text("Ignored"), "submit").expectIgnored();
      expect(scene.defaultPrevented).toBe(true);
      // A form with no submit handler is like any element nothing handles the event for.
      expect(() => scene.fire(Locator.text("Unhandled"), "submit")).toThrow(
        'nothing handles "submit"'
      );
      scene.expect(Locator.tag("output")).toHaveText("2");
      // "always" cancels whatever the handler returns.
      scene.fire(Locator.text("Menu"), "contextmenu").expectIgnored();
      expect(scene.defaultPrevented).toBe(true);
    });
  });
});

describe("Scene children", () => {
  const LeafEvents = TaggedEnum({ Picked: { id: Schema.String } });
  const LeafDef = defineComponent({
    events: LeafEvents,
    message: Schema.Never,
    model: Schema.Struct({}),
    name: "Leaf",
    props: Schema.Struct({}),
  });
  const Leaf = LeafDef.make({
    init: () => ({}),
    update: ($) => $,
    view: () => <i>leaf</i>,
  });
  const ParentMessage = TaggedEnum({ Failed: {}, Got: { id: Schema.String } });
  const ParentDef = defineComponent({
    message: ParentMessage,
    model: Schema.Struct({ failed: Schema.Boolean, got: Schema.String }),
    name: "Parent",
  });
  const Parent = ParentDef.make({
    init: () => ({ failed: false, got: "" }),
    update: {
      Failed: ($) => $.set({ ...$.model, failed: true }),
      Got: ($, { id }) => $.set({ ...$.model, got: id }),
    },
    view: (_h, model) => (
      <div>
        <output data-testid="got">{model.got}</output>
        <output data-testid="failed">{String(model.failed)}</output>
        <Leaf
          key="a"
          onEmit={{
            Picked: (event) =>
              // SAFETY: the stub child's Picked event always carries the id the test emitted.
              ParentMessage.Got({ id: (event as { readonly id: string }).id }),
          }}
        />
        <Leaf
          key="b"
          onEmit={{
            Picked: (event) =>
              // SAFETY: the stub child's Picked event always carries the id the test emitted.
              ParentMessage.Got({ id: (event as { readonly id: string }).id }),
          }}
          onFailure={() => ParentMessage.Failed()}
          fallback={() => <p>down</p>}
        />
      </div>
    ),
  });

  it("childEmit sends the parent's onEmit mapping", async () => {
    await runScene(Parent, {}, (scene) => {
      scene.childEmit(Leaf, "a", LeafEvents.Picked({ id: "x" }));
      scene.expect(Locator.testId("got")).toHaveText("x");
    });
  });

  it("childEmit without a key throws on several matches", () => {
    expect(() =>
      Scene.start(Parent, {}).childEmit(Leaf, LeafEvents.Picked({ id: "x" }))
    ).toThrow("several children match Leaf");
  });

  it("childEmit on a missing child lists the rendered children", () => {
    const OtherDef = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "Other",
    });
    const Other = OtherDef.make({
      init: () => ({}),
      update: ($) => $,
      view: () => <i />,
    });
    expect(() =>
      Scene.start(Parent, {}).childEmit(Other, LeafEvents.Picked({ id: "x" }))
    ).toThrow("the view has no child Other");
  });

  it("childFailure shows the fallback and sends onFailure", async () => {
    await runScene(Parent, {}, (scene) => {
      scene.childFailure(Leaf, "b", Cause.die("boom"));
      scene.expect(Locator.text("down")).toExist();
      // The update ran: the parent recorded the failure.
      scene.expect(Locator.testId("failed")).toHaveText("true");
    });
  });

  it("childPending needs a fallback and shows it until a failure", async () => {
    expect(() => Scene.start(Parent, {}).childPending(Leaf, "a")).toThrow(
      "has no fallback"
    );
    await runScene(Parent, {}, (scene) => {
      scene.childPending(Leaf, "b");
      scene.expect(Locator.text("down")).toExist();
      scene.childFailure(Leaf, "b", Cause.die("boom"));
      scene.expect(Locator.text("down")).toExist();
    });
  });

  it("children and fallback read the view's leaves", () => {
    const scene = Scene.start(Parent, {});
    const found = Scene.children(scene.root, Leaf);
    expect(found.map((entry) => entry.path)).toEqual([
      "/Parent/Leaf[a]",
      "/Parent/Leaf[b]",
    ]);
    const failure = Cause.die("boom");
    void failure;
  });
});

describe("Scene click defaults", () => {
  const ToggleMessage = TaggedEnum({ Toggled: { on: Schema.Boolean } });
  const ToggleDef = defineComponent({
    message: ToggleMessage,
    model: Schema.Struct({ on: Schema.Boolean }),
    name: "Toggle",
  });
  const Toggle = ToggleDef.make({
    init: () => ({ on: false }),
    update: {
      Toggled: ($, { on }) => $.set({ on }),
    },
    view: (h, model) => (
      <div>
        <input
          type="checkbox"
          data-testid="box"
          checked={model.on}
          onchange={h.send((event) =>
            ToggleMessage.Toggled({
              // SAFETY: the harness delivers the synthetic checkbox event the click step built, which always carries checked.
              on: (event as { readonly checked: boolean }).checked,
            })
          )}
        />
      </div>
    ),
  });

  it("a checkbox fires input and change with the checked state flipped", async () => {
    await runScene(Toggle, {}, (scene) => {
      scene.expect(Locator.testId("box")).toBeChecked(false);
      scene.click(Locator.testId("box"));
      scene.expect(Locator.testId("box")).toBeChecked(true);
      scene.click(Locator.testId("box"));
      scene.expect(Locator.testId("box")).toBeChecked(false);
    });
  });

  it("a disabled control throws", () => {
    const DisabledDef = defineComponent({
      message: CounterMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Disabled",
    });
    const Disabled = DisabledDef.make({
      init: () => ({ n: 0 }),
      update: {
        Decrement: ($) => $,
        Increment: ($) => $.set({ n: 1 }),
      },
      view: (h, model) => (
        <div>
          <button disabled onclick={h.send(CounterMessage.Increment())}>
            off
          </button>
          <fieldset disabled>
            <button onclick={h.send(CounterMessage.Increment())}>
              nested {String(model.n)}
            </button>
          </fieldset>
        </div>
      ),
    });
    expect(() => Scene.start(Disabled, {}).click("off")).toThrow("is disabled");
    expect(() => Scene.start(Disabled, {}).click("nested")).toThrow(
      "is disabled"
    );
  });

  it("a submit button submits its form with the view's fields", async () => {
    const SubmitMessage = TaggedEnum({ Submitted: { q: Schema.String } });
    const SearchDef = defineComponent({
      message: SubmitMessage,
      model: Schema.Struct({ q: Schema.String, submitted: Schema.String }),
      name: "Search",
    });
    const Search = SearchDef.make({
      init: () => ({ q: "", submitted: "" }),
      update: {
        Submitted: ($, { q }) => $.set({ ...$.model, submitted: q }),
      },
      view: (h, model) => (
        <form
          onsubmit={h.send((event) => {
            // SAFETY: the harness delivers the synthetic submit event the submit step built, which always carries fields.
            const { fields } = event as {
              readonly fields: Record<string, string>;
            };
            return SubmitMessage.Submitted({ q: fields["q"] ?? "" });
          })}
        >
          <input name="q" value={model.q} oninput={h.send(() => {})} />
          <button>Go</button>
          <output data-testid="submitted">{model.submitted}</output>
        </form>
      ),
    });
    await runScene(Search, {}, (scene) => {
      scene.given({ q: "ada", submitted: "" });
      scene.click("Go");
      scene.expect(Locator.testId("submitted")).toHaveText("ada");
    });
  });

  it("radio buttons check exactly one", async () => {
    const PickMessage = TaggedEnum({ Picked: { choice: Schema.String } });
    const PickDef = defineComponent({
      message: PickMessage,
      model: Schema.Struct({ choice: Schema.String }),
      name: "Pick",
    });
    const Pick = PickDef.make({
      init: () => ({ choice: "a" }),
      update: {
        Picked: ($, { choice }) => $.set({ choice }),
      },
      view: (h, model) => (
        <div>
          <input
            type="radio"
            name="choice"
            data-testid="a"
            checked={model.choice === "a"}
            onchange={h.send(() => PickMessage.Picked({ choice: "a" }))}
          />
          <input
            type="radio"
            name="choice"
            data-testid="b"
            checked={model.choice === "b"}
            onchange={h.send(() => PickMessage.Picked({ choice: "b" }))}
          />
        </div>
      ),
    });
    await runScene(Pick, {}, (scene) => {
      scene.expect(Locator.testId("a")).toBeChecked(true);
      scene.click(Locator.testId("b"));
      scene.expect(Locator.testId("b")).toBeChecked(true);
      scene.expect(Locator.testId("a")).toBeChecked(false);
    });
  });
});

describe("Scene field steps", () => {
  const Typed = TaggedEnum({ Submitted: {}, Typed: { value: Schema.String } });
  const FieldDef = defineComponent({
    message: Typed,
    model: Schema.Struct({ submitted: Schema.Boolean, value: Schema.String }),
    name: "Field",
  });
  const Field = FieldDef.make({
    init: () => ({ submitted: false, value: "" }),
    update: {
      Submitted: ($) => $.set({ ...$.model, submitted: true }),
      Typed: ($, { value }) => $.set({ ...$.model, value }),
    },
    view: (h, model) => (
      <div>
        <input
          data-testid="name"
          value={model.value}
          oninput={h.send((event) =>
            // SAFETY: the harness delivers the synthetic input event the type step built, which always carries value.
            Typed.Typed({ value: (event as { readonly value: string }).value })
          )}
          onchange={h.send((event) =>
            // SAFETY: the harness delivers the synthetic input event the change step built, which always carries value.
            Typed.Typed({ value: (event as { readonly value: string }).value })
          )}
        />
        <form onsubmit={h.send(() => Typed.Submitted())}>
          <button>Send</button>
        </form>
        <output data-testid="value">{model.value}</output>
        <output data-testid="sent">{String(model.submitted)}</output>
      </div>
    ),
  });

  it("type and change write the field", async () => {
    await runScene(Field, {}, (scene) => {
      scene.type(Locator.testId("name"), "Ada").expectIgnored();
      scene.expect(Locator.testId("value")).toHaveText("Ada");
      scene.expect(Locator.testId("name")).toHaveValue("Ada");
      scene.change(Locator.testId("name"), "Grace").expectIgnored();
      scene.expect(Locator.testId("value")).toHaveText("Grace");
    });
  });

  it("submit fires the form", async () => {
    await runScene(Field, {}, (scene) => {
      scene.submit(Locator.tag("form")).expectIgnored();
      scene.expect(Locator.testId("sent")).toHaveText("true");
    });
  });

  it("keydown sends the key", async () => {
    const Keyed = TaggedEnum({ Key: { key: Schema.String } });
    const KeyDef = defineComponent({
      message: Keyed,
      model: Schema.Struct({ key: Schema.String }),
      name: "Key",
    });
    const Keys = KeyDef.make({
      init: () => ({ key: "" }),
      update: {
        Key: ($, { key }) => $.set({ key }),
      },
      view: (h, model) => (
        <div>
          <input
            data-testid="in"
            onkeydown={h.send((event) =>
              // SAFETY: the harness delivers the synthetic keydown event the key step built, which always carries key.
              Keyed.Key({ key: (event as { readonly key: string }).key })
            )}
            onfocus={h.send(() => Keyed.Key({ key: "focus" }))}
            onblur={h.send(() => Keyed.Key({ key: "blur" }))}
          />
          <output data-testid="out">{model.key}</output>
        </div>
      ),
    });
    await runScene(Keys, {}, (scene) => {
      scene.keydown(Locator.testId("in"), "Enter").expectIgnored();
      scene.expect(Locator.testId("out")).toHaveText("Enter");
      scene.focus(Locator.testId("in")).expectIgnored();
      scene.expect(Locator.testId("out")).toHaveText("focus");
      scene.blur(Locator.testId("in")).expectIgnored();
      scene.expect(Locator.testId("out")).toHaveText("blur");
    });
  });
});
