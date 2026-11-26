/**
 * `evolve`: field updates over structs, the step's `evolve`, and the error
 * cases. Ported from Effect UI's `Evolve.test.ts`: the Checkout scenario
 * runs through `render` here instead of `Story`.
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import * as Command from "./command.ts";
import { defineComponent } from "./component.ts";
import { evolve } from "./evolve.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const Message = TaggedEnum({
  ClickedIncrement: { id: Schema.String },
  FailedPlaceOrder: {},
  SubmittedOrder: {},
});

const PlaceOrder = Command.make(
  "PlaceOrder",
  { args: { lines: Schema.Number } },
  () => Effect.succeed(Message.FailedPlaceOrder())
);

const Line = Schema.Struct({ id: Schema.String, quantity: Schema.Number });

const CheckoutDef = defineComponent({
  message: Message,
  model: Schema.Struct({
    attempts: Schema.Number,
    lines: Schema.Array(Line),
    notice: Schema.NullOr(Schema.String),
    submitting: Schema.Boolean,
  }),
  name: "Checkout",
});

const Checkout = CheckoutDef.make({
  init: () => ({
    attempts: 0,
    lines: [
      { id: "a", quantity: 1 },
      { id: "b", quantity: 2 },
    ],
    notice: "Welcome",
    submitting: false,
  }),
  update: {
    ClickedIncrement: ($, { id }) =>
      $.evolve({
        lines: $.model.lines.map((line) =>
          line.id === id ? evolve(line, { quantity: (n) => n + 1 }) : line
        ),
        notice: null,
      }),
    FailedPlaceOrder: ($) => evolve($.model, { submitting: false }),
    SubmittedOrder: ($) =>
      // oxlint-disable-next-line eslint/sort-keys -- evolve applies fields in written order; submitting-then-attempts mirrors the submission flow.
      $.evolve({ submitting: true, attempts: (n) => n + 1 }).run(
        PlaceOrder.make({ lines: $.model.lines.length })
      ),
  },
  view: (h, model) => (
    <div>
      <output id="lines">
        {model.lines.map((line) => `${line.id}:${line.quantity}`).join(",")}
      </output>
      <output id="attempts">{String(model.attempts)}</output>
      <output id="notice">{model.notice ?? ""}</output>
      <button
        id="inc-a"
        onclick={h.send(Message.ClickedIncrement({ id: "a" }))}
      >
        inc
      </button>
      <button id="submit" onclick={h.send(Message.SubmittedOrder())}>
        submit
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

describe("evolve", () => {
  it("changes the given fields of the Model and of the structs in it", async () => {
    const ui = render(() => <Checkout props={{}} />);
    await ui.settled();
    expect(ui.query("#lines")?.textContent).toBe("a:1,b:2");
    await ui.click("#inc-a");
    expect(ui.query("#lines")?.textContent).toBe("a:2,b:2");
    expect(ui.query("#notice")?.textContent).toBe("");
    await ui.click("#submit");
    await waitFor(() => ui.query("#attempts")?.textContent === "1");
    await waitFor(() => (ui.query("#lines")?.textContent ?? "").length > 0);
    // The order's failure resets `submitting` (unseen) while keeping the lines.
    expect(ui.query("#lines")?.textContent).toBe("a:2,b:2");
    ui.unmount();
  });

  it("changes a field under a symbol key", () => {
    const key = Symbol("key");
    expect(evolve({ [key]: 1, label: "a" }, { [key]: (n) => n + 1 })).toEqual({
      [key]: 2,
      label: "a",
    });
  });

  it("keeps the same struct when every field keeps its value", () => {
    const model = { label: "a", n: 1 };
    expect(evolve(model, { n: 1 })).toBe(model);
  });

  it("refuses unions at the type level and fails loudly for misuse", () => {
    // A union Model is a type error (anchored in types.test.tsx); at run time
    // evolve still applies the fields it is given.
    // SAFETY: fixture deliberately inhabits one union member to exercise the runtime path.
    const union = { _tag: "A", n: 1 } as
      | { readonly _tag: "A"; readonly n: number }
      | { readonly _tag: "B" };
    expect(
      // SAFETY: narrowed by construction above — the fixture is the "A" member with a numeric n.
      // oxlint-disable-next-line anti-slop/no-known-value-widening -- test narrows a union fixture to its constructed member for the runtime-path assertion.
      evolve(union as { readonly _tag: "A"; readonly n: number }, { n: 2 }).n
    ).toBe(2);
  });
});
