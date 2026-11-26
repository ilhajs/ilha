/**
 * Headless components: the part merge algebra, event layering order,
 * consumer ownership of the `view` closure, `p.child` composition and the
 * part guards. Adapted from Effect UI's part rules (`component §1.9`).
 */

import { describe, expect, it } from "bun:test";

import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import { defineComponent } from "./component.ts";
import * as MessageLog from "./message-log.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const OwnerMsg = TaggedEnum({ Bump: {} });
const OwnerEvents = TaggedEnum({ Bumped: { n: Schema.Number } });

const OwnerDef = defineComponent({
  events: OwnerEvents,
  message: OwnerMsg,
  model: Schema.Struct({ n: Schema.Number }),
  name: "PartsOwner",
  props: Schema.Struct({}),
});

const Owner = OwnerDef.make({
  init: () => ({ n: 0 }),
  parts: (p) => ({
    trigger: p.part("button", () => ({
      "aria-label": "part",
      class: "p1 c1",
      onclick: p.send({ _tag: "Bump" }),
      title: undefined,
    })),
  }),
  update: {
    Bump: ($) =>
      $.set({ n: $.model.n + 1 }).emit({ _tag: "Bumped", n: $.model.n + 1 }),
  },
});

const PageMsg = TaggedEnum({ Tapped: {} });

const PageDef = defineComponent({
  message: PageMsg,
  model: Schema.Struct({ taps: Schema.Number }),
  name: "PartsPage",
  props: Schema.Struct({}),
});

const Page = PageDef.make({
  init: () => ({ taps: 0 }),
  update: {
    Tapped: ($) => $.set({ taps: $.model.taps + 1 }),
  },
  view: (h, model) => (
    <Owner
      props={{}}
      // The frozen HeadlessCallOptions pins onEmit's return to the owner's
      // Msg, but the kernel dispatches it to the consumer (whose messages
      // own the closure). The cast marks that boundary; the value stays a
      // consumer message.
      // SAFETY: frozen HeadlessCallOptions pins onEmit to the owner Msg; the kernel dispatches to the consumer whose messages own the closure
      onEmit={{
        Bumped: () =>
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- consumer message must cross the owner-typed onEmit boundary
          PageMsg.Tapped() as unknown as Schema.Schema.Type<
            (typeof OwnerDef)["message"]
          >,
      }}
      view={(parts) => (
        <div>
          {parts.trigger(
            h(
              "button",
              {
                "aria-label": "consumer",
                class: "c1",
                id: "t",
                onclick: h.send(PageMsg.Tapped()),
                title: "t",
                // The consumer's own layer on the same element: it fires last,
                // after the part's owner layer above.
              },
              "go"
            )
          )}
          <output id="taps">{model.taps}</output>
        </div>
      )}
    />
  ),
});

describe("headless parts", () => {
  it("merges part props: part wins, token lists union with dedup, undefined removes", async () => {
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    const html = ui.html();
    expect(html).toContain('class="c1 p1"');
    expect(html).toContain('aria-label="part"');
    expect(html).not.toContain("title=");
    ui.unmount();
  });

  it("fires event layers deepest owner first and the consumer last", async () => {
    const log = MessageLog.makeMemory();
    const detach = MessageLog.attach(log);
    try {
      const ui = render(() => <Page props={{}} />);
      await ui.settled();
      await ui.click("#t");
      await ui.settled();
      expect(ui.query("#taps")?.textContent).toBe("2");
      const updates = log
        .entries()
        .filter(
          (entry): entry is MessageLog.Update =>
            entry._tag === "Update" &&
            (entry.path === "/PartsPage/PartsOwner[]" ||
              entry.path === "/PartsPage")
        );
      // SAFETY: Update entries always carry a tagged message; _tag read only names the layer order
      const tags = updates.map(
        (entry) => (entry.message as { readonly _tag: string })._tag
      );
      // The owner's layer dispatches first (emitting through onEmit), then the
      // consumer's own handler on the same element.
      expect(tags).toEqual(["Bump", "Tapped", "Tapped"]);
      ui.unmount();
    } finally {
      detach();
    }
  });

  it("a part for one tag rejects another tag", async () => {
    const Strict = OwnerDef.make({
      init: () => ({ n: 0 }),
      parts: (p) => ({
        only: p.part("button", () => ({})),
      }),
      update: { Bump: ($) => $.set({ n: $.model.n + 1 }) },
    });
    const Host = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "PartsStrictHost",
      props: Schema.Struct({}),
    }).make({
      init: () => ({}),
      update: () => ({}),
      view: (h) => (
        <Strict
          props={{}}
          fallback={() => <p id="fb">strict down</p>}
          view={(parts) => <div>{parts.only(h("span", null, "nope"))}</div>}
        />
      ),
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    expect(ui.text()).toContain("strict down");
    ui.unmount();
  });

  it("a closure that throws fails the headless child, showing its fallback", async () => {
    const Host = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "PartsThrowHost",
      props: Schema.Struct({}),
    }).make({
      init: () => ({}),
      update: () => ({}),
      view: () => (
        <Owner
          props={{}}
          fallback={() => <p id="fb">owner down</p>}
          view={() => {
            throw new Error("closure boom");
          }}
        />
      ),
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    expect(ui.text()).toContain("owner down");
    ui.unmount();
  });
});

