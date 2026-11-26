/**
 * Story tests: the ported acknowledgement-rule, Command-mode and replay
 * cases whose features exist, plus a Validation form in a component.
 */
// oxlint-disable-next-line eslint/max-classes-per-file -- the file groups two suites, each defining its own Command service.
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { Update } from "../component.ts";
import {
  Command,
  Component,
  defineComponent,
  Subscription,
  TaggedEnum,
} from "../index.ts";
import * as Validation from "../validation/index.ts";
import type { AnyComponent, PropsOf } from "./steps.ts";
import * as Story from "./story.ts";

/** Runs `fn` with a story cursor, closing the scope (and the end check) after. */
const runStory = <C extends AnyComponent, A>(
  component: C,
  props: PropsOf<C>,
  fn: (story: Story.Steps<C>) => A
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.map(Story.make(component, props), (story) => fn(story))
    )
  );

const CounterMessage = TaggedEnum({
  Add: { amount: Schema.Number },
  Increment: {},
});

const CounterDef = defineComponent({
  message: CounterMessage,
  model: Schema.Struct({ count: Schema.Number }),
  name: "Counter",
  props: Schema.Struct({ initial: Schema.Number }),
});

const Counter = CounterDef.make({
  init: ($, props) => $.set({ count: props.initial }),
  update: {
    Add: ($, { amount }) => ({ count: $.model.count + amount }),
    Increment: ($) => $.set({ count: $.model.count + 1 }),
  },
  view: (h, model) => h("div", null, String(model.count)),
});

describe("Story counter", () => {
  it("sends messages to update", async () => {
    const count = await runStory(Counter, { initial: 1 }, (s) => {
      s.send(CounterMessage.Increment()).send(
        CounterMessage.Add({ amount: 4 })
      );
      return s.model.count;
    });
    expect(count).toBe(6);
  });

  it("an updater reads the current model", async () => {
    const count = await runStory(Counter, { initial: 1 }, (s) => {
      s.send((model) => CounterMessage.Add({ amount: model.count }));
      return s.model.count;
    });
    expect(count).toBe(2);
  });

  it("given starts from any model, and a cursor function is a shared setup", async () => {
    const twice = (s: Story.Steps<typeof Counter>) =>
      s.send(CounterMessage.Increment()).send(CounterMessage.Increment());
    const count = await runStory(Counter, { initial: 1 }, (s) => {
      s.given({ count: 10 }).pipe(twice);
      return s.model.count;
    });
    expect(count).toBe(12);
  });

  it("given with a function maps the model", async () => {
    const count = await runStory(Counter, { initial: 1 }, (s) => {
      s.given((model) => ({ count: model.count * 10 }));
      return s.model.count;
    });
    expect(count).toBe(10);
  });

  it("steps run as separate statements on one cursor", async () => {
    await runStory(Counter, { initial: 0 }, (s) => {
      s.send(CounterMessage.Increment());
      s.send(CounterMessage.Increment());
      expect(s.model.count).toBe(2);
    });
  });

  it("props changes never reach update", async () => {
    await runStory(Counter, { initial: 1 }, (s) => {
      s.send(CounterMessage.Increment());
      s.props({ initial: 100 });
      expect(s.model.count).toBe(2);
      expect(s.current.props).toEqual({ initial: 100 });
    });
  });

  it("props with a function maps the props", async () => {
    await runStory(Counter, { initial: 1 }, (s) => {
      s.props((props) => ({ initial: props.initial + 1 }));
      expect(s.current.props).toEqual({ initial: 2 });
    });
  });

  it("a defect in update throws on the calling line", async () => {
    const BrokenDef = defineComponent({
      message: CounterMessage,
      model: Schema.Struct({ count: Schema.Number }),
      name: "Broken",
    });
    const Broken = BrokenDef.make({
      init: () => ({ count: 0 }),
      update: () => {
        throw new Error("boom");
      },
      view: (h) => h("div", null),
    });
    await expect(
      runStory(Broken, {}, (s) => {
        s.send(CounterMessage.Increment());
      })
    ).rejects.toThrow("boom");
  });

  it("an unknown tag throws naming the path", async () => {
    await expect(
      runStory(Counter, { initial: 0 }, (s) => {
        // SAFETY: "Nope" is no Counter tag; the test asserts the harness throws naming the path.
        s.send({ _tag: "Nope" } as never);
      })
    ).rejects.toThrow('"/Counter" has no update handler for "Nope"');
  });
});

