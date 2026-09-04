import { expect, test } from "bun:test";

import { atom, mount } from "../src/index.ts";

// Module-level component: exercises fresh atom state per mount.
const CheckboxApp = () => {
  const on = atom(false);
  return {
    $$ilha: 1 as const,
    children: [],
    props: {
      checked: on,
      onclick: () => on.update((v: boolean) => !v),
      type: "checkbox",
    },
    type: "input",
  };
};

test("checkbox checked={atom}", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, CheckboxApp);
  await Bun.sleep(10);
  // SAFETY: the component above renders exactly one input element.
  const input = el.querySelector("input") as HTMLInputElement;
  expect(input.checked).toBe(false);
  input.click();
  await Bun.sleep(10);
  expect(input.checked).toBe(true);
  el.remove();
});

test("ref called with element and null on unmount", async () => {
  const seen: unknown[] = [];
  const App = () => ({
    $$ilha: 1 as const,
    children: ["hi"],
    props: { ref: (n: Element | null) => seen.push(n) },
    type: "p",
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
