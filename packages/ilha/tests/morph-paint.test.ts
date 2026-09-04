import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { mount } from "../src/index.ts";

const App = function* App() {
  yield {
    $$ilha: 1 as const,
    children: ["hi"],
    props: { className: "a", id: "x" },
    type: "p",
  };
  yield Effect.sleep(40);
  yield {
    $$ilha: 1 as const,
    children: ["hi"],
    props: { className: "b", id: "x" },
    type: "p",
  };
};

test("re-yield same tag morphs in place", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(0);
  const p = el.querySelector("#x");
  expect(p?.className).toBe("a");
  await Bun.sleep(60);
  expect(el.querySelector("#x")).toBe(p);
  expect(p?.className).toBe("b");
  el.remove();
});
