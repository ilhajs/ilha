// @jsxImportSource ilha
import { describe, expect, it } from "bun:test";

import { mount } from "ilha";
import { VoidActionError } from "void/pages-client";

import { formState } from "./form-state";
import type { FormState } from "./form-state";
import type { FieldErrors, FormValues } from "./types";
/** Build form state in component scope and hand the test its handle. */
const captureState = <T extends FormValues>(
  defaults: T,
  globalErrors?: () => FieldErrors
) => {
  const host = document.createElement("div");
  let captured: FormState<T> | undefined;
  const dispose = mount(host, () => {
    captured = formState(defaults, globalErrors);
    return null;
  });
  if (!captured) {
    throw new Error("form-state probe did not render");
  }
  return { dispose, state: captured };
};

const actionError = (): VoidActionError =>
  new VoidActionError({
    body: "boom",
    status: 500,
    statusText: "Server Error",
    url: "/form",
  });

describe("formState", () => {
  it("starts clean", () => {
    const { state } = captureState({ text: "" });
    expect(state.read()).toEqual({ text: "" });
    expect(state.fields.pending).toBe(false);
    expect(state.fields.hasChanges).toBe(false);
    expect(state.fields.errors).toEqual({});
    expect(state.fields.error).toBeNull();
    expect(state.fields.wasSuccessful).toBe(false);
    expect(state.fields.recentlySuccessful).toBe(false);
  });

  it("flags changes only for values that actually differ", () => {
    const { state } = captureState({ tags: ["a"], text: "" });
    state.fields.setData("text", "");
    // A fresh array with equal items is still "no change": comparison is
    // deep, so edits that round-trip through inputs don't dirty the form.
    state.fields.setData("tags", ["a"]);
    expect(state.fields.hasChanges).toBe(false);
    state.fields.setData("tags", ["b"]);
    expect(state.fields.hasChanges).toBe(true);
    expect(state.read()).toEqual({ tags: ["b"], text: "" });
  });

  it("returns a snapshot copy from read()", () => {
    const { state } = captureState({ text: "a" });
    const snapshot = state.read();
    snapshot.text = "mutated";
    expect(state.fields.data.text).toBe("a");
  });

  it("resets everything, or only the named fields", () => {
    const { state } = captureState({ a: "a", b: "b" });
    state.fields.setData("a", "changed");
    state.fields.setData("b", "changed");
    state.fields.reset("a");
    expect(state.read()).toEqual({ a: "a", b: "changed" });
    expect(state.fields.hasChanges).toBe(true);
    state.fields.reset();
    expect(state.read()).toEqual({ a: "a", b: "b" });
    expect(state.fields.hasChanges).toBe(false);
  });

  it("begin() marks pending and clears the previous submit state", () => {
    const { dispose, state } = captureState({ text: "" });
    state.fields.setData("text", "x");
    state.succeed();
    state.setErrors({ text: "Required" });
    state.fail(actionError());
    state.begin();
    expect(state.fields.pending).toBe(true);
    expect(state.fields.errors).toEqual({});
    expect(state.fields.error).toBeNull();
    expect(state.fields.wasSuccessful).toBe(false);
    expect(state.fields.recentlySuccessful).toBe(false);
    state.finish();
    expect(state.fields.pending).toBe(false);
    dispose();
  });

  it("succeed() moves the baseline so the new data counts as clean", () => {
    const { dispose, state } = captureState({ text: "" });
    state.fields.setData("text", "milk");
    expect(state.fields.hasChanges).toBe(true);
    state.succeed();
    expect(state.fields.wasSuccessful).toBe(true);
    expect(state.fields.recentlySuccessful).toBe(true);
    expect(state.fields.hasChanges).toBe(false);
    // Resetting now restores the last success, not the original defaults.
    state.fields.setData("text", "coffee");
    state.fields.reset();
    expect(state.read()).toEqual({ text: "milk" });
    dispose();
  });

  it("fail() sets the error and clearError() clears it", () => {
    const { state } = captureState({ text: "" });
    const error = actionError();
    state.fail(error);
    expect(state.fields.error).toBe(error);
    state.fields.clearError();
    expect(state.fields.error).toBeNull();
  });

  it("clearErrors() clears everything, or only the named fields", () => {
    const { state } = captureState({ text: "" });
    state.setErrors({ a: "one", b: "two" });
    state.fields.clearErrors("a");
    expect(state.fields.errors).toEqual({ b: "two" });
    state.fields.clearErrors();
    expect(state.fields.errors).toEqual({});
  });

  it("prefers local errors over page errors and falls back once cleared", () => {
    const { state } = captureState({ text: "" }, () => ({
      other: "global",
      text: "global",
    }));
    expect(state.fields.errors).toEqual({ other: "global", text: "global" });
    state.setErrors({ text: "local" });
    expect(state.fields.errors).toEqual({ text: "local" });
    state.fields.clearErrors();
    expect(state.fields.errors).toEqual({ other: "global", text: "global" });
  });
});
