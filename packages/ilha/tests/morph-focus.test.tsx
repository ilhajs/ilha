// @jsxImportSource ../src
import { expect, test } from "bun:test";

import { atom, mount } from "../src/index.ts";
import { morphInner } from "../src/morph.ts";

const FocusApp = () => {
  const counter = atom(0);
  return (
    <div>
      <input id="morph-target" placeholder="type here" />
      <button
        type="button"
        onclick={() => counter.update((v: number) => v + 1)}
      >
        {counter}
      </button>
    </div>
  );
};

test("rerender preserves focus on the focused element", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, FocusApp);
  await Bun.sleep(5);

  const input = el.querySelector("input");
  if (!input) {
    throw new Error("input missing");
  }
  input.focus();
  input.value = "user typed";
  el.querySelector("button")?.click();
  await Bun.sleep(5);

  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("user typed");
  expect(el.textContent).toContain("1");
  unmount();
  el.remove();
});

const TypedValueApp = () => {
  const flag = atom(false);
  return (
    <div>
      <input id="free-input" />
      <button type="button" onclick={() => flag.update((v: boolean) => !v)}>
        {flag() ? "on" : "off"}
      </button>
    </div>
  );
};

test("uncontrolled input keeps typed value across rerenders", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, TypedValueApp);
  await Bun.sleep(5);

  const input = el.querySelector("input");
  if (!input) {
    throw new Error("input missing");
  }
  input.value = "kept";
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  el.querySelector("button")?.click();
  await Bun.sleep(5);

  expect(input.value).toBe("kept");
  unmount();
  el.remove();
});

test("data-morph-preserve keeps listed attributes", () => {
  const from = document.createElement("input");
  from.dataset.morphPreserve = "title";
  from.setAttribute("title", "keep me");
  from.setAttribute("placeholder", "old");
  const to = document.createElement("input");
  to.dataset.morphPreserve = "title";
  to.setAttribute("title", "dropped by sync");
  to.setAttribute("placeholder", "new");
  const host = document.createElement("div");
  host.append(from);
  const target = document.createElement("div");
  target.append(to);
  morphInner(host, target);
  expect(from.getAttribute("title")).toBe("keep me");
  expect(from.getAttribute("placeholder")).toBe("new");
});

test("morph drops removed attributes except preserved ones", () => {
  const from = document.createElement("div");
  from.dataset.old = "1";
  from.dataset.keep = "yes";
  from.dataset.morphPreserve = "data-keep";
  const to = document.createElement("div");
  to.dataset.new = "1";
  to.dataset.morphPreserve = "data-keep";
  const host = document.createElement("div");
  host.append(from);
  const target = document.createElement("div");
  target.append(to);
  morphInner(host, target);
  expect(Object.hasOwn(from.dataset, "old")).toBe(false);
  expect(from.dataset.keep).toBe("yes");
  expect(from.dataset.new).toBe("1");
});

const SiblingFocusApp = () => {
  const count = atom(0);
  return (
    <div>
      {count}
      <input id="focus-sibling" />
      <button type="button" onclick={() => count.update((v: number) => v + 1)}>
        add
      </button>
    </div>
  );
};

test("focus survives rerender that replaces siblings", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, SiblingFocusApp);
  await Bun.sleep(5);
  const input = el.querySelector("input");
  if (!input) {
    throw new Error("input missing");
  }
  input.focus();
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(document.activeElement).toBe(input);
  expect(el.textContent).toContain("1");
  unmount();
  el.remove();
});
