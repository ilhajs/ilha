// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import type { Option } from "effect";
import { Context, Data, Effect, Layer } from "effect";
import * as Stream from "effect/Stream";

import type {
  AppOptions,
  Dispatch,
  ModelLogDiff,
  ModelLogEntry,
} from "./index";
import {
  attachModelRecorder,
  combine,
  defineApp,
  foldChild,
  MODEL_LOG_CAP,
  readModelLog,
  subscription,
} from "./index";
import type { SimulateResult } from "./test";
import { runCommands, simulate } from "./test";

// oxlint-disable-next-line typescript/no-empty-object-type, typescript/ban-types, typescript/consistent-type-definitions -- Data.taggedEnum spells payload-free variants as `{}`.
type NoArgs = {};

// oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
type Message = Data.TaggedEnum<{ Ping: NoArgs; Pong: NoArgs }>;
// oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
const Message = Data.taggedEnum<Message>();

interface Model {
  readonly count: number;
}

const typecheckApp = (): void => {
  const app = defineApp({
    init: () => ({ model: { count: 0 } }),
    update: (model: Model, message: Message) =>
      message._tag === "Ping"
        ? { model: { count: model.count + 1 } }
        : { model },
    view: (model: Model, dispatch: Dispatch<Message>) => {
      dispatch(Message.Ping());
      return <p>{model.count}</p>;
    },
  });
  const count: number = app.options.init().model.count;
  void count;

  const badModel: AppOptions<{ count: number }, Message> = {
    init: () => ({ model: { count: 0 } }),
    // @ts-expect-error -- update must return the declared model shape.
    update: () => ({ model: { missing: true } }),
    view: () => <p>no</p>,
  };
  void badModel;

  // Message comes from `update` alone: a command resolving to one variant
  // keeps the full union.
  const narrowCmd = defineApp({
    init: () => ({ model: { count: 0 } }),
    update: (model: Model, _message: Message) => ({
      cmd: Effect.succeed(Message.Pong()),
      model,
    }),
    view: (model: Model) => <p>{model.count}</p>,
  });
  const ping: Parameters<typeof narrowCmd.options.update>[1] = Message.Ping();
  void ping;

  const unannotatedView = defineApp({
    init: () => ({ model: { count: 0 } }),
    update: (model: Model, _message: Message) => ({ model }),
    view: (model, dispatch) => (
      // @ts-expect-error -- an unannotated view's dispatch takes the app's messages only.
      <button type="button" onclick={() => dispatch({ _tag: "Nope" })}>
        {model.count}
      </button>
    ),
  });
  void unannotatedView;
};

const typecheckMessages = (): void => {
  interface Payload {
    readonly x: number;
  }
  // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
  type Rich = Data.TaggedEnum<{
    Got: { readonly payload: Payload };
    Maybe: { readonly value: Option.Option<number> };
  }>;
  // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
  const Rich = Data.taggedEnum<Rich>();
  const richApp = defineApp({
    init: () => ({ model: { count: 0 } }),
    update: (model: Model, message: Rich) =>
      Rich.$match(message, {
        Got: ({ payload }) => ({ model: { count: model.count + payload.x } }),
        Maybe: ({ value }) => ({
          model: {
            count: value._tag === "Some" ? value.value : model.count,
          },
        }),
      }),
    view: (model: Model) => <p>{model.count}</p>,
  });
  void richApp;
};

