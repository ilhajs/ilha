/**
 * Tests for `Feature.Service`: the contract, `toLayer` closing requirements,
 * `render` (ready, pending and failed Layers), and the missing-feature error.
 */

import { describe, expect, it } from "bun:test";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { render } from "ilha/test";

import * as Command from "./command.ts";
import * as Feature from "./feature.ts";
import { Component, defineComponent } from "./index.ts";
import type { ModelComponent } from "./index.ts";
import * as MessageLog from "./message-log.ts";

/**
 * The frozen `toLayer` parameter keeps the full `ModelComponent` with its
 * default query spec, which a concrete `make` result never satisfies — and
 * no conditional type can read through it either. So the message and
 * requirements are written out literally per component (`never` poisons the
 * constraint, so message-less components use `any`). Runtime values pass
 * through untouched.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- message-less components use `any`: `never` poisons the constraint, per the comment above
type ErasedComponent<M, R> = ModelComponent<any, M, R, any>;
/**
 * Exact variant for `toLayer` and feature values: their signatures name
 * `never` requirements, so the erased type keeps them instead of `any`.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- toLayer signatures name `never` requirements, so the erased type keeps them instead of `any`
type ErasedExactComponent<M, R> = ModelComponent<any, M, R, never>;
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- erase takes any made component; runtime values pass through untouched
const erase = <M, R>(component: unknown): ErasedComponent<M, R> =>
  // SAFETY: erasure keeps the runtime value; the caller reattaches the contract per component
  component as ErasedComponent<M, R>;
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- erase takes any made component; runtime values pass through untouched
const eraseExact = <M, R>(component: unknown): ErasedExactComponent<M, R> =>
  // SAFETY: erasure keeps the runtime value; the caller reattaches the contract per component
  component as ErasedExactComponent<M, R>;

const flush = async (rounds = 8): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential flush; parallelizing would change test semantics
    await Effect.runPromise(Effect.sleep("1 millis"));
  }
};

// oxlint-disable-next-line typescript/no-explicit-any -- factory Self is test-only tag identity; any keeps Layer plumbing permissive
const Todos = Feature.Service<any>()("Todos", {
  props: Schema.Struct({ filter: Schema.String }),
});

// oxlint-disable-next-line typescript/no-explicit-any -- factory Self is test-only tag identity; any keeps Layer plumbing permissive
const Quiet = Feature.Service<any>()("Quiet", {
  props: Schema.Struct({}),
});

// oxlint-disable-next-line typescript/no-explicit-any -- factory Self is test-only tag identity; any keeps Layer plumbing permissive
const Get = Command.Service<any>()("test/Get", {
  args: Schema.Struct({}),
  success: Schema.Struct({ v: Schema.String }),
});

const TodoListDef = defineComponent({
  events: Schema.Never,
  message: Schema.Never,
  model: Schema.Struct({}),
  name: "TodoList",
  props: Schema.Struct({ filter: Schema.String }),
});
const TodoList = TodoListDef.make({
  init: () => ({}),
  update: ($) => $,
  view: (h) => <ul>{h.props.filter}</ul>,
});

const AppDef = defineComponent({
  events: Schema.Never,
  message: Schema.Never,
  model: Schema.Struct({}),
  name: "App",
  props: Schema.Struct({}),
});
const App = AppDef.make({
  init: () => ({}),
  update: ($) => $,
  view: (h) => (
    <div>
      {Todos.render(h, {
        fallback: (result) =>
          result._tag === "Initial" ? <p>waiting</p> : <p>broken</p>,
        props: { filter: "open" },
      })}
    </div>
  ),
});

/**
 * The feature mounts as a real child of the consumer that renders it: the
 * wrapper gets its own fiber and record, so its path nests under the
 * consumer (`/Page/App[]/Todos[]`) and the providing record may sit anywhere
 * above the consumer. `Page` carries the Layer, `App` consumes the feature.
 */
const PageDef = defineComponent({
  message: Schema.Never,
  model: Schema.Struct({}),
  name: "Page",
  props: Schema.Struct({}),
});
const Page = PageDef.make({
  init: () => ({}),
  update: ($) => $,
  view: () => <App props={{}} />,
});