describe("Story commands", () => {
  const TodoMessage = TaggedEnum({
    SaveFailed: { reason: Schema.String },
    Saved: {},
    Toggled: {},
  });
  const TodoEvents = TaggedEnum({
    Toggled: { done: Schema.Boolean },
  });
  class SaveTodo extends Command.Service<SaveTodo>()("todos/SaveTodo", {
    args: { id: Schema.String },
    error: Schema.String,
    success: TodoMessage,
  }) {}
  const SaverDef = defineComponent({
    events: TodoEvents,
    message: TodoMessage,
    model: Schema.Struct({ saved: Schema.Boolean }),
    name: "Saver",
    props: Schema.Struct({ id: Schema.String }),
  });
  const Saver = SaverDef.make({
    init: () => ({ saved: false }),
    update: (
      $: Update<
        { readonly saved: boolean },
        Schema.Schema.Type<typeof TodoMessage>,
        { readonly id: string },
        SaveTodo,
        Schema.Schema.Type<typeof TodoEvents>
      >,
      message: Schema.Schema.Type<typeof TodoMessage>
    ) => {
      // oxlint-disable-next-line eslint/default-case -- the switch is exhaustive over the message union; a default arm is unreachable.
      switch (message._tag) {
        case "Toggled": {
          return $.set({ saved: false }).run(
            Command.match(SaveTodo.make({ id: $.props.id }), {
              onFailure: (reason) => TodoMessage.SaveFailed({ reason }),
              onSuccess: () => TodoMessage.Saved(),
            })
          );
        }
        case "Saved": {
          return $.set({ saved: true }).emit(
            TodoEvents.Toggled({ done: true })
          );
        }
        case "SaveFailed": {
          return $.set({ saved: false });
        }
      }
    },
    view: (h, model) => h("div", null, String(model.saved)),
  });

  it("resolves the oldest matching command and sends its message", async () => {
    await runStory(Saver, { id: "t1" }, (s) => {
      s.send(TodoMessage.Toggled())
        .expectExact(SaveTodo.make({ id: "t1" }))
        .expectHas(SaveTodo)
        .resolve(SaveTodo, TodoMessage.Saved())
        .emitted(TodoEvents.Toggled({ done: true }));
      expect(s.model.saved).toBe(true);
    });
  });

  it("fails a command with its typed failure", async () => {
    await runStory(Saver, { id: "t1" }, (s) => {
      s.send(TodoMessage.Toggled()).fail(SaveTodo, "offline");
      expect(s.model.saved).toBe(false);
      s.expectNone();
    });
  });

  it("a command that can't fail throws", async () => {
    const Ping = Command.make("Ping", { args: {} }, () =>
      Effect.succeed(TodoMessage.Saved())
    );
    const PingerDef = defineComponent({
      message: TodoMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Pinger",
    });
    const Pinger = PingerDef.make({
      init: () => ({ n: 0 }),
      update: ($, message) => {
        // oxlint-disable-next-line eslint/default-case -- the switch is exhaustive over the message union; a default arm is unreachable.
        switch (message._tag) {
          case "Toggled": {
            return $.run(Ping({}));
          }
          case "Saved": {
            return $.set({ n: 1 });
          }
          case "SaveFailed": {
            return $;
          }
        }
      },
      view: (h) => h("div", null),
    });
    await expect(
      runStory(Pinger, {}, (s) => {
        s.send(TodoMessage.Toggled()).fail(Ping, "nope");
      })
    ).rejects.toThrow("can't fail");
  });

  it("resolve replays Command.map", async () => {
    const Fetch = Command.make("Fetch", { args: { id: Schema.String } }, () =>
      Effect.succeed(42)
    );
    const MappedDef = defineComponent({
      message: CounterMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Mapped",
    });
    const Mapped = MappedDef.make({
      init: () => ({ n: 0 }),
      update: ($, message) => {
        // oxlint-disable-next-line eslint/default-case -- the switch is exhaustive over the message union; a default arm is unreachable.
        switch (message._tag) {
          case "Increment": {
            return $.run(
              Command.map(Fetch({ id: "a" }), (n) =>
                CounterMessage.Add({ amount: n })
              )
            );
          }
          case "Add": {
            return $.set({ n: message.amount });
          }
        }
      },
      view: (h) => h("div", null),
    });
    await runStory(Mapped, {}, (s) => {
      s.send(CounterMessage.Increment()).resolve(Fetch, 7);
      expect(s.model.n).toBe(7);
    });
  });

  it("a silent command sends nothing", async () => {
    const Ping = Command.make("Ping", { args: {} }, () =>
      Effect.succeed(TodoMessage.Saved())
    );
    const QuietDef = defineComponent({
      message: TodoMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Quiet",
    });
    const Quiet = QuietDef.make({
      init: () => ({ n: 0 }),
      update: {
        SaveFailed: ($) => $,
        Saved: ($) => $.set({ n: 1 }),
        Toggled: ($) => $.run(Command.map(Ping({}), () => Component.noop)),
      },
      view: (h) => h("div", null),
    });
    await runStory(Quiet, {}, (s) => {
      s.send(TodoMessage.Toggled()).resolve(Ping, TodoMessage.Saved());
      expect(s.model.n).toBe(0);
      s.expectNone();
    });
  });

  it("switch cuts the running command and records the interrupt", async () => {
    const Fetch = Command.make(
      "Fetch",
      { args: { id: Schema.String }, mode: "switch" },
      ({ id }) => Effect.succeed(CounterMessage.Add({ amount: Number(id) }))
    );
    const SwitcherDef = defineComponent({
      message: CounterMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Switcher",
    });
    const Switcher = SwitcherDef.make({
      init: () => ({ n: 0 }),
      update: ($, message) => {
        // oxlint-disable-next-line eslint/default-case -- the switch is exhaustive over the message union; a default arm is unreachable.
        switch (message._tag) {
          case "Increment": {
            return $.run(Fetch({ id: "1" }));
          }
          case "Add": {
            return $.set({ n: message.amount });
          }
        }
      },
      view: (h) => h("div", null),
    });
    await runStory(Switcher, {}, (s) => {
      s.send(CounterMessage.Increment());
      s.send(CounterMessage.Increment());
      // A switch run cuts the earlier one: it leaves pending, recorded in interrupted.
      expect(s.pending).toHaveLength(1);
      expect(s.interrupted).toHaveLength(1);
      // A switch run never blocks: the sends are not message-step errors.
      // The cut-behind run starts queued, so a third send starts the run
      // the resolve settles (cutting the queued one, which had no fiber).
      s.send(CounterMessage.Increment());
      s.resolve(Fetch, CounterMessage.Add({ amount: 2 }));
      expect(s.model.n).toBe(2);
    });
  });

  it("queue waits behind the running command", async () => {
    const Fetch = Command.make(
      "Fetch",
      { args: { id: Schema.String }, mode: "queue" },
      ({ id }) => Effect.succeed(CounterMessage.Add({ amount: Number(id) }))
    );
    const QueuedDef = defineComponent({
      message: CounterMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Queued",
    });
    const Queued = QueuedDef.make({
      init: () => ({ n: 0 }),
      update: ($, message) => {
        // oxlint-disable-next-line eslint/default-case -- the switch is exhaustive over the message union; a default arm is unreachable.
        switch (message._tag) {
          case "Increment": {
            return $.run(Fetch({ id: String($.model.n + 1) }));
          }
          case "Add": {
            return $.set({ n: message.amount });
          }
        }
      },
      view: (h) => h("div", null),
    });
    await runStory(Queued, {}, (s) => {
      s.send(CounterMessage.Increment());
      s.send(CounterMessage.Increment());
      expect(s.pending.map((entry) => entry.status)).toEqual([
        "running",
        "queued",
      ]);
      s.resolve(Fetch, CounterMessage.Add({ amount: 1 }));
      expect(s.pending.map((entry) => entry.status)).toEqual(["running"]);
      s.resolve(Fetch, CounterMessage.Add({ amount: 2 }));
      expect(s.model.n).toBe(2);
    });
  });

  it("an interrupt command cuts its runs", async () => {
    const Fetch = Command.make("Fetch", { args: { id: Schema.String } }, () =>
      Effect.succeed(CounterMessage.Increment())
    );
    const StoppableDef = defineComponent({
      message: CounterMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Stoppable",
    });
    const Stoppable = StoppableDef.make({
      init: () => ({ n: 0 }),
      update: {
        Add: ($) => $,
        // The first send starts the run and records it; the second send,
        // once the run is kept, interrupts it instead.
        Increment: ($) =>
          $.model.n === 0
            ? $.run(Fetch({ id: "a" })).set({ n: 1 })
            : $.run<never>(Command.interrupt(Fetch)).set({ n: 9 }),
      },
      view: (h) => h("div", null),
    });
    await runStory(Stoppable, {}, (s) => {
      s.send(CounterMessage.Increment());
      expect(s.pending).toHaveLength(1);
      // The interrupt is issued by an update, so the pending run is kept first.
      s.keepPending(Fetch);
      s.send(CounterMessage.Increment());
      expect(s.model.n).toBe(9);
      expect(s.interrupted).toHaveLength(1);
      s.expectNone();
    });
  });

  it("streams send one element per next and end with nothing", async () => {
    const Ticks = Command.make("Ticks", { args: {}, stream: true }, () =>
      Stream.make(CounterMessage.Increment(), CounterMessage.Increment())
    );
    const TickerDef = defineComponent({
      message: CounterMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Ticker",
    });
    const Ticker = TickerDef.make({
      init: () => ({ n: 0 }),
      update: {
        Add: ($, { amount }) => $.set({ n: $.model.n + amount }),
        // The first Increment opens the stream; stream elements arrive as
        // Add and count without opening another stream.
        Increment: ($) =>
          $.model.n === 0 ? $.run(Ticks({})) : $.set({ n: $.model.n + 1 }),
      },
      view: (h) => h("div", null),
    });
    await runStory(Ticker, {}, (s) => {
      s.send(CounterMessage.Increment());
      s.next(Ticks, CounterMessage.Add({ amount: 1 }));
      s.next(Ticks, CounterMessage.Add({ amount: 1 }));
      expect(s.model.n).toBe(2);
      s.end(Ticks);
      s.expectNone();
    });
  });

  it("isRunning derives from the pending commands", async () => {
    const Fetch = Command.make("Fetch", { args: {} }, () =>
      Effect.succeed(CounterMessage.Increment())
    );
    let running: boolean[] = [];
    const WatcherDef = defineComponent({
      message: CounterMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Watcher",
    });
    const Watcher = WatcherDef.make({
      init: () => ({ n: 0 }),
      update: {
        Add: ($, { amount }) => $.set({ n: amount }),
        // The first Increment opens the run; the resolve delivers Add so the
        // run settles quietly instead of opening another run.
        Increment: ($) =>
          $.model.n === 0 ? $.run(Fetch({})) : $.set({ n: 1 }),
      },
      view: (h, model) => {
        running.push(h.isRunning(Fetch));
        return h("div", null, String(model.n));
      },
    });
    // A story never renders, so read isRunning through the engine helper instead.
    await runStory(Watcher, {}, (s) => {
      s.send(CounterMessage.Increment());
      expect(s.pending).toHaveLength(1);
      s.check(() => {
        running = [];
      });
      s.resolve(Fetch, CounterMessage.Add({ amount: 1 }));
      expect(s.model.n).toBe(1);
    });
    expect(running).toEqual([]);
  });

  it("subscriptions deliver by key and list the active keys", async () => {
    const TickerDef = defineComponent({
      message: CounterMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Sub",
      props: Schema.Struct({ room: Schema.String }),
    });
    const Sub = TickerDef.make({
      init: () => ({ n: 0 }),
      subscriptions: ({ props }) => [
        Subscription.make(
          "ticks",
          // SAFETY: subscriptions receive the component's own props, whose schema declares room.
          (props as { readonly room: string }).room,
          () => Stream.empty
        ),
      ],
      update: {
        Add: ($) => $,
        Increment: ($) => $.set({ n: $.model.n + 1 }),
      },
      view: (h) => h("div", null),
    });
    await runStory(Sub, { room: "a" }, (s) => {
      expect(s.subscriptions).toEqual([`ticks:"a"`]);
      s.subscription(`ticks:"a"`, CounterMessage.Increment());
      expect(s.model.n).toBe(1);
      s.props({ room: "b" });
      expect(s.subscriptions).toEqual([`ticks:"b"`]);
    });
    await expect(
      runStory(Sub, { room: "a" }, (s) => {
        s.subscription("missing", CounterMessage.Increment());
      })
    ).rejects.toThrow('no Subscription has the key "missing"');
  });

  it("duplicate subscription keys throw", async () => {
    const DupDef = defineComponent({
      message: CounterMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Dup",
    });
    const Dup = DupDef.make({
      init: () => ({ n: 0 }),
      subscriptions: () => [
        Subscription.make("same", Stream.empty),
        Subscription.make("same", Stream.empty),
      ],
      update: {
        Add: ($) => $,
        Increment: ($) => $,
      },
      view: (h) => h("div", null),
    });
    await expect(
      runStory(Dup, {}, (s) => {
        void s.subscriptions;
      })
    ).rejects.toThrow('two Subscriptions share the key "same"');
  });
});