const typecheckCommands = (): void => {
  const single = defineApp({
    init: () => ({ model: { count: 0 } }),
    update: (model: { count: number }) => ({
      cmd: Effect.succeed(Message.Pong()),
      model,
    }),
    view: () => <p>ok</p>,
  });
  void single;

  const many = defineApp({
    init: () => ({ model: { count: 0 } }),
    update: (model: { count: number }) => ({
      cmd: [Effect.succeed(Message.Pong()), Effect.void],
      model,
    }),
    view: () => <p>ok</p>,
  });
  void many;

  const badCmd: AppOptions<{ count: number }, Message> = {
    init: () => ({ model: { count: 0 } }),
    // @ts-expect-error -- commands resolve to messages, not models.
    update: (model) => ({ cmd: Effect.succeed({ count: 1 }), model }),
    view: () => <p>no</p>,
  };
  void badCmd;

  // The same checks through `defineApp`, where `Message` is inferred.
  const badUpdateCmd = defineApp({
    init: () => ({ model: { count: 0 } }),
    // @ts-expect-error -- an update command must resolve to the app's messages.
    update: (model: Model, _message: Message) => ({
      cmd: Effect.succeed({ count: 1 }),
      model,
    }),
    view: (model: Model) => <p>{model.count}</p>,
  });
  void badUpdateCmd;
  const badInitCmd = defineApp({
    // @ts-expect-error -- an init command must resolve to the app's messages.
    init: () => ({ cmd: Effect.succeed(42), model: { count: 0 } }),
    update: (model: Model, _message: Message) => ({ model }),
    view: (model: Model) => <p>{model.count}</p>,
  });
  void badInitCmd;

  const failCmd: AppOptions<{ count: number }, Message> = {
    init: () => ({ model: { count: 0 } }),
    // @ts-expect-error -- commands cannot fail; map failures into messages.
    update: (model) => ({ cmd: Effect.fail(new Error("nope")), model }),
    view: () => <p>no</p>,
  };
  void failCmd;
};

const typecheckSubscriptions = (): void => {
  interface SearchModel {
    readonly term: string;
  }
  const sub = subscription({
    deps: (model: SearchModel) => model.term,
    stream: (term) => {
      const checked: string = term;
      void checked;
      return Stream.make(Message.Ping());
    },
  });
  void sub;

  const badDeps = subscription({
    // @ts-expect-error -- the stream receives the deps type, not another one.
    deps: (model: SearchModel) => model.term,
    stream: (_term: number) => Stream.make(Message.Ping()),
  });
  void badDeps;
};

const Greeter = Context.Service<{ readonly greet: (name: string) => string }>(
  "TypeGreeter"
);
const Other = Context.Service<{ readonly other: number }>("TypeOther");

const typecheckServices = (): void => {
  const svcApp = defineApp({
    init: () => ({ model: { count: 0 } }),
    layer: Layer.succeed(Greeter, { greet: (name) => `hi ${name}` }),
    update: (model: { count: number }, message: Message) =>
      message._tag === "Ping"
        ? {
            cmd: Effect.map(Effect.service(Greeter), (service) =>
              service.greet("x") === "hi x" ? Message.Pong() : Message.Ping()
            ),
            model: { count: model.count + 1 },
          }
        : { model },
    view: () => <p>ok</p>,
  });
  void svcApp;

  const missing: AppOptions<Model, Message> = {
    init: () => ({ model: { count: 0 } }),
    update: (model) => ({
      // @ts-expect-error -- the service is not in the layer.
      cmd: Effect.map(Effect.service(Greeter), () => Message.Pong()),
      model,
    }),
    view: () => <p>no</p>,
  };
  void missing;

  const wrongLayer: AppOptions<Model, Message, { readonly other: number }> = {
    init: () => ({ model: { count: 0 } }),
    layer: Layer.succeed(Other, { other: 1 }),
    update: (model) => ({
      // @ts-expect-error -- Greeter is not the provided service.
      cmd: Effect.as(Effect.service(Greeter), Message.Pong()),
      model,
    }),
    view: () => <p>no</p>,
  };
  void wrongLayer;

  // @ts-expect-error -- the layer does not provide Greeter.
  const shortLayer = defineApp({
    init: () => ({ model: { count: 0 } }),
    layer: Layer.succeed(Other, { other: 1 }),
    update: (model: Model, message: Message) =>
      message._tag === "Ping"
        ? {
            cmd: Effect.as(Effect.service(Greeter), Message.Pong()),
            model: { count: model.count + 1 },
          }
        : { model },
    view: () => <p>no</p>,
  });
  void shortLayer;

  // @ts-expect-error -- no layer provides Greeter.
  const noLayer = defineApp({
    init: () => ({ model: { count: 0 } }),
    update: (model: Model, message: Message) =>
      message._tag === "Ping"
        ? {
            cmd: Effect.as(Effect.service(Greeter), Message.Pong()),
            model: { count: model.count + 1 },
          }
        : { model },
    view: () => <p>no</p>,
  });
  void noLayer;

  const bothApp = defineApp({
    init: () => ({ model: { count: 0 } }),
    layer: Layer.merge(
      Layer.succeed(Greeter, { greet: (name) => `hi ${name}` }),
      Layer.succeed(Other, { other: 1 })
    ),
    update: (model: { count: number }, message: Message) =>
      message._tag === "Ping"
        ? {
            cmd: [
              Effect.as(Effect.service(Greeter), Message.Pong()),
              Effect.as(Effect.service(Other), Message.Pong()),
            ],
            model: { count: model.count + 1 },
          }
        : { model },
    view: () => <p>ok</p>,
  });
  void bothApp;
};

