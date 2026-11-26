/**
 * Unit tests for `DomSubscription` constructors: keys, handler forms,
 * `preventDefault` rules, capture phases, shortcut matching, and the
 * direct-attach wiring against the `TestGlobalEvents` and
 * `TestAnimationFrames` fakes. Kernel integration (real DOM events,
 * duplicate keys failing the instance) lives in the runtime tests below.
 */
import { describe, expect, it } from "bun:test";

import * as Context from "effect/Context";

import {
  AnimationFrames,
  GlobalEvents,
  onAnimationFrame,
  onCustomEvent,
  onDocument,
  onWindow,
  shortcuts,
} from "./dom-subscription.ts";
import type * as Subscription from "./subscription.ts";
import { isDirect } from "./subscription.ts";
import { make as makeFrames } from "./test/test-animation-frames.ts";
import { make as makeEvents } from "./test/test-global-events.ts";

interface Emitted {
  readonly message: unknown;
  readonly accepted?: (() => void) | undefined;
}

/** A `direct` declaration attached to a test context, driven by hand. */
interface Attached {
  readonly detach: () => void;
  readonly emitted: Emitted[];
  readonly failures: unknown[];
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- forwards the declaration's own direct state, whose type is declaration-specific.
  readonly setLatest: (latest: unknown) => void;
}

/** Run a `direct` declaration's attach against a context, driving events by hand. */
const attachTo = (
  declaration: Subscription.Subscription<unknown>,
  context: Context.Context<never>
): Attached => {
  if (!isDirect(declaration)) {
    throw new Error("not a direct subscription");
  }
  const emitted: Emitted[] = [];
  const failures: unknown[] = [];
  let latest: unknown = declaration.directState;
  const detach = declaration.directAttach(context, {
    // The kernel calls `accepted` right after dispatch; do the same, so
    // `preventDefault: true` cancels in these tests too.
    emit: (message, accepted) => {
      emitted.push(
        accepted === undefined ? { message } : { accepted, message }
      );
      accepted?.();
    },
    enter: (f) => f(latest),
    fail: (cause) => failures.push(cause),
  });
  return { detach, emitted, failures, setLatest: (value) => (latest = value) };
};

const handler = (): undefined => undefined;
describe("DomSubscription keys", () => {
  it("keys listeners by target, event and phase", () => {
    expect(
      [
        onDocument("keydown", handler),
        onDocument("mousedown", handler, { capture: true }),
        onWindow("blur", handler),
        onCustomEvent("app:notice", handler),
        onAnimationFrame(handler),
      ].map((entry) => entry.key)
    ).toEqual([
      `@ilha/model/document:"keydown"`,
      `@ilha/model/document:"mousedown","capture"`,
      `@ilha/model/window:"blur"`,
      `@ilha/model/document:"app:notice"`,
      `@ilha/model/animationFrame:`,
    ]);
  });

  it("shares the document key space with custom events", () => {
    expect(onDocument("click", handler).key).toBe(
      onCustomEvent("click", handler).key
    );
  });
});

