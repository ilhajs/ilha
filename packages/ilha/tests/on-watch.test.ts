import { expect, test } from "bun:test";

import { atom, mount, watch } from "../src/index.ts";

test("watch(atom, fn) runs without painting", async () => {
  const seen: string[] = [];
  const App = function* App() {
    const title = atom("a");
    yield* watch(title, (t) => {
      seen.push(String(t));
    });
    yield {
      $$ilha: 1 as const,
      children: ["go"],
      props: { id: "go", onclick: () => title.set("b") },
      type: "button",
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(seen).toEqual(["a"]);
  expect(el.textContent).toBe("go");
  el.querySelector("#go")?.dispatchEvent(new Event("click"));
  await Bun.sleep(5);
  expect(seen).toEqual(["a", "b"]);
  unmount();
  el.querySelector("#go")?.dispatchEvent(new Event("click"));
  await Bun.sleep(5);
  expect(seen).toEqual(["a", "b"]);
  el.remove();
});

test("watch in sync component", async () => {
  const seen: string[] = [];
  const App = () => {
    const title = atom("a");
    watch(title, (t) => {
      seen.push(String(t));
    });
    return {
      $$ilha: 1 as const,
      children: ["go"],
      props: { id: "go", onclick: () => title.set("b") },
      type: "button",
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(seen).toEqual(["a"]);
  el.querySelector("#go")?.dispatchEvent(new Event("click"));
  await Bun.sleep(5);
  expect(seen).toEqual(["a", "b"]);
  unmount();
  el.remove();
});

const Other = () => {
  atom(0);
  return "x";
};

test("watch.once runs once and cleans up on unmount", async () => {
  let mounts = 0;
  let cleanups = 0;
  const App = () => {
    const n = atom(0);
    watch.once(() => {
      mounts += 1;
      return () => {
        cleanups += 1;
      };
    });
    return {
      $$ilha: 1 as const,
      children: [String(n())],
      props: { id: "go", onclick: () => n.update((c) => c + 1) },
      type: "button",
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(mounts).toBe(1);
  expect(cleanups).toBe(0);
  el.querySelector("#go")?.dispatchEvent(new Event("click"));
  await Bun.sleep(5);
  expect(mounts).toBe(1);
  expect(el.textContent).toBe("1");
  unmount();
  expect(cleanups).toBe(1);
  el.remove();
});

test("watch.once in a generator component", async () => {
  let mounts = 0;
  const App = function* App() {
    yield* watch.once(() => {
      mounts += 1;
    });
    yield "ok";
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(mounts).toBe(1);
  expect(el.textContent).toBe("ok");
  unmount();
  el.remove();
});

test("watch after atom with a sibling mount", async () => {
  const seen: string[] = [];
  const App = () => {
    const title = atom("a");
    watch(title, (t) => {
      seen.push(String(t));
    });
    return {
      $$ilha: 1 as const,
      children: ["go"],
      props: { id: "go", onclick: () => title.set("b") },
      type: "button",
    };
  };
  const a = document.createElement("div");
  const b = document.createElement("div");
  document.body.append(a, b);
  mount(a, Other);
  mount(b, App);
  await Bun.sleep(10);
  expect(seen).toEqual(["a"]);
  b.querySelector("#go")?.dispatchEvent(new Event("click"));
  await Bun.sleep(5);
  expect(seen).toEqual(["a", "b"]);
  a.remove();
  b.remove();
});
