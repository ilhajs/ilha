import { expect, test } from "bun:test";

import { mount } from "../src/index.ts";
import { h } from "../src/vnode.ts";

test("paints tags and text", () => {
  const App = function* () {
    yield h("p", { className: "hi" }, "hello");
  };
  const el = document.createElement("div");
  mount(el, App);
  expect(el.querySelector("p")?.className).toBe("hi");
  expect(el.textContent).toBe("hello");
});