describe("Feature", () => {
  it("is a Context.Service carrying the contract's Schemas", () => {
    expect(Todos.key).toBe("feature/Todos");
    expect(Todos[Feature.TypeId].name).toBe("Todos");
    expect(Todos.events).toBe(Schema.Never);
    expect(Feature.isService(Todos)).toBe(true);
    expect(Feature.isService(TodoList)).toBe(false);
  });

  it("defaults events to Schema.Never", () => {
    expect(Quiet.events).toBe(Schema.Never);
  });

  it("toLayer closes the implementation's requirements with the build site's Context, minus Scope", async () => {
    const Impl = TodoListDef.make({
      init: ($) =>
        $.set({}).run(
          // SAFETY: Impl requires Get only to prove toLayer closes requirements; the cast names the issued command type
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-explicit-any -- must cross from the untyped issued command to the named command type; any keeps the requirement permissive
          Get.make() as unknown as Command.Command<any, typeof Get>
        ),
      update: ($) => $,
      view: () => <ul />,
    });
    const fake = Layer.succeed(Get, () => Effect.succeed({ v: "fake" }));
    // oxlint-disable-next-line typescript/no-explicit-any -- erased impl keeps the untyped message; the layer supplies the contract
    const layer = Todos.toLayer(eraseExact<any, typeof Get>(Impl)).pipe(
      Layer.provide(fake)
    );
    const context = await Effect.runPromise(Effect.scoped(Layer.build(layer)));
    const todos = Context.get(context, Todos);
    expect(todos.component).toBe(eraseExact<never, never>(Impl));
    expect(Option.isSome(Context.getOption(todos.context, Get))).toBe(true);
    expect(Option.isNone(Context.getOption(todos.context, Scope.Scope))).toBe(
      true
    );
  });

  it("renders the implementation when provided", async () => {
    const Live = Component.provide(
      // oxlint-disable-next-line typescript/no-explicit-any -- erased page keeps the untyped message; the layer supplies the contract
      erase<any, any>(Page),
      // oxlint-disable-next-line typescript/no-explicit-any -- erased impl keeps the untyped message; the layer supplies the contract
      Todos.toLayer(eraseExact<any, any>(TodoList))
    );
    const ui = render(() => <Live props={{}} />);
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain(">open<");
    ui.unmount();
  });

  it("mounts the feature under the consumer with its own path", async () => {
    const log = MessageLog.makeMemory();
    const detach = MessageLog.attach(log);
    try {
      const Live = Component.provide(
        // oxlint-disable-next-line typescript/no-explicit-any -- erased page keeps the untyped message; the layer supplies the contract
        erase<any, any>(Page),
        // oxlint-disable-next-line typescript/no-explicit-any -- erased impl keeps the untyped message; the layer supplies the contract
        Todos.toLayer(eraseExact<any, any>(TodoList))
      );
      const ui = render(() => <Live props={{}} />);
      await ui.settled();
      await flush();
      await ui.settled();
      expect(ui.html()).toContain(">open<");
      const paths = log
        .entries()
        .filter(
          (entry): entry is MessageLog.Mounted => entry._tag === "Mounted"
        )
        .map((entry) => entry.path);
      expect(paths).toContain("/Page/App[]/Todos[]");
      ui.unmount();
    } finally {
      detach();
    }
  });

  it("gives a second Layer build its own context", async () => {
    const Box = Context.Service<
      { readonly v: string },
      { readonly v: string }
    >()("test/Box");
    // oxlint-disable-next-line typescript/no-explicit-any -- factory Self is test-only tag identity; any keeps Layer plumbing permissive
    const TakeBox = Command.Service<any>()("test/TakeBox", {
      args: Schema.Struct({}),
      success: Schema.Struct({ v: Schema.String }),
    });
    const ShowDef = defineComponent({
      events: Schema.Never,
      message: Schema.Struct({ v: Schema.String }),
      model: Schema.Struct({ v: Schema.String }),
      name: "Show",
      props: Schema.Struct({}),
    });
    // oxlint-disable-next-line typescript/no-explicit-any -- Show's requirement is the test-only TakeBox tag; any keeps it permissive
    const Show = ShowDef.make<any>({
      init: ($) => $.set({ v: "none" }).run(TakeBox.make()),
      update: ($, message) => $.set({ v: message.v }),
      // SAFETY: view returns markup; never only satisfies the typed view slot in this test
      view: (_h, model) => (<output>{model.v}</output>) as never,
    });
    const takeLive = Layer.effect(
      TakeBox,
      // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.map is a data-first dual, not Array#map; the second arg is the mapper
      Effect.map(Box, (box) => () => Effect.succeed({ v: box.v }))
    );
    // oxlint-disable-next-line typescript/no-explicit-any -- erased Show keeps the untyped message; the layer supplies the contract
    // oxlint-disable-next-line typescript/no-explicit-any -- erased impl keeps the untyped message; the layer supplies the contract
    const showErased = eraseExact<any, any>(Show);
    const layerFor = (v: string) =>
      Todos.toLayer(showErased).pipe(
        Layer.provide(takeLive.pipe(Layer.provide(Layer.succeed(Box, { v }))))
      );
    // oxlint-disable-next-line typescript/no-explicit-any -- erased page keeps the untyped message; the layer supplies the contract
    const LiveA = Component.provide(erase<any, any>(Page), layerFor("a"));
    // oxlint-disable-next-line typescript/no-explicit-any -- erased page keeps the untyped message; the layer supplies the contract
    const LiveB = Component.provide(erase<any, any>(Page), layerFor("b"));
    const uiA = render(() => <LiveA props={{}} />);
    const uiB = render(() => <LiveB props={{}} />);
    await uiA.settled();
    await uiB.settled();
    await flush();
    await uiA.settled();
    await uiB.settled();
    expect(uiA.html()).toContain(">a<");
    expect(uiB.html()).toContain(">b<");
    uiA.unmount();
    uiB.unmount();
  });

  it("shows the fallback while the Layer builds, then the implementation", async () => {
    // oxlint-disable-next-line typescript/no-invalid-void-type -- gate resolves with no value by design
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const Gated = Layer.effect(
      Todos,
      Effect.promise(() => gate).pipe(
        Effect.as({
          component: eraseExact<never, never>(TodoList),
          context: Context.empty(),
        })
      )
    );
    // oxlint-disable-next-line typescript/no-explicit-any -- erased page keeps the untyped message; the layer supplies the contract
    const Live = Component.provide(erase<any, any>(Page), Gated);
    const ui = render(() => <Live props={{}} />);
    await ui.settled();
    expect(ui.html()).toContain("waiting");
    release();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain(">open<");
    ui.unmount();
  });

  it("throws nothing-provides when no Layer is above", async () => {
    const errors: Error[] = [];
    const ui = render(() => <App props={{}} />, {
      onError: (error) => errors.push(error),
    });
    await ui.settled();
    await flush();
    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0]?.message ?? errors[0])).toContain(
      "nothing provides feature/Todos"
    );
    ui.unmount();
  });
});
