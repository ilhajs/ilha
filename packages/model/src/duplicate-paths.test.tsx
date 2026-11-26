/**
 * Duplicate paths: two children at one path fail the author with a key
 * hint, while the rest of the island keeps running. Ported from the
 * kernel-owned parts of Effect UI's `DuplicatePaths.test.ts` (slots belong
 * to another slice).
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import { defineComponent } from "./component.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const RowDef = defineComponent({
  message: Schema.Never,
  model: Schema.Null,
  name: "DupRow",
  props: Schema.Struct({ label: Schema.String }),
});

const Row = RowDef.make({
  init: () => null,
  update: ($) => $.model,
  view: (h) => <li>{h.props.label}</li>,
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

describe("duplicate paths", () => {
  it("two unkeyed children of one component fail the author with a key hint", async () => {
    const ListDef = defineComponent({
      message: TaggedEnum({ Set: { keys: Schema.Array(Schema.String) } }),
      model: Schema.Array(Schema.String),
      name: "DupList",
      props: Schema.Struct({ keys: Schema.Array(Schema.String) }),
    });
    const List = ListDef.make({
      init: ($) => $.props.keys,
      update: (_, message) => message.keys,
      view: (_h, keys) => (
        <ul>
          {keys.map((key) =>
            key === "" ? (
              <Row props={{ label: key }} />
            ) : (
              <Row key={key} props={{ label: key }} />
            )
          )}
        </ul>
      ),
    });
    const PageDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "DupPage",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => null,
      update: ($) => $,
      view: () => (
        <main>
          <span id="sibling">alive</span>
          <List
            props={{ keys: ["", ""] }}
            fallback={() => <output id="fallback">list failed</output>}
          />
        </main>
      ),
    });
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await waitFor(() => ui.query("#fallback")?.textContent === "list failed");
    // The rest of the island keeps running.
    expect(ui.query("#sibling")?.textContent).toBe("alive");
    ui.unmount();
  });

  it("the same name under different parents is fine", async () => {
    // Plain elements don't separate paths (the walk flattens them), so
    // each Row sits under a genuinely different model parent instead.
    // Paths carry only component names: /DupNestedPage/DupWrapA/DupRow
    // and /DupNestedPage/DupWrapB/DupRow never collide.
    const WrapADef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "DupWrapA",
      props: Schema.Struct({ label: Schema.String }),
    });
    const WrapA = WrapADef.make({
      init: () => null,
      update: ($) => $,
      view: (h) => <Row props={{ label: h.props.label }} />,
    });
    const WrapBDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "DupWrapB",
      props: Schema.Struct({ label: Schema.String }),
    });
    const WrapB = WrapBDef.make({
      init: () => null,
      update: ($) => $,
      view: (h) => <Row props={{ label: h.props.label }} />,
    });
    const PageDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "DupNestedPage",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => null,
      update: ($) => $,
      view: () => (
        <main>
          <WrapA props={{ label: "one" }} />
          <WrapB props={{ label: "two" }} />
        </main>
      ),
    });
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    expect(ui.html()).toContain("one");
    expect(ui.html()).toContain("two");
    ui.unmount();
  });

  it("duplicates below elements still collide", async () => {
    const ListDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "DupDeepList",
      props: Schema.Struct({}),
    });
    const List = ListDef.make({
      init: () => null,
      update: ($) => $,
      view: () => (
        <ul>
          <div>
            <Row props={{ label: "x" }} />
          </div>
          <div>
            <Row props={{ label: "y" }} />
          </div>
        </ul>
      ),
    });
    const PageDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "DupDeepPage",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => null,
      update: ($) => $,
      view: () => (
        <main>
          <List
            props={{}}
            fallback={() => <output id="fallback">list failed</output>}
          />
        </main>
      ),
    });
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await waitFor(() => ui.query("#fallback")?.textContent === "list failed");
    ui.unmount();
  });
});
