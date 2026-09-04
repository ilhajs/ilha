import { describe, expect, it } from "bun:test";

import type { JSX } from "./jsx-types.ts";
import { isFunction } from "./shared.ts";
import type { AtomHandle } from "./types.ts";

const click: NonNullable<JSX.IntrinsicElements["button"]["onclick"]> = (e) => {
  void e.currentTarget.disabled;
  void e.button;
};
const submit: NonNullable<JSX.IntrinsicElements["form"]["onsubmit"]> = (e) => {
  e.preventDefault();
  void e.currentTarget.action;
};
const input: NonNullable<JSX.IntrinsicElements["input"]["oninput"]> = (e) => {
  void e.currentTarget.value;
};

// SAFETY: type-anchor fixtures only — never read at runtime.
const asHandle = <A,>(): AtomHandle<A> => undefined as AtomHandle<A>;

const typecheckJsxProps = (): void => {
  const count = asHandle<number>();
  const on = asHandle<boolean>();
  const name = asHandle<string>();

  const buttonProps: JSX.IntrinsicElements["button"] = {
    children: count,
    class: "btn",
    disabled: true,
    name: "go",
    onclick: click,
    type: "button",
  };
  const formProps: JSX.IntrinsicElements["form"] = {
    children: "go",
    onsubmit: submit,
  };
  const inputProps: JSX.IntrinsicElements["input"] = {
    className: "input",
    oninput: input,
    type: "text",
    value: name,
  };
  const checkProps: JSX.IntrinsicElements["input"] = {
    checked: on,
    type: "checkbox",
  };
  const labelProps: JSX.IntrinsicElements["label"] = {
    children: "Email",
    for: "email",
    htmlFor: "email",
  };
  const styleProps: JSX.IntrinsicElements["div"] = {
    "aria-label": "x",
    class: "card",
    "data-ilha": "",
    style: { color: "red", marginTop: 4 },
  };

  // @ts-expect-error value is not a boolean binding
  const badValue: JSX.IntrinsicElements["input"] = { value: on };
  // @ts-expect-error checked expects boolean atom/value
  const badChecked: JSX.IntrinsicElements["input"] = { checked: name };
  // @ts-expect-error onclick does not take a string
  const badClick: JSX.IntrinsicElements["button"] = { onclick: "alert(1)" };
  // @ts-expect-error div does not accept name
  const badDivName: JSX.IntrinsicElements["div"] = { name: "x" };
  // @ts-expect-error div does not accept disabled
  const badDivDisabled: JSX.IntrinsicElements["div"] = { disabled: true };
  // @ts-expect-error p does not accept form
  const badPForm: JSX.IntrinsicElements["p"] = { form: "f" };

  void buttonProps;
  void formProps;
  void inputProps;
  void checkProps;
  void labelProps;
  void styleProps;
  void badValue;
  void badChecked;
  void badClick;
  void badDivName;
  void badDivDisabled;
  void badPForm;
  void count;
};

describe("jsx types", () => {
  it("keeps type anchors importable", () => {
    expect(isFunction(typecheckJsxProps)).toBe(true);
  });
});
