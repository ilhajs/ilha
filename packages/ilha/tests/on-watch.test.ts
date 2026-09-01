import { expect, test } from "bun:test";

import { atom, mount, watch } from "../src/index.ts";

test("watch(atom, fn) runs without painting", async () => {
  const seen: string[] = [];
  const App = function* () {
    const title = atom("a");
    yield* watch(title, (t) => {
      seen.push(String(t));
    });
    yield {
      $$ilha: 1 as const,
      type: "button",
      props: { id: "go", onclick: () => title.set("b") },
      children: ["go"],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(seen).toEqual(["a"]);
  expect(el.textContent).toBe("go");
  el.querySelector("#go")!.dispatchEvent(new Event("click"));
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
      type: "button",
      props: { id: "go", onclick: () => title.set("b") },
      children: ["go"],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(seen).toEqual(["a"]);
  el.querySelector("#go")!.dispatchEvent(new Event("click"));
  await Bun.sleep(5);
  expect(seen).toEqual(["a", "b"]);
  unmount();
  el.remove();
});

test("watch after atom with a sibling mount", async () => {
  const seen: string[] = [];
  const Other = async () => {
    atom(0);
    return "x";
  };
  const App = async () => {
    const title = atom("a");
    watch(title, (t) => {
      seen.push(String(t));
    });
    return {
      $$ilha: 1 as const,
      type: "button",
      props: { id: "go", onclick: () => title.set("b") },
      children: ["go"],
    };
  };
  const a = document.createElement("div");
  const b = document.createElement("div");
  document.body.append(a, b);
  mount(a, Other);
  mount(b, App);
  await Bun.sleep(10);
  expect(seen).toEqual(["a"]);
  b.querySelector("#go")!.dispatchEvent(new Event("click"));
  await Bun.sleep(5);
  expect(seen).toEqual(["a", "b"]);
  a.remove();
  b.remove();
});
