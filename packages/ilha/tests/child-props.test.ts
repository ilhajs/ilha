import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { mount } from "../src/index.ts";
import type { PropBag } from "../src/types.ts";

const Child = (props: PropBag) => ({
  $$ilha: 1 as const,
  children: [String(props.label ?? "")],
  props: { id: "c" },
  type: "span",
});

const App = function* App() {
  yield {
    $$ilha: 1 as const,
    children: [
      {
        $$ilha: 1 as const,
        children: [],
        key: "1",
        props: { label: "a" },
        type: Child,
      },
    ],
    props: {},
    type: "div",
  };
  yield Effect.sleep(40);
  yield {
    $$ilha: 1 as const,
    children: [
      {
        $$ilha: 1 as const,
        children: [],
        key: "1",
        props: { label: "b" },
        type: Child,
      },
    ],
    props: {},
    type: "div",
  };
};

test("keyed sync child props update without new node", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(0);
  const span = el.querySelector("#c");
  expect(span?.textContent).toBe("a");
  await Bun.sleep(60);
  expect(el.querySelector("#c")?.textContent).toBe("b");
  el.remove();
});
