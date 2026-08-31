import { expect, test } from "bun:test";

import { define } from "../src/define.ts";
import { atom } from "../src/index.ts";

test("define mounts into the custom element", async () => {
  define("ilha-count", async () => {
    const n = atom(0);
    return {
      $$ilha: 1 as const,
      type: "button",
      props: { onclick: () => n.update((x: number) => x + 1) },
      children: ["n=", n],
    };
  });
  const el = document.createElement("ilha-count");
  document.body.append(el);
  await Bun.sleep(20);
  expect(el.textContent).toContain("n=0");
  el.querySelector("button")?.dispatchEvent(new Event("click"));
  await Bun.sleep(15);
  expect(el.textContent).toContain("n=1");
  el.remove();
});
