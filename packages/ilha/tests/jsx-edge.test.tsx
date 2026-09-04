// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { mount } from "../src/index.ts";
import type { Component } from "../src/types.ts";

const paint = (App: Component): HTMLElement => {
  const el = document.createElement("div");
  mount(el, App);
  return el;
};

test("skips null undefined boolean children", () => {
  const el = paint(function* el() {
    yield (
      <p>
        {null}
        {undefined}
        {false}
        {true}
        ok
      </p>
    );
  });
  expect(el.textContent).toBe("ok");
});

test("Fragment has no wrapper", () => {
  const el = paint(function* el() {
    yield (
      <>
        <span>a</span>
        <span>b</span>
      </>
    );
  });
  expect(el.children.length).toBe(2);
  expect(el.querySelector("span")?.parentElement).toBe(el);
});

test("array children have no commas", () => {
  const el = paint(function* el() {
    yield <p>{["a", "b", "c"]}</p>;
  });
  expect(el.textContent).toBe("abc");
});

test("className maps to class", () => {
  const el = paint(function* el() {
    yield <p className="hi">x</p>;
  });
  expect(el.querySelector("p")?.getAttribute("class")).toBe("hi");
});

test("htmlFor maps to for", () => {
  const el = paint(function* el() {
    yield <label htmlFor="n">n</label>;
  });
  expect(el.querySelector("label")?.getAttribute("for")).toBe("n");
});

test("boolean true attribute is present", () => {
  const el = paint(function* el() {
    yield <input disabled />;
  });
  expect(el.querySelector("input")?.hasAttribute("disabled")).toBe(true);
});
