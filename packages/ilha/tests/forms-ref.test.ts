import { expect, test } from "bun:test";

import { atom, mount } from "../src/index.ts";

test("checkbox checked={atom}", async () => {
  const App = async () => {
    const on = atom(false);
    return {
      $$ilha: 1 as const,
      type: "input",
      props: {
        type: "checkbox",
        checked: on,
        onclick: () => on.update((v: boolean) => !v),
      },
      children: [],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(10);
  const input = el.querySelector("input") as HTMLInputElement;
  expect(input.checked).toBe(false);
  input.click();
  await Bun.sleep(10);
  expect(input.checked).toBe(true);
  el.remove();
});

test("ref called with element and null on unmount", async () => {
  const seen: unknown[] = [];
  const App = async () => ({
    $$ilha: 1 as const,
    type: "p",
    props: { ref: (n: Element | null) => seen.push(n) },
    children: ["hi"],
  });
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(10);
  expect(seen[0]).toBeInstanceOf(HTMLParagraphElement);
  unmount();
  expect(seen[1]).toBe(null);
  el.remove();
});
