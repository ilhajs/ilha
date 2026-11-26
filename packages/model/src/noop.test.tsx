/**
 * `Component.noop`: silent results send nothing. Ported from Effect UI's
 * `Noop.test.ts`, running through `render` here instead of `TestHost`.
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { render } from "ilha/test";

import * as Command from "./command.ts";
import { Component, defineComponent, isComponent } from "./component.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const Message = TaggedEnum({
  Fire: { command: Schema.String },
  Got: { n: Schema.Number },
});
const got = (n: number) => Message.Got({ n });

const waitFor = async (
  what: () => boolean,
  timeoutMs = 5000
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

describe("Component.noop", () => {
  it("is matched by type id, not identity", () => {
    expect(Component.isNoop(Component.noop)).toBe(true);
    expect(
      Component.isNoop({
        "~@effect/ui/Component/Noop": "~@effect/ui/Component/Noop",
      })
    ).toBe(true);
    expect(Component.isNoop(Message.Got({ n: 1 }))).toBe(false);
    // oxlint-disable-next-line unicorn/no-useless-undefined -- isNoop takes a required unknown argument; undefined exercises its false branch.
    expect(Component.isNoop(undefined)).toBe(false);
  });

  it("isComponent rejects non-components", () => {
    expect(isComponent(Component.noop)).toBe(false);
  });

  it("a silent Effect Command sends nothing", async () => {
    const Quiet = Command.make("Quiet", { args: {} }, () =>
      Effect.succeed(Component.noop)
    );
    const Loud = Command.make("Loud", { args: {} }, () =>
      Effect.succeed(got(0))
    );
    const Def = defineComponent({
      message: Message,
      model: Schema.Array(Schema.String),
      name: "NoopQuiet",
    });
    const Recorder = Def.make({
      init: () => [],
      update: ($, message) => {
        const next = [
          ...$.model,
          message._tag === "Got" ? `Got ${message.n}` : message._tag,
        ];
        // oxlint-disable-next-line eslint/default-case -- switch is exhaustive over the Message union (Fire, Got).
        switch (message._tag) {
          case "Fire": {
            return $.set(next).run(
              message.command === "Quiet" ? Quiet.make() : Loud.make()
            );
          }
          case "Got": {
            return next;
          }
        }
      },
      view: (h, model) => (
        <div>
          <output id="model">{model.join(",")}</output>
          <button
            id="quiet"
            onclick={h.send(Message.Fire({ command: "Quiet" }))}
          >
            quiet
          </button>
          <button id="loud" onclick={h.send(Message.Fire({ command: "Loud" }))}>
            loud
          </button>
        </div>
      ),
    });
    const ui = render(() => <Recorder props={{}} />);
    await ui.settled();
    await ui.click("#quiet");
    await Effect.runPromise(Effect.sleep("50 millis"));
    expect(ui.query("#model")?.textContent).toBe("Fire");
    await ui.click("#loud");
    await waitFor(() => ui.query("#model")?.textContent === "Fire,Fire,Got 0");
    ui.unmount();
  });

  it("asNoop silences a Command that has a message", async () => {
    const Loud = Command.make("LoudNoop", { args: {} }, () =>
      Effect.succeed(got(0))
    );
    const Def = defineComponent({
      message: Message,
      model: Schema.Array(Schema.String),
      name: "NoopAs",
    });
    const Recorder = Def.make({
      init: () => [],
      update: ($, message) =>
        message._tag === "Fire"
          ? $.set([...$.model, "Fire"]).run(Command.asNoop(Loud.make()))
          : [...$.model, `Got ${message.n}`],
      view: (h, model) => (
        <div>
          <output id="model">{model.join(",")}</output>
          <button id="fire" onclick={h.send(Message.Fire({ command: "x" }))}>
            fire
          </button>
        </div>
      ),
    });
    const ui = render(() => <Recorder props={{}} />);
    await ui.settled();
    await ui.click("#fire");
    await Effect.runPromise(Effect.sleep("50 millis"));
    expect(ui.query("#model")?.textContent).toBe("Fire");
    ui.unmount();
  });

  it("a Stream's silent elements send nothing and the Stream carries on", async () => {
    const Mixed = Command.make("Mixed", { args: {}, stream: true }, () =>
      Stream.make(Component.noop, got(1), Component.noop, got(2))
    );
    const Def = defineComponent({
      message: Message,
      model: Schema.Array(Schema.String),
      name: "NoopMixed",
    });
    const Recorder = Def.make({
      init: () => [],
      update: ($, message) =>
        message._tag === "Fire"
          ? $.set([...$.model, "Fire"]).run(Mixed.make())
          : [...$.model, `Got ${message.n}`],
      view: (h, model) => (
        <div>
          <output id="model">{model.join(",")}</output>
          <button id="fire" onclick={h.send(Message.Fire({ command: "x" }))}>
            fire
          </button>
        </div>
      ),
    });
    const ui = render(() => <Recorder props={{}} />);
    await ui.settled();
    await ui.click("#fire");
    await waitFor(() => ui.query("#model")?.textContent === "Fire,Got 1,Got 2");
    ui.unmount();
  });
});
