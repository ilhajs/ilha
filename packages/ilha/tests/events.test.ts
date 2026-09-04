import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { atom, mount } from "../src/index.ts";

test("event Effect is interrupted on unmount", async () => {
  let ran = false;
  const App = function* App() {
    yield {
      $$ilha: 1 as const,
      children: ["go"],
      props: {
        onclick: () =>
          Effect.sleep(40).pipe(
            Effect.tap(
              Effect.sync(() => {
                ran = true;
              })
            )
          ),
      },
      type: "button",
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  el.querySelector("button")?.click();
  unmount();
  await Bun.sleep(60);
  expect(ran).toBe(false);
  el.remove();
});

const ClickApp = function* ClickApp() {
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

test("click after unmount is a no-op", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ClickApp);
  await Bun.sleep(5);
  const btn = el.querySelector("button");
  if (!btn) {
    throw new Error("button missing");
  }
  btn.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 1");
  unmount();
  btn.click();
  await Bun.sleep(5);
  expect(el.textContent).toBe("");
  el.remove();
});

test("multiple events on one element", () => {
  const seen: string[] = [];
  const App = function* App() {
    yield {
      $$ilha: 1 as const,
      children: [],
      props: {
        onfocus: () => seen.push("focus"),
        oninput: () => seen.push("input"),
      },
      type: "input",
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  const input = el.querySelector("input");
  if (!input) {
    throw new Error("input missing");
  }
  input.dispatchEvent(new Event("focus"));
  input.dispatchEvent(new Event("input"));
  expect(seen).toEqual(["focus", "input"]);
  el.remove();
});
