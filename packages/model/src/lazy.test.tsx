/**
 * Tests for `Component.lazy`: loading placeholders, loaded rendering,
 * preload, failure branches, retry, and `isLazy`.
 *
 * Handles are declared at module scope and shared across islands: one test
 * below renders the same handle in two islands, and the server test renders
 * without `preload`. A permanently failing load retries once on the next
 * render (then stays on the Failure branch) and once per unseen mount, so
 * `settled` drains and `setTimeout` polling works.
 */

import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { render, renderHtml } from "ilha/test";

import { Component, defineComponent, isLazy } from "./index.ts";
import type { Lazy, ModelComponent } from "./index.ts";

/**
 * The frozen `lazy` loader wants `Promise<ModelComponent<any, any, any,
 * any>>`, which a concrete `make` result (with its `SpecOf` query spec)
 * never satisfies. The all-`any` shape satisfies it; the loaded test
 * components carry no requirements, so nothing observable is lost. Runtime
 * values pass through untouched.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- lazy loader wants Promise<ModelComponent<any, any, any, any>>; loaded components carry no requirements
type Target = ModelComponent<any, any, never, any>;
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- asTarget takes any made component; runtime values pass through untouched
const asTarget = (component: unknown): Target =>
  // SAFETY: loaded components carry no requirements; the alias only satisfies the loader signature
  component as Target;
// oxlint-disable-next-line typescript/no-explicit-any -- Lazy slots mirror the all-any loader shape; loaded components carry no requirements
type LazyPage = Lazy<any, any, never>;

const flush = async (rounds = 8): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential flush; parallelizing would change test semantics
    await Effect.runPromise(Effect.sleep("1 millis"));
  }
};

/** Poll until `what` holds; `settled` would wait for in-flight lazy loads. */
const waitFor = async (
  what: () => boolean,
  timeoutMs = 5000
): Promise<void> => {
  const start = Date.now();
  while (!what()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential poll; parallelizing would change test semantics
    await Effect.runPromise(Effect.sleep("5 millis"));
  }
};

const LoadedDef = defineComponent({
  events: Schema.Never,
  message: Schema.Never,
  model: Schema.Struct({}),
  name: "Loaded",
  props: Schema.Struct({}),
});
const Loaded = LoadedDef.make({
  init: () => ({}),
  update: ($) => $,
  view: () => <p>loaded!</p>,
});

const fallback = (result: { _tag: string }) =>
  result._tag === "Initial" ? <p>waiting</p> : <p>broken</p>;

/**
 * Declared at module scope, outside any fiber: sharing this handle across
 * islands is the point of the test below, and the declaration itself would
 * throw if `Component.lazy` still needed an active fiber.
 */
let sharedLoads = 0;
const Shared = Component.lazy("Shared", () => {
  sharedLoads += 1;
  return Promise.resolve(asTarget(Loaded));
});

