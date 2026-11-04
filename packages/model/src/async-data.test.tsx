// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { Data, Effect, Option, Schema } from "effect";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { TestClock } from "effect/testing";
import { renderToString } from "ilha";
import { render } from "ilha/test";

import type { Dispatch } from "./index";
import { defineApp, keyed } from "./index";
import { runCommands, simulate } from "./test";

// oxlint-disable-next-line typescript/no-empty-object-type, typescript/ban-types, typescript/consistent-type-definitions -- Data.taggedEnum spells payload-free variants as `{}`.
type NoArgs = {};

// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
const User = Schema.Struct({ id: Schema.String, name: Schema.String });
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
type User = typeof User.Type;
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
const LoadError = Schema.Struct({
  _tag: Schema.Literal("LoadError"),
  reason: Schema.String,
});
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
type LoadError = typeof LoadError.Type;

// oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
type Message = Data.TaggedEnum<{
  GotUser: { readonly result: AsyncResult.AsyncResult<User, LoadError> };
  Refresh: NoArgs;
}>;
// oxlint-disable-next-line eslint/no-redeclare -- intentional Data union + constructor pair
const Message = Data.taggedEnum<Message>();

interface Model {
  readonly user: AsyncResult.AsyncResult<User, LoadError>;
}

const ModelSchema = Schema.Struct({
  user: AsyncResult.Schema({ error: LoadError, success: User }),
});

/**
 * The documented load pattern: capture the exit so typed failures become
 * `Failure` data instead of rejected commands. Interruption still
 * propagates, so a `keyed` supersede stays silent.
 */
const load = (
  effect: Effect.Effect<User, LoadError>
): Effect.Effect<Message, never> =>
  Effect.map(Effect.exit(effect), (exit) =>
    Message.GotUser({ result: AsyncResult.fromExit(exit) })
  );

const ada = { id: "1", name: "Ada" };
const bob = { id: "1", name: "Bob" };

const view = (model: Model, dispatch: Dispatch<Message>) => (
  <div>
    <p>{AsyncResult.isAsyncResult(model.user) ? "real" : "plain"}</p>
    {AsyncResult.match(model.user, {
      onFailure: (failure) => {
        const error = Option.getOrUndefined(AsyncResult.error(failure));
        return (
          <div>
            <p>{error === undefined ? "failed" : error.reason}</p>
            <button type="button" onclick={() => dispatch(Message.Refresh())}>
              retry
            </button>
          </div>
        );
      },
      onInitial: () => <p>loading</p>,
      onSuccess: ({ value, waiting }) => (
        <div>
          <p>{waiting ? `${value.name}:refreshing` : value.name}</p>
          <button type="button" onclick={() => dispatch(Message.Refresh())}>
            refresh
          </button>
        </div>
      ),
    })}
  </div>
);

