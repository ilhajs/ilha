import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { atom, h, mount } from "../src/index.ts";
import type { PropBag } from "../src/types.ts";

const ISLAND = Symbol.for("ilha.island");
const MOUNT = Symbol.for("ilha.islandMountInternal");
const TAG = Symbol.for("ilha.islandSlotTag");

const makeProxy = () =>
  Object.assign(() => "", {
    [ISLAND]: true,
    [TAG]: "section",
    [MOUNT]: (host: Element, props?: PropBag) => {
      host.textContent = String(props?.name ?? "");
      return {
        unmount() {
          host.textContent = "";
        },
        updateProps(next?: PropBag) {
          host.textContent = String(next?.name ?? "");
        },
      };
    },
  });

test("island updateProps runs when parent passes new props", async () => {
  const Proxy = makeProxy();

  const App = function* App() {
    const name = atom("Ilha");
    // SAFETY: Proxy carries the island brand symbols for the mount hook.
    yield h("div", null, h(Proxy as never, { name: name() }));
    yield Effect.sleep(40);
    // SAFETY: Proxy carries the island brand symbols for the mount hook.
    yield h("div", null, h(Proxy as never, { name: "Ada" }));
  };

  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(5);
  expect(el.querySelector("section")?.textContent).toBe("Ilha");
  await Bun.sleep(60);
  expect(el.querySelector("section")?.textContent).toBe("Ada");
  el.remove();
});

test("island updateProps runs when a sync parent rerenders on atom change", async () => {
  const Proxy = makeProxy();

  const App = () => {
    const name = atom("Ilha");
    return h("div", null, [
      h("button", { onclick: () => name.set("Ada") }, "go"),
      // SAFETY: Proxy carries the island brand symbols for the mount hook.
      h(Proxy as never, { name: name() }),
    ]);
  };

  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(5);
  expect(el.querySelector("section")?.textContent).toBe("Ilha");
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.querySelector("section")?.textContent).toBe("Ada");
  el.remove();
});

test("island updateProps survives nested element materialization", async () => {
  const Proxy = Object.assign(() => "", {
    [ISLAND]: true,
    [TAG]: "section",
    [MOUNT]: (host: Element, _props?: PropBag) => {
      host.textContent = "mounted";
      return {
        unmount() {
          host.textContent = "";
        },
        updateProps(next?: PropBag) {
          host.textContent = String(next?.name ?? "");
        },
      };
    },
  });

  const App = () => {
    const name = atom("Ilha");
    return h("div", { class: "card" }, [
      // SAFETY: Proxy carries the island brand symbols for the mount hook.
      h("div", { class: "card-body" }, h(Proxy as never, { name: name() })),
      h("button", { onclick: () => name.set("Ada") }, "go"),
    ]);
  };

  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(5);
  expect(el.querySelector("section")?.textContent).toBe("mounted");
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.querySelector("section")?.textContent).toBe("Ada");
  el.remove();
});
