import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { atom, h, mount } from "../src/index.ts";

test("island updateProps runs when parent passes new props", async () => {
  const ISLAND = Symbol.for("ilha.island");
  const MOUNT = Symbol.for("ilha.islandMountInternal");
  const TAG = Symbol.for("ilha.islandSlotTag");
  const Proxy = Object.assign(() => "", {
    [ISLAND]: true,
    [TAG]: "section",
    [MOUNT]: (host: Element, props?: Record<string, unknown>) => {
      host.textContent = String(props?.name ?? "");
      return {
        unmount() {
          host.textContent = "";
        },
        updateProps(next?: Record<string, unknown>) {
          host.textContent = String(next?.name ?? "");
        },
      };
    },
  });

  const App = function* () {
    const name = atom("Ilha");
    yield h("div", null, h(Proxy as never, { name: name() }));
    yield Effect.sleep(40);
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
  const ISLAND = Symbol.for("ilha.island");
  const MOUNT = Symbol.for("ilha.islandMountInternal");
  const TAG = Symbol.for("ilha.islandSlotTag");
  const Proxy = Object.assign(() => "", {
    [ISLAND]: true,
    [TAG]: "section",
    [MOUNT]: (host: Element, props?: Record<string, unknown>) => {
      host.textContent = String(props?.name ?? "");
      return {
        unmount() {
          host.textContent = "";
        },
        updateProps(next?: Record<string, unknown>) {
          host.textContent = String(next?.name ?? "");
        },
      };
    },
  });

  const App = () => {
    const name = atom("Ilha");
    return h("div", null, [
      h("button", { onclick: () => name.set("Ada") }, "go"),
      h(Proxy as never, { name: name() }),
    ]);
  };

  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(5);
  expect(el.querySelector("section")?.textContent).toBe("Ilha");
  el.querySelector("button")!.click();
  await Bun.sleep(5);
  expect(el.querySelector("section")?.textContent).toBe("Ada");
  el.remove();
});

test("island updateProps survives nested element materialization", async () => {
  const ISLAND = Symbol.for("ilha.island");
  const MOUNT = Symbol.for("ilha.islandMountInternal");
  const TAG = Symbol.for("ilha.islandSlotTag");
  const Proxy = Object.assign(() => "", {
    [ISLAND]: true,
    [TAG]: "section",
    [MOUNT]: (host: Element, _props?: Record<string, unknown>) => {
      host.textContent = "mounted";
      return {
        unmount() {
          host.textContent = "";
        },
        updateProps(next?: Record<string, unknown>) {
          host.textContent = String(next?.name ?? "");
        },
      };
    },
  });

  const App = () => {
    const name = atom("Ilha");
    return h("div", { class: "card" }, [
      h("div", { class: "card-body" }, h(Proxy as never, { name: name() })),
      h("button", { onclick: () => name.set("Ada") }, "go"),
    ]);
  };

  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(5);
  expect(el.querySelector("section")?.textContent).toBe("mounted");
  el.querySelector("button")!.click();
  await Bun.sleep(5);
  expect(el.querySelector("section")?.textContent).toBe("Ada");
  el.remove();
});
