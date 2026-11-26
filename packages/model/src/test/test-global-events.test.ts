/**
 * Unit tests for the `TestGlobalEvents` fake: capture-then-bubble dispatch
 * in insertion order, removal skipping, cancel reporting, and custom
 * events. The runtime attach tests live in `dom-subscription.test`.
 */
import { describe, expect, it } from "bun:test";

import { make } from "./test-global-events";

describe("TestGlobalEvents", () => {
  it("fires capture listeners before bubble ones, in insertion order", () => {
    const events = make();
    const heard: string[] = [];
    events.listen("document", "keydown", { capture: false }, () =>
      heard.push("bubble-1")
    );
    events.listen("document", "keydown", { capture: true }, () =>
      heard.push("capture-1")
    );
    events.listen("document", "keydown", { capture: true }, () =>
      heard.push("capture-2")
    );
    events.listen("document", "keydown", { capture: false }, () =>
      heard.push("bubble-2")
    );
    const cancelled = events.fire("document", "keydown", { key: "x" });
    expect(cancelled).toBe(false);
    expect(heard).toEqual(["capture-1", "capture-2", "bubble-1", "bubble-2"]);
  });

  it("reports a cancelled default and marks later payloads defaultPrevented", () => {
    const events = make();
    const prevented: unknown[] = [];
    events.listen(
      "document",
      "click",
      { capture: true },
      (payload, preventDefault) => {
        // SAFETY: the fake always delivers an object with a defaultPrevented boolean (see fireTarget).
        prevented.push(
          (payload as { readonly defaultPrevented: unknown }).defaultPrevented
        );
        preventDefault();
      }
    );
    events.listen("document", "click", { capture: false }, (payload) => {
      // SAFETY: the fake always delivers an object with a defaultPrevented boolean (see fireTarget).
      prevented.push(
        (payload as { readonly defaultPrevented: unknown }).defaultPrevented
      );
    });
    const cancelled = events.fire("document", "click", { button: 0 });
    expect(cancelled).toBe(true);
    expect(prevented).toEqual([false, true]);
  });

  it("merges key and pointer defaults under the given payload", () => {
    const events = make();
    const payloads: unknown[] = [];
    events.listen("document", "keydown", { capture: false }, (payload) =>
      payloads.push(payload)
    );
    events.fire("document", "keydown", { key: "Enter" });
    expect(payloads).toEqual([
      {
        alt: false,
        composing: false,
        ctrl: false,
        defaultPrevented: false,
        editable: false,
        key: "Enter",
        meta: false,
        repeat: false,
        selectionEnd: null,
        selectionStart: null,
        shift: false,
      },
    ]);
  });

  it("skips a listener an earlier message removed, and hears window targets apart", () => {
    const events = make();
    const heard: string[] = [];
    // oxlint-disable-next-line eslint/prefer-const -- removeSecond is assigned after the listener that closes over it registers.
    let removeSecond: (() => void) | undefined;
    events.listen("document", "keydown", { capture: false }, () => {
      heard.push("first");
      removeSecond?.();
    });
    removeSecond = events.listen(
      "document",
      "keydown",
      { capture: false },
      () => heard.push("second")
    );
    events.listen("window", "keydown", { capture: false }, () =>
      heard.push("window")
    );
    events.fire("document", "keydown", {});
    expect(heard).toEqual(["first"]);
    // The removal is permanent: the next fire hears only what remains.
    events.fire("document", "keydown", {});
    expect(heard).toEqual(["first", "first"]);
    events.fire("window", "keydown", {});
    expect(heard).toEqual(["first", "first", "window"]);
  });

  it("fires custom events with a null detail by default", () => {
    const events = make();
    const payloads: unknown[] = [];
    events.listen(
      "document",
      "app:notice",
      { capture: false, custom: true },
      (payload) => payloads.push(payload)
    );
    expect(events.fireCustomEvent("app:notice")).toBe(false);
    expect(events.fireCustomEvent("app:notice", { detail: "saved" })).toBe(
      false
    );
    expect(payloads).toEqual([
      { defaultPrevented: false, detail: null },
      { defaultPrevented: false, detail: "saved" },
    ]);
  });
});
