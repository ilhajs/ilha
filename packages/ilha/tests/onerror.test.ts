import { expect, test } from "bun:test";

import { mount } from "../src/index.ts";

test("mount onError receives failure", async () => {
  const seen: unknown[] = [];
  const App = async () => {
    throw new Error("nope");
  };
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App, { onError: (e) => seen.push(e) });
  await Bun.sleep(10);
  expect(seen.length).toBe(1);
  el.remove();
});
