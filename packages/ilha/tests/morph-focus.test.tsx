/** @jsxImportSource ../src */
import { expect, test } from "bun:test";

import { atom, mount } from "../src/index.ts";
import { morphInner } from "../src/morph.ts";

test("rerender preserves focus on the focused element", async () => {
  const App = () => {
    const n = atom(0);
    return (
      <div>
        <input id="morph-target" placeholder="type here" />
        <button type="button" onclick={() => n.update((v: number) => v + 1)}>
          {n}
        </button>
      </div>
    );
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);

  const input = el.querySelector("input")!;
  input.focus();
  input.value = "user typed";
  el.querySelector("button")!.click();
  await Bun.sleep(5);

  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("user typed");
  expect(el.textContent).toContain("1");
  unmount();
  el.remove();
});

test("uncontrolled input keeps typed value across rerenders", async () => {
  const App = () => {
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
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);

  const input = el.querySelector("input")!;
  input.value = "kept";
  el.querySelector("button")!.click();
  await Bun.sleep(5);
  el.querySelector("button")!.click();
  await Bun.sleep(5);

  expect(input.value).toBe("kept");
  unmount();
  el.remove();
});

test("data-morph-preserve keeps listed attributes", () => {
  const from = document.createElement("input");
  from.setAttribute("data-morph-preserve", "title");
  from.setAttribute("title", "keep me");
  from.setAttribute("placeholder", "old");
  const to = document.createElement("input");
  to.setAttribute("data-morph-preserve", "title");
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
  from.setAttribute("data-old", "1");
  from.setAttribute("data-keep", "yes");
  from.setAttribute("data-morph-preserve", "data-keep");
  const to = document.createElement("div");
  to.setAttribute("data-new", "1");
  to.setAttribute("data-morph-preserve", "data-keep");
  const host = document.createElement("div");
  host.append(from);
  const target = document.createElement("div");
  target.append(to);
  morphInner(host, target);
  expect(from.hasAttribute("data-old")).toBe(false);
  expect(from.getAttribute("data-keep")).toBe("yes");
  expect(from.getAttribute("data-new")).toBe("1");
});

test("focus survives rerender that replaces siblings", async () => {
  const App = () => {
    const n = atom(0);
    return (
      <div>
        {n}
        <input id="focus-sibling" />
        <button type="button" onclick={() => n.update((v: number) => v + 1)}>
          add
        </button>
      </div>
    );
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  const input = el.querySelector("input")!;
  input.focus();
  el.querySelector("button")!.click();
  await Bun.sleep(5);
  expect(document.activeElement).toBe(input);
  expect(el.textContent).toContain("1");
  unmount();
  el.remove();
});
