import { expect, test } from "bun:test";

import { atom, mount } from "../src/index.ts";

test("atom outside island throws", () => {
  expect(() => {
    void atom(0);
  }).toThrow(/no fiber/);
});

test("atom handle from another island throws when a different island is active", async () => {
  let foreign: (() => number) | undefined;

  const A = () => {
    const n = atom(0);
    foreign = n;
    return { $$ilha: 1 as const, type: "span", props: {}, children: [n] };
  };
  const B = () => {
    atom(1);
    expect(() => foreign!()).toThrow(/different island/);
    return { $$ilha: 1 as const, type: "span", props: {}, children: ["b"] };
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

test("atom hole updates text without second root yield", async () => {
  const Counter = function* () {
    const count = atom(0);
    yield {
      $$ilha: 1 as const,
      type: "button",
      props: {
        onclick: () => count.update((n: number) => n + 1),
      },
      children: ["Count: ", count],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, Counter);
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 0");
  el.querySelector("button")!.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 1");
  unmount();
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.textContent).toBe("");
  el.remove();
});

test("atom(() => ...) tracks source atoms", async () => {
  const App = function* () {
    const items = atom([{ done: true }, { done: false }]);
    const pending = atom(() => items().filter((item) => !item.done).length);
    yield {
      $$ilha: 1 as const,
      type: "button",
      props: {
        onclick: () => items.update((list) => list.map((item) => ({ ...item, done: true }))),
      },
      children: ["Pending: ", pending],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(el.textContent).toContain("Pending: 1");
  el.querySelector("button")!.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("Pending: 0");
  unmount();
  el.remove();
});

test("computed atom inside sync setup updates", async () => {
  const App = () => {
    const items = atom(["a"]);
    const n = atom(() => items().length);
    return {
      $$ilha: 1 as const,
      type: "button",
      props: {
        onclick: () => items.update((list) => [...list, "b"]),
      },
      children: ["n=", n],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(5);
  expect(el.textContent).toContain("n=1");
  el.querySelector("button")!.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("n=2");
  el.remove();
});

test("computed atom inside function child updates", async () => {
  const Badge = (props: Record<string, unknown>) => ({
    $$ilha: 1 as const,
    type: "span",
    props: {},
    children: [props.children as never],
  });
  const App = () => {
    const items = atom(["a"]);
    const n = atom(() => items().length);
    return {
      $$ilha: 1 as const,
      type: "div",
      props: {},
      children: [
        { $$ilha: 1 as const, type: Badge, props: {}, children: [n] },
        {
          $$ilha: 1 as const,
          type: "button",
          props: { onclick: () => items.update((list) => [...list, "b"]) },
          children: ["+"],
        },
      ],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(10);
  expect(el.textContent).toContain("1");
  el.querySelector("button")!.click();
  await Bun.sleep(10);
  expect(el.textContent).toContain("2");
  el.remove();
});

test("value={atom} tracks the atom", async () => {
  const App = function* () {
    const q = atom("x");
    yield {
      $$ilha: 1 as const,
      type: "input",
      props: {
        value: q,
        oninput: (e: Event) => q.set((e.currentTarget as HTMLInputElement).value),
      },
      children: [],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(5);
  const input = el.querySelector("input")!;
  expect(input.value).toBe("x");
  input.value = "yz";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await Bun.sleep(5);
  expect(input.value).toBe("yz");
  el.remove();
});
