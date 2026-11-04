// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Context, Data, Effect, Layer, Logger } from "effect";
import * as Deferred from "effect/Deferred";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { renderToString } from "ilha";
import { render } from "ilha/test";
import type { TestUi } from "ilha/test";

import type { Dispatch } from "./index";
import { combine, defineApp, foldChild, keyed, subscription } from "./index";

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
  CounterMessage.$match(message, {
    AddBonus: ({ amount }) => ({ model: { count: model.count + amount } }),
    Decrement: () => ({ model: { count: model.count - 1 } }),
    FetchBonus: () => ({
      cmd: Effect.succeed(CounterMessage.AddBonus({ amount: 10 })),
      model,
    }),
    Increment: () => ({ model: { count: model.count + 1 } }),
  });

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
  init: () => ({ model: { count: 0 } }),
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

/**
 * Server-render without the happy-dom `document`, as on a real server, so
 * the client-only start path stays off.
 */
const serverRender = async (
  component: Parameters<typeof renderToString>[0]
): Promise<string> => {
  const { document: dom } = globalThis;
  // SAFETY: removed for the render only and restored right after.
  Reflect.deleteProperty(globalThis, "document");
  try {
    return await renderToString(component);
  } finally {
    globalThis.document = dom;
  }
};

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

  it("leaves other subscriptions running when one subscription's deps change", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Msg = Data.TaggedEnum<{ FlipA: NoArgs; TickA: NoArgs; TickB: NoArgs }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Msg = Data.taggedEnum<Msg>();
    interface Model {
      readonly a: boolean;
      readonly ticksA: number;
      readonly ticksB: number;
    }
    let startsA = 0;
    let startsB = 0;
    const app = defineApp({
      init: () => ({ model: { a: false, ticksA: 0, ticksB: 0 } }),
      subscriptions: [
        subscription({
          deps: (model: Model) => model.a,
          stream: (on) => {
            startsA += 1;
            return on ? Stream.make(Msg.TickA()) : Stream.empty;
          },
        }),
        subscription({
          deps: () => 0,
          stream: () => {
            startsB += 1;
            return Stream.make(Msg.TickB());
          },
        }),
      ],
      update: (model: Model, message: Msg) =>
        Msg.$match(message, {
          FlipA: () => ({ model: { ...model, a: !model.a } }),
          TickA: () => ({ model: { ...model, ticksA: model.ticksA + 1 } }),
          TickB: () => ({ model: { ...model, ticksB: model.ticksB + 1 } }),
        }),
      view: (model: Model, dispatch: Dispatch<Msg>) => (
        <div>
          <p>{`${model.ticksA}:${model.ticksB}`}</p>
          <button type="button" onclick={() => dispatch(Msg.FlipA())}>
            flip
          </button>
        </div>
      ),
    });
    const ui = render(app.component);
    await pollText(ui, "0:1flip");
    expect(startsA).toBe(1);
    expect(startsB).toBe(1);
    await ui.click("button");
    await poll(() => startsA === 2);
    await pollText(ui, "1:1flip");
    expect(startsB).toBe(1);
    await ui.click("button");
    await poll(() => startsA === 3);
    await pollText(ui, "1:1flip");
    expect(startsB).toBe(1);
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("restarts a subscription when its deps change", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Tick = Data.TaggedEnum<{ Tick: NoArgs; Toggle: NoArgs }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Tick = Data.taggedEnum<Tick>();
    let releases = 0;
    const ticks = (on: boolean): Stream.Stream<Tick, never, never> =>
      on
        ? Stream.ensuring(
            Stream.fromIterable([Tick.Tick(), Tick.Tick()]),
            Effect.sync(() => {
              releases += 1;
            })
          )
        : Stream.empty;
    const app = defineApp({
      init: () => ({ model: { count: 0, on: true } }),
      subscriptions: [
        subscription({
          deps: (model: { count: number; on: boolean }) => model.on,
          stream: (on) => ticks(on),
        }),
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

  it("stops subscriptions on unmount", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Msg = Data.TaggedEnum<{ Tick: NoArgs }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Msg = Data.taggedEnum<Msg>();
    let starts = 0;
    let releases = 0;
    const app = defineApp({
      init: () => ({ model: { count: 0 } }),
      subscriptions: [
        subscription({
          deps: () => 0,
          stream: () =>
            Stream.unwrap(
              Effect.sync(() => {
                starts += 1;
                return Stream.ensuring(
                  Stream.never,
                  Effect.sync(() => {
                    releases += 1;
                  })
                );
              })
            ),
        }),
      ],
      update: (model: { count: number }, message: Msg) =>
        message._tag === "Tick"
          ? { model: { count: model.count + 1 } }
          : { model },
      view: (model: { count: number }) => <p>{model.count}</p>,
    });
    const ui = render(app.component);
    await poll(() => starts === 1);
    ui.unmount();
    await poll(() => releases === 1);
    expect(ui.errors).toEqual([]);
  });

  it("interrupts running commands on unmount and dispatches nothing afterward", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Msg = Data.TaggedEnum<{ Done: NoArgs; Go: NoArgs }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Msg = Data.taggedEnum<Msg>();
    const gate = Effect.runSync(Deferred.make<boolean>());
    let started = false;
    let interrupted = false;
    // A probe, not app logic: `update` runs only through `dispatch`, so a
    // non-empty list proves a post-unmount dispatch happened.
    const landed: string[] = [];
    const app = defineApp({
      init: () => ({ model: { count: 0 } }),
      update: (model: { count: number }, message: Msg) =>
        Msg.$match(message, {
          Done: () => {
            landed.push("done");
            return { model: { count: model.count + 1 } };
          },
          Go: () => ({
            cmd: Effect.suspend(() => {
              started = true;
              return Deferred.await(gate);
            }).pipe(
              Effect.as(Msg.Done()),
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted = true;
                })
              )
            ),
            model,
          }),
        }),
      view: (model: { count: number }, dispatch: Dispatch<Msg>) => (
        <div>
          <p>{model.count}</p>
          <button type="button" onclick={() => dispatch(Msg.Go())}>
            go
          </button>
        </div>
      ),
    });
    const ui = render(app.component);
    await ui.click("button");
    await poll(() => started);
    ui.unmount();
    await poll(() => interrupted);
    await Effect.runPromise(Deferred.succeed(gate, true));
    await Bun.sleep(20);
    expect(landed).toEqual([]);
    expect(ui.errors).toEqual([]);
  });

  it("supersedes keyed commands and runs different keys independently", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Msg = Data.TaggedEnum<{
      Got: { readonly value: string };
      StartFirst: NoArgs;
      StartOther: NoArgs;
      StartSecond: NoArgs;
    }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Msg = Data.taggedEnum<Msg>();
    const gate1 = Effect.runSync(Deferred.make<boolean>());
    const gate2 = Effect.runSync(Deferred.make<boolean>());
    let started1 = false;
    let interrupted1 = false;
    const app = defineApp({
      init: () => {
        const log: string[] = [];
        return { model: { log } };
      },
      update: (model: { log: string[] }, message: Msg) =>
        Msg.$match(message, {
          Got: ({ value }) => ({ model: { log: [...model.log, value] } }),
          StartFirst: () => ({
            cmd: keyed(
              "k",
              Effect.suspend(() => {
                started1 = true;
                return Deferred.await(gate1);
              }).pipe(
                Effect.as(Msg.Got({ value: "first" })),
                Effect.onInterrupt(() =>
                  Effect.sync(() => {
                    interrupted1 = true;
                  })
                )
              )
            ),
            model,
          }),
          StartOther: () => ({
            cmd: keyed("other", Effect.succeed(Msg.Got({ value: "other" }))),
            model,
          }),
          StartSecond: () => ({
            cmd: keyed(
              "k",
              Deferred.await(gate2).pipe(
                Effect.as(Msg.Got({ value: "second" }))
              )
            ),
            model,
          }),
        }),
      view: (model: { log: string[] }, dispatch: Dispatch<Msg>) => (
        <div>
          <p>{model.log.join(",")}</p>
          <button type="button" onclick={() => dispatch(Msg.StartFirst())}>
            1
          </button>
          <button type="button" onclick={() => dispatch(Msg.StartSecond())}>
            2
          </button>
          <button type="button" onclick={() => dispatch(Msg.StartOther())}>
            3
          </button>
        </div>
      ),
    });
    const ui = render(app.component);
    await ui.click("button");
    await poll(() => started1);
    await ui.click("button:nth-of-type(2)");
    await poll(() => interrupted1);
    await Effect.runPromise(Deferred.succeed(gate2, true));
    await pollText(ui, "second123");
    await Effect.runPromise(Deferred.succeed(gate1, true));
    await Bun.sleep(20);
    expect(ui.text()).toBe("second123");
    await ui.click("button:nth-of-type(3)");
    await pollText(ui, "second,other123");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("provides layer services to commands and subscriptions", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Msg = Data.TaggedEnum<{
      FromCmd: NoArgs;
      FromSub: NoArgs;
      Go: NoArgs;
    }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Msg = Data.taggedEnum<Msg>();
    interface Model {
      readonly cmd: boolean;
      readonly sub: boolean;
    }
    const Greeting = Context.Service<{ readonly greet: string }>(
      "TestGreeting"
    );
    const app = defineApp({
      init: () => ({ model: { cmd: false, sub: false } }),
      layer: Layer.succeed(Greeting, { greet: "hi" }),
      subscriptions: [
        subscription({
          deps: () => 0,
          stream: () =>
            Stream.fromEffect(Effect.service(Greeting)).pipe(
              Stream.filter((service) => service.greet === "hi"),
              Stream.as(Msg.FromSub())
            ),
        }),
      ],
      update: (model: Model, message: Msg) =>
        Msg.$match(message, {
          FromCmd: () => ({ model: { ...model, cmd: true } }),
          FromSub: () => ({ model: { ...model, sub: true } }),
          Go: () => ({
            cmd: Effect.map(Effect.service(Greeting), (service) =>
              service.greet === "hi" ? Msg.FromCmd() : Msg.FromSub()
            ),
            model,
          }),
        }),
      view: (model: Model, dispatch: Dispatch<Msg>) => (
        <div>
          <p>{`${model.cmd}:${model.sub}`}</p>
          <button type="button" onclick={() => dispatch(Msg.Go())}>
            go
          </button>
        </div>
      ),
    });
    const ui = render(app.component);
    await pollText(ui, "false:truego");
    await ui.click("button");
    await pollText(ui, "true:truego");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("runs init once per instance and its command once per client mount", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Msg = Data.TaggedEnum<{ Fetched: NoArgs; Nudge: NoArgs }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Msg = Data.taggedEnum<Msg>();
    let inits = 0;
    let cmdRuns = 0;
    const app = defineApp({
      init: () => {
        inits += 1;
        return {
          cmd: Effect.sync(() => {
            cmdRuns += 1;
            return Msg.Fetched();
          }),
          model: { count: 0, fetched: false },
        };
      },
      update: (model: { count: number; fetched: boolean }, message: Msg) =>
        Msg.$match(message, {
          Fetched: () => ({ model: { ...model, fetched: true } }),
          Nudge: () => ({ model: { ...model, count: model.count + 1 } }),
        }),
      view: (
        model: { count: number; fetched: boolean },
        dispatch: Dispatch<Msg>
      ) => (
        <div>
          <p>{`${model.count}:${model.fetched}`}</p>
          <button type="button" onclick={() => dispatch(Msg.Nudge())}>
            nudge
          </button>
        </div>
      ),
    });
    const html = await serverRender(app.component);
    expect(html).toContain("0:false");
    expect(inits).toBe(1);
    expect(cmdRuns).toBe(0);
    inits = 0;
    const ui = render(app.component);
    await pollText(ui, "0:truenudge");
    expect(inits).toBe(1);
    expect(cmdRuns).toBe(1);
    await ui.click("button");
    expect(ui.text()).toBe("1:truenudge");
    expect(inits).toBe(1);
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("runs the init command again after hydration", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Msg = Data.TaggedEnum<{ Fetched: NoArgs }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Msg = Data.taggedEnum<Msg>();
    let inits = 0;
    let cmdRuns = 0;
    const app = defineApp({
      init: () => {
        inits += 1;
        return {
          cmd: Effect.sync(() => {
            cmdRuns += 1;
            return Msg.Fetched();
          }),
          model: { fetched: false },
        };
      },
      update: (model: { fetched: boolean }, message: Msg) =>
        message._tag === "Fetched" ? { model: { fetched: true } } : { model },
      view: (model: { fetched: boolean }) => <p>{`${model.fetched}`}</p>,
    });
    const html = await serverRender(app.component);
    expect(cmdRuns).toBe(0);
    const host = document.createElement("div");
    host.innerHTML = html;
    const ui = render(app.component, { container: host, hydrate: true });
    await pollText(ui, "true");
    expect(inits).toBe(2);
    expect(cmdRuns).toBe(1);
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("round-trips the model through a schema across SSR and hydration", async () => {
    const ModelSchema = Schema.Struct({ at: Schema.Date });
    const app = defineApp({
      init: () => ({ model: { at: new Date("2024-05-06T00:00:00.000Z") } }),
      schema: ModelSchema,
      update: (model: { at: Date }) => ({ model }),
      view: (model: { at: Date }) => <p>{model.at.getUTCFullYear()}</p>,
    });
    const html = await serverRender(app.component);
    expect(html).toContain("2024");
    const host = document.createElement("div");
    host.innerHTML = html;
    const ui = render(app.component, { container: host, hydrate: true });
    await ui.settled();
    expect(ui.text()).toBe("2024");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("logs a command defect through the Effect logger and stays interactive", async () => {
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    type Msg = Data.TaggedEnum<{ BlowUp: NoArgs; Increment: NoArgs }>;
    // oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
    const Msg = Data.taggedEnum<Msg>();
    const logged: unknown[] = [];
    const testLogger = Logger.make((options) => {
      logged.push(options.message);
    });
    const app = defineApp({
      init: () => ({ model: { count: 0 } }),
      layer: Logger.layer([testLogger]),
      update: (model: { count: number }, message: Msg) =>
        Msg.$match(message, {
          BlowUp: () => ({ cmd: Effect.die(new Error("boom")), model }),
          Increment: () => ({ model: { count: model.count + 1 } }),
        }),
      view: (model: { count: number }, dispatch: Dispatch<Msg>) => (
        <div>
          <p>{model.count}</p>
          <button type="button" onclick={() => dispatch(Msg.BlowUp())}>
            boom
          </button>
          <button type="button" onclick={() => dispatch(Msg.Increment())}>
            inc
          </button>
        </div>
      ),
    });
    const ui = render(app.component);
    await ui.click("button");
    await poll(() => logged.length === 1);
    expect(String(logged[0])).toContain("boom");
    expect(ui.errors).toEqual([]);
    await ui.click("button:nth-of-type(2)");
    expect(ui.text()).toBe("1boominc");
    ui.unmount();
  });

  it("server-renders the init model", async () => {
    const html = await serverRender(counter.component);
    expect(html).toContain("0");
  });

  it("hydrates server markup and stays interactive", async () => {
    const html = await serverRender(counter.component);
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
    ChildMessage.$match(message, {
      Bump: () => ({ model: { n: model.n + 1 } }),
      Save: () => ({
        cmd: Effect.succeed(ChildMessage.Saved()),
        model,
      }),
      Saved: () => ({ model }),
    });

  const fold = foldChild<Parent, ParentMessage, Child, ChildMessage>({
    read: (model) => model.child,
    toParentMessage: (message) => ParentMessage.Child({ message }),
    update: childUpdate,
    write: (model, child) => ({ ...model, child }),
  });

  it("delegates messages and lifts commands to the parent", async () => {
    const app = defineApp({
      init: () => ({ model: { child: { n: 0 }, saved: false } }),
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
