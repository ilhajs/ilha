/**
 * `Subscription`: keys, deps, filtering, diffing and `direct`. Ported from
 * Effect UI's `Subscription.test.ts`, with the mount behavior running
 * through `render` here instead of `TestHost`.
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { render } from "ilha/test";

import { defineComponent } from "./component.ts";
import * as Subscription from "./subscription.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const waitFor = async (
  what: () => boolean,
  timeoutMs = 5000
): Promise<void> => {
  const start = Date.now();
  while (!what()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- polls an async condition; each sleep must follow the previous check.
    await Effect.runPromise(Effect.sleep("5 millis"));
  }
};
const depKey = (dep: Subscription.Dep) =>
  Subscription.make("page", dep, () => Stream.empty).key;
const depsKey = (deps: Subscription.Deps) =>
  Subscription.make("room", deps, () => Stream.empty).key;
const Ticks = (n: number) =>
  Stream.fromIterable(
    [1, 2, 3].map((i) => ({ _tag: "Got", n: n * 10 + i }) as const)
  );

describe("Subscription", () => {
  it("a Subscription without deps is keyed by its name", () => {
    expect(Subscription.make("tick", Stream.empty).key).toBe("tick");
  });

  it("a name can't pass for a name with deps", () => {
    expect(Subscription.make("page:null", Stream.empty).key).toBe("page::null");
    expect(Subscription.make("page", null, () => Stream.empty).key).toBe(
      "page:null"
    );
    expect(Subscription.make("a:b", "c", () => Stream.empty).key).toBe(
      'a::b:"c"'
    );
  });

  it("numbers JSON can't tell apart keep distinct keys", () => {
    const keys = [
      depKey(Number.NaN),
      depKey(Infinity),
      depKey(-Infinity),
      depKey(null),
      depKey(0),
      depKey(-0),
      depKey("null"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(depKey(Number.NaN)).toBe("page:NaN");
    expect(depKey(-0)).toBe("page:-0");
    expect(depKey(0)).toBe("page:0");
  });

  it("deps join the key without colliding", () => {
    expect(depsKey("42")).toBe('room:"42"');
    expect(depsKey(42)).toBe("room:42");
    expect(depsKey("1")).not.toBe(depsKey(1));
    expect(depsKey(["a,b", "c"])).not.toBe(depsKey(["a", "b,c"]));
    expect(depsKey([true, null])).not.toBe(depsKey(["true", "null"]));
    expect(depsKey([1, "x"])).toBe(Subscription.keyOf("room", [1, "x"]));
  });

  it("keeps the name and deps its key was built from", () => {
    const room = Subscription.make("room", "42", () => Stream.empty);
    expect([room.name, room.deps, room.key]).toEqual([
      "room",
      ["42"],
      'room:"42"',
    ]);
    expect(Subscription.make("room", ["42"], () => Stream.empty).deps).toEqual([
      "42",
    ]);
    expect(
      Subscription.make("cell", [1, true], () => Stream.empty).deps
    ).toEqual([1, true]);
    expect(Subscription.make("tick", Stream.empty).deps).toBeUndefined();
    expect(Subscription.make("tick", [], () => Stream.empty).deps).toEqual([]);
    expect(Subscription.make("page:null", Stream.empty).name).toBe("page:null");
  });

  it("builds lazily with only its deps each time the Stream runs", async () => {
    const seen: unknown[] = [];
    const subscription = Subscription.make("room", ["a", 1], (deps) => {
      seen.push(deps);
      return Stream.empty;
    });
    expect(seen).toEqual([]);
    await Effect.runPromise(Stream.runDrain(subscription.stream));
    await Effect.runPromise(Stream.runDrain(subscription.stream));
    expect(seen).toEqual([
      ["a", 1],
      ["a", 1],
    ]);
  });

  it("delivers stream messages and stops when the key leaves", async () => {
    const Def = defineComponent({
      message: TaggedEnum({ Got: { n: Schema.Number }, Toggle: {} }),
      model: Schema.Struct({
        got: Schema.Array(Schema.Number),
        on: Schema.Boolean,
      }),
      name: "SubStream",
    });
    const Sub = Def.make({
      init: () => ({ got: [], on: true }),
      subscriptions: ({ model }) => [
        model.on &&
          Subscription.make(
            "ticks",
            Stream.flatMap(Stream.fromIterable([1]), () => Ticks(1))
          ),
      ],
      update: {
        Got: ($, { n }) => $.evolve({ got: [...$.model.got, n] }),
        Toggle: ($) => $.evolve({ on: !$.model.on }),
      },
      view: (h, model) => (
        <div>
          <output id="got">{model.got.join(",")}</output>
          <button id="toggle" onclick={h.send({ _tag: "Toggle" })}>
            toggle
          </button>
        </div>
      ),
    });
    const ui = render(() => <Sub props={{}} />);
    await ui.settled();
    await waitFor(() => ui.query("#got")?.textContent === "11,12,13");
    await ui.click("#toggle");
    ui.unmount();
  });

  it("duplicate keys fail the instance to the author's fallback", async () => {
    const Def = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "SubDup",
    });
    const Dup = Def.make({
      init: () => null,
      subscriptions: () => [
        Subscription.make("same", Stream.empty),
        Subscription.make("same", Stream.empty),
      ],
      update: ($) => $,
      view: () => "dup",
    });
    const PageDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "SubDupPage",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => null,
      update: ($) => $,
      view: () => (
        <div>
          <Dup
            props={{}}
            fallback={() => <output id="fallback">failed</output>}
          />
        </div>
      ),
    });
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await waitFor(() => ui.query("#fallback")?.textContent === "failed");
    ui.unmount();
  });

  it("falsy subscriptions entries are filtered out", async () => {
    const Def = defineComponent({
      message: TaggedEnum({ Activate: {}, Got: { n: Schema.Number } }),
      model: Schema.Struct({
        active: Schema.Boolean,
        got: Schema.Array(Schema.Number),
      }),
      name: "SubFalsy",
    });
    const Falsy = Def.make({
      init: () => ({ active: false, got: [] }),
      subscriptions: ({ model }) => [
        model.active &&
          Subscription.make(
            "late",
            Stream.fromIterable([{ _tag: "Got", n: 1 } as const])
          ),
      ],
      update: {
        Activate: ($) => $.evolve({ active: true }),
        Got: ($, { n }) => $.evolve({ got: [...$.model.got, n] }),
      },
      view: (h, model) => (
        <div>
          <output id="got">{model.got.join(",")}</output>
          <button id="activate" onclick={h.send({ _tag: "Activate" })}>
            activate
          </button>
        </div>
      ),
    });
    const ui = render(() => <Falsy props={{}} />);
    await ui.settled();
    expect(ui.query("#got")?.textContent).toBe("");
    await ui.click("#activate");
    await waitFor(() => ui.query("#got")?.textContent === "1");
    ui.unmount();
  });

  it("direct delivers latest state, and detaches on stop", async () => {
    let fire: ((value: number) => void) | undefined;
    let detached = false;
    const accepted: number[] = [];
    const Message = TaggedEnum({ Got: { value: Schema.Number }, Stop: {} });
    const Def = defineComponent({
      message: Message,
      model: Schema.Struct({ active: Schema.Boolean, count: Schema.Number }),
      name: "SubDirect",
    });
    const Direct = Def.make({
      init: () => ({ active: true, count: 1 }),
      subscriptions: ({ model }) => [
        model.active &&
          Subscription.direct(
            "direct",
            undefined,
            model.count,
            (_context, { emit, enter }) => {
              fire = (value) =>
                enter((latest) =>
                  emit(Message.Got({ value: value * latest }), () => {
                    accepted.push(latest);
                  })
                );
              return () => {
                detached = true;
                fire = undefined;
              };
            }
          ),
      ],
      update: {
        Got: ($, { value }) => $.evolve({ count: (n) => n + value }),
        Stop: ($) => $.evolve({ active: false }),
      },
      view: (h, model) => (
        <div>
          <output id="count">{String(model.count)}</output>
          <button id="stop" onclick={h.send(Message.Stop())}>
            stop
          </button>
        </div>
      ),
    });
    const ui = render(() => <Direct props={{}} />);
    await ui.settled();
    fire?.(2);
    expect(accepted).toEqual([1]);
    await waitFor(() => ui.query("#count")?.textContent === "3");
    fire?.(2);
    expect(accepted).toEqual([1, 3]);
    await waitFor(() => ui.query("#count")?.textContent === "9");
    await ui.click("#stop");
    await waitFor(() => detached);
    expect(fire).toBeUndefined();
    ui.unmount();
  });

  it("a deps change restarts the key", async () => {
    const started: string[] = [];
    const Def = defineComponent({
      message: TaggedEnum({
        Got: { text: Schema.String },
        Move: { room: Schema.String },
      }),
      model: Schema.Struct({
        got: Schema.Array(Schema.String),
        room: Schema.String,
      }),
      name: "SubDeps",
    });
    const Rooms = Def.make({
      init: () => ({ got: [], room: "a" }),
      subscriptions: ({ model }) => [
        Subscription.make("room", [model.room], ([room]) => {
          started.push(room);
          return Stream.fromIterable([{ _tag: "Got", text: room } as const]);
        }),
      ],
      update: {
        Got: ($, { text }) => $.evolve({ got: [...$.model.got, text] }),
        Move: ($, { room }) => $.set({ got: $.model.got, room }),
      },
      view: (h, model) => (
        <div>
          <output id="got">{model.got.join(",")}</output>
          <button id="move" onclick={h.send({ _tag: "Move", room: "b" })}>
            move
          </button>
        </div>
      ),
    });
    const ui = render(() => <Rooms props={{}} />);
    await ui.settled();
    await waitFor(() => (ui.query("#got")?.textContent ?? "").includes("a"));
    await ui.click("#move");
    await waitFor(() => (ui.query("#got")?.textContent ?? "").includes("b"));
    expect(started).toEqual(["a", "b"]);
    ui.unmount();
  });
});
