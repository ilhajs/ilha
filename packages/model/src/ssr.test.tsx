// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Effect, Schema } from "effect";
import { renderToString } from "ilha";
import { render } from "ilha/test";

import { Command, defineComponent } from "./index";

const Msg = Schema.TaggedUnion({
  Boot: {},
  Booted: {},
});

let booted = false;

const BootCmd = Command.make("BootCmd", () =>
  Effect.sleep("100 millis").pipe(
    Effect.tap(
      Effect.sync(() => {
        booted = true;
      })
    ),
    Effect.as(Msg.cases.Booted.make({}))
  )
);

const App = defineComponent({
  message: Msg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "SsrApp",
  props: Schema.Struct({ start: Schema.Number }),
}).make({
  init: ($, props) => $.set({ count: props.start }).run(BootCmd()),
  update: {
    Boot: ($) => $,
    Booted: ($) => $.evolve({ count: (c) => c + 1 }),
  },
  view: (h, model) => (
    <div>
      <span>{h.props.start}</span>
      <output>{model.count}</output>
    </div>
  ),
});

const poll = async (
  done: () => boolean,
  deadline = Date.now() + 3000
): Promise<void> => {
  if (done()) {
    return;
  }

  if (Date.now() > deadline) {
    expect(done()).toBe(true);

    return;
  }

  await Bun.sleep(5);
  await poll(done, deadline);
};

describe("ssr", () => {
  it("server-renders the init model without running commands", async () => {
    booted = false;
    const html = await renderToString(() => <App props={{ start: 41 }} />);
    expect(html).toContain("41");
    expect(html).toContain("data-ilha-state");
    expect(booted).toBe(false);
  });

  it("hydrates the snapshot model, then runs init commands", async () => {
    booted = false;
    const html = await renderToString(() => <App props={{ start: 41 }} />);
    const host = document.createElement("div");
    host.innerHTML = html;

    const ui = render(() => <App props={{ start: 41 }} />, {
      container: host,
      hydrate: true,
    });

    await ui.settled();
    expect(ui.query("output")?.textContent).toBe("41");
    await poll(() => ui.query("output")?.textContent === "42");
    expect(booted).toBe(true);
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });
});
