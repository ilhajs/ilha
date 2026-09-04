// @jsxImportSource ../src
import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { atom, mount } from "../src/index.ts";

const Counter = () => {
  const count = atom(0);
  return (
    <button onclick={() => count.update((n: number) => n + 1)}>
      Count: {count}
    </button>
  );
};

test("async setup + atom", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, Counter);
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 0");
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 1");
  unmount();
  el.remove();
});

const SleepApp = function* SleepApp() {
  yield Effect.sleep(10);
  yield <p>ready</p>;
};

test("yield Effect.sleep then view", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, SleepApp);
  expect(el.textContent).toBe("");
  await Bun.sleep(20);
  expect(el.textContent).toBe("ready");
  unmount();
  el.remove();
});

const AsyncCounter = async () => {
  const count = atom(0);
  await Promise.resolve();
  // SAFETY: mirrors async page components that build JSX after awaiting.
  return (
    <button onclick={() => count.update((n: number) => n + 1)}>
      Count: {count}
    </button>
  );
};

test("await before return keeps atom reactivity", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, AsyncCounter);
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 0");
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 1");
  unmount();
  el.remove();
});
