/**
 * `ssr()` tests: server render, hydration in a fresh document, and the
 * `SsrError` catalogue that applies to Ilha.
 */
import { describe, expect, it } from "bun:test";

import * as Schema from "effect/Schema";

import { defineComponent, TaggedEnum } from "../index.ts";
import { ssr, SsrError } from "./ssr.ts";

const CounterMessage = TaggedEnum({
  Increment: {},
});

const CounterDef = defineComponent({
  message: CounterMessage,
  model: Schema.Struct({ count: Schema.Number }),
  name: "SsrCounter",
  props: Schema.Struct({ initial: Schema.Number }),
});

const Counter = CounterDef.make({
  init: ($, props) => $.set({ count: props.initial }),
  update: {
    Increment: ($) => $.set({ count: $.model.count + 1 }),
  },
  view: (h, model) => h("div", null, h("span", null, String(model.count))),
});

describe("ssr", () => {
  it("adopts the model and keeps the HTML", async () => {
    const result = await ssr(Counter, { initial: 7 });
    try {
      expect(result.html).toContain(">7<");
      expect(result.container.innerHTML).toBe(result.html);
      expect(result.model).toEqual({ count: 7 });
      expect(result.adopted).toContain("/SsrCounter");
      expect(result.log.length).toBeGreaterThan(0);
    } finally {
      result.unmount();
    }
  });

  it("fails with SsrError when the server render throws", async () => {
    const BrokenDef = defineComponent({
      message: CounterMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "SsrBroken",
    });
    const Broken = BrokenDef.make({
      init: () => ({ n: 0 }),
      update: {
        Increment: ($) => $,
      },
      view: () => {
        throw new Error("server boom");
      },
    });
    const error = await ssr(Broken, {}).then(
      () => {},
      (error_) => error_
    );
    expect(error).toBeInstanceOf(SsrError);
    // The server tolerates the throw; hydration reports it with its message.
    expect(error.problems.join("\n")).toContain(
      "hydration failed: server boom"
    );
  });
});
