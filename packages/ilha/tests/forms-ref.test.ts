import { expect, test } from "bun:test";

import { atom, mount } from "../src/index.ts";

// Module-level component: exercises fresh atom state per mount.
const CheckboxApp = () => {
  const on = atom(false);
  return {
    $$ilha: 1 as const,
    children: [],
    props: {
      checked: on,
      onclick: () => on.update((v: boolean) => !v),
      type: "checkbox",
    },
    type: "input",
  };
};

test("checkbox checked={atom}", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, CheckboxApp);
  await Bun.sleep(10);
  // SAFETY: the component above renders exactly one input element.
  const input = el.querySelector("input") as HTMLInputElement;
  expect(input.checked).toBe(false);
  input.click();
  await Bun.sleep(10);
  expect(input.checked).toBe(true);
  el.remove();
});

test("ref called with element and null on unmount", async () => {
  const seen: unknown[] = [];
  const App = () => ({
    $$ilha: 1 as const,
    children: ["hi"],
    props: { ref: (n: Element | null) => seen.push(n) },
    type: "p",
  });
  const el = document.createElement("div");
  document.body.append(el);
  const unmount = mount(el, App);
  await Bun.sleep(10);
  expect(seen[0]).toBeInstanceOf(HTMLParagraphElement);
  unmount();
  expect(seen[1]).toBe(null);
  el.remove();
});

// Controlled checkbox whose click handler forces a re-render without
// accepting the edit: the render's `checked` must win over the live node.
interface CheckboxProps {
  checked?: boolean;
  onclick: () => void;
  type: "checkbox";
}

const rejectingCheckbox = (initial: boolean | undefined) => () => {
  const tick = atom(0);
  const inputProps: CheckboxProps = {
    onclick: () => tick.update((n: number) => n + 1),
    type: "checkbox",
  };
  if (initial !== undefined) {
    inputProps.checked = initial;
  }
  return {
    $$ilha: 1 as const,
    children: [
      {
        $$ilha: 1 as const,
        children: [],
        props: inputProps,
        type: "input",
      },
    ],
    props: { "data-tick": tick() },
    type: "div",
  };
};

const clickAndRender = async (
  App: ReturnType<typeof rejectingCheckbox>
): Promise<boolean> => {
  const el = document.createElement("div");
  document.body.append(el);
  mount(el, App);
  await Bun.sleep(10);
  // SAFETY: each component renders exactly one input element.
  const input = el.querySelector("input") as HTMLInputElement;
  input.click();
  await Bun.sleep(10);
  const { checked } = input;
  el.remove();
  return checked;
};

test("controlled checked={true} re-render undoes a user uncheck", async () => {
  expect(await clickAndRender(rejectingCheckbox(true))).toBe(true);
});

test("controlled checked={false} re-render undoes a user check", async () => {
  expect(await clickAndRender(rejectingCheckbox(false))).toBe(false);
});

test("uncontrolled checkbox keeps the user's edit across re-renders", async () => {
  expect(await clickAndRender(rejectingCheckbox())).toBe(true);
});
