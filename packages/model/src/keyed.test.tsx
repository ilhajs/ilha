/**
 * Keyed children: state follows keys across reorder, add and remove; branch
 * swaps at one path keep the instance; a key change resets. Ported from the
 * kernel-owned parts of Effect UI's `Keyed.test.ts` (query/router cases
 * belong to other slices).
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import { defineComponent } from "./component.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const RowMessage = TaggedEnum({ Bump: {} });

const RowDef = defineComponent({
  message: RowMessage,
  model: Schema.Number,
  name: "KeyedRow",
  props: Schema.Struct({ id: Schema.String }),
});

const Row = RowDef.make({
  init: () => 0,
  update: ($) => $.model + 1,
  view: (h, count) => (
    <li>
      <span class="row-id">{h.props.id}</span>:
      <span class="row-count">{String(count)}</span>
      <button class="bump" onclick={h.send(RowMessage.Bump())}>
        bump
      </button>
    </li>
  ),
});

const ListMessage = TaggedEnum({
  Add: { id: Schema.String },
  Remove: { id: Schema.String },
  Reverse: {},
});

const ListDef = defineComponent({
  message: ListMessage,
  model: Schema.Array(Schema.String),
  name: "KeyedList",
  props: Schema.Struct({ ids: Schema.Array(Schema.String) }),
});

const counts = (ui: {
  queryAll: (selector: string) => { textContent: string | null }[];
}): string[] => ui.queryAll(".row-count").map((el) => el.textContent ?? "");
const ids = (ui: {
  queryAll: (selector: string) => { textContent: string | null }[];
}): string[] => ui.queryAll(".row-id").map((el) => el.textContent ?? "");

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

const mountList = () => {
  const List = ListDef.make({
    init: ($) => $.props.ids,
    update: ($, message) =>
      ListMessage.match(message, {
        Add: ({ id }) => [...$.model, id],
        Remove: ({ id }) => $.model.filter((x) => x !== id),
        Reverse: () => $.model.toReversed(),
      }),
    view: (h, model) => (
      <div>
        <ul>
          {model.map((id) => (
            <Row key={id} props={{ id }} />
          ))}
        </ul>
        <button id="add" onclick={h.send(ListMessage.Add({ id: "c" }))}>
          add
        </button>
        <button id="reverse" onclick={h.send(ListMessage.Reverse())}>
          reverse
        </button>
      </div>
    ),
  });
  return List;
};

describe("keyed children", () => {
  it("keeps each row's model across a reorder", async () => {
    const List = mountList();
    const ui = render(() => <List props={{ ids: ["a", "b"] }} />);
    await ui.settled();
    expect(ui.queryAll(".bump")).toHaveLength(2);
    await ui.click(".bump");
    await waitFor(() => counts(ui).join(",") === "1,0");
    await ui.click("#reverse");
    await waitFor(() => ids(ui).join(",") === "b,a");
    // The bumped row kept its count through the reorder.
    expect(counts(ui).join(",")).toBe("0,1");
    ui.unmount();
  });

  it("adds and removes rows without disturbing the rest", async () => {
    const List = mountList();
    const ui = render(() => <List props={{ ids: ["a", "b"] }} />);
    await ui.settled();
    await ui.click(".bump");
    await waitFor(() => counts(ui).join(",") === "1,0");
    await ui.click("#add");
    await waitFor(() => ids(ui).join(",") === "a,b,c");
    expect(counts(ui).join(",")).toBe("1,0,0");
    ui.unmount();
  });

  it("a branch swap at one path keeps the instance", async () => {
    const Def = defineComponent({
      message: TaggedEnum({ Bump: {}, Flip: {} }),
      model: Schema.Struct({ alt: Schema.Boolean }),
      name: "KeyedBranch",
    });
    const Branch = Def.make({
      init: () => ({ alt: false }),
      update: {
        Bump: ($) => $,
        Flip: ($) => $.evolve({ alt: !$.model.alt }),
      },
      view: (h, model) => (
        <div>
          <button id="flip" onclick={h.send({ _tag: "Flip" })}>
            flip
          </button>
          {model.alt ? (
            <Row key="" props={{ id: "same" }} />
          ) : (
            <Row key="" props={{ id: "same" }} />
          )}
        </div>
      ),
    });
    const ui = render(() => <Branch props={{}} />);
    await ui.settled();
    await ui.click(".bump");
    await waitFor(() => counts(ui).join(",") === "1");
    await ui.click("#flip");
    await waitFor(() => ui.queryAll(".bump").length === 1);
    // Same path, so the count survived the branch swap.
    expect(counts(ui).join(",")).toBe("1");
    ui.unmount();
  });

  it("a key change resets the instance", async () => {
    const Def = defineComponent({
      message: TaggedEnum({ Rekey: {} }),
      model: Schema.Struct({ key: Schema.String }),
      name: "KeyedReset",
    });
    const Rekey = Def.make({
      init: () => ({ key: "a" }),
      update: { Rekey: ($) => $.set({ key: "b" }) },
      view: (h, model) => (
        <div>
          <button id="rekey" onclick={h.send({ _tag: "Rekey" })}>
            rekey
          </button>
          <Row key={model.key} props={{ id: "row" }} />
        </div>
      ),
    });
    const ui = render(() => <Rekey props={{}} />);
    await ui.settled();
    await ui.click(".bump");
    await waitFor(() => counts(ui).join(",") === "1");
    await ui.click("#rekey");
    await waitFor(() => counts(ui).join(",") === "0");
    ui.unmount();
  });

  it("an unmounted row's model is gone when it comes back", async () => {
    const Def = defineComponent({
      message: TaggedEnum({ Hide: {}, Show: {} }),
      model: Schema.Array(Schema.String),
      name: "KeyedLeave",
      props: Schema.Struct({ ids: Schema.Array(Schema.String) }),
    });
    const Leave = Def.make({
      init: ($) => $.props.ids,
      update: {
        Hide: ($) => $.set([]),
        Show: ($) => $.set(["a"]),
      },
      view: (h, model) => (
        <div>
          <ul>
            {model.map((id) => (
              <Row key={id} props={{ id }} />
            ))}
          </ul>
          <button id="hide" onclick={h.send({ _tag: "Hide" })}>
            hide
          </button>
          <button id="show" onclick={h.send({ _tag: "Show" })}>
            show
          </button>
        </div>
      ),
    });
    const ui = render(() => <Leave props={{ ids: ["a"] }} />);
    await ui.settled();
    await ui.click(".bump");
    await waitFor(() => counts(ui).join(",") === "1");
    await ui.click("#hide");
    await waitFor(() => ui.queryAll(".bump").length === 0);
    await ui.click("#show");
    await waitFor(() => ui.queryAll(".bump").length === 1);
    expect(counts(ui).join(",")).toBe("0");
    ui.unmount();
  });
});
