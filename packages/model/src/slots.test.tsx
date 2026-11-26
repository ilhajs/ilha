/**
 * Slots: declared outlets, author-owned content, the single-placement rule
 * and the `[name]` path segment. Adapted from Effect UI's slot rules
 * (`component §1.8`).
 */
import { describe, expect, it } from "bun:test";

import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import { defineComponent } from "./component.ts";
import * as MessageLog from "./message-log.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const GrandMsg = TaggedEnum({ Go: {} });
const GrandEvents = TaggedEnum({ Done: {} });

const Grand = defineComponent({
  events: GrandEvents,
  message: GrandMsg,
  model: Schema.Null,
  name: "SlotGrand",
  props: Schema.Struct({}),
}).make({
  init: () => null,
  update: { Go: ($) => $.emit({ _tag: "Done" }) },
  view: (h) => (
    <button id="go" onclick={h.send({ _tag: "Go" })}>
      go
    </button>
  ),
});

let panelViews = 0;

const Panel = defineComponent({
  message: Schema.Never,
  model: Schema.Struct({}),
  name: "SlotPanel",
  props: Schema.Struct({}),
  slots: ["body", "extra"],
}).make({
  init: () => ({}),
  update: () => ({}),
  view: (h) => {
    panelViews += 1;
    return (
      <section>
        <main id="m">{h.slots.body}</main>
        <footer id="f">{h.slots.extra}</footer>
      </section>
    );
  },
});

const PageMsg = TaggedEnum({ Other: {}, Ping: {} });

const Page = defineComponent({
  message: PageMsg,
  model: Schema.Struct({ other: Schema.Number, pings: Schema.Number }),
  name: "SlotPage",
  props: Schema.Struct({}),
}).make({
  init: () => ({ other: 0, pings: 0 }),
  update: {
    Other: ($) => $.set({ ...$.model, other: $.model.other + 1 }),
    Ping: ($) => $.set({ ...$.model, pings: $.model.pings + 1 }),
  },
  view: (h, model) => (
    <div>
      <button id="other" onclick={h.send({ _tag: "Other" })}>
        other
      </button>
      <output id="pings">{model.pings}</output>
      <Panel
        props={{}}
        slots={{
          body: (
            <>
              <Grand props={{}} onEmit={{ Done: () => ({ _tag: "Ping" }) }} />
              <p>static</p>
            </>
          ),
        }}
      />
    </div>
  ),
});

describe("slots", () => {
  it("renders placed content and leaves unplaced slots empty", async () => {
    panelViews = 0;
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    expect(ui.query("#m")?.textContent).toContain("static");
    expect(ui.query("#m")?.textContent).toContain("go");
    expect(ui.query("#f")?.textContent).toBe("");
    ui.unmount();
  });

  it("content belongs to the author: handlers and emits map to the parent", async () => {
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await ui.click("#go");
    await ui.settled();
    expect(ui.query("#pings")?.textContent).toBe("1");
    ui.unmount();
  });

  it("a parent re-render patches slot content without re-running the child's view", async () => {
    panelViews = 0;
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    expect(panelViews).toBe(1);
    await ui.click("#other");
    await ui.settled();
    expect(panelViews).toBe(1);
    expect(ui.query("#m")?.textContent).toContain("static");
    ui.unmount();
  });

  it("slot children mount under the placer's [name] segment", async () => {
    const log = MessageLog.makeMemory();
    const detach = MessageLog.attach(log);
    try {
      const ui = render(() => <Page props={{}} />);
      await ui.settled();
      await ui.click("#go");
      await ui.settled();
      const paths = log
        .entries()
        .filter((entry): entry is MessageLog.Update => entry._tag === "Update")
        .map((entry) => entry.path);
      expect(paths.some((path) => path.includes("[body]"))).toBe(true);
      expect(paths).toContain("/SlotPage/SlotPanel[]/[body]/SlotGrand[]");
      ui.unmount();
    } finally {
      detach();
    }
  });

  it("placing a slot twice in one render fails the placer, showing its fallback", async () => {
    const Twice = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "SlotTwice",
      props: Schema.Struct({}),
      slots: ["body"],
    }).make({
      init: () => ({}),
      update: () => ({}),
      view: (h) => (
        <div>
          {h.slots.body}
          {h.slots.body}
        </div>
      ),
    });
    const Host = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "SlotTwiceHost",
      props: Schema.Struct({}),
    }).make({
      init: () => ({}),
      update: () => ({}),
      view: () => (
        <Twice
          props={{}}
          slots={{ body: <p>twice</p> }}
          fallback={() => <p id="fb">panel down</p>}
        />
      ),
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    expect(ui.text()).toContain("panel down");
    ui.unmount();
  });

  it("successive parent re-renders patch slot content without re-running the slot host", async () => {
    panelViews = 0;
    const Counter = defineComponent({
      message: TaggedEnum({ Inc: {} }),
      model: Schema.Number,
      name: "SlotCounter",
      props: Schema.Struct({}),
    }).make({
      init: () => 0,
      update: { Inc: ($) => $.model + 1 },
      view: (h, n) => (
        <div>
          <button id="inc" onclick={h.send({ _tag: "Inc" })}>
            inc
          </button>
          <Panel props={{}} slots={{ body: <output id="n">{n}</output> }} />
        </div>
      ),
    });
    const ui = render(() => <Counter props={{}} />);
    await ui.settled();
    expect(panelViews).toBe(1);
    expect(ui.query("#n")?.textContent).toBe("0");
    await ui.click("#inc");
    await ui.settled();
    expect(panelViews).toBe(1);
    expect(ui.query("#n")?.textContent).toBe("1");
    await ui.click("#inc");
    await ui.settled();
    expect(panelViews).toBe(1);
    expect(ui.query("#n")?.textContent).toBe("2");
    ui.unmount();
  });
});