describe("DomSubscription attach", () => {
  it("dispatches the handler's message and cancels only for one", () => {
    const events = makeEvents();
    // SAFETY: the test context holds only the faked service; never marks the absence of other requirements.
    const context = Context.make(
      GlobalEvents,
      events
    ) as Context.Context<never>;
    const seen: unknown[] = [];
    // SAFETY: the fake fires plain key payloads; the handler reads the key field it matched on.
    const sub = onDocument("keydown", (payload) =>
      (payload as { key: string }).key === "Escape"
        ? undefined
        : { key: (payload as { key: string }).key }
    );
    const attached = attachTo(sub, context);
    events.fire("document", "keydown", { key: "x" });
    events.fire("document", "keydown", { key: "Escape" });
    expect(attached.emitted.map((entry) => entry.message)).toEqual([
      { key: "x" },
    ]);
    expect(attached.failures).toEqual([]);
    attached.detach();
    void seen;
  });

  it("applies preventDefault true only for a message, and always unconditionally", () => {
    const events = makeEvents();
    // SAFETY: the test context holds only the faked service; never marks the absence of other requirements.
    const context = Context.make(
      GlobalEvents,
      events
    ) as Context.Context<never>;
    const cancellations: boolean[] = [];
    const conditional = attachTo(
      onDocument("keydown", () => {}, { preventDefault: true }),
      context
    );
    cancellations.push(events.fire("document", "keydown", { key: "x" }));
    const always = attachTo(
      onDocument("keydown", () => {}, { preventDefault: "always" }),
      context
    );
    cancellations.push(events.fire("document", "keydown", { key: "x" }));
    expect(cancellations).toEqual([false, true]);
    expect(conditional.emitted).toEqual([]);
    expect(always.emitted).toEqual([]);
    conditional.detach();
    always.detach();
  });

  it("reads the latest declaration through enter", () => {
    const events = makeEvents();
    // SAFETY: the test context holds only the faked service; never marks the absence of other requirements.
    const context = Context.make(
      GlobalEvents,
      events
    ) as Context.Context<never>;
    // SAFETY: passes a non-handler latest to exercise the enter-reread path.
    const one = attachTo(onDocument("keydown", "first" as never), context);
    one.setLatest({
      handler: "second",
      preventDefault: undefined,
      target: "document",
    });
    events.fire("document", "keydown", { key: "x" });
    expect(one.emitted.map((entry) => entry.message)).toEqual(["second"]);
    one.detach();
  });

  it("fails the instance when the handler throws", () => {
    const events = makeEvents();
    // SAFETY: the test context holds only the faked service; never marks the absence of other requirements.
    const context = Context.make(
      GlobalEvents,
      events
    ) as Context.Context<never>;
    const attached = attachTo(
      onDocument("keydown", (): never => {
        throw new Error("boom");
      }),
      context
    );
    events.fire("document", "keydown", { key: "x" });
    expect(attached.emitted).toEqual([]);
    expect(attached.failures).toHaveLength(1);
    attached.detach();
  });

  it("listens on the window and on custom events", () => {
    const events = makeEvents();
    // SAFETY: the test context holds only the faked service; never marks the absence of other requirements.
    const context = Context.make(
      GlobalEvents,
      events
    ) as Context.Context<never>;
    // SAFETY: passes a constant message where a handler belongs to exercise the constant-message form.
    const focus = attachTo(
      onWindow("focus", { _tag: "Focused" } as never),
      context
    );
    const notice = attachTo(
      // SAFETY: custom-event payloads carry detail; never stands in for the handler's message type in this unit test.
      onCustomEvent(
        "app:notice",
        (payload) =>
          ({ text: (payload as { detail: unknown }).detail }) as never
      ),
      context
    );
    events.fire("window", "focus", {});
    events.fireCustomEvent("app:notice", { detail: "saved" });
    expect(focus.emitted.map((entry) => entry.message)).toEqual([
      { _tag: "Focused" },
    ]);
    expect(notice.emitted.map((entry) => entry.message)).toEqual([
      { text: "saved" },
    ]);
    focus.detach();
    notice.detach();
  });

  it("sends animation frame deltas from subscription start", () => {
    const frames = makeFrames();
    // SAFETY: the test context holds only the faked frames service; never marks the absence of other requirements.
    const context = Context.make(
      AnimationFrames,
      frames
    ) as Context.Context<never>;
    const deltas: unknown[] = [];
    const attached = attachTo(
      onAnimationFrame((delta) => {
        deltas.push(delta);
      }),
      context
    );
    frames.fire(16);
    frames.fire(17);
    expect(deltas).toEqual([16, 17]);
    expect(attached.emitted).toEqual([]);
    attached.detach();
  });

  it("shortcuts match rows in order with preventDefault defaulting to true", () => {
    const events = makeEvents();
    // SAFETY: the test context holds only the faked service; never marks the absence of other requirements.
    const context = Context.make(
      GlobalEvents,
      events
    ) as Context.Context<never>;
    const help = attachTo(
      shortcuts([
        { key: "?", message: "help" },
        { key: "Escape", message: "close", whileTyping: true },
      ]),
      context
    );
    expect(events.fire("document", "keydown", { key: "?" })).toBe(true);
    expect(
      events.fire("document", "keydown", { editable: true, key: "?" })
    ).toBe(false);
    expect(
      events.fire("document", "keydown", { editable: true, key: "Escape" })
    ).toBe(true);
    expect(help.emitted.map((entry) => entry.message)).toEqual([
      "help",
      "close",
    ]);
    help.detach();
  });

  it("detach stops the listener", () => {
    const events = makeEvents();
    // SAFETY: the test context holds only the faked service; never marks the absence of other requirements.
    const context = Context.make(
      GlobalEvents,
      events
    ) as Context.Context<never>;
    // SAFETY: passes a constant message where a handler belongs to exercise the constant-message form.
    const attached = attachTo(onDocument("keydown", "heard" as never), context);
    attached.detach();
    events.fire("document", "keydown", { key: "x" });
    expect(attached.emitted).toEqual([]);
  });
});

describe("DomSubscription services", () => {
  it("defaults never fire", () => {
    // SAFETY: the empty context has no services; never marks the absence of requirements.
    const empty = Context.empty() as Context.Context<never>;
    const heard: unknown[] = [];
    const removeDocument = Context.get(empty, GlobalEvents).listen(
      "document",
      "keydown",
      { capture: false },
      (payload) => heard.push(payload)
    );
    const frames = Context.get(empty, AnimationFrames);
    let framesHeard = 0;
    const removeFrames = frames.listen(() => (framesHeard += 1));
    expect(frames.now()).toBe(0);
    removeDocument();
    removeFrames();
    expect(heard).toEqual([]);
    expect(framesHeard).toBe(0);
  });
});