describe("p.child composition", () => {
  const InnerMsg = TaggedEnum({ Ping: {} });
  const InnerEvents = TaggedEnum({ Pong: {} });

  const InnerDef = defineComponent({
    events: InnerEvents,
    message: InnerMsg,
    model: Schema.Struct({}),
    name: "ComposedInner",
    props: Schema.Struct({}),
  });

  const Inner = InnerDef.make({
    init: () => ({}),
    parts: () => ({ text: "inner" }),
    update: { Ping: ($) => $.emit({ _tag: "Pong" }) },
  });

  const OuterMsg = TaggedEnum({ Got: { text: Schema.String } });

  const OuterDef = defineComponent({
    message: OuterMsg,
    model: Schema.Struct({ heard: Schema.String }),
    name: "ComposedOuter",
    props: Schema.Struct({}),
  });

  const Outer = OuterDef.make({
    init: () => ({ heard: "" }),
    parts: (p) => ({
      combined: p.child(Inner, {
        onEmit: { Pong: () => ({ _tag: "Got", text: "pong" }) },
        parts: (childParts: { readonly text: string }) => `${childParts.text}!`,
        props: {},
      }),
    }),
    update: {
      Got: ($, { text }) => $.set({ heard: text }),
    },
  });

  it("maps a composed child's parts through the composer", async () => {
    const Host = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "ComposedHost",
      props: Schema.Struct({}),
    }).make({
      init: () => ({}),
      update: () => ({}),
      view: () => (
        <Outer
          props={{}}
          view={(parts) => <output id="c">{String(parts.combined)}</output>}
        />
      ),
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    expect(ui.query("#c")?.textContent).toBe("inner!");
    ui.unmount();
  });

  it("a composed child takes no slots", async () => {
    // A runtime guard, so the options bypass the types on purpose.
    // SAFETY: badOptions only feeds the guard path that rejects slots; never a live render
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the guard test must smuggle an invalid option past the types
    const badOptions = {
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the guard test forwards an unparsed payload to trigger the rejection
      parts: (childParts: unknown) => childParts,
      props: {},
      slots: { x: "y" },
    } as unknown as never;
    const Slotted = OuterDef.make({
      init: () => ({ heard: "" }),
      parts: (p) => ({
        bad: p.child(Inner, badOptions),
      }),
      update: {
        Got: ($, { text }) => $.set({ heard: text }),
      },
    });
    const Host = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "ComposedSlotsHost",
      props: Schema.Struct({}),
    }).make({
      init: () => ({}),
      update: () => ({}),
      view: () => (
        <Slotted
          props={{}}
          fallback={() => <p id="fb">outer down</p>}
          view={(parts) => <div>{String(parts.bad)}</div>}
        />
      ),
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    expect(ui.text()).toContain("outer down");
    ui.unmount();
  });
});
