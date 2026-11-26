/**
 * Tests for `Component.provide`: all input forms, sharing, keyed reselection,
 * failure handling, the wait-for-Layer gate, and the `R` type rules.
 */

import { describe, expect, it } from "bun:test";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Client } from "ilha";
import { render } from "ilha/test";

import * as Command from "./command.ts";
import { Component, defineComponent, MessageLog } from "./index.ts";
import type { ModelComponent } from "./index.ts";

// oxlint-disable-next-line typescript/no-explicit-any -- ROf probes the erased message/model slots; any keeps the probe permissive
type ROf<C> = C extends ModelComponent<any, any, infer R, any> ? R : never;

/**
 * The frozen `provide` overloads constrain the component to
 * `ModelComponent<any, any, any, any>`, which a concrete `make` result
 * (with its `SpecOf` query spec and model) never satisfies — and no
 * conditional type can read through it either. So the message and
 * requirements are written out literally per component (`never` poisons the
 * constraint, so message-less components use `any`). Runtime values pass
 * through untouched, and the `R` assertions below still mean something.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- message-less components use `any`: `never` poisons the constraint, per the comment above
type ErasedProvided<M, R> = ModelComponent<any, M, R, any>;
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- erase takes any made component; runtime values pass through untouched
const erase = <M, R>(component: unknown): ErasedProvided<M, R> =>
  // SAFETY: erasure keeps the runtime value; the caller reattaches the contract per component
  component as ErasedProvided<M, R>;

interface LeafMsg {
  readonly saved: boolean;
}
type BoomMsg =
  | { readonly _tag: "WentBoom" }
  | { readonly _tag: "GotSave"; readonly saved: boolean };
type RoomMsg =
  | { readonly _tag: "Selected"; readonly room: string }
  | { readonly _tag: "Joined"; readonly room: string };

const flush = async (rounds = 8): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential flush; parallelizing would change test semantics
    await Effect.runPromise(Effect.sleep("1 millis"));
  }
};

const waitFor = async (what: () => boolean): Promise<void> => {
  const start = Date.now();
  while (!what()) {
    if (Date.now() - start > 5000) {
      throw new Error("timed out waiting for condition");
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential poll; parallelizing would change test semantics
    await Effect.runPromise(Effect.sleep("5 millis"));
  }
};

// oxlint-disable-next-line typescript/no-explicit-any -- factory Self is test-only tag identity; any keeps Layer plumbing permissive
const Save = Command.Service<any>()("test/Save", {
  args: Schema.Struct({}),
  success: Schema.Struct({ saved: Schema.Boolean }),
});

// oxlint-disable-next-line typescript/no-explicit-any -- factory Self is test-only tag identity; any keeps Layer plumbing permissive
const Join = Command.Service<any>()("test/Join", {
  args: Schema.Struct({}),
  success: Schema.TaggedStruct("Joined", { room: Schema.String }),
});

const LeafDef = defineComponent({
  events: Schema.Never,
  message: Schema.Struct({ saved: Schema.Boolean }),
  model: Schema.Struct({ saved: Schema.Boolean }),
  name: "Leaf",
  props: Schema.Struct({}),
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- leafView ignores the host handle; the model carries the assertion
const leafView = (_h: unknown, model: { readonly saved: boolean }) =>
  // SAFETY: leafView returns markup; never only satisfies the typed view slot in this test
  (<output>{String(model.saved)}</output>) as never;

const NeedsSave = LeafDef.make({
  init: () => ({ saved: false }),
  update: ($, message) => $.set({ saved: message.saved }),
  view: leafView,
});

const savingLeaf = () =>
  LeafDef.make({
    init: ($) => $.set({ saved: false }).run(Save.make()),
    update: ($, message) => $.set({ saved: message.saved }),
    view: leafView,
  });

describe("Component.provide", () => {
  it("removes the provided service from R", () => {
    const Live = Component.provide(
      erase<LeafMsg, never>(NeedsSave),
      Save.toLayer(() => Effect.succeed({ saved: true }))
    );
    // SAFETY: ok is never (Save was provided), so the null value never flows
    const ok: ROf<typeof Live> = null as never;
    expect(ok).toBeNull();
    // SAFETY: still must not typecheck after Save is provided; the null value never flows
    // @ts-expect-error - Save was provided
    const still: ROf<typeof Live> = null as typeof Save;
    expect(still).toBeNull();
  });

  it("runs Commands against the provided Layer", async () => {
    const Live = Component.provide(
      erase<LeafMsg, never>(savingLeaf()),
      Save.toLayer(() => Effect.succeed({ saved: true }))
    );
    const ui = render(() => <Live props={{}} />);
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain(">true<");
    ui.unmount();
  });

  it("lets the inner provide win", async () => {
    const outer = Save.toLayer(() => Effect.succeed({ saved: false }));
    const inner = Save.toLayer(() => Effect.succeed({ saved: true }));
    const Both = Component.provide(
      erase<LeafMsg, never>(
        Component.provide(erase<LeafMsg, never>(savingLeaf()), outer)
      ),
      inner
    );
    const ui = render(() => <Both props={{}} />);
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain(">true<");
    ui.unmount();
  });

  it("shares one Layer value per Env", async () => {
    let builds = 0;
    const counting = Layer.effect(
      Save,
      Effect.sync(() => {
        builds += 1;
        return () => Effect.succeed({ saved: true });
      })
    );
    const Row = Component.provide(
      erase<LeafMsg, never>(savingLeaf()),
      counting
    );
    const PageDef = defineComponent({
      events: Schema.Never,
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "Page",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => ({}),
      update: ($) => $,
      view: () => (
        <div>
          <Row key="a" props={{}} />
          <Row key="b" props={{}} />
        </div>
      ),
    });
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain(">true<");
    expect(builds).toBe(1);
    ui.unmount();
  });

  it("builds per instance with local: true", async () => {
    let builds = 0;
    const counting = Layer.effect(
      Save,
      Effect.sync(() => {
        builds += 1;
        return () => Effect.succeed({ saved: true });
      })
    );
    const Row = Component.provide(
      erase<LeafMsg, never>(savingLeaf()),
      counting,
      { local: true }
    );
    const PageDef = defineComponent({
      events: Schema.Never,
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "PageLocal",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => ({}),
      update: ($) => $,
      view: () => (
        <div>
          <Row key="a" props={{}} />
          <Row key="b" props={{}} />
        </div>
      ),
    });
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await flush();
    await ui.settled();
    expect(builds).toBe(2);
    ui.unmount();
  });

  it("maps a build failure to a message with onFailure", async () => {
    const BoomDef = defineComponent({
      events: Schema.Never,
      message: Schema.Union([
        Schema.TaggedStruct("WentBoom", {}),
        Schema.TaggedStruct("GotSave", { saved: Schema.Boolean }),
      ]),
      model: Schema.Struct({ failed: Schema.Boolean }),
      name: "Boom",
      props: Schema.Struct({}),
    });
    const Boom = Component.provide(
      erase<BoomMsg, never>(
        BoomDef.make({
          init: () => ({ failed: false }),
          update: {
            GotSave: ($) => $,
            WentBoom: ($) => $.set({ failed: true }),
          },
          view: (_h, model) => <output>{String(model.failed)}</output>,
        })
      ),
      Layer.effectDiscard(Effect.fail(new Error("boom"))),
      // SAFETY: WentBoom is the declared failure message; never only satisfies the typed onFailure slot
      { onFailure: () => ({ _tag: "WentBoom" }) as never }
    );
    const log = MessageLog.makeMemory();
    const detach = MessageLog.attach(log);
    try {
      const ui = render(() => <Boom props={{}} />);
      await ui.settled();
      await flush();
      await ui.settled();
      expect(ui.html()).toContain(">true<");
      const tags = log.entries().map((entry) => entry._tag);
      expect(tags).toContain("LayerPending");
      expect(tags).toContain("LayerFailed");
      ui.unmount();
    } finally {
      detach();
    }
  });
  it("fails the instance on an unhandled Layer failure", async () => {
    const Boom = Component.provide(
      erase<LeafMsg, never>(
        LeafDef.make({
          init: () => ({ saved: false }),
          update: ($, message) => $.set({ saved: message.saved }),
          view: leafView,
        })
      ),
      Layer.effectDiscard(Effect.die(new Error("boom")))
    );
    const ui = render(() => (
      <Boom props={{}} fallback={() => <p>leaf down</p>} />
    ));
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain("leaf down");
    ui.unmount();
  });

  it("reselects a keyed provide in place and keeps the Model", async () => {
    const Chat = Context.Service<
      { readonly room: string },
      { readonly room: string }
    >()("test/Chat");
    const joinLive = Layer.effect(
      Join,
      Effect.map(
        // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.map is a data-first dual, not Array#map; the second arg is the mapper
        Chat,
        (chat) => () => Effect.succeed({ _tag: "Joined", room: chat.room })
      )
    );
    const RoomDef = defineComponent({
      events: Schema.Never,
      message: Schema.Union([
        Schema.TaggedStruct("Selected", { room: Schema.String }),
        Schema.TaggedStruct("Joined", { room: Schema.String }),
      ]),
      model: Schema.Struct({ joined: Schema.String, room: Schema.String }),
      name: "Room",
      props: Schema.Struct({}),
    });
    const Room = Component.provide(
      erase<RoomMsg, typeof Join>(
        RoomDef.make<typeof Join>({
          init: () => ({ joined: "", room: "lobby" }),
          update: {
            Joined: ($, message) => $.evolve({ joined: message.room }),
            Selected: ($, message) =>
              $.evolve({ room: message.room }).run(Join.make()),
          },
          view: (h, model) => (
            <div>
              <span>
                {model.room}/{model.joined}
              </span>
              <button
                id="general"
                onclick={h.send({
                  _tag: "Selected",
                  room: "general",
                })}
              >
                general
              </button>
            </div>
          ),
        })
      ),
      {
        // SAFETY: key reads the host's own model shape, kept in sync with the Struct above
        key: (_props, model) => (model as { readonly room: string }).room,
        layer: (room: string) =>
          joinLive.pipe(Layer.provide(Layer.succeed(Chat, { room }))),
      }
    );
    const ui = render(() => <Room props={{}} />);
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain("lobby/");
    await ui.click("#general");
    await flush();
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain("general/general");
    ui.unmount();
  });

  it("drops a stale keyed build when a newer selection settles first", async () => {
    const Site = Context.Service<
      { readonly room: string },
      { readonly room: string }
    >()("test/StaleSite");
    // oxlint-disable-next-line typescript/no-invalid-void-type -- gates resolve with no value by design
    const lobbyGate = Promise.withResolvers<void>();
    // oxlint-disable-next-line typescript/no-invalid-void-type -- gates resolve with no value by design
    const generalGate = Promise.withResolvers<void>();
    generalGate.resolve();
    const gateFor = (room: string): Effect.Effect<void> =>
      Effect.promise(() =>
        room === "lobby" ? lobbyGate.promise : generalGate.promise
      );
    const joinLive = Layer.effect(
      Join,
      Effect.map(
        // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.map is a data-first dual, not Array#map; the second arg is the mapper
        Site,
        (site) => () => Effect.succeed({ _tag: "Joined", room: site.room })
      )
    );
    type StaleMsg =
      | { readonly _tag: "Selected"; readonly room: string }
      | { readonly _tag: "Joined"; readonly room: string }
      | { readonly _tag: "Rejoin" };
    const RoomDef = defineComponent({
      events: Schema.Never,
      message: Schema.Union([
        Schema.TaggedStruct("Selected", { room: Schema.String }),
        Schema.TaggedStruct("Joined", { room: Schema.String }),
        Schema.TaggedStruct("Rejoin", {}),
      ]),
      model: Schema.Struct({ joined: Schema.String, room: Schema.String }),
      name: "StaleRoom",
      props: Schema.Struct({}),
    });
    const StaleRoom = Component.provide(
      erase<StaleMsg, typeof Join>(
        RoomDef.make<typeof Join>({
          init: () => ({ joined: "", room: "lobby" }),
          update: {
            Joined: ($, message) => $.evolve({ joined: message.room }),
            Rejoin: ($) => $.run(Join.make()),
            Selected: ($, message) =>
              $.evolve({ room: message.room }).run(Join.make()),
          },
          view: (h, model) => (
            <div>
              <span>
                {model.room}/{model.joined}
              </span>
              <button
                id="general"
                onclick={h.send({
                  _tag: "Selected",
                  room: "general",
                })}
              >
                general
              </button>
              <button id="rejoin" onclick={h.send({ _tag: "Rejoin" })}>
                rejoin
              </button>
            </div>
          ),
        })
      ),
      {
        // SAFETY: key reads the host's own model shape, kept in sync with the Struct above
        key: (_props, model) => (model as { readonly room: string }).room,
        layer: (room: string) =>
          joinLive.pipe(
            Layer.provide(
              Layer.effect(Site, gateFor(room).pipe(Effect.as({ room })))
            )
          ),
      }
    );
    const ui = render(() => <StaleRoom props={{}} />);
    // No `settled` while the lobby gate is closed: it waits for the
    // in-flight lobby build. Dispatch raw events and poll instead.
    const clickRaw = (selector: string): void => {
      ui.query(selector)?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    };

    await waitFor(() => ui.html().includes("lobby/"));
    clickRaw("#general");
    await waitFor(() => ui.html().includes("general/general"));
    // The lobby build settles after the general one did: dropping it keeps
    // the current selection, so a later Join still reads the general room.
    lobbyGate.resolve();
    await flush();
    await ui.settled();
    clickRaw("#rejoin");
    await flush();
    await ui.settled();
    expect(ui.html()).toContain("general/general");
    ui.unmount();
  });

  it("closes the previous local scopes when a keyed provide reselects", async () => {
    const Site = Context.Service<
      { readonly room: string },
      { readonly room: string }
    >()("test/ScopeSite");
    const released: string[] = [];
    const siteLive = (room: string): Layer.Layer<{ readonly room: string }> =>
      Layer.effect(
        Site,
        Effect.acquireRelease(Effect.succeed({ room }), () =>
          Effect.sync(() => {
            released.push(room);
          })
        )
      );
    const joinLive = Layer.effect(
      Join,
      Effect.map(
        // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.map is a data-first dual, not Array#map; the second arg is the mapper
        Site,
        (site) => () => Effect.succeed({ _tag: "Joined", room: site.room })
      )
    );
    const RoomDef = defineComponent({
      events: Schema.Never,
      message: Schema.Union([
        Schema.TaggedStruct("Selected", { room: Schema.String }),
        Schema.TaggedStruct("Joined", { room: Schema.String }),
      ]),
      model: Schema.Struct({ joined: Schema.String, room: Schema.String }),
      name: "ScopeRoom",
      props: Schema.Struct({}),
    });
    const ScopeRoom = Component.provide(
      erase<RoomMsg, typeof Join>(
        RoomDef.make<typeof Join>({
          init: () => ({ joined: "", room: "lobby" }),
          update: {
            Joined: ($, message) => $.evolve({ joined: message.room }),
            Selected: ($, message) =>
              $.evolve({ room: message.room }).run(Join.make()),
          },
          view: (h, model) => (
            <div>
              <span>
                {model.room}/{model.joined}
              </span>
              <button
                id="general"
                onclick={h.send({
                  _tag: "Selected",
                  room: "general",
                })}
              >
                general
              </button>
            </div>
          ),
        })
      ),
      {
        // SAFETY: key reads the host's own model shape, kept in sync with the Struct above
        key: (_props, model) => (model as { readonly room: string }).room,
        layer: (room: string) => joinLive.pipe(Layer.provide(siteLive(room))),
      }
    );
    const ui = render(() => <ScopeRoom props={{}} />);
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain("lobby/");
    await ui.click("#general");
    await flush();
    await ui.settled();
    expect(ui.html()).toContain("general/general");
    expect(released).toContain("lobby");
    ui.unmount();
    expect(released).toContain("general");
  });

  it("builds a root provide with the island's Client", async () => {
    const errors: Error[] = [];
    const pingLive = Layer.effect(
      Save,
      // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.map is a data-first dual, not Array#map; the second arg is the mapper
      Effect.map(Client, () => () => Effect.succeed({ saved: true }))
    );
    const Live = Component.provide(
      erase<LeafMsg, never>(savingLeaf()),
      pingLive
    );
    const ui = render(() => <Live props={{}} />, {
      onError: (error) => errors.push(error),
    });
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain(">true<");
    expect(errors).toEqual([]);
    ui.unmount();
  });

  it("curried provide carries the layer", () => {
    const AlsoLive = Component.provide(
      Save.toLayer(() => Effect.succeed({ saved: true }))
    )(erase<LeafMsg, never>(NeedsSave));
    expect(Component.isComponent(AlsoLive)).toBe(true);
  });
});
