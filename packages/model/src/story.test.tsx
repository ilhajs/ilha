import { describe, expect, it } from "bun:test";

import { Effect, Schema } from "effect";

import { Command, defineComponent } from "./index";
import { Story } from "./test";

// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
const Msg = Schema.TaggedUnion({
  Add: { amount: Schema.Number },
  Replied: { v: Schema.Number },
  Reset: {},
  Resetted: {},
});
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
type Msg = typeof Msg.Type;

// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
const Event = Schema.TaggedUnion({
  Reached: { count: Schema.Number },
  Started: {},
});
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
type Event = typeof Event.Type;

// Never executed by Story; only recorded as pending.
const Boot = Command.make("Boot", () =>
  Effect.succeed(Msg.cases.Resetted.make({}))
);
const DelayReset = Command.make("DelayReset", (_v: number) =>
  Effect.succeed(Msg.cases.Resetted.make({}))
);

const Counter = defineComponent({
  events: Event,
  message: Msg,
  model: Schema.Struct({ count: Schema.Number }),
  name: "StoryCounter",
  props: Schema.Struct({ start: Schema.Number }),
}).make({
  init: ($, props) =>
    $.set({ count: props.start })
      .run(Boot())
      .emit(Event.cases.Started.make({})),
  update: {
    Add: ($, { amount }) => {
      const count = $.model.count + amount;
      return $.set({ count }).emit(Event.cases.Reached.make({ count }));
    },
    Replied: ($, { v }) => $.set({ count: v }),
    Reset: ($) => $.run(DelayReset(41)),
    Resetted: ($) => $.set({ count: 0 }),
  },
  view: () => null,
});

describe("story", () => {
  it("runs init without executing commands", () => {
    const story = Story.make(Counter, { start: 3 });
    expect(story.model).toEqual({ count: 3 });
    expect(story.commands).toEqual([{ args: undefined, name: "Boot" }]);
    expect(story.emitted).toEqual([Event.cases.Started.make({})]);
  });

  it("sends messages, records issues, and resolves them", () => {
    const story = Story.make(Counter, { start: 0 });
    story.send(Msg.cases.Add.make({ amount: 2 }));
    expect(story.model).toEqual({ count: 2 });
    expect(story.emitted).toEqual([
      Event.cases.Started.make({}),
      Event.cases.Reached.make({ count: 2 }),
    ]);
    story.send(Msg.cases.Reset.make({}));
    expect(story.commands).toEqual([
      { args: undefined, name: "Boot" },
      { args: 41, name: "DelayReset" },
    ]);
    story.resolve(DelayReset);
    expect(story.commands).toEqual([{ args: undefined, name: "Boot" }]);
    expect(story.model).toEqual({ count: 2 });
    story.resolve(DelayReset, Msg.cases.Replied.make({ v: 9 }));
    expect(story.model).toEqual({ count: 9 });
    story.resolve(Boot);
    expect(story.commands).toEqual([]);
  });

  it("throws on an unknown tag", () => {
    const story = Story.make(Counter, { start: 0 });
    expect(() =>
      // SAFETY: test feeds an unhandled tag to assert the unknown-tag throw.
      story.send({ _tag: "Nope" } as never)
    ).toThrow(/no update/u);
  });
});
