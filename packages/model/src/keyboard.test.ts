import { describe, expect, it } from "bun:test";

import { keyPayload, shortcuts } from "./keyboard";
import type { DocumentKeyPayload, KeyPayload } from "./keyboard";

const key = (overrides: Partial<DocumentKeyPayload>): DocumentKeyPayload => ({
  alt: false,
  composing: false,
  ctrl: false,
  defaultPrevented: false,
  editable: false,
  key: "",
  meta: false,
  repeat: false,
  selectionEnd: null,
  selectionStart: null,
  shift: false,
  ...overrides,
});

describe("shortcuts", () => {
  const handle = shortcuts([
    { key: "?", message: "help" },
    { key: "Escape", message: "close", whileTyping: true },
    { key: "ArrowDown", message: "down", repeat: true },
    { key: "k", message: "cmd-shift-k", meta: true, shift: true },
    { key: "k", message: "cmd-k", meta: true },
    { key: "o", message: "open", mod: true },
  ]);

  it("matches rows in order with modifier, typing, repeat, composing and defaultPrevented guards", () => {
    expect(handle(key({ key: "?", shift: true }))).toBe("help");
    expect(handle(key({ ctrl: true, key: "?" }))).toBeUndefined();
    expect(handle(key({ editable: true, key: "?" }))).toBeUndefined();
    expect(handle(key({ key: "?", repeat: true }))).toBeUndefined();
    expect(handle(key({ composing: true, key: "?" }))).toBeUndefined();
    expect(handle(key({ defaultPrevented: true, key: "?" }))).toBeUndefined();
    expect(handle(key({ editable: true, key: "Escape" }))).toBe("close");
    expect(handle(key({ key: "ArrowDown", repeat: true }))).toBe("down");
    expect(handle(key({ key: "k", meta: true, shift: true }))).toBe(
      "cmd-shift-k"
    );
    expect(handle(key({ key: "k", meta: true }))).toBe("cmd-k");
    expect(handle(key({ ctrl: true, key: "o" }))).toBe("open");
    expect(handle(key({ key: "o", meta: true }))).toBe("open");
    expect(handle(key({ ctrl: true, key: "o", meta: true }))).toBeUndefined();
    expect(handle(key({ alt: true, ctrl: true, key: "o" }))).toBeUndefined();
    expect(handle(key({ key: "o" }))).toBeUndefined();
    expect(handle(key({ key: "x" }))).toBeUndefined();
  });

  it("matches alt only when the row asks for it, and shift only when the row sets it", () => {
    const alt = shortcuts([{ alt: true, key: "s", message: "save-alt" }]);
    expect(alt(key({ alt: true, key: "s" }))).toBe("save-alt");
    expect(alt(key({ key: "s" }))).toBeUndefined();
    expect(handle(key({ key: "?", shift: true }))).toBe("help");
  });

  it("lets an explicit ctrl row match ctrl without meta, and keeps mod XOR", () => {
    const ctrl = shortcuts([{ ctrl: true, key: "s", message: "save" }]);
    expect(ctrl(key({ ctrl: true, key: "s" }))).toBe("save");
    expect(ctrl(key({ ctrl: true, key: "s", meta: true }))).toBeUndefined();
    expect(ctrl(key({ key: "s", meta: true }))).toBeUndefined();
  });

  it("ignores a plain element payload's missing defaultPrevented", () => {
    const element: KeyPayload = {
      alt: false,
      composing: false,
      ctrl: false,
      editable: false,
      key: "?",
      meta: false,
      repeat: false,
      selectionEnd: null,
      selectionStart: null,
      shift: false,
    };
    expect(handle(element)).toBe("help");
  });

  it("returns the first matching row", () => {
    const first = shortcuts([
      { key: "a", message: "one" },
      { key: "a", message: "two" },
    ]);
    expect(first(key({ key: "a" }))).toBe("one");
  });
});

const payloadOf = (target: Element, init: KeyboardEventInit): KeyPayload => {
  let seen: KeyboardEvent | undefined;
  document.addEventListener(
    "keydown",
    (event) => {
      // SAFETY: keydown listeners always receive KeyboardEvent; the DOM type is the generic Event.
      seen = event as KeyboardEvent;
    },
    { once: true }
  );
  target.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, composed: true, ...init })
  );
  if (seen === undefined) {
    throw new Error("keyPayload: no event was seen");
  }
  return keyPayload(seen);
};

describe("keyPayload", () => {
  it("reads the key, modifiers, composing and repeat from the event", () => {
    const div = document.createElement("div");
    document.body.append(div);
    try {
      const payload = payloadOf(div, {
        altKey: true,
        ctrlKey: true,
        key: "Enter",
        metaKey: true,
        shiftKey: true,
      });
      expect(payload.key).toBe("Enter");
      expect([payload.shift, payload.ctrl, payload.alt, payload.meta]).toEqual([
        true,
        true,
        true,
        true,
      ]);
      expect(payload.composing).toBe(false);
      expect(payload.repeat).toBe(false);
      expect(payload.editable).toBe(false);
      expect([payload.selectionStart, payload.selectionEnd]).toEqual([
        null,
        null,
      ]);
    } finally {
      div.remove();
    }
  });

  it("marks text fields editable with a caret, and boxes and buttons not editable", () => {
    const text = document.createElement("input");
    text.type = "text";
    text.value = "hi";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    document.body.append(text, checkbox);
    try {
      const typed = payloadOf(text, { key: "a" });
      expect(typed.editable).toBe(true);
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- asserts the caret offsets are numbers, not null, for text inputs.
      expect(typeof typed.selectionStart).toBe("number");
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- asserts the caret offsets are numbers, not null, for text inputs.
      expect(typeof typed.selectionEnd).toBe("number");
      expect(payloadOf(checkbox, { key: " " }).editable).toBe(false);
    } finally {
      text.remove();
      checkbox.remove();
    }
  });

  it("marks textarea, select and contenteditable editable", () => {
    const area = document.createElement("textarea");
    const select = document.createElement("select");
    const rich = document.createElement("div");
    rich.contentEditable = "true";
    document.body.append(area, select, rich);
    try {
      expect(payloadOf(area, { key: "a" }).editable).toBe(true);
      expect(payloadOf(select, { key: "ArrowDown" }).editable).toBe(true);
      expect(payloadOf(rich, { key: "a" }).editable).toBe(true);
    } finally {
      area.remove();
      select.remove();
      rich.remove();
    }
  });

  it("reads the innermost target through an open shadow root", () => {
    const host = document.createElement("div");
    document.body.append(host);
    try {
      const shadow = host.attachShadow({ mode: "open" });
      const inner = document.createElement("input");
      inner.type = "text";
      shadow.append(inner);
      expect(payloadOf(inner, { key: "a" }).editable).toBe(true);
    } finally {
      host.remove();
    }
  });
});
