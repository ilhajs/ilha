import { expect, test } from "bun:test";

import { mount } from "../src/index.ts";

const Boom = async () => {
  await Promise.resolve();
  throw new Error("boom");
};

const Page = () => ({
  $$ilha: 1 as const,
  children: [
    { $$ilha: 1 as const, children: ["ok"], props: {}, type: "p" },
    Boom,
  ],
  props: {},
  type: "div",
});

test("child throw paints hole error, parent stays", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, Page);
  await Bun.sleep(15);
  expect(el.textContent).toContain("ok");
  expect(el.querySelector("[data-ilha-error]")?.textContent).toContain("boom");
  el.remove();
});
