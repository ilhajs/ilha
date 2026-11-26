/**
 * Keep-alive children: the Model, running Commands and Subscriptions survive
 * while the author hides the child, the DOM is rebuilt from the kept Model
 * when it is drawn again, predicates drop children, keys must be literal and
 * `h`/`s` must not share a key. Adapted from Effect UI's kept rules
 * (`component §6.3`) with the documented Ilha limit: uncontrolled DOM state
 * is not preserved.
 */

import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import * as Command from "./command.ts";
import { defineComponent } from "./component.ts";
import * as Subscription from "./subscription.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const KidMsg = TaggedEnum({ Inc: {} });

const KidDef = defineComponent({
  message: KidMsg,
  model: Schema.Number,
  name: "KeptKid",
  props: Schema.Struct({ tag: Schema.String }),
});

const Kid = KidDef.make({
  init: () => 0,
  update: { Inc: ($) => $.model + 1 },
  view: (h, n) => (
    <div>
      <button id={`inc-${h.props.tag}`} onclick={h.send({ _tag: "Inc" })}>
        inc
      </button>
      <output id={`n-${h.props.tag}`}>{n}</output>
    </div>
  ),
});

const PageMsg = TaggedEnum({ Toggle: {} });

const makePage = () =>
  defineComponent({
    message: PageMsg,
    model: Schema.Boolean,
    name: "KeepPage",
    props: Schema.Struct({}),
  }).make({
    init: () => true,
    update: { Toggle: ($) => !$.model },
    view: (h, show) => (
      <div>
        <button id="toggle" onclick={h.send({ _tag: "Toggle" })}>
          t
        </button>
        {show ? (
          <div>
            {h.keepAlive((s) => s(Kid, { key: "k", props: { tag: "kept" } }))}
            <Kid key="p" props={{ tag: "plain" }} />
          </div>
        ) : (
          ""
        )}
      </div>
    ),
  });

