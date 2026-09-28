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

test("island keeps its live host when a nested component rerenders", async () => {
  let mounts = 0;
  const Proxy = Object.assign(() => "", {
    [ISLAND]: true,
    [TAG]: "section",
    [MOUNT]: (host: Element, props?: PropBag) => {
      mounts += 1;
      // Server islands paint async and only into a connected host.
      const paint = (next?: PropBag) => {
        queueMicrotask(() => {
          if (host.isConnected) {
            host.textContent = String(next?.name ?? "");
          }
        });
      };
      paint(props);
      return {
        unmount() {
          host.textContent = "";
        },
        updateProps: paint,
      };
    },
  });

  const App = () => {
    const name = atom("Ilha");
    return h("div", null, [
      h("button", { onclick: () => name.set("Ada") }, "go"),
      // SAFETY: Proxy carries the island brand symbols for the mount hook.
      h(Proxy as never, { name: name() }),
    ]);
  };

  // Router-style shell: the page is an unkeyed child component.
  const Shell = () => h(App, null);

  const el = document.createElement("div");
  document.body.append(el);
  mount(el, Shell);
  await Bun.sleep(5);
  const host = el.querySelector("section");
  expect(host?.textContent).toBe("Ilha");
  el.querySelector("button")?.click();
  await Bun.sleep(5);
  expect(el.querySelector("section")).toBe(host);
  expect(host?.textContent).toBe("Ada");
  expect(mounts).toBe(1);
  el.remove();
});

const makeCountingProxy = (tag: string, counts: { unmounts: number }) =>
  Object.assign(() => "", {
    [ISLAND]: true,
    [TAG]: tag,
    [MOUNT]: (host: Element) => {
      host.textContent = tag;
      return {
        unmount() {
          counts.unmounts += 1;
        },
        updateProps() {
          /* empty */
        },
      };
    },
  });

test("replacing an island slot in place unmounts the old island once", async () => {
  const counts = { unmounts: 0 };
  const A = makeCountingProxy("section", counts);
  const B = makeCountingProxy("aside", counts);
  let flip: (() => void) | undefined;
  const App = () => {
    const which = atom(false);
    flip = () => which.set(true);
    // SAFETY: A/B carry the island brand symbols for the mount hook.
    return h("div", null, h((which() ? B : A) as never, null));
  };
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  flip?.();
  await Bun.sleep(5);
  expect(el.querySelector("aside")).not.toBeNull();
  expect(counts.unmounts).toBe(1);
  unmount();
  expect(counts.unmounts).toBe(2);
  el.remove();
});

test("switching to a keyed list sweeps former island slots", async () => {
  const counts = { unmounts: 0 };
  const A = makeCountingProxy("section", counts);
  let flip: (() => void) | undefined;
  const Child = () => {
    const keyed = atom(false);
    flip = () => keyed.set(true);
    if (keyed()) {
      return [h("p", { key: "a" }, "a"), h("p", { key: "b" }, "b")];
    }
    // SAFETY: A carries the island brand symbols for the mount hook.
    return [h(A as never, null)];
  };
  // Nested so the list paints through a component hole.
  const App = () => h("div", null, h(Child, null));
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(5);
  flip?.();
  await Bun.sleep(5);
  expect(el.textContent).toBe("ab");
  expect(counts.unmounts).toBe(1);
  unmount();
  expect(counts.unmounts).toBe(1);
  el.remove();
});