describe("Component.lazy", () => {
  it("shows the fallback while loading, then the component", async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<Target>();
    let Page: LazyPage | undefined;
    const ui = render(() => {
      Page ??= Component.lazy("LazyPage", () => gate);
      // SAFETY: Page is defined by this render; the alias only satisfies the lazy slot type
      const page = Page as LazyPage;
      return <div>{page({ fallback })}</div>;
    });
    // No `settled` here: it waits for the in-flight load, which only
    // `release` below resolves. The initial paint already shows the fallback.
    expect(ui.html()).toContain("waiting");
    release(asTarget(Loaded));
    await flush();
    await ui.settled();
    expect(ui.html()).toContain("loaded!");
    ui.unmount();
  });

  it("preload loads without rendering", async () => {
    let Page: LazyPage | undefined;
    const ui = render(() => {
      Page ??= Component.lazy("Preloaded", () =>
        Promise.resolve(asTarget(Loaded))
      );
      // SAFETY: Page is defined by this render; the alias only satisfies the lazy slot type
      const page = Page as LazyPage;
      return <div>{page({ fallback })}</div>;
    });
    // SAFETY: Page is defined by this render; the alias only satisfies the lazy slot type
    const page = Page as LazyPage;
    await page.preload();
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain("loaded!");
    expect(ui.html()).not.toContain("waiting");
    ui.unmount();
  });

  it("shows the Failure branch when the load fails, then loads on the next mount", async () => {
    let loads = 0;
    const { promise: retryGate, resolve: releaseRetry } =
      Promise.withResolvers<Target>();
    const loader = (): Promise<Target> => {
      loads += 1;
      // The first load fails; the automatic retry on rerender, and the
      // remount below, wait on the gate so the Failure branch stays put.
      return loads === 1 ? Promise.reject(new Error("nope")) : retryGate;
    };
    let Flaky: LazyPage | undefined;
    const ShellDef = defineComponent({
      events: Schema.Never,
      message: Schema.Union([Schema.TaggedStruct("Toggle", {})]),
      model: Schema.Struct({ show: Schema.Boolean }),
      name: "FlakyShell",
      props: Schema.Struct({}),
    });
    const ui = render(() => {
      Flaky ??= Component.lazy("Flaky", loader);
      // SAFETY: Page is defined by this render; the alias only satisfies the lazy slot type
      const flaky = Flaky as LazyPage;
      const Shell = ShellDef.make({
        init: () => ({ show: true }),
        update: { Toggle: ($) => $.set({ show: !$.model.show }) },
        view: (h, model) => (
          <div>
            <button id="toggle" onclick={h.send({ _tag: "Toggle" })}>
              toggle
            </button>
            {model.show ? <div>{flaky({ fallback })}</div> : <p>hidden</p>}
          </div>
        ),
      });
      return <Shell props={{}} />;
    });
    // No `settled` or `click` while the retry gate is pending: both wait for
    // in-flight loads. Poll and dispatch the raw event instead.
    const toggle = () => {
      ui.query("#toggle")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    };
    await waitFor(() => ui.html().includes("broken"));
    expect(loads).toBe(2);
    toggle();
    await waitFor(() => ui.html().includes("hidden"));
    toggle();
    await waitFor(() => ui.html().includes("waiting"));
    releaseRetry(asTarget(Loaded));
    await flush();
    await ui.settled();
    expect(ui.html()).toContain("loaded!");
    expect(loads).toBe(2);
    ui.unmount();
  });

  it("fails the load when the module holds no callable component", async () => {
    let loads = 0;
    const Bad = Component.lazy("Bad", () => {
      loads += 1;
      return Promise.resolve(asTarget({ nope: true }));
    });
    const ui = render(() => <div>{Bad({ fallback })}</div>);
    // The load fails, retries once on the next render, then stays on the
    // Failure branch: `settled` drains instead of hanging on an endless
    // retry loop.
    await flush();
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html()).toContain("broken");
    expect(loads).toBe(2);
    ui.unmount();
  });

  it("isLazy tells lazy components apart", () => {
    let Page: LazyPage | undefined;
    const ui = render(() => {
      Page ??= Component.lazy("LazyPage", () =>
        Promise.resolve(asTarget(Loaded))
      );
      return <div />;
    });
    // SAFETY: Page is defined by this render; the alias only satisfies the lazy slot type
    const page = Page as LazyPage;
    expect(isLazy(page)).toBe(true);
    expect(Component.isLazy(page)).toBe(true);
    expect(isLazy(Loaded)).toBe(false);
    ui.unmount();
  });

  it("renders loaded content on the server after preload, and the fallback otherwise", async () => {
    const html = await renderHtml(function* html() {
      const Ready = Component.lazy("Ready", () =>
        Promise.resolve(asTarget(Loaded))
      );
      yield* Effect.promise(() => Ready.preload());
      return <>{Ready({ fallback })}</>;
    });
    expect(html).toContain("loaded!");
    // The never-resolving load keeps the server's `ready` pending, so bound
    // the wait: the already-rendered fallback serializes on timeout.
    const serverHtml = await renderHtml(
      () => {
        const Pending = Component.lazy("Pending", () => {
          const { promise } = Promise.withResolvers<Target>();
          return promise;
        });
        return <>{Pending({ fallback })}</>;
      },
      { timeout: 100 }
    );
    expect(serverHtml).toContain("waiting");
  });

  it("shares one module-scope handle across two islands with a single load", async () => {
    const uiA = render(() => <div>{Shared({ fallback })}</div>);
    const uiB = render(() => <div>{Shared({ fallback })}</div>);
    await uiA.settled();
    await uiB.settled();
    await flush();
    await uiA.settled();
    await uiB.settled();
    expect(uiA.html()).toContain("loaded!");
    expect(uiB.html()).toContain("loaded!");
    expect(sharedLoads).toBe(1);
    uiA.unmount();
    uiB.unmount();
  });

  it("renders loaded content on the server without preload", async () => {
    const Late = Component.lazy("Late", async () => {
      // oxlint-disable-next-line typescript/no-invalid-void-type -- gate resolves with no value by design
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 10);
      await promise;
      return asTarget(Loaded);
    });
    const HostDef = defineComponent({
      events: Schema.Never,
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "LateHost",
      props: Schema.Struct({}),
    });
    const Host = HostDef.make({
      init: () => ({}),
      update: ($) => $,
      view: () => <div>{Late({ fallback })}</div>,
    });
    const html = await renderHtml(() => <Host props={{}} />);
    expect(html).toContain("loaded!");
  });

  it("does not retry a permanently failing load forever across call sites", async () => {
    let loads = 0;
    const Failing = Component.lazy("Failing", (): Promise<Target> => {
      loads += 1;
      return Promise.reject(new Error("down"));
    });
    const ChildDef = defineComponent({
      events: Schema.Never,
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "FailChild",
      props: Schema.Struct({}),
    });
    const Child = ChildDef.make({
      init: () => ({}),
      update: ($) => $,
      view: () => <div>{Failing({ fallback })}</div>,
    });
    const ParentDef = defineComponent({
      events: Schema.Never,
      message: Schema.Never,
      model: Schema.Struct({}),
      name: "FailParent",
      props: Schema.Struct({}),
    });
    const Parent = ParentDef.make({
      init: () => ({}),
      update: ($) => $,
      view: () => (
        <main>
          <Child key="a" props={{}} />
          <Child key="b" props={{}} />
        </main>
      ),
    });
    const ui = render(() => <Parent props={{}} />);
    await flush();
    await ui.settled();
    await flush();
    await ui.settled();
    expect(ui.html().match(/broken/gu)?.length).toBe(2);
    expect(loads).toBe(2);
    ui.unmount();
  });
});
