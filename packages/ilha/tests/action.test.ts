import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";

import { atom, mount } from "../src/index.ts";

const App = () => {
  const save = atom(
    Atom.fn((n: number) => Effect.sleep(20).pipe(Effect.as(n)))
  );
  return {
    $$ilha: 1 as const,
    children: [save],
    props: {
      id: "save",
      onclick: () => {
        if (Atom.isWritable(save.atom)) {
          // SAFETY: Atom.fn setter expects the effect argument type; 1 is that seed.
          save.set(1 as never);
        }
      },
    },
    type: "button",
  };
};

test("Atom.fn pending then success", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(10);
  const btn = el.querySelector("#save");
  if (!(btn instanceof HTMLButtonElement)) {
    throw new Error("#save missing");
  }
  btn.click();
  await Bun.sleep(50);
  expect(el.textContent).toBeDefined();
  unmount();
  el.remove();
});
