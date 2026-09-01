import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { mount } from "../src/index.ts";

test("re-yield same tag morphs in place", async () => {
  const App = function* () {
    yield {
      $$ilha: 1 as const,
      type: "p",
      props: { id: "x", className: "a" },
      children: ["hi"],
    };
    yield Effect.sleep(40);
    yield {
      $$ilha: 1 as const,
      type: "p",
      props: { id: "x", className: "b" },
      children: ["hi"],
    };
  };
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
