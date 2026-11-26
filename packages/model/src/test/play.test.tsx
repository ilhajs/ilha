/**
 * Play tests: the real renderer under `TestHost.layer`, driving the real
 * runtime. Each step settles before and after it acts.
 */
// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ModelComponent } from "../component.ts";
import { defineComponent, TaggedEnum } from "../index.ts";
import * as Locator from "./locator.ts";
import * as Play from "./play.ts";
import type { AnyComponent, PropsOf } from "./steps.ts";
import { layer, TestHost } from "./test-host.ts";

const runPlay = <C extends AnyComponent, A>(
  component: C,
  props: PropsOf<C>,
  fn: (play: Play.Play<C>) => Effect.Effect<A, Play.StepError>
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(Effect.flatMap(Play.make(component, props), fn), layer())
    )
  );

const CounterMessage = TaggedEnum({
  Decrement: {},
  Increment: {},
});

const CounterDef = defineComponent({
  message: CounterMessage,
  model: Schema.Struct({ count: Schema.Number }),
  name: "Counter",
  props: Schema.Struct({ initial: Schema.Number }),
});

const Counter = CounterDef.make({
  init: ($, props) => $.set({ count: props.initial }),
  update: {
    Decrement: ($) => $.set({ count: $.model.count - 1 }),
    Increment: ($) => $.set({ count: $.model.count + 1 }),
  },
  view: (h, model) => (
    <div>
      <button data-testid="inc" onclick={h.send(CounterMessage.Increment())}>
        +
      </button>
      <span data-testid="count">{String(model.count)}</span>
    </div>
  ),
});

describe("Play counter", () => {
  it("mounts, clicks, and sees the real runtime update", async () => {
    await runPlay(Counter, { initial: 1 }, (play) =>
      Effect.gen(function* mountClick() {
        yield* play.click('[data-testid="inc"]');
        yield* play.click(Locator.testId("inc"));
        yield* play.expect(Locator.testId("count")).toHaveText("3");
        expect(play.root.model()).toEqual({ count: 3 });
        expect(play.root.pending()).toEqual([]);
      })
    );
  });

  it("routes child emits to the author's onEmit", async () => {
    const ChildMessage = TaggedEnum({ Go: {} });
    const ChildEvents = TaggedEnum({ Went: {} });
    const ChildDef = defineComponent({
      events: ChildEvents,
      message: ChildMessage,
      model: Schema.Struct({}),
      name: "Child",
    });
    const Child = ChildDef.make({
      init: () => ({}),
      update: {
        Go: ($) => $.emit(ChildEvents.Went()),
      },
      view: (h) => (
        <button data-testid="go" onclick={h.send(ChildMessage.Go())}>
          go
        </button>
      ),
    });
    const PageMessage = TaggedEnum({ Bumped: {} });
    const PageDef = defineComponent({
      message: PageMessage,
      model: Schema.Struct({ bumps: Schema.Number }),
      name: "Page",
    });
    const Page = PageDef.make({
      init: () => ({ bumps: 0 }),
      update: {
        Bumped: ($) => $.set({ bumps: $.model.bumps + 1 }),
      },
      view: (_h, model) => (
        <div>
          <output data-testid="bumps">{String(model.bumps)}</output>
          <Child onEmit={{ Went: () => PageMessage.Bumped() }} />
        </div>
      ),
    });
    await runPlay(Page, {}, (play) =>
      Effect.gen(function* emitFlow() {
        yield* play.click('[data-testid="go"]');
        yield* play.expect(Locator.testId("bumps")).toHaveText("1");
      })
    );
  });

  it("an ignored interaction needs expectIgnored", async () => {
    await runPlay(Counter, { initial: 0 }, (play) =>
      Effect.gen(function* ignoredFlow() {
        // The span handles nothing: the click produces no message.
        yield* play.click('[data-testid="count"]');
        yield* play.expectIgnored();
      })
    );
  });
});
describe("TestHost stub", () => {
  it("records props and emits through the parent", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* stubFlow() {
            const host = yield* TestHost;
            const dialog = host.stub("dialog");
            // SAFETY: the stub renders one emit-only view; Closed is its only event and props carry nothing.
            // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- AnyComponent erases the stub's schema types; this test restores the Closed-only contract.
            const Dialog = dialog.component as unknown as ModelComponent<
              Record<string, never>,
              { readonly _tag: "Closed" },
              unknown,
              unknown
            >;
            const PageMessage = TaggedEnum({ Closed: {} });
            const PageDef = defineComponent({
              message: PageMessage,
              model: Schema.Struct({ closed: Schema.Boolean }),
              name: "StubPage",
            });
            const StubPage = PageDef.make({
              init: () => ({ closed: false }),
              update: {
                Closed: ($) => $.set({ closed: true }),
              },
              view: (_h, model) => (
                <div>
                  <output data-testid="closed">{String(model.closed)}</output>
                  <Dialog props={{}} onEmit={() => PageMessage.Closed()} />
                </div>
              ),
            });
            const mounted = yield* host.mount(StubPage, {});
            dialog.emit({ _tag: "Stub" });
            yield* host.settle();
            expect(mounted.text()).toContain("true");
            expect(dialog.recorded()).toHaveLength(1);
            const lines = host.formatLog(host.log.entries()).split("\n");
            expect(lines.length).toBeGreaterThan(0);
            expect(host.formatTimeline(host.log.entries())).toContain(
              "Mounted"
            );
          }),
          layer()
        )
      )
    );
  });
});
