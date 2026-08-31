import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";

import { define } from "../src/define.ts";
import { failureMessage } from "../src/errors.ts";
import { atom, h, mount, renderToString, watch } from "../src/index.ts";
import { encodeSnapshot, STATE_COMMENT } from "../src/snapshot.ts";
import "../src/jsx-dev-runtime.ts";

test("generator throw paints error", async () => {
  const el = document.createElement("div");
  mount(
    el,
    // SAFETY: throw before the first yield is the behavior under test.
    // oxlint-disable-next-line require-yield
    function* () {
      throw new Error("boom");
    },
  );
  await Bun.sleep(5);
  expect(el.querySelector("[data-ilha-error]")?.textContent).toContain("boom");
});

test("yield Effect.fail paints error", async () => {
  const el = document.createElement("div");
  mount(el, function* () {
    yield Effect.fail("nope") as never;
  });
  await Bun.sleep(5);
  expect(el.textContent).toContain("nope");
});

test("watch stream and Atom", async () => {
  const seen: number[] = [];
  const el = document.createElement("div");
  mount(el, function* () {
    yield* watch(Stream.fromIterable([1, 2]), (n) => seen.push(n as number));
    const a = Atom.make(3);
    yield* watch(a, (n) => seen.push(n));
    yield "ok";
  });
  await Bun.sleep(10);
  expect(seen).toContain(1);
  expect(seen).toContain(3);
  expect(el.textContent).toBe("ok");
});

test("stream view paints", async () => {
  const el = document.createElement("div");
  mount(el, function* () {
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
  mount(el, () => h(Proxy as never, null));
  await Bun.sleep(5);
  expect(el.querySelector("section")?.textContent).toBe("framed");
});

test("stream view error paints", async () => {
  const el = document.createElement("div");
  mount(el, function* () {
    yield Stream.fail("bad") as never;
  });
  await Bun.sleep(10);
  expect(el.textContent).toContain("bad");
});

test("keyed atom list reuses and drops", async () => {
  const el = document.createElement("div");
  mount(el, function* () {
    const items = atom([h("li", { key: "a" }, "a"), h("li", { key: "b" }, "b")]);
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

test("keyed function children reuse holes", async () => {
  const Item = (p: Record<string, unknown>) => h("li", null, String(p.label ?? ""));
  const el = document.createElement("div");
  mount(el, function* () {
    const items = atom([h(Item, { key: "a", label: "a" }), h(Item, { key: "b", label: "b" })]);
    yield h("ul", null, items);
    yield Effect.sleep(15);
    items.set([h(Item, { key: "b", label: "B" }), h(Item, { key: "a", label: "A" })]);
  });
  await Bun.sleep(5);
  expect(el.querySelectorAll("li").length).toBe(2);
  await Bun.sleep(40);
  expect(el.querySelectorAll("li").length).toBe(2);
});

test("Atom.fn waiting keeps previous view", async () => {
  const box: { set?: (n: never) => void } = {};
  const el = document.createElement("div");
  mount(el, async () => {
    const save = atom(Atom.fn(() => Effect.sleep(20).pipe(Effect.as("done"))));
    box.set = (n) => save.set(n);
    return h("p", null, save);
  });
  await Bun.sleep(5);
  box.set?.(undefined as never);
  await Bun.sleep(40);
  expect(el.textContent).toContain("done");
  box.set?.(undefined as never);
  await Bun.sleep(5);
  expect(el.textContent).toContain("done");
});

test("selected true on option", () => {
  const el = document.createElement("div");
  mount(el, function* () {
    yield h("select", null, h("option", { selected: true }, "x"));
  });
  expect((el.querySelector("option") as HTMLOptionElement).selected).toBe(true);
});

test("selected={atom} on option", async () => {
  const el = document.createElement("div");
  mount(el, async () => {
    const on = atom(true);
    return h("select", null, h("option", { selected: on }, "x"));
  });
  await Bun.sleep(10);
  expect((el.querySelector("option") as HTMLOptionElement).selected).toBe(true);
});

test("hydrate empty host full mounts", async () => {
  const el = document.createElement("div");
  mount(
    el,
    function* () {
      yield h("p", null, "x");
    },
    { hydrate: true },
  );
  await Bun.sleep(5);
  expect(el.textContent).toContain("x");
});

test("hydrate from state comment", async () => {
  const App = async () => {
    const n = atom(0);
    return h("p", null, n);
  };
  const el = document.createElement("div");
  el.append(
    document.createComment(`${STATE_COMMENT}${encodeSnapshot([4])}`),
    document.createElement("p"),
  );
  document.body.append(el);
  mount(el, App, { hydrate: true });
  await Bun.sleep(15);
  expect(el.textContent).toContain("4");
  el.remove();
});

test("markers off snapshot on uses comment", async () => {
  const html = await renderToString(
    async () => {
      const n = atom(2);
      return h("p", null, n);
    },
    { markers: false },
  );
  expect(html.startsWith(`<!--${STATE_COMMENT}`)).toBe(true);
  expect(html).toContain('"v":[2]');
});

test("bigint and iterable children", () => {
  const el = document.createElement("div");
  mount(el, function* () {
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
  mount(el, function* () {
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
  define("ilha-h", async () => h("span", null, "h"));
  const el = document.createElement("ilha-h");
  el.setAttribute("data-ilha", "");
  document.body.append(el);
  await Bun.sleep(20);
  expect(el.textContent).toContain("h");
  el.remove();
});