describe("h.keepAlive", () => {
  it("keeps the Model while a plain child remounts fresh", async () => {
    const Page = makePage();
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await ui.click("#inc-kept");
    await ui.click("#inc-plain");
    await ui.settled();
    expect(ui.query("#n-kept")?.textContent).toBe("1");
    await ui.click("#toggle");
    await ui.settled();
    expect(ui.query("#n-kept")).toBeNull();
    await ui.click("#toggle");
    await ui.settled();
    expect(ui.query("#n-kept")?.textContent).toBe("1");
    expect(ui.query("#n-plain")?.textContent).toBe("0");
    ui.unmount();
  });

  it("keeps a running Command across a hide and show", async () => {
    const Wait = Command.make(
      "KeepWait",
      { args: Schema.Struct({}) },
      (): Effect.Effect<{ readonly _tag: "Done" }, never, never> => Effect.never
    );
    const Runner = defineComponent({
      message: TaggedEnum({ Done: {} }),
      model: Schema.Number,
      name: "KeepRunner",
      props: Schema.Struct({}),
    }).make({
      init: ($) => $.set(0).run(Wait({})),
      update: { Done: ($) => $.model },
      view: (h) => <output id="running">{String(h.isRunning(Wait))}</output>,
    });
    const Host = defineComponent({
      message: TaggedEnum({ Toggle: {} }),
      model: Schema.Boolean,
      name: "KeepRunnerHost",
      props: Schema.Struct({}),
    }).make({
      init: () => true,
      update: { Toggle: ($) => !$.model },
      view: (h, show) => (
        <div>
          <button id="toggle" onclick={h.send({ _tag: "Toggle" })}>
            t
          </button>
          {show ? h.keepAlive((s) => s(Runner, { key: "r", props: {} })) : ""}
        </div>
      ),
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    expect(ui.query("#running")?.textContent).toBe("true");
    await ui.click("#toggle");
    await ui.settled();
    await ui.click("#toggle");
    await ui.settled();
    expect(ui.query("#running")?.textContent).toBe("true");
    ui.unmount();
  });

  it("keeps a direct Subscription attached across a hide and show", async () => {
    let attached = 0;
    let detached = 0;
    const KeepSub = Subscription.direct<never, never, undefined, []>(
      "KeepSub",
      [],
      undefined,
      () => {
        attached += 1;
        return () => {
          detached += 1;
        };
      }
    );
    const Subbed = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "KeepSubbed",
      props: Schema.Struct({}),
    }).make({
      init: () => ({}),
      subscriptions: () => [KeepSub],
      update: () => ({}),
      view: () => <output id="sub">sub</output>,
    });
    const Host = defineComponent({
      message: TaggedEnum({ Toggle: {} }),
      model: Schema.Boolean,
      name: "KeepSubHost",
      props: Schema.Struct({}),
    }).make({
      init: () => true,
      update: { Toggle: ($) => !$.model },
      view: (h, show) => (
        <div>
          <button id="toggle" onclick={h.send({ _tag: "Toggle" })}>
            t
          </button>
          {show ? h.keepAlive((s) => s(Subbed, { key: "s", props: {} })) : ""}
        </div>
      ),
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    expect(attached).toBe(1);
    await ui.click("#toggle");
    await ui.settled();
    expect(attached).toBe(1);
    expect(detached).toBe(0);
    await ui.click("#toggle");
    await ui.settled();
    expect(attached).toBe(1);
    expect(detached).toBe(0);
    expect(ui.query("#sub")?.textContent).toBe("sub");
    ui.unmount();
    expect(detached).toBe(1);
  });

  it("rebuilds the DOM from the kept Model: uncontrolled state is lost, bound state stays", async () => {
    const TextMsg = TaggedEnum({ Set: { text: Schema.String } });
    const Text = defineComponent({
      message: TextMsg,
      model: Schema.Struct({ text: Schema.String }),
      name: "KeepText",
      props: Schema.Struct({}),
    }).make({
      init: () => ({ text: "" }),
      update: { Set: ($, { text }) => $.set({ text }) },
      view: (h, model) => (
        <div>
          <input id="free" />
          <input
            id="bound"
            value={model.text}
            oninput={h.send((event) => {
              if (
                // oxlint-disable-next-line anti-slop/no-runtime-typeof, unicorn/no-useless-undefined -- synthetic event is untyped at the DOM boundary; undefined ignores non-input events
                typeof event !== "object" ||
                event === null ||
                !("target" in event)
              ) {
                // oxlint-disable-next-line unicorn/no-useless-undefined -- send mapping must return undefined to ignore non-input events
                return undefined;
              }
              const { target } = event;
              if (!(target instanceof HTMLInputElement)) {
                // oxlint-disable-next-line unicorn/no-useless-undefined -- send mapping must return undefined to ignore non-input events
                return undefined;
              }
              return { _tag: "Set", text: target.value };
            })}
          />
        </div>
      ),
    });
    const Host = defineComponent({
      message: TaggedEnum({ Toggle: {} }),
      model: Schema.Boolean,
      name: "KeepTextHost",
      props: Schema.Struct({}),
    }).make({
      init: () => true,
      update: { Toggle: ($) => !$.model },
      view: (h, show) => (
        <div>
          <button id="toggle" onclick={h.send({ _tag: "Toggle" })}>
            t
          </button>
          {show ? h.keepAlive((s) => s(Text, { key: "t", props: {} })) : ""}
        </div>
      ),
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    await ui.input("#free", "typed");
    await ui.input("#bound", "typed");
    await ui.settled();
    expect(ui.query<HTMLInputElement>("#bound")?.value).toBe("typed");
    await ui.click("#toggle");
    await ui.settled();
    await ui.click("#toggle");
    await ui.settled();
    expect(ui.query<HTMLInputElement>("#free")?.value).toBe("");
    expect(ui.query<HTMLInputElement>("#bound")?.value).toBe("typed");
    ui.unmount();
  });

  it("a false predicate ends the hidden child, so it mounts fresh next time", async () => {
    const Host = defineComponent({
      message: TaggedEnum({ Drop: {}, Toggle: {} }),
      model: Schema.Struct({ keep: Schema.Boolean, show: Schema.Boolean }),
      name: "KeepPredHost",
      props: Schema.Struct({}),
    }).make({
      init: () => ({ keep: true, show: true }),
      update: {
        Drop: ($) => $.set({ ...$.model, keep: false }),
        Toggle: ($) => $.set({ ...$.model, show: !$.model.show }),
      },
      view: (h, model) => (
        <div>
          <button id="toggle" onclick={h.send({ _tag: "Toggle" })}>
            t
          </button>
          <button id="drop" onclick={h.send({ _tag: "Drop" })}>
            d
          </button>
          {model.show
            ? h.keepAlive(
                // SAFETY: predicate reads the host's own model shape, kept in sync with the Struct above
                (input) => (input.model as { readonly keep: boolean }).keep,
                (s) => s(Kid, { key: "k", props: { tag: "pred" } })
              )
            : ""}
        </div>
      ),
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    await ui.click("#inc-pred");
    await ui.settled();
    expect(ui.query("#n-pred")?.textContent).toBe("1");
    await ui.click("#toggle");
    await ui.settled();
    await ui.click("#drop");
    await ui.settled();
    await ui.click("#toggle");
    await ui.settled();
    expect(ui.query("#n-pred")?.textContent).toBe("0");
    ui.unmount();
  });

  it("a keep-alive child without a literal key fails the author", async () => {
    const errors: Error[] = [];
    const Host = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "KeepKeyHost",
      props: Schema.Struct({}),
    }).make({
      init: () => ({}),
      update: () => ({}),
      view: (h) => (
        <div>{h.keepAlive((s) => s(Kid, { props: { tag: "nokey" } }))}</div>
      ),
    });
    const ui = render(() => <Host props={{}} />, {
      onError: (error) => errors.push(error),
    });
    await ui.settled();
    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0]?.message ?? errors[0])).toContain("literal key");
    ui.unmount();
  });

  it("writing one key through both h and s fails the author, showing its fallback", async () => {
    const Mid = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "KeepBoth",
      props: Schema.Struct({}),
    }).make({
      init: () => ({}),
      update: () => ({}),
      view: (h) => (
        <div>
          {h.keepAlive((s) => (
            <>
              {s(Kid, { key: "k", props: { tag: "both" } })}
              <Kid key="k" props={{ tag: "both" }} />
            </>
          ))}
        </div>
      ),
    });
    const Host = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "KeepBothHost",
      props: Schema.Struct({}),
    }).make({
      init: () => ({}),
      update: () => ({}),
      view: () => <Mid props={{}} fallback={() => <p id="fb">mid down</p>} />,
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    expect(ui.text()).toContain("mid down");
    ui.unmount();
  });

  it("closing the author closes its parked children", async () => {
    let detached = 0;
    const KeepSub = Subscription.direct<never, never, undefined, []>(
      "KeepAuthorSub",
      [],
      undefined,
      () => () => {
        detached += 1;
      }
    );
    const Subbed = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "KeepAuthorSubbed",
      props: Schema.Struct({}),
    }).make({
      init: () => ({}),
      subscriptions: () => [KeepSub],
      update: () => ({}),
      view: () => <output id="asub">sub</output>,
    });
    const Author = defineComponent({
      message: TaggedEnum({ Toggle: {} }),
      model: Schema.Boolean,
      name: "KeepAuthor",
      props: Schema.Struct({}),
    }).make({
      init: () => true,
      update: { Toggle: ($) => !$.model },
      view: (h, show) => (
        <div>
          <button id="hide" onclick={h.send({ _tag: "Toggle" })}>
            hide
          </button>
          {show ? h.keepAlive((s) => s(Subbed, { key: "s", props: {} })) : ""}
        </div>
      ),
    });
    const Host = defineComponent({
      message: TaggedEnum({ Drop: {} }),
      model: Schema.Boolean,
      name: "KeepAuthorHost",
      props: Schema.Struct({}),
    }).make({
      init: () => true,
      update: { Drop: ($) => !$.model },
      view: (h, present) => (
        <div>
          <button id="drop" onclick={h.send({ _tag: "Drop" })}>
            drop
          </button>
          {present ? <Author key="a" props={{}} /> : ""}
        </div>
      ),
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    await ui.click("#hide");
    await ui.settled();
    expect(ui.query("#asub")).toBeNull();
    expect(detached).toBe(0);
    await ui.click("#drop");
    await ui.settled();
    expect(detached).toBe(1);
    ui.unmount();
  });
});
