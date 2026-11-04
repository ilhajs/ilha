// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Context, Data, Effect, Layer, Logger } from "effect";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";

import { defineApp, keyed } from "./app";
import { foldChild } from "./submodel";
import { runCommands, simulate } from "./test";

// oxlint-disable-next-line typescript/no-empty-object-type, typescript/ban-types, typescript/consistent-type-definitions -- Data.taggedEnum spells payload-free variants as `{}`.
type NoArgs = {};

describe("runCommands", () => {
  it("collects messages in completion order", async () => {
    const messages = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* messages() {
          const fiber = yield* Effect.forkChild(
            runCommands([
              Effect.as(Effect.sleep(Duration.minutes(10)), "first"),
              Effect.succeed("second"),
            ])
          );
          yield* TestClock.adjust(Duration.minutes(10));
          return yield* Fiber.join(fiber);
        }),
        TestClock.layer()
      )
    );
    expect(messages).toEqual(["second", "first"]);
  });

  it("lets the latest same-key command win and keeps different keys", async () => {
    const messages = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* messages() {
          const fiber = yield* Effect.forkChild(
            runCommands([
              keyed(
                "k",
                Effect.as(Effect.sleep(Duration.minutes(10)), "first")
              ),
              keyed(
                "k",
                Effect.as(Effect.sleep(Duration.minutes(1)), "second")
              ),
              keyed("other", Effect.succeed("other")),
            ])
          );
          yield* TestClock.adjust(Duration.minutes(10));
          return yield* Fiber.join(fiber);
        }),
        TestClock.layer()
      )
    );
    expect(messages.toSorted()).toEqual(["other", "second"]);
  });

  it("logs defects and drops them and void results", async () => {
    const logged: unknown[] = [];
    const messages = await Effect.runPromise(
      Effect.provide(
        runCommands([
          Effect.die(new Error("boom")),
          Effect.void,
          Effect.succeed("ok"),
        ]),
        Logger.layer([
          Logger.make((options) => {
            logged.push(options.message);
          }),
        ])
      )
    );
    expect(messages).toEqual(["ok"]);
    expect(logged.length).toBe(1);
    expect(String(logged[0])).toContain("boom");
  });

  it("accepts one command or an update result", async () => {
    const single = await Effect.runPromise(runCommands(Effect.succeed("a")));
    expect(single).toEqual(["a"]);
    const fromResult = await Effect.runPromise(
      runCommands({
        cmd: [Effect.succeed("b"), Effect.succeed("c")],
        model: { n: 1 },
      })
    );
    expect(fromResult.toSorted()).toEqual(["b", "c"]);
    const empty = await Effect.runPromise(runCommands({ model: { n: 1 } }));
    expect(empty).toEqual([]);
  });

  it("delivers foldChild-lifted commands wrapped for the parent", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type ChildMessage = Data.TaggedEnum<{
      Save: NoArgs;
      Saved: NoArgs;
    }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const ChildMessage = Data.taggedEnum<ChildMessage>();
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type ParentMessage = Data.TaggedEnum<{
      Child: { readonly message: ChildMessage };
    }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const ParentMessage = Data.taggedEnum<ParentMessage>();
    const fold = foldChild<
      { readonly n: number },
      ParentMessage,
      { readonly n: number },
      ChildMessage
    >({
      read: (model) => model,
      toParentMessage: (message) => ParentMessage.Child({ message }),
      update: (model, message) =>
        ChildMessage.$match(message, {
          Save: () => ({
            cmd: Effect.succeed(ChildMessage.Saved()),
            model,
          }),
          Saved: () => ({ model }),
        }),
      write: (_model, child) => child,
    });
    const result = fold({ n: 0 }, ChildMessage.Save());
    const messages = await Effect.runPromise(runCommands(result));
    expect(messages).toEqual([
      ParentMessage.Child({ message: ChildMessage.Saved() }),
    ]);
  });
});

