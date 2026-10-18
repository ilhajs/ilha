import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";

import { atom } from "./atom.ts";
import type { JSX } from "./jsx-types.ts";
import { isFunction } from "./shared.ts";
import type {
  AtomHandle,
  AtomLazyOptions,
  AtomOptions,
  IlhaRuntime,
  MountOptions,
  UnsafeHtml,
  View,
  WatchCallback,
  WatchContext,
} from "./types.ts";
import { unsafe } from "./unsafe.ts";

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
const asHandle = <A,>(): AtomHandle<A> => undefined as never;

type WatchOnce = (fn: () => (() => void) | undefined) => void;
// SAFETY: type-anchor fixture only — never invoked at runtime.
const asWatchOnce = (): WatchOnce => undefined as never;

const typecheckWatch = (): void => {
  const once = asWatchOnce();
  once(() => {});
  once(() => () => {});
  // @ts-expect-error once callback must not take arguments
  once((_n: number) => {});
  // @ts-expect-error cleanup must be a void function
  once(() => 1);
};

type Untrack = <A>(fn: () => A) => A;
// SAFETY: type-anchor fixture only — never invoked at runtime.
const asUntrack = (): Untrack => undefined as never;

const typecheckUntrack = (): void => {
  const u = asUntrack();
  const n: number = u(() => 1);
  // @ts-expect-error untrack callback must not take arguments
  u((_x: number) => 1);
  void n;
};

const KeyedItem = (_props: { id: string }): View => "x";

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
    ref: (el) => {
      void el?.tagName;
    },
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
    "data-morph-preserve": "title",
    style: { color: "red", marginTop: 4 },
  };
  const detailsProps: JSX.IntrinsicElements["details"] = {
    ontoggle: (e) => {
      void e.currentTarget.open;
    },
  };
  const dialogProps: JSX.IntrinsicElements["dialog"] = {
    oncancel: (e) => {
      e.preventDefault();
    },
    onclose: (e) => {
      void e.currentTarget.returnValue;
    },
  };
  const popoverProps: JSX.IntrinsicElements["div"] = {
    onbeforetoggle: (e) => {
      void e.currentTarget;
    },
  };

  const keyAttrs: JSX.IntrinsicAttributes = { key: "row-1" };
  const keyedComponent = <KeyedItem id="a" key="a" />;
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
  void detailsProps;
  void dialogProps;
  void popoverProps;
  void keyAttrs;
  void keyedComponent;
  void badValue;
  void badChecked;
  void badClick;
  void badDivName;
  void badDivDisabled;
  void badPForm;
  void count;
};

const ctxFn: WatchCallback<number> = (value, ctx) => {
  ctx.signal.addEventListener("abort", () => {});
  ctx.onCleanup(() => {});
  void value;
};
const asyncCtxFn: WatchCallback<string> = (value, ctx) => {
  void value;
  void ctx.signal;
  return Promise.resolve(() => {
    // Nothing to clean in the anchor.
  });
};
const legacy: WatchCallback<number> = (value) => {
  void value;
};
const useCtx = (_ctx: WatchContext): void => {};
const typecheckAsyncApis = (): void => {
  const eqOpts: AtomOptions<{ a: number }> = { equals: "structural" };
  const fnOpts: AtomOptions<string> = {
    equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
  };
  // @ts-expect-error equals must be "structural" or a comparator
  const badOpts: AtomOptions<number> = { equals: "fuzzy" };

  void eqOpts;
  void fnOpts;
  void badOpts;
  void ctxFn;
  void asyncCtxFn;
  void legacy;
  void useCtx;
};

const typecheckUnsafe = (): void => {
  const raw = unsafe("<b>x</b>");
  const view: View = raw;
  const branded: UnsafeHtml = raw;
  // @ts-expect-error unsafe takes pre-rendered HTML, not a number
  unsafe(42);
  void view;
  void branded;
};

type RuntimeOnError = NonNullable<IlhaRuntime["onError"]>;

const onErrorAnchor: RuntimeOnError = (error) => {
  void error.message;
};
// @ts-expect-error onError receives an Error, not an arbitrary payload
const badOnErrorAnchor: RuntimeOnError = (error: string) => {
  void error;
};

const typecheckSnapshotOptions = (): void => {
  const plain: AtomOptions<number> = { snapshot: false };
  const lazy: AtomLazyOptions = { snapshot: false };
  // @ts-expect-error snapshot is a boolean
  const bad: AtomLazyOptions = { snapshot: "no" };
  void plain;
  void lazy;
  void bad;
};

const typecheckMountOptions = (): void => {
  const opts: MountOptions = { hydrate: true, onIdle: () => {} };
  // @ts-expect-error onIdle takes no arguments
  const bad: MountOptions = { onIdle: (_n: number) => {} };
  void opts;
  void bad;
};

const typecheckEffectAtom = (): void => {
  const loaded = atom(Effect.succeed(1));
  const result: AtomHandle<AsyncResult.AsyncResult<number, never>> = loaded;
  // @ts-expect-error an effect atom holds an AsyncResult, not the value
  const plain: AtomHandle<number> = loaded;
  const view: View = loaded;
  void result;
  void plain;
  void view;
};

describe("jsx types", () => {
  it("keeps type anchors importable", () => {
    expect(isFunction(typecheckJsxProps)).toBe(true);
    expect(isFunction(typecheckWatch)).toBe(true);
    expect(isFunction(typecheckUntrack)).toBe(true);
    expect(isFunction(typecheckUnsafe)).toBe(true);
    expect(isFunction(typecheckAsyncApis)).toBe(true);
    expect(isFunction(typecheckSnapshotOptions)).toBe(true);
    expect(isFunction(typecheckMountOptions)).toBe(true);
    expect(isFunction(typecheckEffectAtom)).toBe(true);
    expect(isFunction(onErrorAnchor)).toBe(true);
    expect(isFunction(badOnErrorAnchor)).toBe(true);
  });
});
