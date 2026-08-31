import { expect, test } from "bun:test";

import { mount } from "../src/index.ts";

test("hydrate mismatch warns and full mounts", async () => {
  const warns: unknown[] = [];
  const prev = console.warn;
  console.warn = (...a: unknown[]) => {
    warns.push(a[0]);
  };
  const App = async () => ({
    $$ilha: 1 as const,
    type: "p",
    props: {},
    children: ["ok"],
  });
  const el = document.createElement("div");
  const span = document.createElement("span");
  span.textContent = "old";
  el.append(span);
  document.body.append(el);
  mount(el, App, { hydrate: true });
  await Bun.sleep(15);
  console.warn = prev;
  expect(String(warns[0])).toContain("hydrate mismatch");
  expect(el.querySelector("p")?.textContent).toBe("ok");
  expect(el.querySelector("span")).toBeNull();
  el.remove();
});
