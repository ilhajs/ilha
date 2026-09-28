import { expect, test } from "bun:test";

import { atom, mount, watch } from "../src/index.ts";

const shell = (): HTMLElement => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

test("watch.once runs async cleanup on unmount", async () => {
  const order: string[] = [];
  const gate = Promise.withResolvers<() => void>();
  const App = () => {
    watch.once(() => {
      order.push("setup");
      return gate.promise;
    });
  };
  const el = shell();
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(order).toEqual(["setup"]);
  gate.resolve(() => {
    order.push("cleanup");
  });
  await Bun.sleep(5);
  unmount();
  expect(order).toEqual(["setup", "cleanup"]);
  el.remove();
});

test("watch.once cleanup runs when unmount wins the race", async () => {
  const order: string[] = [];
  const gate = Promise.withResolvers<() => void>();
  const App = () => {
    watch.once(() => gate.promise);
    return { $$ilha: 1 as const, children: ["x"], props: {}, type: "p" };
  };
  const el = shell();
  const unmount = mount(el, App);
  await Bun.sleep(5);
  unmount();
  gate.resolve(() => {
    order.push("late-cleanup");
  });
  await Bun.sleep(5);
  expect(order).toEqual(["late-cleanup"]);
  el.remove();
});

test("watch.once signal aborts on unmount", async () => {
  let aborted = false;
  const App = () => {
    watch.once(({ signal }) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
    });
    return { $$ilha: 1 as const, children: ["x"], props: {}, type: "p" };
  };
  const el = shell();
  const unmount = mount(el, App);
  await Bun.sleep(5);
  expect(aborted).toBe(false);
  unmount();
  expect(aborted).toBe(true);
  el.remove();
});

test("watch(source) aborts stale runs and cleans up", async () => {
  const aborted: string[] = [];
  const cleaned: string[] = [];
  let current: ((v: string) => void) | undefined;
  const App = () => {
    const name = atom("a");
    watch(name, (v, { signal }) => {
      const seen = v;
      signal.addEventListener("abort", () => {
        aborted.push(seen);
      });
      return () => {
        cleaned.push(seen);
      };
    });
    current = (v: string): void => name.set(v);
    return { $$ilha: 1 as const, children: ["x"], props: {}, type: "p" };
  };
  const el = shell();
  const unmount = mount(el, App);
  await Bun.sleep(5);
  current?.("b");
  await Bun.sleep(5);
  expect(aborted).toEqual(["a"]);
  expect(cleaned).toEqual(["a"]);
  unmount();
  expect(aborted).toEqual(["a", "b"]);
  expect(cleaned).toEqual(["a", "b"]);
  el.remove();
});

test("watch(source) onCleanup runs on unmount", async () => {
  const cleaned: string[] = [];
  const App = () => {
    const flag = atom(0);
    watch(flag, (_v, { onCleanup }) => {
      onCleanup(() => {
        cleaned.push("extra");
      });
    });
    return { $$ilha: 1 as const, children: ["x"], props: {}, type: "p" };
  };
  const el = shell();
  const unmount = mount(el, App);
  await Bun.sleep(5);
  unmount();
  expect(cleaned).toEqual(["extra"]);
  el.remove();
});
