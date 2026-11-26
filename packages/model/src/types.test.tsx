/**
 * Compile-time anchors for the spec's type rules. The `it` blocks assert
 * nothing at runtime; every `@ts-expect-error` is enforced by `tsc`.
 */

import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Client, h, renderToString } from "ilha";
import type { ComponentRequires, Requires } from "ilha";

import * as Command from "./command.ts";
import { Component, defineComponent, evolve, TaggedEnum } from "./index.ts";
import type { Helper, Lazy, ModelComponent } from "./index.ts";

interface Fire {
  readonly _tag: "Fire";
}
// oxlint-disable-next-line typescript/no-explicit-any -- message-less components use `any`: `never` poisons the constraint, per the feature/provide erasers
type ErasedT<M, R> = ModelComponent<any, M, R, any>;
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- erase takes any made component; runtime values pass through untouched
const erase = <M, R>(component: unknown): ErasedT<M, R> =>
  // SAFETY: erasure keeps the runtime value; the caller reattaches the contract per component
  component as ErasedT<M, R>;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const Msg = TaggedEnum({ Go: { id: Schema.String }, Stop: {} });
const ChildEvents = TaggedEnum({ Went: { id: Schema.String } });

// oxlint-disable-next-line typescript/no-explicit-any -- factory Self is test-only tag identity; any keeps Layer plumbing permissive
const Svc = Command.Service<any>()("types/Svc", {
  args: Schema.Struct({}),
  success: Schema.Struct({ v: Schema.String }),
});

const InnerDef = defineComponent({
  message: TaggedEnum({ Fire: {} }),
  model: Schema.Struct({ v: Schema.String }),
  name: "TypesInner",
  props: Schema.Struct({}),
});
const Inner = InnerDef.make({
  init: () => ({ v: "" }),
  update: { Fire: ($) => $.set({ v: "fired" }) },
  view: (hh) => hh("div", null, "inner"),
});
// The layer still needs Client, so providing it puts Client in R.
const SvcLive = Layer.effect(
  Svc,
  // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.map is a data-first dual, not Array#map; the second arg is the mapper
  Effect.map(Client, () => () => Effect.succeed({ v: "live" }))
);
const NeedsClient = Component.provide(erase<Fire, never>(Inner), SvcLive);
// Lazy components keep the core requirements phantom, so h() sees it.
// (Built as a cast: Component.lazy itself needs a render fiber.)
// SAFETY: LazyNeeds is only a type-level carrier for h()/JSX requirement threading; it is never rendered
// oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/ban-types, typescript/no-empty-object-type -- the anchor needs the empty-props shape crossed from null
const LazyNeeds = null as unknown as Lazy<{}, typeof ChildEvents, Client>;
const ChildDef = defineComponent({
  events: ChildEvents,
  message: TaggedEnum({ Go: {} }),
  model: Schema.Struct({}),
  name: "TypesChild",
  props: Schema.Struct({}),
});
const Child = ChildDef.make({
  init: () => ({}),
  update: { Go: ($) => $.emit(ChildEvents.Went({ id: "x" })) },
  view: (hh) => hh("div", null, "child"),
});

const ParentMsg = TaggedEnum({ Bumped: { id: Schema.String } });

// oxlint-disable-next-line typescript/no-explicit-any -- factory Self is test-only tag identity; any keeps Layer plumbing permissive
const Fallible = Command.Service<any>()("types/Fallible", {
  args: Schema.Struct({ username: Schema.String }),
  error: Schema.String,
  success: ParentMsg,
});

const UnDef = defineComponent({
  message: Msg,
  model: Schema.Struct({ n: Schema.Number }),
  name: "TypesUn",
});
const Un = Fallible.make({ username: "ada" });

const RecDef = defineComponent({
  message: Msg,
  model: Schema.Struct({ n: Schema.Number }),
  name: "TypesRec",
});

