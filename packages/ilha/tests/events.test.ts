import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { atom, mount } from "../src/index.ts";

test("event Effect is interrupted on unmount", async () => {
  let ran = false;
  const App = function* () {
    yield {
      $$ilha: 1 as const,
      type: "button",
      props: {
        onclick: () =>
          Effect.sleep(40).pipe(
            Effect.tap(
              Effect.sync(() => {
                ran = true;
              }),
            ),
          ),
      },
      children: ["go"],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  el.querySelector("button")!.click();
  unmount();
  await Bun.sleep(60);
  expect(ran).toBe(false);
  el.remove();
});

test("click after unmount is a no-op", async () => {
  const App = function* () {
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
  const unmount = mount(el, App);
  await Bun.sleep(5);
  const btn = el.querySelector("button")!;
  btn.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 1");
  unmount();
  btn.click();
  await Bun.sleep(5);
  expect(el.textContent).toBe("");
  el.remove();
});

test("multiple events on one element", async () => {
  const seen: string[] = [];
  const App = function* () {
    yield {
      $$ilha: 1 as const,
      type: "input",
      props: {
        onfocus: () => seen.push("focus"),
        oninput: () => seen.push("input"),
      },
      children: [],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  const input = el.querySelector("input")!;
  input.dispatchEvent(new Event("focus"));
  input.dispatchEvent(new Event("input"));
  expect(seen).toEqual(["focus", "input"]);
  el.remove();
});
