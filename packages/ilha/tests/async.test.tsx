/** @jsxImportSource ../src */
import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { atom, mount } from "../src/index.ts";

test("async setup + atom", async () => {
  const Counter = async () => {
    const count = atom(0);
    return <button onclick={() => count.update((n: number) => n + 1)}>Count: {count}</button>;
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, Counter);
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 0");
  el.querySelector("button")!.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 1");
  unmount();
  el.remove();
});

test("yield Effect.sleep then view", async () => {
  const App = function* () {
    yield Effect.sleep(10);
    yield <p>ready</p>;
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  expect(el.textContent).toBe("");
  await Bun.sleep(20);
  expect(el.textContent).toBe("ready");
  unmount();
  el.remove();
});
