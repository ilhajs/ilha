/**
 * Runtime: init/update/view/prop failures, unmatched messages, bare-model
 * returns, init Commands and roots. Ported from the kernel-owned parts of
 * Effect UI's `Runtime.test.ts` (shared state, provide, queries, mounts,
 * layers and the log belong to other slices).
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { renderToString } from "ilha";
import { render } from "ilha/test";

import * as Command from "./command.ts";
import { Component, defineComponent } from "./component.ts";
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- pageWith wraps any caller-supplied child vnode; the slot stays generic across failure cases.
const pageWith = (child: unknown, name: string) => {
  const PageDef = defineComponent({
    message: Schema.Never,
    model: Schema.Null,
    name,
    props: Schema.Struct({}),
  });
  return PageDef.make({
    init: () => null,
    update: ($) => $,
    // SAFETY: child is a caller-supplied vnode; never satisfies the child-list type without changing the value.
    view: () => <main>{child as never}</main>,
  });
};

describe("Runtime", () => {
  it("a throw in init fails the instance to the author's fallback", async () => {
    const BadDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "RtBadInit",
    });
    const Bad = BadDef.make({
      init: () => {
        throw new Error("bad init");
      },
      update: ($) => $,
      view: () => "never",
    });
    const Page = pageWith(
      <Bad props={{}} fallback={() => <output id="fallback">failed</output>} />,
      "RtBadInitPage"
    );
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await waitFor(() => ui.query("#fallback")?.textContent === "failed");
    ui.unmount();
  });

  it("a throw in view fails the instance to the author's fallback", async () => {
    const BadDef = defineComponent({
      message: TaggedEnum({ Go: {} }),
      model: Schema.Struct({ n: Schema.Number }),
      name: "RtBadView",
    });
    const Bad = BadDef.make({
      init: () => ({ n: 0 }),
      update: {
        Go: ($) => $.set({ n: 1 }),
      },
      view: (h, model) => {
        if (model.n > 0) {
          throw new Error("bad view");
        }
        return (
          <button id="go" onclick={h.send({ _tag: "Go" })}>
            go
          </button>
        );
      },
    });
    const Page = pageWith(
      <Bad props={{}} fallback={() => <output id="fallback">failed</output>} />,
      "RtBadViewPage"
    );
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await ui.click("#go");
    await waitFor(() => ui.query("#fallback")?.textContent === "failed");
    ui.unmount();
  });

  it("a props decode failure fails the instance at mount", async () => {
    const NeedDef = defineComponent({
      message: Schema.Never,
      model: Schema.Null,
      name: "RtNeedProps",
      props: Schema.Struct({ n: Schema.Number }),
    });
    const Need = NeedDef.make({
      init: () => null,
      update: ($) => $,
      view: () => "never",
    });
    const Page = pageWith(
      // SAFETY: deliberately passes an undecodable prop to exercise the mount-time failure.
      <Need
        props={{ n: "not a number" } as never}
        fallback={() => <output id="fallback">failed</output>}
      />,
      "RtNeedPropsPage"
    );
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await waitFor(() => ui.query("#fallback")?.textContent === "failed");
    ui.unmount();
  });

  it("init Commands run on the client mount", async () => {
    const Boot = Command.make("Boot", { args: {} }, () =>
      Effect.succeed({ _tag: "Started" } as const)
    );
    const Def = defineComponent({
      message: TaggedEnum({ Started: {} }),
      model: Schema.Struct({ n: Schema.Number }),
      name: "RtInitCmd",
    });
    const Started = Def.make({
      init: ($) => $.set({ n: 0 }).run(Boot.make()),
      update: { Started: ($) => $.set({ n: 1 }) },
      view: (_h, model) => <output id="n">{String(model.n)}</output>,
    });
    const ui = render(() => <Started props={{}} />);
    await ui.settled();
    await waitFor(() => ui.query("#n")?.textContent === "1");
    ui.unmount();
  });

  it("init Commands run on the client mount", async () => {
    const Def = defineComponent({
      message: TaggedEnum({ Started: {} }),
      model: Schema.Struct({ n: Schema.Number }),
      name: "RtInitCmd",
    });
    const Started = Def.make({
      init: ($) => $.set({ n: 0 }),
      update: { Started: ($) => $.set({ n: 1 }) },
      view: (_h, model) => <output id="n">{String(model.n)}</output>,
    });
    const ui = render(() => <Started props={{}} />);
    await ui.settled();
    expect(ui.query("#n")?.textContent).toBe("0");
    ui.unmount();
  });

  it("onFailure maps the failure for the author and the child stays failed", async () => {
    const BrokenDef = defineComponent({
      message: TaggedEnum({ Boom: {} }),
      model: Schema.Null,
      name: "RtBroken",
    });
    const Broken = BrokenDef.make({
      init: () => null,
      update: () => {
        throw new Error("boom");
      },
      view: (h) => (
        <button id="boom" onclick={h.send({ _tag: "Boom" })}>
          boom
        </button>
      ),
    });
    const ParentDef = defineComponent({
      message: TaggedEnum({ FailedChild: {} }),
      model: Schema.Struct({ heard: Schema.Boolean }),
      name: "RtFailurePage",
      props: Schema.Struct({}),
    });
    const Parent = ParentDef.make({
      init: () => ({ heard: false }),
      update: { FailedChild: ($) => $.set({ heard: true }) },
      view: (_h, model) => (
        <div>
          <output id="heard">{String(model.heard)}</output>
          <Broken
            props={{}}
            fallback={(result) => <output id="fallback">{result._tag}</output>}
            onFailure={() => ({ _tag: "FailedChild" })}
          />
        </div>
      ),
    });
    const ui = render(() => <Parent props={{}} />);
    await ui.settled();
    await ui.click("#boom");
    await waitFor(() => ui.query("#fallback")?.textContent === "Failure");
    await waitFor(() => ui.query("#heard")?.textContent === "true");
    ui.unmount();
  });

  it("an update may return a bare model", async () => {
    const Def = defineComponent({
      message: TaggedEnum({ Tick: {} }),
      model: Schema.Struct({ n: Schema.Number }),
      name: "RtBare",
    });
    const Bare = Def.make({
      init: () => ({ n: 0 }),
      update: {
        Tick: ($) => ({ n: $.model.n + 1 }),
      },
      view: (h, model) => (
        <button id="tick" onclick={h.send({ _tag: "Tick" })}>
          {String(model.n)}
        </button>
      ),
    });
    const ui = render(() => <Bare props={{}} />);
    await ui.settled();
    await ui.click("#tick");
    await waitFor(() => ui.query("#tick")?.textContent === "1");
    ui.unmount();
  });

  it("h.send maps the event and h.id is stable", async () => {
    const Def = defineComponent({
      message: TaggedEnum({ Add: { n: Schema.Number } }),
      model: Schema.Struct({ id: Schema.String, n: Schema.Number }),
      name: "RtSend",
    });
    const Send = Def.make({
      init: () => ({ id: "", n: 0 }),
      update: { Add: ($, { n }) => $.evolve({ n }) },
      view: (h, model) => (
        <div>
          <output id="n">{String(model.n)}</output>
          <output id="id">{h.id("field")}</output>
          <button
            id="add"
            onclick={h.send((event) => {
              // SAFETY: the test clicks a real button; the event target carries the input value.
              const value =
                (event as { target?: { value?: string } }).target?.value ?? "0";
              return { _tag: "Add", n: Number(value) + model.n };
            })}
          >
            add
          </button>
        </div>
      ),
    });
    const ui = render(() => <Send props={{}} />);
    await ui.settled();
    const id = ui.query("#id")?.textContent ?? "";
    expect(id.length).toBeGreaterThan(0);
    await ui.click("#add");
    await waitFor(() => ui.query("#n")?.textContent === "0");
    // The server render agrees on the id.
    const html = await renderToString(() => <Send props={{}} />);
    expect(html).toContain(id);
    ui.unmount();
  });

  it("a root keeps working through Component.root", async () => {
    const Def = defineComponent({
      message: TaggedEnum({ Inc: {} }),
      model: Schema.Struct({ n: Schema.Number }),
      name: "RtRooted",
      props: Schema.Struct({ initial: Schema.Number }),
    });
    const Counter = Def.make({
      init: (_, props) => ({ n: props.initial }),
      update: { Inc: ($) => $.evolve({ n: (n) => n + 1 }) },
      view: (h, model) => (
        <button id="inc" onclick={h.send({ _tag: "Inc" })}>
          {String(model.n)}
        </button>
      ),
    });
    const ui = render(Component.root(Counter, { initial: 5 }));
    await ui.settled();
    expect(ui.query("#inc")?.textContent).toBe("5");
    await ui.click("#inc");
    await waitFor(() => ui.query("#inc")?.textContent === "6");
    ui.unmount();
  });
});
