import { expect, test } from "bun:test";

import { atom, mount, untrack } from "../src/index.ts";

test("untrack: body does not subscribe to peeked atoms", async () => {
  let renders = 0;
  let setB: ((n: number) => void) | undefined;
  const App = () => {
    const a = atom(0);
    const b = atom(10);
    setB = b.set;
    renders += 1;
    const peeked = untrack(() => b());
    const aNow = a();
    return {
      $$ilha: 1 as const,
      children: [
        {
          $$ilha: 1 as const,
          children: [String(aNow)],
          props: { id: "a" },
          type: "span",
        },
        {
          $$ilha: 1 as const,
          children: [b],
          props: { id: "b" },
          type: "span",
        },
        {
          $$ilha: 1 as const,
          children: [String(peeked)],
          props: { id: "peek" },
          type: "span",
        },
        {
          $$ilha: 1 as const,
          children: ["bump"],
          props: {
            id: "bump",
            onclick: () => a.update((n) => n + 1),
          },
          type: "button",
        },
      ],
      props: {},
      type: "div",
    };
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(renders).toBe(1);
  expect(el.querySelector("#peek")?.textContent).toBe("10");
  setB?.(99);
  await Bun.sleep(5);
  expect(renders).toBe(1);
  expect(el.querySelector("#b")?.textContent).toBe("99");
  expect(el.querySelector("#peek")?.textContent).toBe("10");
  el.querySelector("#bump")?.dispatchEvent(new Event("click"));
  await Bun.sleep(5);
  expect(renders).toBe(2);
  expect(el.querySelector("#peek")?.textContent).toBe("99");
  unmount();
  el.remove();
});
