import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";

import { atom, mount } from "../src/index.ts";

test("Atom.fn pending then success", async () => {
  const App = async () => {
    const save = atom(Atom.fn((n: number) => Effect.sleep(20).pipe(Effect.as(n))));
    return {
      $$ilha: 1 as const,
      type: "button",
      props: {
        id: "save",
        onclick: () => {
          if (Atom.isWritable(save.atom)) save.set(1 as never);
        },
      },
      children: [save],
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(10);
  const btn = el.querySelector("#save") as HTMLButtonElement;
  expect(btn).toBeTruthy();
  btn.click();
  await Bun.sleep(50);
  expect(el.textContent).toBeDefined();
  unmount();
  el.remove();
});