const update = (
  loadUser: () => Effect.Effect<User, LoadError>,
  model: Model,
  message: Message
) =>
  Message.$match(message, {
    GotUser: ({ result }) => ({
      model: {
        user: AsyncResult.replacePrevious(result, Option.some(model.user)),
      },
    }),
    Refresh: () => ({
      cmd: keyed("user", load(loadUser())),
      model: { user: AsyncResult.waiting(model.user) },
    }),
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
const pollText = (
  ui: { text: () => string },
  expected: string
): Promise<void> => poll(() => ui.text() === expected);

describe("async data with AsyncResult", () => {
  it("loads the user from the init command", async () => {
    const app = defineApp({
      init: () => ({
        cmd: load(Effect.succeed(ada)),
        model: { user: AsyncResult.initial() },
      }),
      update: (model: Model, message: Message) =>
        update(() => Effect.succeed(ada), model, message),
      view,
    });
    const { messages, model } = await Effect.runPromise(simulate(app, []));
    expect(model.user._tag).toBe("Success");
    expect(AsyncResult.isAsyncResult(model.user)).toBe(true);
    if (model.user._tag === "Success") {
      expect(model.user.value).toEqual(ada);
      expect(model.user.waiting).toBe(false);
    }
    expect(messages.length).toBe(1);
    expect(messages[0]?._tag).toBe("GotUser");
  });

  it("maps load failures into Failure messages", async () => {
    const app = defineApp({
      init: () => ({
        cmd: load(Effect.fail({ _tag: "LoadError", reason: "boom" } as const)),
        model: { user: AsyncResult.initial() },
      }),
      update: (model: Model, message: Message) =>
        update(
          () => Effect.fail({ _tag: "LoadError", reason: "boom" } as const),
          model,
          message
        ),
      view,
    });
    const { model } = await Effect.runPromise(simulate(app, []));
    expect(model.user._tag).toBe("Failure");
    const error = Option.getOrUndefined(AsyncResult.error(model.user));
    expect(error).toEqual({ _tag: "LoadError", reason: "boom" });
  });

  it("round-trips a Success through SSR and hydration as a real AsyncResult", async () => {
    const app = defineApp({
      init: () => ({ model: { user: AsyncResult.success(ada) } }),
      schema: ModelSchema,
      update: (model: Model, message: Message) =>
        update(() => Effect.succeed(ada), model, message),
      view,
    });
    const html = await renderToString(app.component);
    expect(html).toContain("Ada");
    const host = document.createElement("div");
    host.innerHTML = html;
    const ui = render(app.component, { container: host, hydrate: true });
    await ui.settled();
    expect(ui.text()).toContain("real");
    expect(ui.text()).toContain("Ada");
    expect(ui.text()).not.toContain("refreshing");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("round-trips a typed Failure through SSR and hydration", async () => {
    const app = defineApp({
      init: () => ({
        model: {
          user: AsyncResult.fail<LoadError, User>({
            _tag: "LoadError",
            reason: "boom",
          }),
        },
      }),
      schema: ModelSchema,
      update: (model: Model, message: Message) =>
        update(() => Effect.succeed(ada), model, message),
      view,
    });
    const html = await renderToString(app.component);
    expect(html).toContain("boom");
    const host = document.createElement("div");
    host.innerHTML = html;
    const ui = render(app.component, { container: host, hydrate: true });
    await ui.settled();
    expect(ui.text()).toContain("real");
    expect(ui.text()).toContain("boom");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("keeps the previous value with waiting set while a refetch runs", async () => {
    const gate = Effect.runSync(Deferred.make<User, LoadError>());
    const app = defineApp({
      init: () => ({ model: { user: AsyncResult.success(ada) } }),
      schema: ModelSchema,
      update: (model: Model, message: Message) =>
        update(() => Deferred.await(gate), model, message),
      view,
    });
    const ui = render(app.component);
    expect(ui.text()).toBe("realAdarefresh");
    await ui.click("button");
    await pollText(ui, "realAda:refreshingrefresh");
    await Effect.runPromise(Deferred.succeed(gate, bob));
    await pollText(ui, "realBobrefresh");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });

  it("delivers nothing from a superseded exit-based load", async () => {
    const messages = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* delivered() {
          const fiber = yield* Effect.forkChild(
            runCommands([
              keyed(
                "user",
                load(Effect.as(Effect.sleep(Duration.minutes(10)), ada))
              ),
              keyed("user", load(Effect.succeed(bob))),
            ])
          );
          yield* TestClock.adjust(Duration.minutes(10));
          return yield* Fiber.join(fiber);
        }),
        TestClock.layer()
      )
    );
    expect(messages.length).toBe(1);
    const [only] = messages;
    expect(only?._tag).toBe("GotUser");
    if (only !== undefined && only._tag === "GotUser") {
      expect(only.result._tag).toBe("Success");
      if (only.result._tag === "Success") {
        expect(only.result.value).toEqual(bob);
      }
    }
  });

  it("never lands a superseded refetch", async () => {
    const gate1 = Effect.runSync(Deferred.make<User, LoadError>());
    const gate2 = Effect.runSync(Deferred.make<User, LoadError>());
    const gates = [gate1, gate2];
    let calls = 0;
    let started1 = false;
    let interrupted1 = false;
    const app = defineApp({
      init: () => ({ model: { user: AsyncResult.success(ada) } }),
      schema: ModelSchema,
      update: (model: Model, message: Message) =>
        update(
          () => {
            const gate = gates[calls];
            calls += 1;
            if (gate === gate1) {
              return Effect.suspend(() => {
                started1 = true;
                return Deferred.await(gate1);
              }).pipe(
                Effect.onInterrupt(() =>
                  Effect.sync(() => {
                    interrupted1 = true;
                  })
                )
              );
            }
            return Deferred.await(gate2);
          },
          model,
          message
        ),
      view,
    });
    const ui = render(app.component);
    await ui.click("button");
    await poll(() => started1);
    expect(ui.text()).toBe("realAda:refreshingrefresh");
    await ui.click("button");
    await poll(() => interrupted1);
    await Effect.runPromise(Deferred.succeed(gate2, bob));
    await pollText(ui, "realBobrefresh");
    // The first refetch finishing late must not overwrite the second.
    await Effect.runPromise(Deferred.succeed(gate1, ada));
    await Bun.sleep(20);
    expect(ui.text()).toBe("realBobrefresh");
    expect(ui.errors).toEqual([]);
    ui.unmount();
  });
});
