// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { atom, mount } from "../src/index.ts";

const Counter = function* Counter() {
  const count = atom(0);
  yield (
    <button onclick={() => count.update((n: number) => n + 1)}>
      Count: {count}
    </button>
  );
};

test("counter click", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, Counter);
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 0");
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.textContent).toContain("Count: 1");
  unmount();
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.textContent).toBe("");
  el.remove();
});
