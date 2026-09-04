import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";

import { define } from "../src/define.ts";
import { failureMessage } from "../src/errors.ts";
import { atom, h, mount, renderToString } from "../src/index.ts";
import { encodeSnapshot } from "../src/snapshot.ts";
import type { PropBag } from "../src/types.ts";
import "../src/jsx-dev-runtime.ts";

test("generator throw paints error", async () => {
  const el = document.createElement("div");
  mount(
    el,
    // An async setup fn that rejects before painting — the failure path under test.
    async () => {
      await Promise.resolve();
      throw new Error("boom");
    }
  );
  await Bun.sleep(5);
  expect(el.querySelector("[data-ilha-error]")?.textContent).toContain("boom");
});

test("yield Effect.fail paints error", async () => {
  const el = document.createElement("div");
  mount(el, function* appGen() {
    // SAFETY: Effect.fail is yielded as the error-paint path under test.
    yield Effect.fail("nope") as never;
  });
  await Bun.sleep(5);
  expect(el.textContent).toContain("nope");
});

test("yield* Stream.runForEach for finite stream side effects", async () => {
  const seen: number[] = [];
  const el = document.createElement("div");
  mount(el, function* appGen() {
    yield* Stream.runForEach(Stream.fromIterable([1, 2]), (n) =>
      Effect.sync(() => seen.push(n))
    );
    yield "ok";
  });
  await Bun.sleep(10);
  expect(seen).toEqual([1, 2]);
  expect(el.textContent).toBe("ok");
});

test("stream view paints", async () => {
  const el = document.createElement("div");
  mount(el, function* appGen() {
    yield Stream.fromIterable(["s1"]);
  });
  await Bun.sleep(10);
  expect(el.textContent).toContain("s1");
});

test("renderToString waits for stream view", async () => {
  const html = await renderToString(() => Stream.fromIterable(["hello"]));
  expect(html).toContain("hello");
});

test("ilha.island brand mounts via internal hook", async () => {
  const ISLAND = Symbol.for("ilha.island");
  const MOUNT = Symbol.for("ilha.islandMountInternal");
  const TAG = Symbol.for("ilha.islandSlotTag");
  const Proxy = Object.assign(() => "", {
    [ISLAND]: true,
    [TAG]: "section",
    [MOUNT]: (host: Element) => {
      host.textContent = "framed";
      return { unmount() {} };
    },
  });
  const el = document.createElement("div");
  // SAFETY: Proxy carries the island brand symbols for the mount hook.
  mount(el, () => h(Proxy as never, null));
  await Bun.sleep(5);
  expect(el.querySelector("section")?.textContent).toBe("framed");
});

test("stream view error paints", async () => {
  const el = document.createElement("div");
  mount(el, function* appGen() {
    // SAFETY: Stream.fail is the stream error-paint path under test.
    yield Stream.fail("bad") as never;
  });
  await Bun.sleep(10);
  expect(el.textContent).toContain("bad");
});

test("keyed atom list reuses and drops", async () => {
  const el = document.createElement("div");
  mount(el, function* appGen() {
    const items = atom([
      h("li", { key: "a" }, "a"),
      h("li", { key: "b" }, "b"),
    ]);
    yield h("ul", null, items);
    yield Effect.sleep(15);
    items.set([h("li", { key: "b" }, "b"), h("li", { key: "c" }, "c")]);
  });
  await Bun.sleep(5);
  expect(el.textContent).toContain("ab");
  await Bun.sleep(40);
  expect(el.textContent).toContain("bc");
  expect(el.textContent).not.toContain("a");
});

const Item = (p: PropBag) => h("li", null, String(p.label ?? ""));

test("keyed function children reuse holes", async () => {
  const el = document.createElement("div");
  mount(el, function* appGen() {
    const items = atom([
      h(Item, { key: "a", label: "a" }),
      h(Item, { key: "b", label: "b" }),
    ]);
    yield h("ul", null, items);
    yield Effect.sleep(15);
    items.set([
      h(Item, { key: "b", label: "B" }),
      h(Item, { key: "a", label: "A" }),
    ]);
  });
  await Bun.sleep(5);
  expect(el.querySelectorAll("li").length).toBe(2);
  await Bun.sleep(40);
  expect(el.querySelectorAll("li").length).toBe(2);
});

interface SaveBox {
  set?: (n: never) => void;
}