describe("the acknowledgement rule", () => {
  const Started = Command.make("Started", { args: {} }, () =>
    Effect.succeed(CounterMessage.Increment())
  );
  const Slow = Command.make("Slow", { args: {}, mode: "queue" }, () =>
    Effect.succeed(CounterMessage.Increment())
  );
  const FlowDef = defineComponent({
    events: TaggedEnum({ Done: {} }),
    message: CounterMessage,
    model: Schema.Struct({ n: Schema.Number }),
    name: "Flow",
  });
  const Flow = FlowDef.make({
    init: () => ({ n: 0 }),
    // Stories deliver resolve messages back through update, so runs only
    // start while the count is low: resolves settle quietly afterwards.
    update: ($, message) => {
      // oxlint-disable-next-line eslint/default-case -- the switch is exhaustive over the message union; a default arm is unreachable.
      switch (message._tag) {
        case "Increment": {
          return $.model.n <= 1
            ? $.run(Started({})).set({ n: $.model.n + 1 })
            : $.set({ n: $.model.n + 1 });
        }
        case "Add": {
          return $.model.n <= 1
            ? $.run(Slow({})).set({ n: $.model.n + 1 })
            : $.set({ n: $.model.n + 1 });
        }
      }
    },
    view: (h) => h("div", null),
  });

  it("a message step throws while a command is pending", async () => {
    await expect(
      runStory(Flow, {}, (s) => {
        s.send(CounterMessage.Increment());
        s.send(CounterMessage.Increment());
      })
    ).rejects.toThrow("earlier work isn't settled or acknowledged");
  });

  it("a switch, queue or stream command never blocks a message step", async () => {
    await runStory(Flow, {}, (s) => {
      s.send(CounterMessage.Add({ amount: 0 }));
      // queue mode: exempt, so a second message step is fine.
      s.send(CounterMessage.Add({ amount: 0 }));
      s.resolve(Slow, CounterMessage.Increment());
      s.resolve(Slow, CounterMessage.Increment());
    });
  });

  it("an acting step throws on unacknowledged events, and emitted acks them", async () => {
    const EmitterDef = defineComponent({
      events: TaggedEnum({ Done: {} }),
      message: CounterMessage,
      model: Schema.Struct({ n: Schema.Number }),
      name: "Emitter",
    });
    const Emitter = EmitterDef.make({
      init: () => ({ n: 0 }),
      update: {
        Add: ($) => $,
        Increment: ($) => $.set({ n: 1 }).emit({ _tag: "Done" }),
      },
      view: (h) => h("div", null),
    });
    await runStory(Emitter, {}, (s) => {
      s.send(CounterMessage.Increment());
      expect(() => s.props({})).toThrow(
        "was emitted: acknowledge it with emitted"
      );
      s.emitted({ _tag: "Done" });
      s.props({});
    });
    await expect(
      runStory(Emitter, {}, (s) => {
        s.send(CounterMessage.Increment()).emitted();
      })
    ).rejects.toThrow("needs at least one event");
  });

  it("keepPending marks commands so message steps pass, but not the end check", async () => {
    await runStory(Flow, {}, (s) => {
      s.send(CounterMessage.Increment());
      s.keepPending(Started);
      s.send(CounterMessage.Increment());
      s.resolve(Started, CounterMessage.Increment());
      s.resolve(Started, CounterMessage.Increment());
    });
    await expect(
      runStory(Flow, {}, (s) => {
        s.send(CounterMessage.Increment());
        s.keepPending(Started);
      })
    ).rejects.toThrow("the test ends with work not settled or acknowledged");
    await expect(
      runStory(Flow, {}, (s) => {
        s.send(CounterMessage.Increment());
        s.keepPending("nope");
      })
    ).rejects.toThrow('has no query "nope"');
  });

  it("given after an acting step throws rather than discard work", async () => {
    await expect(
      runStory(Flow, {}, (s) => {
        s.send(CounterMessage.Increment());
        s.given({ n: 10 });
      })
    ).rejects.toThrow("given would discard work");
  });

  it("the end check passes start cursors by", () => {
    const s = Story.start(Flow, {});
    s.send(CounterMessage.Increment());
    // No end check: pending work is fine on a start cursor.
    expect(s.pending).toHaveLength(1);
  });

  it("expectExact compares the pending commands in order", async () => {
    await runStory(Flow, {}, (s) => {
      s.send(CounterMessage.Increment());
      s.expectExact(Started({}));
      expect(() => s.expectExact(Slow)).toThrow(
        "expected exactly these Commands pending"
      );
      expect(() => s.expectHas(Slow)).toThrow(
        "no pending Command matches Slow"
      );
      s.expectHas(Started);
      // Settle the run and the one its resolve re-opens, so the end check passes.
      s.resolve(Started, CounterMessage.Increment());
      s.resolve(Started, CounterMessage.Increment());
    });
  });
});

