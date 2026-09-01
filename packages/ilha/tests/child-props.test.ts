import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { mount } from "../src/index.ts";

const Child = (props: Record<string, unknown>) => ({
  $$ilha: 1 as const,
  type: "span",
  props: { id: "c" },
  children: [String(props.label ?? "")],
});

test("keyed sync child props update without new node", async () => {
  const App = function* () {
    yield {
      $$ilha: 1 as const,
      type: "div",
      props: {},
      children: [
        {
          $$ilha: 1 as const,
          type: Child,
          props: { label: "a" },
          children: [],
          key: "1",
        },
      ],
    };
    yield Effect.sleep(40);
    yield {
      $$ilha: 1 as const,
      type: "div",
      props: {},
      children: [
        {
          $$ilha: 1 as const,
          type: Child,
          props: { label: "b" },
          children: [],
          key: "1",
        },
      ],
    };
  };
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
