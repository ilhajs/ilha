import { expect, test } from "bun:test";

import * as Atom from "effect/unstable/reactivity/Atom";

import { atom, mount } from "../src/index.ts";
import type { PropBag } from "../src/types.ts";

const mapAtom = Atom.map;

test("atom outside island throws", () => {
  expect(() => {
    void atom(0);
  }).toThrow(/no fiber/u);
});

test("atom handle from another island throws when a different island is active", async () => {
  let foreign: (() => number) | undefined;

  const A = () => {
    const n = atom(0);
    foreign = n;
    return { $$ilha: 1 as const, children: [n], props: {}, type: "span" };
  };
  const B = () => {
    atom(1);
    if (!foreign) {
      throw new Error("foreign missing");
    }
    expect(() => foreign()).toThrow(/different island/u);
    return { $$ilha: 1 as const, children: ["b"], props: {}, type: "span" };
  };

  const root = document.createElement("div");
  document.body.append(root);
  const aHost = document.createElement("div");
  const bHost = document.createElement("div");
  root.append(aHost, bHost);
  mount(aHost, A);
  await Bun.sleep(5);
  mount(bHost, B);
  await Bun.sleep(5);
  root.remove();
});

const Counter = function* Counter() {
  const count = atom(0);
  yield {
    $$ilha: 1 as const,
    children: ["Count: ", count],
    props: {
      onclick: () => count.update((n: number) => n + 1),
    },
    type: "button",
  };
};

test("atom hole updates text without second root yield", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, Counter);
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 0");
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 1");
  unmount();
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.textContent).toBe("");
  el.remove();
});

const MapApp = function* MapApp() {
  const items = atom([{ done: true }, { done: false }]);
  const pending = atom(
    mapAtom(items.atom, (list) => list.filter((item) => !item.done).length)
  );
  yield {
    $$ilha: 1 as const,
    children: ["Pending: ", pending],
    props: {
      onclick: () =>
        items.update((list) => list.map((item) => ({ ...item, done: true }))),
    },
    type: "button",
  };
};

test("Atom.map tracks source atoms", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, MapApp);
  await Bun.sleep(5);
  expect(el.textContent).toContain("Pending: 1");
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("Pending: 0");
  unmount();
  el.remove();
});

const SyncMapApp = () => {
  const items = atom(["a"]);
  const n = atom(mapAtom(items.atom, (list) => list.length));
  return {
    $$ilha: 1 as const,
    children: ["n=", n],
    props: {
      onclick: () => items.update((list) => [...list, "b"]),
    },
    type: "button",
  };
};

test("Atom.map inside sync setup updates", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, SyncMapApp);
  await Bun.sleep(5);
  expect(el.textContent).toContain("n=1");
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("n=2");
  el.remove();
});

const Badge = (props: PropBag) => ({
  $$ilha: 1 as const,
  // SAFETY: children is passed through as the badge's painted content.
  children: [props.children as never],
  props: {},
  type: "span",
});

const ChildMapApp = () => {
  const items = atom(["a"]);
  const n = atom(mapAtom(items.atom, (list) => list.length));
  return {
    $$ilha: 1 as const,
    children: [
      { $$ilha: 1 as const, children: [n], props: {}, type: Badge },
      {
        $$ilha: 1 as const,
        children: ["+"],
        props: { onclick: () => items.update((list) => [...list, "b"]) },
        type: "button",
      },
    ],
    props: {},
    type: "div",
  };
};

test("Atom.map inside function child updates", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, ChildMapApp);
  await Bun.sleep(10);
  expect(el.textContent).toContain("1");
  el.querySelector("button")?.click();
  await Bun.sleep(10);
  expect(el.textContent).toContain("2");
  el.remove();
});

const ValueApp = function* ValueApp() {
  const q = atom("x");
  yield {
    $$ilha: 1 as const,
    children: [],
    props: {
      oninput: (e: Event) => {
        const target = e.currentTarget;
        // SAFETY: oninput is bound to the painted input element.
        q.set((target as HTMLInputElement).value);
      },
      value: q,
    },
    type: "input",
  };
};

test("value={atom} tracks the atom", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, ValueApp);
  await Bun.sleep(5);
  const input = el.querySelector("input");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("input missing");
  }
  expect(input.value).toBe("x");
  input.value = "yz";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await Bun.sleep(5);
  expect(input.value).toBe("yz");
  el.remove();
});

const ReadApp = () => {
  const items = atom(["a", "b", "c"]);
  return {
    $$ilha: 1 as const,
    children: [
      ...items().map((x) => ({
        $$ilha: 1 as const,
        children: [x],
        props: { "data-item": x },
        type: "span",
      })),
      {
        $$ilha: 1 as const,
        children: ["pop"],
        props: {
          onclick: () => items.update((list) => list.slice(1)),
        },
        type: "button",
      },
    ],
    props: {},
    type: "div",
  };
};

test("atom reads during sync setup rerun the component", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ReadApp);
  await Bun.sleep(5);
  expect(el.querySelectorAll("[data-item]").length).toBe(3);
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.querySelectorAll("[data-item]").length).toBe(2);
  expect(el.textContent).not.toContain("a");
  unmount();
  el.remove();
});

