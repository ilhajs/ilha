import { expect, test } from "bun:test";

import { ErrorBoundary, mount } from "../src/index.ts";
import type { ComponentFn, JsxComponent, PropBag, View } from "../src/types.ts";

const vnode = (
  type: string | ComponentFn | JsxComponent,
  props: PropBag = {},
  children: View[] = []
): View => ({
  $$ilha: 1,
  children,
  props,
  type,
});

const Boom = () => {
  throw new Error("boom");
};

const BoomAsync = async () => {
  await Promise.resolve();
  throw new Error("boom");
};

test("ErrorBoundary paints fallback and reset remounts", async () => {
  let attempts = 0;
  let onErrorCount = 0;
  const Sometimes = () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("boom");
    }
    return "ok";
  };
  const App = () =>
    vnode("div", {}, [
      vnode(
        ErrorBoundary,
        {
          fallback: ({ error, reset }: { error: Error; reset: () => void }) =>
            vnode("div", { id: "fallback" }, [
              error.message,
              vnode("button", { id: "retry", onclick: reset, type: "button" }, [
                "retry",
              ]),
            ]),
          onError: () => {
            onErrorCount += 1;
          },
        },
        [vnode(Sometimes)]
      ),
    ]);
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(15);
  expect(el.querySelector("#fallback")?.textContent).toContain("boom");
  expect(onErrorCount).toBe(1);
  el.querySelector("#retry")?.dispatchEvent(new Event("click"));
  await Bun.sleep(15);
  expect(el.textContent).toContain("ok");
  expect(el.querySelector("#fallback")).toBeNull();
  unmount();
  el.remove();
});

const LocalErrorApp = () =>
  vnode("div", {}, [vnode("p", {}, ["ok"]), BoomAsync]);

test("without ErrorBoundary, child still paints local error", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, LocalErrorApp);
  await Bun.sleep(15);
  expect(el.textContent).toContain("ok");
  expect(el.querySelector("[data-ilha-error]")?.textContent).toContain("boom");
  el.remove();
});

const NestedBoomApp = () =>
  vnode("div", {}, [
    vnode(
      ErrorBoundary,
      {
        fallback: ({ error }: { error: Error }) => error.message,
      },
      [vnode("div", {}, [vnode(Boom)])]
    ),
  ]);

test("ErrorBoundary catches nested component throw", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, NestedBoomApp);
  await Bun.sleep(15);
  expect(el.textContent).toBe("boom");
  expect(el.querySelector("[data-ilha-error]")).toBeNull();
  unmount();
  el.remove();
});