// Log-entry builders for one component's session: the harness decodes the
// payloads back through the component's own schemas in `fromLog`.
const mounted = (
  seq: number,
  instance: number,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- log payloads stay schema-erased until fromLog decodes them.
  model: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- log payloads stay schema-erased until fromLog decodes them.
  props: unknown
) => ({
  _tag: "Mounted",
  adopted: false,
  at: seq * 10,
  commands: [],
  component: { definition: undefined, fullName: "Logged", name: "Logged" },
  events: [],
  instance,
  model,
  path: "/Logged",
  props,
  seq,
  session: "s1",
});
const updated = (
  seq: number,
  instance: number,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- log payloads stay schema-erased until fromLog decodes them.
  message: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- log payloads stay schema-erased until fromLog decodes them.
  model: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- log payloads stay schema-erased until fromLog decodes them.
  props: unknown,
  commands: readonly unknown[] = [],
  events: readonly unknown[] = []
) => ({
  _tag: "Update",
  at: seq * 10,
  commands,
  component: { definition: undefined, fullName: "Logged", name: "Logged" },
  events,
  instance,
  message,
  model,
  path: "/Logged",
  props,
  seq,
  session: "s1",
  source: { _tag: "Dispatch" },
});

describe("Story.fromLog", () => {
  const LoggedDef = defineComponent({
    events: TaggedEnum({ Changed: { count: Schema.Number } }),
    message: CounterMessage,
    model: Schema.Struct({ count: Schema.Number }),
    name: "Logged",
    props: Schema.Struct({ step: Schema.Number }),
  });
  const Logged = LoggedDef.make({
    init: ($, props) => $.set({ count: props.step }),
    update: {
      Add: ($, { amount }) => $.set({ count: $.model.count + amount }),
      Increment: ($) =>
        $.set({ count: $.model.count + 1 }).emit({
          _tag: "Changed",
          count: $.model.count + 1,
        }),
    },
    view: (h, model) => h("div", null, String(model.count)),
  });

  it("replays a session to its final state", () => {
    // SAFETY: mounted/updated build entries of Logged's own log shape; never bridges the literal/Entry gap.
    const replay = Story.fromLog(Logged, [
      mounted(1, 0, { count: 5 }, { step: 5 }),
      updated(
        2,
        0,
        CounterMessage.Increment(),
        { count: 6 },
        { step: 5 },
        [],
        [{ _tag: "Changed", count: 6 }]
      ),
      updated(
        3,
        0,
        CounterMessage.Add({ amount: 4 }),
        { count: 10 },
        { step: 5 }
      ),
    ] as never);
    expect(replay.path).toBe("/Logged");
    expect(replay.model).toEqual({ count: 10 });
    expect(replay.replayed).toBe(2);
    expect(replay.divergence).toBeUndefined();
  });

  it("reports the first divergence with the state before it", () => {
    // SAFETY: mounted/updated build entries of Logged's own log shape; never bridges the literal/Entry gap.
    const replay = Story.fromLog(Logged, [
      mounted(1, 0, { count: 5 }, { step: 5 }),
      updated(
        2,
        0,
        CounterMessage.Increment(),
        { count: 6 },
        { step: 5 },
        [],
        [{ _tag: "Changed", count: 6 }]
      ),
      // Recorded 99, but the update computes 7.
      updated(
        3,
        0,
        CounterMessage.Add({ amount: 1 }),
        { count: 99 },
        { step: 5 }
      ),
    ] as never);
    expect(replay.divergence?.seq).toBe(3);
    expect(replay.model).toEqual({ count: 6 });
    expect(replay.divergence?.recorded.model).toEqual({ count: 99 });
    expect(replay.divergence?.recomputed.model).toEqual({ count: 7 });
  });

  it("a second mount starts over, and the result is the last instance", () => {
    // SAFETY: mounted/updated build entries of Logged's own log shape; never bridges the literal/Entry gap.
    const replay = Story.fromLog(Logged, [
      mounted(1, 0, { count: 5 }, { step: 5 }),
      updated(
        2,
        0,
        CounterMessage.Increment(),
        { count: 6 },
        { step: 5 },
        [],
        [{ _tag: "Changed", count: 6 }]
      ),
      mounted(3, 1, { count: 0 }, { step: 0 }),
      updated(
        4,
        1,
        CounterMessage.Increment(),
        { count: 1 },
        { step: 0 },
        [],
        [{ _tag: "Changed", count: 1 }]
      ),
    ] as never);
    expect(replay.model).toEqual({ count: 1 });
    expect(replay.replayed).toBe(1);
  });

  it("errors name the component when the log has no entry for it", () => {
    // SAFETY: the empty log carries no entries, so the component name is all fromLog needs to throw.
    expect(() => Story.fromLog(Logged, [] as never)).toThrow(
      "Story.fromLog: the log has no entry for Logged"
    );
  });

  it("a truncated placeholder fails with its entry", () => {
    // SAFETY: the literal is a truncated Logged mount entry; never bridges the literal/Entry gap.
    expect(() =>
      Story.fromLog(Logged, [
        {
          _tag: "Mounted",
          at: 10,
          component: { name: "Logged" },
          instance: 0,
          model: { "~truncated": 8 },
          path: "/Logged",
          props: { step: 5 },
          seq: 1,
          session: "s1",
        },
      ] as never)
    ).toThrow("has a model that can't be decoded");
  });
});

