import { expect, test } from "bun:test";

import { mount } from "../src/index.ts";
import { h } from "../src/vnode.ts";

const App = function* App() {
  yield h("p", { className: "hi" }, "hello");
};

test("paints tags and text", () => {
  const el = document.createElement("div");
  mount(el, App);
  expect(el.querySelector("p")?.className).toBe("hi");
  expect(el.textContent).toBe("hello");
});
