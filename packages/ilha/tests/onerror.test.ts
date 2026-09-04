import { expect, test } from "bun:test";

import { mount } from "../src/index.ts";

const App = () => {
  throw new Error("nope");
};

test("mount onError receives failure", async () => {
  const seen: unknown[] = [];
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App, { onError: (e) => seen.push(e) });
  await Bun.sleep(10);
  expect(seen.length).toBe(1);
  el.remove();
});
