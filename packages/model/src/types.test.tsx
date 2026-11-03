// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Data, Effect } from "effect";

import type { AppOptions, Dispatch, Slice } from "./index";
import { combine, defineApp, foldChild } from "./index";

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
    init: () => ({ count: 0 }),
    update: (model: Model, message: Message) =>
      message._tag === "Ping"
        ? { model: { count: model.count + 1 } }
        : { model },
    view: (model: Model, dispatch: Dispatch<Message>) => {
      dispatch(Message.Ping());
      return <p>{model.count}</p>;
    },
  });
  const count: number = app.options.init().count;
  void count;

  // @ts-expect-error -- messages must be serializable data, not callbacks.
  const badMsg: AppOptions<{ count: number }, { run: () => void }> = {
    init: () => ({ count: 0 }),
    update: (model) => ({ model }),
    view: () => <p>no</p>,
  };
  void badMsg;

  const badModel: AppOptions<{ count: number }, Message> = {
    init: () => ({ count: 0 }),
    // @ts-expect-error -- update must return the declared model shape.
    update: () => ({ model: { missing: true } }),
    view: () => <p>no</p>,
  };
  void badModel;
};

const typecheckFlags = (): void => {
  const app = defineApp<Model, Message, { readonly start: number }>({
    flags: { start: 3 },
    init: (flags) => ({ count: flags.start }),
    update: (model) => ({ model }),
    view: (model) => <p>{model.count}</p>,
  });
  const start: number = app.options.flags?.start ?? 0;
  void start;

  const badOpts: AppOptions<Model, Message, { readonly start: number }> = {
    init: (flags) => ({
      // @ts-expect-error -- only declared flag fields are visible.
      count: flags.missing,
    }),
    update: (model) => ({ model }),
    view: () => <p>no</p>,
  };
  void badOpts;
};

const typecheckCommands = (): void => {
  const single = defineApp({
    init: () => ({ count: 0 }),
    update: (model: { count: number }) => ({
      cmd: Effect.succeed(Message.Pong()),
      model,
    }),
    view: () => <p>ok</p>,
  });
  void single;

  const many = defineApp({
    init: () => ({ count: 0 }),
    update: (model: { count: number }) => ({
      cmd: [Effect.succeed(Message.Pong()), Effect.void],
      model,
    }),
    view: () => <p>ok</p>,
  });
  void many;

  const badCmd: AppOptions<{ count: number }, Message> = {
    init: () => ({ count: 0 }),
    // @ts-expect-error -- commands resolve to messages, not models.
    update: (model) => ({ cmd: Effect.succeed({ count: 1 }), model }),
    view: () => <p>no</p>,
  };
  void badCmd;
};

const typecheckSlices = (): void => {
  const data: Slice = { nested: [1, "two", null, undefined, true] };
  void data;
  // @ts-expect-error -- slices cannot hold functions.
  const fns: Slice = { run: () => 1 };
  void fns;
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

describe("types", () => {
  it("renders a typed app", async () => {
    const { render } = await import("ilha/test");
    const app = defineApp({
      init: () => ({ count: 0 }),
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
    typecheckFlags();
    typecheckCommands();
    typecheckSlices();
    typecheckComposition();
    const ui = render(app.component);
    await ui.click("button");
    expect(ui.text()).toBe("1");
    ui.unmount();
  });
});