const typecheckComposition = (): void => {
  const fold = foldChild<Model, Message, Model, Message>({
    read: (model) => model,
    toParentMessage: (message) => message,
    update: (model) => ({ model }),
    write: (_model, child) => child,
  });
  const child: Message = Message.Ping();
  const result = fold({ count: 1 }, child);
  const count: number = result.model.count;
  void count;

  const stepped = combine({ count: 0 }, [
    (model) => ({ model: { count: model.count + 1 } }),
    (model) => ({ model }),
  ]);
  const total: number = stepped.model.count;
  void total;
};

const typecheckTestHelpers = (): void => {
  const app = defineApp({
    init: () => ({ model: { count: 0 } }),
    update: (model: Model, message: Message) =>
      message._tag === "Ping"
        ? { cmd: Effect.succeed(Message.Pong()), model }
        : { model },
    view: (model: Model) => <p>{model.count}</p>,
  });

  const run = runCommands(Effect.succeed(Message.Ping()));
  const collected: Effect.Effect<readonly Message[], never, never> = run;
  void collected;
  // @ts-expect-error -- collected messages are Message, not Model.
  const wrongMessages: Effect.Effect<readonly Model[], never, never> = run;
  void wrongMessages;

  const sim = simulate(app, [Message.Ping()]);
  const outcome: Effect.Effect<SimulateResult<Model, Message>, never> = sim;
  void outcome;
  // @ts-expect-error -- simulate takes the app's messages.
  const badInput = simulate(app, [{ count: 1 }]);
  void badInput;

  const unprovided = runCommands(
    Effect.as(Effect.service(Greeter), Message.Pong())
  );
  // @ts-expect-error -- Greeter is not provided.
  const missing: Effect.Effect<readonly Message[], never, never> = unprovided;
  void missing;

  const unprovidedMany = runCommands([
    Effect.as(Effect.service(Greeter), Message.Pong()),
  ]);
  // @ts-expect-error -- Greeter is not provided.
  const missingMany: Effect.Effect<readonly Message[], never, never> =
    unprovidedMany;
  void missingMany;
};

const typecheckLog = (): void => {
  const detach: () => void = attachModelRecorder();
  detach();
  // @ts-expect-error -- attach takes no options.
  const extra = attachModelRecorder({});
  extra();
  const entries: readonly ModelLogEntry[] | undefined = readModelLog([]);
  void entries;
  const cap: number = MODEL_LOG_CAP;
  void cap;
  const fields: ModelLogDiff = { _tag: "fields", changed: {} };
  void fields;
  const snapshot: ModelLogDiff = {
    _tag: "snapshot",
    after: 1,
    before: 0,
  };
  void snapshot;
  // @ts-expect-error -- diff tags are fields or snapshot.
  const badDiff: ModelLogDiff = { _tag: "rows", changed: {} };
  void badDiff;
};

describe("types", () => {
  it("renders a typed app", async () => {
    const { render } = await import("ilha/test");
    const app = defineApp({
      init: () => ({ model: { count: 0 } }),
      update: (model: Model, message: Message) =>
        message._tag === "Ping"
          ? { model: { count: model.count + 1 } }
          : { model },
      view: (model: Model, dispatch: Dispatch<Message>) => (
        <button type="button" onclick={() => dispatch(Message.Ping())}>
          {model.count}
        </button>
      ),
    });
    typecheckApp();
    typecheckMessages();
    typecheckCommands();
    typecheckSubscriptions();
    typecheckServices();
    typecheckComposition();
    typecheckTestHelpers();
    typecheckLog();
    const ui = render(app.component);
    await ui.click("button");
    expect(ui.text()).toBe("1");
    ui.unmount();
  });
});
