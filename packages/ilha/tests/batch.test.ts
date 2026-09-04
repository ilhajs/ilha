import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";

import { atom, batch, mount } from "../src/index.ts";

test("batch coalesces multiple writes", async () => {
  let renders = 0;
  const App = () => {
    const a = atom(0);
    const b = atom(0);
    renders += 1;
    return {
      $$ilha: 1 as const,
      children: [`${a()}-${b()}`],
      props: {
        onclick: () => {
          batch(() => {
            a.set(1);
            b.set(2);
          });
        },
      },
      type: "button",
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  const before = renders;
  el.querySelector("button")?.click();
  await Bun.sleep(10);
  expect(el.textContent).toBe("1-2");
  expect(renders - before).toBe(1);
  unmount();
  el.remove();
});

const FnApp = () => {
  const total = atom(0);
  const bump = atom(
    Atom.fn(() => Effect.sync(() => total.update((n) => n + 1)))
  );
  return {
    $$ilha: 1 as const,
    children: [total],
    props: {
      onclick: () => {
        // SAFETY: Atom.fn with no args uses never-like void seed for set().
        bump.set(undefined as never);
      },
    },
    type: "button",
  };
};

test("Atom.fn mutation runs through handle.set", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, FnApp);
  await Bun.sleep(5);
  el.querySelector("button")?.click();
  await Bun.sleep(20);
  expect(el.textContent).toBe("1");
  unmount();
  el.remove();
});
