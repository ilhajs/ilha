import { expect, test } from "bun:test";

import { mount } from "../src/index.ts";

const MismatchApp = () => ({
  $$ilha: 1 as const,
  children: ["ok"],
  props: {},
  type: "p",
});

test("hydrate mismatch warns and full mounts", async () => {
  const warns: unknown[] = [];
  const prev = console.warn;
  console.warn = (...a: unknown[]) => {
    warns.push(a[0]);
  };
  const el = document.createElement("div");
  const span = document.createElement("span");
  span.textContent = "old";
  el.append(span);
  document.body.append(el);
  mount(el, MismatchApp, { hydrate: true });
  await Bun.sleep(15);
  console.warn = prev;
  expect(String(warns[0])).toContain("hydrate mismatch");
  expect(el.querySelector("p")?.textContent).toBe("ok");
  expect(el.querySelector("span")).toBeNull();
  el.remove();
});