test("Atom.fn waiting keeps previous view", async () => {
  const box: SaveBox = {};
  const el = document.createElement("div");
  mount(el, () => {
    const save = atom(Atom.fn(() => Effect.sleep(20).pipe(Effect.as("done"))));
    box.set = (n) => save.set(n);
    return h("p", null, save);
  });
  await Bun.sleep(5);
  // SAFETY: Atom.fn with no args uses a void-like seed for set().
  box.set?.(undefined as never);
  await Bun.sleep(40);
  expect(el.textContent).toContain("done");
  // SAFETY: Atom.fn with no args uses a void-like seed for set().
  box.set?.(undefined as never);
  await Bun.sleep(5);
  expect(el.textContent).toContain("done");
});

test("selected true on option", () => {
  const el = document.createElement("div");
  mount(el, function* appGen() {
    yield h("select", null, h("option", { selected: true }, "x"));
  });
  const option = el.querySelector("option");
  // SAFETY: querySelector('option') returns an HTMLOptionElement when present.
  expect((option as HTMLOptionElement).selected).toBe(true);
});

test("selected={atom} on option", async () => {
  const el = document.createElement("div");
  mount(el, () => {
    const on = atom(true);
    return h("select", null, h("option", { selected: on }, "x"));
  });
  await Bun.sleep(10);
  const option = el.querySelector("option");
  // SAFETY: querySelector('option') returns an HTMLOptionElement when present.
  expect((option as HTMLOptionElement).selected).toBe(true);
});

test("hydrate empty host full mounts", async () => {
  const el = document.createElement("div");
  mount(
    el,
    function* appGen() {
      yield h("p", null, "x");
    },
    { hydrate: true }
  );
  await Bun.sleep(5);
  expect(el.textContent).toContain("x");
});

const HydrateApp = () => {
  const n = atom(0);
  return h("p", null, n);
};

test("hydrate from state template", async () => {
  const el = document.createElement("div");
  const tpl = document.createElement("template");
  tpl.dataset.ilhaState = encodeSnapshot([4]);
  el.append(tpl, document.createElement("p"));
  document.body.append(el);
  mount(el, HydrateApp, { hydrate: true });
  await Bun.sleep(15);
  expect(el.textContent).toContain("4");
  el.remove();
});

const NestedHydrateApp = () => {
  const n = atom(0);
  return h("p", null, n);
};

test("hydrate ignores nested template state snapshots", async () => {
  const el = document.createElement("div");
  const inner = document.createElement("div");
  const nested = document.createElement("template");
  nested.dataset.ilhaState = encodeSnapshot([99]);
  inner.append(nested);
  el.append(inner, document.createElement("p"));
  document.body.append(el);
  mount(el, NestedHydrateApp, { hydrate: true });
  await Bun.sleep(15);
  expect(el.textContent).toContain("0");
  expect(el.textContent).not.toContain("99");
  el.remove();
});

test("markers off snapshot uses escaped template state", async () => {
  const html = await renderToString(
    () => {
      const n = atom(2);
      return h("p", null, n);
    },
    { markers: false }
  );
  expect(html.startsWith('<template data-ilha-state="')).toBe(true);
  expect(html).toContain("&quot;v&quot;:[2]");
  expect(html).not.toContain("<!--ilha-state:");
});

test("bigint and iterable children", () => {
  const el = document.createElement("div");
  mount(el, function* appGen() {
    yield h("p", null, 1n, {
      *[Symbol.iterator]() {
        yield "z";
      },
    });
  });
  expect(el.textContent).toContain("1");
  expect(el.textContent).toContain("z");
});

test("style string and empty async setup", async () => {
  const el = document.createElement("div");
  mount(el, function* appGen() {
    yield h("p", { style: "color:red" }, "x");
  });
  expect(el.querySelector("p")?.getAttribute("style")).toContain("color");
  const el2 = document.createElement("div");
  mount(el2, async () => {});
  await Bun.sleep(5);
  expect(el2.innerHTML).toBe("");
});

test("asFailure Result and non-Error", () => {
  expect(failureMessage(Result.fail("x"))).toBe("x");
  expect(failureMessage(12)).toBe("12");
});

test("define hydrate then disconnect", async () => {
  define("ilha-h", () => h("span", null, "h"));
  const el = document.createElement("ilha-h");
  el.dataset.ilha = "";
  document.body.append(el);
  await Bun.sleep(20);
  expect(el.textContent).toContain("h");
  el.remove();
});