const SlotApp = () => {
  const list = atom([1, 2]);
  const total = atom(0);
  return {
    $$ilha: 1 as const,
    children: [
      {
        $$ilha: 1 as const,
        children: [],
        props: { "data-total": total() },
        type: "span",
      },
      {
        $$ilha: 1 as const,
        children: [],
        props: { "data-count": list().length },
        type: "span",
      },
      {
        $$ilha: 1 as const,
        children: ["go"],
        props: {
          onclick: () => {
            total.update((n) => n + 1);
            list.update((xs) => xs.slice(0, -1));
          },
        },
        type: "button",
      },
    ],
    props: {},
    type: "div",
  };
};

test("primitive slots persist across render reruns", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, SlotApp);
  await Bun.sleep(5);
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.querySelector("[data-total]")?.dataset.total).toBe("1");
  expect(el.querySelector("[data-count]")?.dataset.count).toBe("1");
  unmount();
  el.remove();
});

const AsyncMapApp = async () => {
  const items = atom(["a", "b", "c"]);
  const count = atom(mapAtom(items.atom, (list) => String(list.length)));
  await Bun.sleep(5);
  return {
    $$ilha: 1 as const,
    children: [count],
    props: {
      onclick: () => items.update((list) => list.slice(1)),
    },
    type: "button",
  };
};

test("async setup updates jsx atom children after await", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, AsyncMapApp);
  await Bun.sleep(15);
  expect(el.textContent).toContain("3");
  el.querySelector("button")?.click();
  await Bun.sleep(15);
  expect(el.textContent).toContain("2");
  unmount();
  el.remove();
});

test("atom.lazy runs initializer once", async () => {
  let runs = 0;
  const App = () => {
    const n = atom.lazy(() => {
      runs += 1;
      return runs;
    });
    return {
      $$ilha: 1 as const,
      children: [String(n())],
      props: {
        onclick: () => n.set(n() + 1),
      },
      type: "button",
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(runs).toBe(1);
  expect(el.textContent).toContain("1");
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  unmount();
  el.remove();
});

test("overlapping async setups track reads after await per fiber", async () => {
  const aEl = document.createElement("div");
  const bEl = document.createElement("div");
  document.body.append(aEl, bEl);

  const gateA = Promise.withResolvers<true>();
  const gateB = Promise.withResolvers<true>();

  const A = async () => {
    const n = atom(0);
    await gateA.promise;
    return {
      $$ilha: 1 as const,
      children: [n],
      props: { onclick: () => n.update((x: number) => x + 1) },
      type: "button",
    };
  };
  const B = async () => {
    const n = atom(0);
    await gateB.promise;
    return {
      $$ilha: 1 as const,
      children: [n],
      props: { onclick: () => n.update((x: number) => x + 10) },
      type: "button",
    };
  };

  const unmountA = mount(aEl, A);
  const unmountB = mount(bEl, B);
  gateB.resolve(true);
  await Bun.sleep(15);
  expect(bEl.textContent).toBe("0");
  bEl.querySelector("button")?.click();
  await Bun.sleep(10);
  expect(bEl.textContent).toBe("10");

  gateA.resolve(true);
  await Bun.sleep(15);
  expect(aEl.textContent).toBe("0");
  aEl.querySelector("button")?.click();
  await Bun.sleep(10);
  expect(aEl.textContent).toBe("1");

  unmountA();
  unmountB();
  aEl.remove();
  bEl.remove();
});

const SyncC = () => {
  const count = atom(0);
  return {
    $$ilha: 1 as const,
    children: [String(count())],
    props: {
      id: "c",
      onclick: () => count.update((n: number) => n + 1),
    },
    type: "button",
  };
};

test("sync reads while async setups are suspended do not leak trackGet", async () => {
  const gateA = Promise.withResolvers<true>();
  const gateB = Promise.withResolvers<true>();

  const aEl = document.createElement("div");
  const bEl = document.createElement("div");
  const cEl = document.createElement("div");
  document.body.append(aEl, bEl, cEl);

  const A = async () => {
    const n = atom(0);
    await gateA.promise;
    return {
      $$ilha: 1 as const,
      children: [n],
      props: { id: "a" },
      type: "p",
    };
  };
  const B = async () => {
    const n = atom(0);
    await gateB.promise;
    return {
      $$ilha: 1 as const,
      children: [n],
      props: { id: "b" },
      type: "p",
    };
  };

  mount(aEl, A);
  mount(bEl, B);
  const unmountC = mount(cEl, SyncC);
  await Bun.sleep(5);

  const cBtn = cEl.querySelector("#c");
  if (!(cBtn instanceof HTMLButtonElement)) {
    throw new Error("#c missing");
  }
  cBtn.click();
  await Bun.sleep(10);
  expect(cEl.textContent).toBe("1");

  gateA.resolve(true);
  await Bun.sleep(15);
  expect(aEl.textContent).toBe("0");

  gateB.resolve(true);
  await Bun.sleep(15);
  expect(bEl.textContent).toBe("0");

  cBtn.click();
  await Bun.sleep(10);
  expect(cEl.textContent).toBe("2");

  unmountC();
  aEl.remove();
  bEl.remove();
  cEl.remove();
});
