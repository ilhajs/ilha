/**
 * Tests for `Component.clientOnly`: the client renders the component, the
 * server renders the fallback, hydration swaps them, and `Client` leaves `R`.
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Client } from "ilha";
import { render, renderHtml } from "ilha/test";

import * as Command from "./command.ts";
import { Component, defineComponent } from "./index.ts";
import type { ModelComponent } from "./index.ts";

// oxlint-disable-next-line typescript/no-explicit-any -- ROf probes any component shape; any matches every type argument.
type ROf<C> = C extends ModelComponent<any, any, infer R, any> ? R : never;

/**
 * The frozen `provide` overloads constrain the component to
 * `ModelComponent<any, any, any, any>`, which a concrete `make` result
 * (with its `SpecOf` query spec and model) never satisfies — and no
 * conditional type can read through it either. So the message and
 * requirements are written out literally (`never` poisons the constraint,
 * so the message-less component uses `any`). Runtime values pass through
 * untouched, and the `R` assertions below still mean something.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, typescript/no-explicit-any -- erase accepts any component implementation; the cast below states the contract.
const erase = <M, R>(component: unknown): ModelComponent<any, M, R, any> =>
  // SAFETY: erasure keeps the value (and its definition identity) unchanged; only the static type is widened for the frozen provide overloads.
  // oxlint-disable-next-line typescript/no-explicit-any -- same intentional erasure as the signature above.
  component as ModelComponent<any, M, R, any>;

class Svc extends Command.Service<Svc>()("test/SvcClient", {
  args: Schema.Struct({}),
  success: Schema.Struct({ v: Schema.String }),
}) {}

const InnerDef = defineComponent({
  events: Schema.Never,
  message: Schema.Struct({ v: Schema.String }),
  model: Schema.Struct({ v: Schema.String }),
  name: "Inner",
  props: Schema.Struct({}),
});
const Inner = InnerDef.make({
  init: () => ({ v: "" }),
  update: ($, message) => $.set({ v: message.v }),
  view: (_h, model) => <p>value:{model.v}</p>,
});

// An implementation that itself needs `Client`, so the provided component's
// `R` is exactly `Client`. `Layer.effect` (not the `toLayer` Effect form,
// which only takes requirements-free Effects) carries the requirement.
const SvcLive = Layer.effect(
  Svc,
  Client.pipe(Effect.map(() => () => Effect.succeed({ v: "live" })))
);
// oxlint-disable-next-line typescript/no-explicit-any -- erase's Events/Props are intentionally erased; R carries the requirement.
const Provided = Component.provide(erase<any, never>(Inner), SvcLive);
const Only = Component.clientOnly(Provided, {
  fallback: () => <p>ssr-shell</p>,
});

/**
 * A root-level provided Layer builds with an empty parent chain, which has
 * no `Client`. Nest the consumption under a model parent so the build sees
 * the island's `Client` service.
 */
const ParentDef = defineComponent({
  events: Schema.Never,
  message: Schema.Never,
  model: Schema.Struct({}),
  name: "ClientParent",
  props: Schema.Struct({}),
});
const Parent = ParentDef.make({
  init: () => ({}),
  update: ($) => $,
  view: () => <Only props={{}} />,
});

describe("Component.clientOnly", () => {
  it("removes Client from R", () => {
    // SAFETY: ROf probe only asserts null; the chained assertion materializes a Client-typed null.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- ROf erases through unknown, so the probe value does not overlap Client directly.
    const needs: ROf<typeof Provided> = null as unknown as Client;
    expect(needs).toBeNull();
    // SAFETY: ROf probe only asserts null; never materializes a null of the probed type.
    const noClient: ROf<typeof Provided> = null as never;
    expect(noClient).toBeNull();
    // SAFETY: ROf probe only asserts null; never materializes a null of the probed type.
    const removed: ROf<typeof Only> = null as never;
    expect(removed).toBeNull();
    // @ts-expect-error - Client is removed by clientOnly
    // SAFETY: intentionally mistyped to assert clientOnly removes Client from R (checked by the ts-expect-error above).
    const still: ROf<typeof Only> = null as Client;
    expect(still).toBeNull();
  });

  it("renders the component on the client", async () => {
    const ui = render(() => <Parent props={{}} />);
    await ui.settled();
    expect(ui.html()).toContain("value:");
    expect(ui.html()).not.toContain("ssr-shell");
    ui.unmount();
  });

  it("renders the fallback on the server", async () => {
    const html = await renderHtml(() => <Parent props={{}} />);
    expect(html).toContain("ssr-shell");
    expect(html).not.toContain("value:");
  });

  it("hydrates from the server fallback to the client component", async () => {
    const html = await renderHtml(() => <Parent props={{}} />);
    expect(html).toContain("ssr-shell");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const ui = render(() => <Parent props={{}} />, {
      container,
      hydrate: true,
    });
    await ui.settled();
    expect(container.innerHTML).not.toContain("ssr-shell");
    ui.unmount();
    container.remove();
  });
});
