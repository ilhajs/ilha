import { expect, test } from "bun:test";

import { atom, context, createContext, mount } from "../src/index.ts";
import type { ComponentFn, JsxComponent, View } from "../src/types.ts";

const Theme = createContext("light");

const child = (type: ComponentFn | JsxComponent): View => ({
  $$ilha: 1,
  // SAFETY: test helper builds a vnode with no children.
  children: [] as View[],
  props: {},
  type,
});

const ThemeSpan = () => {
  const theme = context(Theme);
  return {
    $$ilha: 1 as const,
    children: [theme],
    props: { id: "theme" },
    type: "span",
  };
};

const ThemeToggleApp = () => {
  const mode = atom("dark");
  return {
    $$ilha: 1 as const,
    children: [
      {
        $$ilha: 1 as const,
        children: ["toggle"],
        props: {
          id: "toggle",
          onclick: () => mode.set("light"),
          type: "button",
        },
        type: "button",
      },
      {
        $$ilha: 1 as const,
        children: [child(ThemeSpan)],
        props: { value: mode() },
        type: Theme.Provider,
      },
    ],
    props: {},
    type: "div",
  };
};

test("context reads provider value and updates", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, ThemeToggleApp);
  await Bun.sleep(15);
  expect(el.querySelector("#theme")?.textContent).toBe("dark");
  el.querySelector("#toggle")?.dispatchEvent(new Event("click"));
  await Bun.sleep(15);
  expect(el.querySelector("#theme")?.textContent).toBe("light");
  unmount();
  el.remove();
});

const DefaultTheme = () => {
  const theme = context(Theme);
  return theme();
};

test("context falls back to default without a provider", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, DefaultTheme);
  await Bun.sleep(5);
  expect(el.textContent).toBe("light");
  unmount();
  el.remove();
});

const ThemeText = () => context(Theme)();

const NestedProviders = () => ({
  $$ilha: 1 as const,
  children: [
    {
      $$ilha: 1 as const,
      children: [
        {
          $$ilha: 1 as const,
          children: [child(ThemeText)],
          props: { value: "inner" },
          type: Theme.Provider,
        },
      ],
      props: { value: "outer" },
      type: Theme.Provider,
    },
  ],
  props: {},
  type: "div",
});

test("nested providers override outer values", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, NestedProviders);
  await Bun.sleep(15);
  expect(el.textContent).toBe("inner");
  unmount();
  el.remove();
});
