import { expect, test } from "bun:test";

import { mount } from "../src/index.ts";

test("child throw paints hole error, parent stays", async () => {
  const Boom = async () => {
    throw new Error("boom");
  };
  const Page = async () => ({
    $$ilha: 1 as const,
    type: "div",
    props: {},
    children: [{ $$ilha: 1 as const, type: "p", props: {}, children: ["ok"] }, Boom],
  });
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, Page);
  await Bun.sleep(15);
  expect(el.textContent).toContain("ok");
  expect(el.querySelector("[data-ilha-error]")?.textContent).toContain("boom");
  el.remove();
});
