/** @jsxImportSource . */
import { describe, expect, it } from "bun:test";

import type { JSX } from "./jsx-types.ts";
import type { AtomHandle } from "./types.ts";

function typecheckJsxProps(): void {
  const count = null as unknown as AtomHandle<number>;
  const on = null as unknown as AtomHandle<boolean>;
  const name = null as unknown as AtomHandle<string>;

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

  const buttonProps: JSX.IntrinsicElements["button"] = {
    type: "button",
    class: "btn",
    disabled: true,
    name: "go",
    onclick: click,
    children: count,
  };
  const formProps: JSX.IntrinsicElements["form"] = {
    onsubmit: submit,
    children: "go",
  };
  const inputProps: JSX.IntrinsicElements["input"] = {
    type: "text",
    className: "input",
    value: name,
    oninput: input,
  };
  const checkProps: JSX.IntrinsicElements["input"] = {
    type: "checkbox",
    checked: on,
  };
  const labelProps: JSX.IntrinsicElements["label"] = {
    for: "email",
    htmlFor: "email",
    children: "Email",
  };
  const styleProps: JSX.IntrinsicElements["div"] = {
    style: { color: "red", marginTop: 4 },
    class: "card",
    "data-ilha": "",
    "aria-label": "x",
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
}

describe("jsx types", () => {
  it("keeps type anchors importable", () => {
    expect(typeof typecheckJsxProps).toBe("function");
  });
});
