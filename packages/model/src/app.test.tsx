// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Data, Effect, Match } from "effect";
import * as Stream from "effect/Stream";
import { renderToString } from "ilha";
import { render } from "ilha/test";
import type { TestUi } from "ilha/test";

import type { Dispatch } from "./index";
import { combine, defineApp, foldChild } from "./index";

// oxlint-disable-next-line typescript/no-empty-object-type, typescript/ban-types, typescript/consistent-type-definitions -- Data.taggedEnum spells payload-free variants as `{}`.
type NoArgs = {};

// oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
type CounterMessage = Data.TaggedEnum<{
  AddBonus: { readonly amount: number };
  Decrement: NoArgs;
  FetchBonus: NoArgs;
  Increment: NoArgs;
}>;
// oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
const CounterMessage = Data.taggedEnum<CounterMessage>();

interface CounterModel {
  readonly count: number;
}

const counterUpdate = (model: CounterModel, message: CounterMessage) =>
  Match.value(message).pipe(
    Match.tag("Decrement", () => ({
      model: { count: model.count - 1 },
    })),
    Match.tag("FetchBonus", () => ({
      cmd: Effect.succeed(CounterMessage.AddBonus({ amount: 10 })),
      model,
    })),
    Match.tag("Increment", () => ({
      model: { count: model.count + 1 },
    })),
    Match.tag("AddBonus", ({ amount }) => ({
      model: { count: model.count + amount },
    })),
    Match.exhaustive
  );

const counterView = (
  model: CounterModel,
  dispatch: Dispatch<CounterMessage>
) => (
  <div>
    <p>{model.count}</p>
    <button type="button" onclick={() => dispatch(CounterMessage.Increment())}>
      +
    </button>
    <button type="button" onclick={() => dispatch(CounterMessage.Decrement())}>
      -
    </button>
    <button type="button" onclick={() => dispatch(CounterMessage.FetchBonus())}>
      bonus
    </button>
  </div>
);

const counter = defineApp({
  init: () => ({ count: 0 }),
  name: "Counter",
  update: counterUpdate,
  view: counterView,
});

/** Wait for a condition effects the harness cannot track. */
const poll = async (
  done: () => boolean,
  deadline = Date.now() + 2000
): Promise<void> => {
  if (done()) {
    return;
  }
  if (Date.now() > deadline) {
    expect(done()).toBe(true);
    return;
  }
  await Bun.sleep(5);
  await poll(done, deadline);
};

/** Wait until the UI shows `expected`, for effects the harness cannot track. */
const pollText = (ui: TestUi, expected: string): Promise<void> =>
  poll(() => ui.text() === expected);

describe("defineApp", () => {
  it("renders the model and dispatches messages", async () => {
    const ui = render(counter.component);
    await ui.click("button");
    expect(ui.text()).toBe("1+-bonus");
    ui.unmount();
  });

  it("runs commands and feeds their messages back", async () => {
    const ui = render(counter.component);
    await ui.click("button:nth-of-type(3)");
    await pollText(ui, "10+-bonus");
    ui.unmount();
  });

  it("logs a failed command and keeps the island alive", async () => {
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: readonly unknown[]) => {
      logged.push(...args);
    };
    try {
      // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
      type Msg = Data.TaggedEnum<{ Go: NoArgs }>;
      // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
      const Msg = Data.taggedEnum<Msg>();
      const boom = defineApp({
        init: () => ({ count: 0 }),
        subscriptions: [
          {
            deps: () => 0,
            stream: () => Stream.succeed(Msg.Go()),
          },
        ],
        update: (model: { count: number }, _message: Msg) => ({
          cmd: Effect.fail(new Error("boom")),
          model,
        }),
        view: (model: { count: number }) => <p>{model.count}</p>,
      });
      const ui = render(boom.component);
      await pollText(ui, "0");
      expect(ui.errors).toEqual([]);
      await poll(() => logged.length === 1);
      ui.unmount();
    } finally {
      console.error = original;
    }
  });

  it("restarts a subscription when its deps change", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Tick = Data.TaggedEnum<{ Tick: NoArgs; Toggle: NoArgs }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Tick = Data.taggedEnum<Tick>();
    let releases = 0;
    const ticks = (on: boolean): Stream.Stream<Tick, unknown, never> =>
      on
        ? Stream.ensuring(
            Stream.fromIterable([Tick.Tick(), Tick.Tick()]),
            Effect.sync(() => {
              releases += 1;
            })
          )
        : Stream.empty;
    const app = defineApp({
      init: () => ({ count: 0, on: true }),
      subscriptions: [
        {
          deps: (model) => model.on,
          stream: (on) => ticks(on === true),
        },
      ],
      update: (model: { count: number; on: boolean }, message: Tick) =>
        message._tag === "Tick"
          ? { model: { ...model, count: model.count + 1 } }
          : { model: { ...model, on: !model.on } },
      view: (
        model: { count: number; on: boolean },
        dispatch: Dispatch<Tick>
      ) => (
        <div>
          <p>{model.count}</p>
          <button type="button" onclick={() => dispatch(Tick.Toggle())}>
            toggle
          </button>
        </div>
      ),
    });
    const ui = render(app.component);
    await pollText(ui, "2toggle");
    await ui.click("button");
    await poll(() => releases === 1);
    expect(ui.text()).toBe("2toggle");
    await ui.click("button");
    await pollText(ui, "4toggle");
    ui.unmount();
  });

  it("server-renders the init model", async () => {
    const html = await renderToString(counter.component);
    expect(html).toContain("0");
  });

  it("hydrates server markup and stays interactive", async () => {
    const html = await renderToString(counter.component);
    const host = document.createElement("div");
    host.innerHTML = html;
    const ui = render(counter.component, { container: host, hydrate: true });
    expect(ui.text()).toBe("0+-bonus");
    await ui.click("button");
    expect(ui.text()).toBe("1+-bonus");
    ui.unmount();
  });
});