describe("simulate", () => {
  it("runs the init command before the input messages", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Msg = Data.TaggedEnum<{ Nudge: NoArgs; Seeded: NoArgs; Tick: NoArgs }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Msg = Data.taggedEnum<Msg>();
    const app = defineApp({
      init: () => ({
        cmd: Effect.succeed(Msg.Seeded()),
        model: { count: 0 },
      }),
      update: (model: { count: number }, message: Msg) =>
        Msg.$match(message, {
          Nudge: () => ({ cmd: Effect.succeed(Msg.Tick()), model }),
          Seeded: () => ({ model: { count: 100 } }),
          Tick: () => ({ model: { count: model.count + 1 } }),
        }),
      view: (model: { count: number }) => <p>{model.count}</p>,
    });
    const result = await Effect.runPromise(simulate(app, [Msg.Nudge()]));
    expect(result.model).toEqual({ count: 101 });
    expect(result.messages).toEqual([Msg.Seeded(), Msg.Nudge(), Msg.Tick()]);
  });

  it("threads command results back through update until quiet", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Msg = Data.TaggedEnum<{ Start: NoArgs; Tick: NoArgs }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Msg = Data.taggedEnum<Msg>();
    const app = defineApp({
      init: () => ({ model: { count: 0 } }),
      update: (model: { count: number }, message: Msg) =>
        Msg.$match(message, {
          Start: () => ({ cmd: Effect.succeed(Msg.Tick()), model }),
          Tick: () =>
            model.count < 2
              ? {
                  cmd: Effect.succeed(Msg.Tick()),
                  model: { count: model.count + 1 },
                }
              : { model: { count: model.count + 1 } },
        }),
      view: (model: { count: number }) => <p>{model.count}</p>,
    });
    const result = await Effect.runPromise(simulate(app, [Msg.Start()]));
    expect(result.model).toEqual({ count: 3 });
    expect(result.messages).toEqual([
      Msg.Start(),
      Msg.Tick(),
      Msg.Tick(),
      Msg.Tick(),
    ]);
  });

  it("runs sleeping commands on the TestClock", async () => {
    const app = defineApp({
      init: () => ({ model: { count: 0 } }),
      update: (model: { count: number }, message: "go" | "wake") =>
        message === "go"
          ? {
              cmd: Effect.as(
                Effect.sleep(Duration.seconds(30)),
                "wake" as const
              ),
              model,
            }
          : { model: { count: model.count + 1 } },
      view: (model: { count: number }) => <p>{model.count}</p>,
    });
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* result() {
          const fiber = yield* Effect.forkChild(simulate(app, ["go"]));
          yield* TestClock.adjust(Duration.seconds(30));
          return yield* Fiber.join(fiber);
        }),
        TestClock.layer()
      )
    );
    expect(result.model).toEqual({ count: 1 });
    expect(result.messages).toEqual(["go", "wake"]);
  });

  it("provides the app layer and allows overriding it", async () => {
    const Greeter = Context.Service<{ readonly greet: string }>("SimGreeter");
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Msg = Data.TaggedEnum<{
      Go: NoArgs;
      Got: { readonly text: string };
    }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Msg = Data.taggedEnum<Msg>();
    const app = defineApp({
      init: () => ({ model: { text: "" } }),
      layer: Layer.succeed(Greeter, { greet: "real" }),
      update: (model: { text: string }, message: Msg) =>
        Msg.$match(message, {
          Go: () => ({
            cmd: Effect.map(Effect.service(Greeter), (greeter) =>
              Msg.Got({ text: greeter.greet })
            ),
            model,
          }),
          Got: ({ text }) => ({ model: { text } }),
        }),
      view: (model: { text: string }) => <p>{model.text}</p>,
    });
    const withAppLayer = await Effect.runPromise(simulate(app, [Msg.Go()]));
    expect(withAppLayer.model).toEqual({ text: "real" });
    const overridden = await Effect.runPromise(
      simulate(app, [Msg.Go()], {
        layer: Layer.succeed(Greeter, { greet: "fake" }),
      })
    );
    expect(overridden.model).toEqual({ text: "fake" });
  });
});
