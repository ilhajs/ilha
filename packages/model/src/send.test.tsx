/**
 * Ported send tests: `$.send` delivers several sends in issue order, each
 * logged as a `Send`, and the owner's `Update` names the `Send` source.
 * Adapted from Effect UI's `test/Send.test.ts` (runtime parts only).
 */
import { describe, expect, it } from "bun:test";

import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import { defineComponent } from "./component.ts";
import type { Headless } from "./component.ts";
import * as MessageLog from "./message-log.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const LogMessage = TaggedEnum({ Add: { id: Schema.String } });

const LogDef = defineComponent({
  message: LogMessage,
  model: Schema.Array(Schema.String),
  name: "Log",
  shares: { receives: ["Add"], value: (ids) => ids },
});

// The frozen Headless.Any erases Events to any, which a concrete
// headless component (Events never) is not assignable to through the
// definition's overloaded update. The cast only adjusts the type: the
// value (and its definition identity for owner lookup) is unchanged.
// SAFETY: the cast only adjusts the type; the value (and its definition identity for owner lookup) is unchanged.
// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Headless.Any erases Events to any, so the concrete component does not overlap it directly; the chain goes through unknown.
const Log = LogDef.make({
  init: () => [],
  parts: () => ({}),
  update: ($, { id }) => [...$.model, id],
}) as unknown as Headless.Any;

const ItemMessage = TaggedEnum({
  Adds: { ids: Schema.Array(Schema.String) },
});

const ItemDef = defineComponent({
  message: ItemMessage,
  model: Schema.Number,
  name: "Item",
  reads: { log: Log },
});

const Item = ItemDef.make({
  init: () => 0,
  update: ($, { ids: [first, ...rest] }) => {
    let step = $.set($.model + 1 + rest.length).send(
      Log,
      LogMessage.Add({ id: first })
    );
    for (const id of rest) {
      step = step.send(Log, LogMessage.Add({ id }));
    }
    return step;
  },
  view: (h) => (
    <button
      id="item"
      onclick={h.send(ItemMessage.Adds({ ids: ["b", "a", "b"] }))}
    >
      {`log:${
        // SAFETY: Log shares its string-array model under `receives`, so reads.log is that array.
        (h.reads.log as readonly string[]).join(",")
      }`}
    </button>
  ),
});

const Page = defineComponent({
  message: Schema.Never,
  model: Schema.Null,
  name: "Page",
}).make({
  init: () => null,
  update: ($) => $.model,
  view: () => <Log key="log" view={() => <Item key="i" props={{}} />} />,
});

describe("$.send to an owner", () => {
  it("delivers several sends in the order they were issued, each logged as a Send", async () => {
    const log = MessageLog.makeMemory();
    const detach = MessageLog.attach(log);
    try {
      const ui = render(() => <Page props={{}} />);
      await ui.settled();
      await ui.click("#item");
      await ui.settled();
      expect(ui.text()).toBe("log:b,a,b");
      const sent = log
        .entries()
        .find(
          (entry): entry is MessageLog.Update =>
            entry._tag === "Update" && entry.path === "/Page/Log[log]/Item[i]"
        );
      expect(sent).toBeDefined();
      expect(sent?.sends.map(MessageLog.encodeSend)).toEqual([
        { message: { _tag: "Add", id: "b" }, owner: "Log" },
        { message: { _tag: "Add", id: "a" }, owner: "Log" },
        { message: { _tag: "Add", id: "b" }, owner: "Log" },
      ]);
      const received = log
        .entries()
        .filter(
          (entry): entry is MessageLog.Update =>
            entry._tag === "Update" && entry.path === "/Page/Log[log]"
        );
      expect(received.map((entry) => [entry.message, entry.source])).toEqual(
        ["b", "a", "b"].map((id) => [
          { _tag: "Add", id },
          { _tag: "Send", path: "/Page/Log[log]/Item[i]", seq: sent?.seq },
        ])
      );
      ui.unmount();
    } finally {
      detach();
    }
  });
});