describe("foldChild", () => {
  // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
  type ChildMessage = Data.TaggedEnum<{
    Bump: NoArgs;
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
  interface Child {
    readonly n: number;
  }
  interface Parent {
    readonly child: Child;
    readonly saved: boolean;
  }

  const childUpdate = (model: Child, message: ChildMessage) =>
    Match.value(message).pipe(
      Match.tag("Bump", () => ({ model: { n: model.n + 1 } })),
      Match.tag("Save", () => ({
        cmd: Effect.succeed(ChildMessage.Saved()),
        model,
      })),
      Match.tag("Saved", () => ({ model })),
      Match.exhaustive
    );

  const fold = foldChild<Parent, ParentMessage, Child, ChildMessage>({
    read: (model) => model.child,
    toParentMessage: (message) => ParentMessage.Child({ message }),
    update: childUpdate,
    write: (model, child) => ({ ...model, child }),
  });

  it("delegates messages and lifts commands to the parent", async () => {
    const app = defineApp({
      init: () => ({ child: { n: 0 }, saved: false }),
      update: (model: Parent, message: ParentMessage) => {
        if (message._tag !== "Child") {
          return { model };
        }
        const result = fold(model, message.message);
        return message.message._tag === "Saved"
          ? { ...result, model: { ...result.model, saved: true } }
          : result;
      },
      view: (model: Parent, dispatch: Dispatch<ParentMessage>) => (
        <div>
          <p>{`${model.child.n}:${model.saved}`}</p>
          <button
            type="button"
            onclick={() =>
              dispatch(ParentMessage.Child({ message: ChildMessage.Bump() }))
            }
          >
            bump
          </button>
          <button
            type="button"
            onclick={() =>
              dispatch(ParentMessage.Child({ message: ChildMessage.Save() }))
            }
          >
            save
          </button>
        </div>
      ),
    });
    const ui = render(app.component);
    await ui.click("button");
    expect(ui.text()).toBe("1:falsebumpsave");
    await ui.click("button:nth-of-type(2)");
    await pollText(ui, "1:truebumpsave");
    ui.unmount();
  });

  it("leaves the parent unchanged when the child is absent", () => {
    const absent = foldChild<
      { child?: Child },
      { tag: "x" },
      Child,
      { tag: "y" }
    >({
      read: (model) => model.child,
      toParentMessage: () => ({ tag: "x" }),
      update: (model) => ({ model }),
      write: (model, child) => ({ ...model, child }),
    });
    expect(absent({}, { tag: "y" })).toEqual({ model: {} });
  });
});

describe("combine", () => {
  it("threads the model through steps and concatenates commands", () => {
    const seen: string[] = [];
    const result = combine({ n: 0 }, [
      (model) => ({ model: { n: model.n + 1 } }),
      (model) => ({
        cmd: Effect.sync(() => {
          seen.push("first");
        }).pipe(Effect.as({ tag: "a" } as const)),
        model: { n: model.n * 10 },
      }),
      (model) => ({
        cmd: Effect.sync(() => {
          seen.push("second");
        }).pipe(Effect.as({ tag: "b" } as const)),
        model,
      }),
    ]);
    expect(result.model).toEqual({ n: 10 });
    expect(Array.isArray(result.cmd)).toBe(true);
    if (Array.isArray(result.cmd)) {
      expect(result.cmd.length).toBe(2);
    }
    expect(seen).toEqual([]);
  });
});
