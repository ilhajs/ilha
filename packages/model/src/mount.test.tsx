/**
 * Tests for mounts: the body starts after commit with the node and args,
 * same-name renders publish to `changes`, a different name restarts, a
 * render without the mount stops it, a defect fails the instance, and
 * nothing runs on the server.
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { renderToString } from "ilha";
import { render } from "ilha/test";

import { Component, defineComponent, MessageLog, Mount } from "./index.ts";

const tick = (): Promise<void> => Effect.runPromise(Effect.sleep(0));

const logged = (log: MessageLog.Memory, tag: string): MessageLog.Entry[] =>
  log.entries().filter((entry) => entry._tag === tag);
// Mount.map preserves concrete event/args types that Mount.Any
// (Issued<never, never, Element, never>) cannot overlap directly.
const asMountAny = <A,>(mount: A): Mount.Any =>
  // SAFETY: the cast only adjusts the type; the issued mount value is unchanged.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Mount.Any's never type arguments do not overlap the concrete issue; the chain goes through unknown.
  mount as unknown as Mount.Any;

describe("Mount", () => {
  it("starts the body after commit with the node and args, and maps the result", async () => {
    const seen: { node: Element; points: number }[] = [];
    const Message = Schema.Union([
      Schema.TaggedStruct("Drew", { points: Schema.Number }),
    ]);
    const Draw = Mount.make(
      "Draw",
      { args: { points: Schema.Number } },
      (node, args) =>
        Effect.sync(() => {
          seen.push({ node, points: args.points });
          return { _tag: "Drew", points: args.points } as const;
        })
    );
    const CanvasDef = defineComponent({
      events: Schema.Never,
      message: Message,
      model: Schema.Struct({ drew: Schema.Number }),
      name: "Canvas",
      props: Schema.Struct({ points: Schema.Number }),
    });
    const Canvas = CanvasDef.make({
      init: () => ({ drew: -1 }),
      update: { Drew: ($, message) => $.set({ drew: message.points }) },
      view: (h, model) => (
        <div>
          <span id="drew">{String(model.drew)}</span>
          <canvas
            id="chart"
            ref={h.mount(
              asMountAny(
                Mount.map(Draw({ points: h.props.points }), (drew) => drew)
              )
            )}
          />
        </div>
      ),
    });
    const log = MessageLog.makeMemory();
    const detach = MessageLog.attach(log);
    try {
      const ui = render(() => <Canvas props={{ points: 3 }} />);
      await ui.settled();
      expect(seen).toHaveLength(1);
      expect(seen[0]?.points).toBe(3);
      expect(seen[0]?.node.tagName).toBe("CANVAS");
      expect(ui.html()).toContain(">3<");
      const started = logged(log, "MountStarted");
      expect(started).toHaveLength(1);
      // SAFETY: filtered for MountStarted above; the entry carries a MountStarted payload.
      expect((started[0] as MessageLog.MountStarted).name).toBe("Draw");
      // SAFETY: filtered for MountEnded above; the entries carry MountEnded payloads.
      const ended = logged(log, "MountEnded") as MessageLog.MountEnded[];
      expect(ended).toHaveLength(1);
      expect(ended[0]?.reason).toBe("completed");
      expect(ended[0]?.silent).toBe(false);
      ui.unmount();
    } finally {
      detach();
    }
  });

  it("publishes new args to changes without restarting on the same name", async () => {
    const starts: number[] = [];
    const Message = Schema.Union([
      Schema.TaggedStruct("Saw", { points: Schema.Number }),
      Schema.TaggedStruct("Bump", { points: Schema.Number }),
    ]);
    const Watch = Mount.makeStream(
      "Watch",
      { args: { points: Schema.Number } },
      (_node, args, changes) => {
        starts.push(args.points);
        return changes.pipe(
          Stream.map((next) => ({ _tag: "Saw", points: next.points }) as const),
          Stream.take(2)
        );
      }
    );
    const PageDef = defineComponent({
      events: Schema.Never,
      message: Message,
      model: Schema.Struct({ points: Schema.Number, saw: Schema.Number }),
      name: "Page",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => ({ points: 1, saw: -1 }),
      update: {
        Bump: ($, message) => $.set({ ...$.model, points: message.points }),
        Saw: ($, message) => $.set({ ...$.model, saw: message.points }),
      },
      view: (h, model) => (
        <div>
          <span id="saw">{String(model.saw)}</span>
          <canvas
            ref={h.mount(
              asMountAny(
                Mount.map(Watch({ points: model.points }), (message) => message)
              )
            )}
          />
          <button id="bump" onclick={h.send({ _tag: "Bump", points: 2 })}>
            bump
          </button>
        </div>
      ),
    });
    const log = MessageLog.makeMemory();
    const detach = MessageLog.attach(log);
    try {
      const ui = render(() => <Page props={{}} />);
      // Mounts no longer hold the island's pending count, so `settled()`
      // resolves with the stream still open.
      await ui.settled();
      expect(starts).toEqual([1]);
      await ui.click("#bump");
      await ui.settled();
      // The body ran once; the new args arrived through `changes` instead.
      expect(starts).toEqual([1]);
      expect(ui.html()).toContain(">2<");
      expect(logged(log, "MountEnded")).toHaveLength(1);
      ui.unmount();
    } finally {
      detach();
    }
  });

  it("restarts when the name changes and stops when the render drops the mount", async () => {
    const log = MessageLog.makeMemory();
    const detach = MessageLog.attach(log);
    try {
      const events: string[] = [];
      const A = Mount.make("A", { args: {} }, () =>
        Effect.sync(() => {
          events.push("start A");
          return Component.noop;
        })
      );
      const B = Mount.make("B", { args: {} }, () =>
        Effect.sync(() => {
          events.push("start B");
          return Component.noop;
        })
      );
      const SwapDef = defineComponent({
        events: Schema.Never,
        message: Schema.Union([Schema.TaggedStruct("Flip", {})]),
        model: Schema.Struct({ which: Schema.String }),
        name: "Swap",
        props: Schema.Struct({}),
      });
      const Swap = SwapDef.make({
        init: () => ({ which: "a" }),
        update: {
          Flip: ($) => $.set({ which: $.model.which === "a" ? "b" : "none" }),
        },
        view: (h, model) => {
          let ref: ((node: Element | null) => void) | undefined;
          if (model.which === "a") {
            ref = h.mount(asMountAny(A()));
          } else if (model.which === "b") {
            ref = h.mount(asMountAny(B()));
          }
          return (
            <div>
              <span ref={ref} />
              <button id="flip" onclick={h.send({ _tag: "Flip" })}>
                flip
              </button>
            </div>
          );
        },
      });
      const ui = render(() => <Swap props={{}} />);
      await ui.settled();
      expect(events).toEqual(["start A"]);
      await ui.click("#flip");
      await ui.settled();
      await tick();
      expect(events).toContain("start B");
      await ui.click("#flip");
      await ui.settled();
      await tick();
      // SAFETY: filtered for MountEnded above; the entries carry MountEnded payloads.
      const ended = logged(log, "MountEnded") as MessageLog.MountEnded[];
      expect(ended.map((entry) => `${entry.name}:${entry.reason}`)).toEqual([
        "A:completed",
        "B:completed",
      ]);
      ui.unmount();
      await tick();
      // Unmounting stops what still runs; the log already holds both ends.
      expect(logged(log, "MountEnded")).toHaveLength(2);
    } finally {
      detach();
    }
  });

  it("fails the instance when the body defects", async () => {
    const Boom = Mount.make("Boom", { args: {} }, () =>
      Effect.die(new Error("boom"))
    );
    const ChildDef = defineComponent({
      events: Schema.Never,
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "Child",
      props: Schema.Struct({}),
    });
    const Child = ChildDef.make({
      init: () => ({}),
      update: ($) => $,
      view: (h) => <span ref={h.mount(asMountAny(Boom()))} />,
    });
    const ParentDef = defineComponent({
      events: Schema.Never,
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "Parent",
      props: Schema.Struct({}),
    });
    const Parent = ParentDef.make({
      init: () => ({}),
      update: ($) => $,
      view: () => (
        <div>
          <Child fallback={() => <p id="fallback">down</p>} />
        </div>
      ),
    });
    const errors: Error[] = [];
    const ui = render(() => <Parent props={{}} />, {
      onError: (error) => errors.push(error),
    });
    await ui.settled();
    expect(ui.html()).toContain("down");
    ui.unmount();
  });

  it("never runs on the server", async () => {
    let runs = 0;
    const Draw = Mount.make("Draw", { args: {} }, () =>
      Effect.sync(() => {
        runs += 1;
        return Component.noop;
      })
    );
    const CanvasDef = defineComponent({
      events: Schema.Never,
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "Canvas",
      props: Schema.Struct({}),
    });
    const Canvas = CanvasDef.make({
      init: () => ({}),
      update: ($) => $,
      view: (h) => <canvas ref={h.mount(asMountAny(Draw()))} />,
    });
    const log = MessageLog.makeMemory();
    const detach = MessageLog.attach(log);
    try {
      const html = await renderToString(Component.root(Canvas, {}));
      expect(html).toContain("<canvas");
      expect(runs).toBe(0);
      expect(logged(log, "MountStarted")).toHaveLength(0);
    } finally {
      detach();
    }
  });
});
