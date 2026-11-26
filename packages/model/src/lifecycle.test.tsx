/**
 * Lifecycle regression tests: per-record slot-free state, unmount teardown,
 * root-level keyed rows, provided services in stream Subscriptions, and
 * post-hydration mounts running init emits.
 */
import { describe, expect, it } from "bun:test";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { renderToString } from "ilha";
import { render } from "ilha/test";

import {
  Component,
  defineComponent,
  MessageLog,
  Subscription,
} from "./index.ts";
import { islands } from "./internal/kernel.ts";
import { TaggedEnum } from "./tagged-enum.ts";

const waitFor = async (
  what: () => boolean,
  timeoutMs = 3000
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

describe("lifecycle", () => {
  it("a conditional p.child keeps its own init and Model", async () => {
    const LeafDef = defineComponent({
      events: Schema.Never,
      message: TaggedEnum({ Ping: {} }),
      model: Schema.Struct({ who: Schema.String }),
      name: "LifecycleLeaf",
      props: Schema.Struct({}),
    });
    const Leaf = LeafDef.make({
      init: () => ({ who: "leaf" }),
      parts: (_p, model) => ({ label: model.who }),
      update: { Ping: ($) => $.set({ who: "leaf" }) },
    });
    const ComposerDef = defineComponent({
      message: TaggedEnum({ Next: {} }),
      model: Schema.Struct({ phase: Schema.Number, who: Schema.String }),
      name: "LifecycleComposer",
      props: Schema.Struct({}),
    });
    const Composer = ComposerDef.make({
      init: () => ({ phase: 0, who: "composer" }),
      parts: (p, model) => ({
        one: p.child(Leaf, {
          key: "one",
          parts: (c: { readonly label: string }) => c.label,
          props: {},
        }),
        two:
          model.phase === 0
            ? "none"
            : p.child(Leaf, {
                key: "two",
                parts: (c: { readonly label: string }) => c.label,
                props: {},
              }),
      }),
      subscriptions: () => [
        Subscription.make(
          "kick",
          Stream.fromIterable([{ _tag: "Next" } as const])
        ),
      ],
      update: { Next: ($) => $.set({ ...$.model, phase: 1 }) },
    });
    const Host = defineComponent({
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "LifecycleComposerHost",
      props: Schema.Struct({}),
    }).make({
      init: () => ({}),
      update: ($) => $.model,
      view: () => (
        <Composer
          props={{}}
          view={(parts) => (
            <output id="t">
              {parts.one}/{parts.two}
            </output>
          )}
        />
      ),
    });
    const ui = render(() => <Host props={{}} />);
    await ui.settled();
    await waitFor(() => ui.query("#t")?.textContent === "leaf/leaf");
    expect(ui.query("#t")?.textContent).toBe("leaf/leaf");
    ui.unmount();
  });

  it("unmount closes records, detaches subscriptions and drops the kernel", async () => {
    const PageDef = defineComponent({
      message: TaggedEnum({ Tick: {} }),
      model: Schema.Struct({ n: Schema.Number }),
      name: "LifecycleTeardown",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => ({ n: 0 }),
      subscriptions: () => [
        Subscription.make("open", Stream.fromEffect(Effect.never)),
      ],
      update: { Tick: ($) => $.set({ n: $.model.n + 1 }) },
      view: (_h, model) => <output id="n">{String(model.n)}</output>,
    });
    const log = MessageLog.makeMemory();
    const detach = MessageLog.attach(log);
    try {
      const before = islands().length;
      const ui = render(() => <Page props={{}} />);
      await ui.settled();
      expect(islands().length).toBe(before + 1);
      ui.unmount();
      expect(islands().length).toBe(before);
      const stopped = log
        .entries()
        .filter((entry) => entry._tag === "SubscriptionStopped");
      expect(stopped.length).toBe(1);
    } finally {
      detach();
    }
  });

  it("server renders leave no kernels behind", async () => {
    const PageDef = defineComponent({
      message: TaggedEnum({ Tick: {} }),
      model: Schema.Struct({ n: Schema.Number }),
      name: "LifecycleSsr",
      props: Schema.Struct({}),
    });
    const Page = PageDef.make({
      init: () => ({ n: 0 }),
      update: { Tick: ($) => $.set({ n: $.model.n + 1 }) },
      view: (_h, model) => <output>{String(model.n)}</output>,
    });
    const before = islands().length;
    // SAFETY: root props are the empty struct; never satisfies the frozen root signature without changing the value.
    await renderToString(Component.root(Page, {}) as never);
    // SAFETY: root props are the empty struct; never satisfies the frozen root signature without changing the value.
    await renderToString(Component.root(Page, {}) as never);
    expect(islands().length).toBe(before);
  });

  it("root-level keyed rows dispatch independently", async () => {
    const RowDef = defineComponent({
      events: Schema.Never,
      message: TaggedEnum({ Inc: {} }),
      model: Schema.Struct({ n: Schema.Number }),
      name: "LifecycleKeyRow",
      props: Schema.Struct({ id: Schema.String }),
    });
    const Row = RowDef.make({
      init: () => ({ n: 0 }),
      update: { Inc: ($) => $.set({ n: $.model.n + 1 }) },
      view: (h, model) => (
        <li>
          <span id={`n-${h.props.id}`}>{String(model.n)}</span>
          <button id={`inc-${h.props.id}`} onclick={h.send({ _tag: "Inc" })}>
            +
          </button>
        </li>
      ),
    });
    const ui = render(() => (
      <ul>
        {["a", "b", "c"].map((id) => (
          <Row key={id} props={{ id }} />
        ))}
      </ul>
    ));
    await ui.settled();
    await ui.click("#inc-b");
    await waitFor(() => ui.query("#n-b")?.textContent === "1");
    expect(ui.query("#n-a")?.textContent).toBe("0");
    expect(ui.query("#n-c")?.textContent).toBe("0");
    await ui.click("#inc-a");
    await waitFor(() => ui.query("#n-a")?.textContent === "1");
    expect(ui.query("#n-b")?.textContent).toBe("1");
    ui.unmount();
  });

  it("a stream Subscription runs with a provided service", async () => {
    class Cloak extends Context.Service<Cloak, { readonly word: string }>()(
      "test/LifecycleCloak"
    ) {}
    const PageDef = defineComponent({
      message: TaggedEnum({ Got: { text: Schema.String } }),
      model: Schema.Struct({ got: Schema.String }),
      name: "LifecycleProvided",
      props: Schema.Struct({}),
    });
    const InnerPage = PageDef.make({
      init: () => ({ got: "" }),
      subscriptions: () => [
        Subscription.make(
          "heard",
          Stream.fromEffect(
            Cloak.pipe(
              Effect.map((c) => ({ _tag: "Got", text: c.word }) as const)
            )
          )
        ),
      ],
      update: { Got: ($, { text }) => $.set({ got: text }) },
      view: (_h, model) => <output id="got">{model.got}</output>,
    });
    const Page = Component.provide(
      InnerPage,
      Layer.succeed(Cloak, { word: "hi" })
    );
    const ui = render(() => <Page props={{}} />);
    await ui.settled();
    await waitFor(() => ui.query("#got")?.textContent === "hi");
    expect(ui.query("#got")?.textContent).toBe("hi");
    ui.unmount();
  });

  it("a mount after hydration runs init emits", async () => {
    const KidDef = defineComponent({
      events: TaggedEnum({ Greet: {} }),
      message: TaggedEnum({ Fire: {} }),
      model: Schema.Struct({ n: Schema.Number }),
      name: "LifecycleLateKid",
      props: Schema.Struct({}),
    });
    const Kid = KidDef.make({
      init: ({ set }) => set({ n: 0 }).emit({ _tag: "Greet" }),
      update: { Fire: ($) => $.set({ n: $.model.n + 1 }) },
      view: () => <span id="kid">kid</span>,
    });
    const ShellDef = defineComponent({
      message: TaggedEnum({ Heard: {}, Show: {} }),
      model: Schema.Struct({ heard: Schema.String, show: Schema.Boolean }),
      name: "LifecycleLateShell",
      props: Schema.Struct({}),
    });
    const Shell = ShellDef.make({
      init: () => ({ heard: "", show: false }),
      update: {
        Heard: ($) => $.set({ ...$.model, heard: "hi" }),
        Show: ($) => $.set({ ...$.model, show: true }),
      },
      view: (h, model) => (
        <div>
          <output id="heard">{model.heard}</output>
          <button id="show" onclick={h.send({ _tag: "Show" })}>
            show
          </button>
          {model.show ? (
            <Kid props={{}} onEmit={() => ({ _tag: "Heard" })} />
          ) : null}
        </div>
      ),
    });
    // SAFETY: root props are the empty struct; never satisfies the frozen root signature without changing the value.
    const html = await renderToString(Component.root(Shell, {}) as never);
    const container = document.createElement("div");
    container.innerHTML = html;
    // SAFETY: root props are the empty struct; never satisfies the frozen root signature without changing the value.
    const ui = render(Component.root(Shell, {}) as never, {
      container,
      hydrate: true,
    });
    await ui.settled();
    expect(ui.query("#heard")?.textContent).toBe("");
    await ui.click("#show");
    await waitFor(() => ui.query("#heard")?.textContent === "hi");
    expect(ui.query("#heard")?.textContent).toBe("hi");
    ui.unmount();
    container.remove();
  });
});