describe("types", () => {
  it("anchors compile-time rules", () => {
    // Update records need every tag.
    const Missing = RecDef.make({
      init: () => ({ n: 0 }),
      // @ts-expect-error - Stop is missing from the record
      update: {
        Go: ($) => $.set({ n: 1 }),
      },
      view: (
        // oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- the anchor exercises the empty-props Helper slot
        hh: Helper<{}, Schema.Schema.Type<typeof Msg>>,
        _model: { readonly n: number }
      ) => hh("div", null),
    });
    expect(Missing.definitionName).toBe("TypesRec");

    // Unknown tags are rejected.
    const BadTag = RecDef.make({
      init: () => ({ n: 0 }),
      update: {
        Go: ($, { id }) => $.set({ n: id.length }),
        // @ts-expect-error - Nope is not a tag
        Nope: ($) => $,
        Stop: ($) => $.set({ n: 0 }),
      },
      view: (hh) => hh("div", null),
    });
    expect(BadTag.definitionName).toBe("TypesRec");

    // $.run rejects Unmatched commands; match both channels first.
    // oxlint-disable-next-line typescript/no-explicit-any -- Un's requirement is the test-only Fallible tag; any keeps it permissive
    const UnComp = UnDef.make<any>({
      init: () => ({ n: 0 }),
      update: {
        Go: ($) =>
          $.run(
            // @ts-expect-error - match the typed failure before running
            Un
          ),
        Stop: ($) =>
          $.run(
            Command.match(Un, {
              onFailure: () => Msg.Stop(),
              onSuccess: () => Msg.Stop(),
            })
          ),
      },
      view: (hh) => hh("div", null),
    });
    expect(UnComp.definitionName).toBe("TypesUn");

    // evolve only takes the struct's fields, with field types.
    expect(evolve({ v: "" }, { v: "x" })).toEqual({ v: "x" });
    // @ts-expect-error - evolve takes only the struct's fields
    evolve({ v: "" }, { nope: 1 });
    // @ts-expect-error - evolve fields keep their types
    evolve({ v: "" }, { v: 1 });

    // Reserved tags are rejected.
    const Reserved = TaggedEnum({
      Go: {},
      // @ts-expect-error - toString is reserved
      toString: {},
    });
    expect(Reserved.Go()).toEqual({ _tag: "Go" });

    // h() threads the tag's requirements into the VNode; JSX widens to unknown.
    const viaH = h(LazyNeeds, {
      fallback: () => h("div", null, "loading"),
      props: {},
    });
    const hThreaded: Equals<Requires<typeof viaH>, Client> = true;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- smoke assertion on the anchor's runtime value, not a domain branch
    expect(typeof hThreaded).toBe("boolean");
    // @ts-expect-error - h() keeps Client, not never
    const hNotNever: Equals<Requires<typeof viaH>, never> = true;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- smoke assertion on the anchor's runtime value, not a domain branch
    expect(typeof hNotNever).toBe("boolean");

    const viaJsx = <LazyNeeds props={{}} fallback={() => "loading"} />;
    const jsxErased: Equals<Requires<typeof viaJsx>, unknown> = true;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- smoke assertion on the anchor's runtime value, not a domain branch
    expect(typeof jsxErased).toBe("boolean");
    // @ts-expect-error - JSX does not preserve Client
    const jsxNotClient: Equals<Requires<typeof viaJsx>, Client> = true;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- smoke assertion on the anchor's runtime value, not a domain branch
    expect(typeof jsxNotClient).toBe("boolean");

    // Component.root keeps Client in R.
    // oxlint-disable-next-line typescript/no-explicit-any -- erased page keeps the untyped message; the root supplies the contract
    const rooted = Component.root(erase<any, Client>(NeedsClient), {});
    const rootKeeps: Equals<ComponentRequires<typeof rooted>, Client> = true;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- smoke assertion on the anchor's runtime value, not a domain branch
    expect(typeof rootKeeps).toBe("boolean");
    // @ts-expect-error - the root keeps Client
    const rootDrops: Equals<ComponentRequires<typeof rooted>, never> = true;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- smoke assertion on the anchor's runtime value, not a domain branch
    expect(typeof rootDrops).toBe("boolean");
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- smoke assertion on the anchor's runtime value, not a domain branch
    expect(typeof rooted).toBe("function");

    // Typed child onEmit: the event has no count.
    const badEmit = (
      <Child
        props={{}}
        // @ts-expect-error - Went carries no count
        onEmit={(event) => ParentMsg.Bumped({ id: event.count })}
      />
    );
    expect(badEmit === null || badEmit === undefined).toBe(false);

    expect(true).toBe(true);
  });

  it.skip("rejects Client roots on the server", () => {
    // @ts-expect-error - Client roots can't server-render
    // oxlint-disable-next-line typescript/no-explicit-any -- erased page keeps the untyped message; the root supplies the contract
    renderToString(Component.root(erase<any, Client>(NeedsClient), {}));
    renderToString(Component.root(erase<Fire, never>(Inner), {}));
  });
});