describe("Validation in a component", () => {
  const Message = TaggedEnum({
    ClickedSubmit: {},
    CreatedAccount: {},
    UpdatedUsername: { value: Schema.String },
  });
  // onChange shows a field's result as soon as it is edited, so typing
  // validates immediately instead of waiting for blur or submit.
  const Account = Validation.make(
    {
      username: {
        required: "Pick a username",
        rules: [Validation.Rule.minLength(3)],
      },
    },
    { mode: "onChange" }
  );
  const SignupDef = defineComponent({
    message: Message,
    model: Schema.Struct({ form: Account.State, submitted: Schema.Boolean }),
    name: "SignupPage",
  });
  class CreateAccount extends Command.Service<CreateAccount>()(
    "accounts/CreateAccount",
    {
      args: { username: Schema.String },
      success: Message,
    }
  ) {}
  const SignupPage = SignupDef.make({
    init: () => ({ form: Account.init({ username: "" }), submitted: false }),
    update: (
      $: Update<
        {
          readonly form: Schema.Schema.Type<typeof Account.State>;
          readonly submitted: boolean;
        },
        Schema.Schema.Type<typeof Message>,
        Record<string, never>,
        CreateAccount,
        never
      >,
      message: Schema.Schema.Type<typeof Message>
    ) => {
      // oxlint-disable-next-line eslint/default-case -- the switch is exhaustive over the message union; a default arm is unreachable.
      switch (message._tag) {
        case "UpdatedUsername": {
          return $.set({
            ...$.model,
            form: Account.change($.model.form, "username", message.value),
          });
        }
        case "ClickedSubmit": {
          const form = Account.submit($.model.form);
          if (Account.validate(form).invalid) {
            return $.set({ ...$.model, form });
          }
          return $.set({ ...$.model, form }).run(
            CreateAccount.make({ username: form.values.username })
          );
        }
        case "CreatedAccount": {
          return $.set({ ...$.model, submitted: true });
        }
      }
    },
    view: (h, model) =>
      h("div", null, String(Account.validate(model.form).invalid)),
  });

  it("typing validates the field and submitting creates the account", async () => {
    await runStory(SignupPage, {}, (s) => {
      s.send(Message.UpdatedUsername({ value: "ad" }));
      expect(Account.validate(s.model.form).invalid).toBe(true);
      s.send(Message.UpdatedUsername({ value: "ada" }));
      expect(Account.validate(s.model.form).invalid).toBe(false);
      s.send(Message.ClickedSubmit())
        .expectExact(CreateAccount.make({ username: "ada" }))
        .resolve(CreateAccount, Message.CreatedAccount());
      expect(s.model.submitted).toBe(true);
      s.expectNone();
    });
  });

  it("submitting an invalid form runs no command", async () => {
    await runStory(SignupPage, {}, (s) => {
      s.send(Message.UpdatedUsername({ value: "" }));
      s.send(Message.ClickedSubmit());
      s.expectNone();
      expect(Account.validate(s.model.form).invalid).toBe(true);
    });
  });

  it("a submission failure is a message", async () => {
    const FailingDef = defineComponent({
      message: TaggedEnum({
        ClickedSubmit: {},
        Failed: { reason: Schema.String },
      }),
      model: Schema.Struct({ error: Schema.String, form: Account.State }),
      name: "Failing",
    });
    const Failing = FailingDef.make({
      init: () => ({ error: "", form: Account.init({ username: "ada" }) }),
      update: {
        ClickedSubmit: ($) => $.set({ ...$.model, error: "saving" }),
        Failed: ($, { reason }) => $.set({ ...$.model, error: reason }),
      },
      view: (h) => h("div", null),
    });
    await runStory(Failing, {}, (s) => {
      // SAFETY: ClickedSubmit is a Failing tag; the literal stands in for its message until the harness decodes it.
      s.send({ _tag: "ClickedSubmit" } as never);
      expect(s.model.error).toBe("saving");
    });
  });
});
