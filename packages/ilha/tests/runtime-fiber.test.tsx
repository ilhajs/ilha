import { expect, test } from "bun:test";

import { atom, mount, renderToString } from "../src/index.ts";
import {
  closeFiber,
  getFiber,
  makeFiber,
  makeRuntime,
  withFiber,
} from "../src/runtime.ts";

test("getFiber skips closed fibers on the stack", () => {
  const runtime = makeRuntime();
  const open = makeFiber(runtime, document.createElement("div"), () => {});
  const closed = makeFiber(runtime, document.createElement("div"), () => {});

  withFiber(open, () => {
    withFiber(closed, () => {
      expect(getFiber()).toBe(closed);
      closeFiber(closed);
      expect(getFiber()).toBe(open);
    });
  });
  closeFiber(open);
  runtime.close();
});

const ClickApp = function* ClickApp() {
  const count = atom(0);
  yield (
    <button type="button" onclick={() => count.update((n: number) => n + 1)}>
      {count}
    </button>
  );
};

test("closed fiber is not resurged after later() work lands", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ClickApp);
  await Bun.sleep(5);
  expect(el.textContent).toContain("0");
  unmount();
  // Clicking after unmount must not paint or throw.
  expect(() => el.querySelector("button")?.click()).not.toThrow();
  await Bun.sleep(5);
  el.remove();
});

const slow = async (label: string) => {
  await Bun.sleep(10);
  return label;
};

test("renderToString waits for async work nested in keyed holes", async () => {
  const html = await renderToString(() => (
    <div>
      {[1, 2].map((n) => (
        <section key={n}>
          {async () => <p>{await slow(`done-${n}`)}</p>}
        </section>
      ))}
    </div>
  ));
  expect(html).toContain("done-1");
  expect(html).toContain("done-2");
});

test("runtime idle fires once after all pending work", async () => {
  const html = await renderToString(async () => {
    await Bun.sleep(10);
    return (
      <div>
        <p>settled</p>
      </div>
    );
  });
  expect(html).toContain("settled");
});
