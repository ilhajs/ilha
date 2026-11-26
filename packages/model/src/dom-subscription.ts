/**
 * Subscriptions to the page: document, window and custom events, animation
 * frames, and shortcut tables. They are `Subscription.direct` sources, so
 * the listener attaches synchronously and each event runs the handler from
 * the latest `subscriptions` result. Nothing listens on the server. Ported
 * from Effect UI's `html-subscription.ts`, reusing `keyboard.ts`.
 */
import * as Context from "effect/Context";

import * as Keyboard from "./keyboard.ts";
import * as Subscription from "./subscription.ts";

/**
 * A `keydown` or `keyup` payload as a document listener sees it: the
 * {@link Keyboard.KeyPayload} plus whether another handler already called
 * `preventDefault`. Defined once in {@link Keyboard}, aliased here so both
 * import paths keep working.
 */
export type DocumentKeyPayload = Keyboard.DocumentKeyPayload;

/**
 * The payload of a pointer event on the document: the button, the position
 * in the viewport, the modifier keys, and the kind of pointer.
 */
export interface PointerPayload {
  /** The button pressed: `0` for the primary button. */
  readonly button: number;
  /** The horizontal position in the viewport, in CSS pixels. */
  readonly x: number;
  /** The vertical position in the viewport, in CSS pixels. */
  readonly y: number;
  /** Whether Shift was held. */
  readonly shift: boolean;
  /** Whether Ctrl was held. */
  readonly ctrl: boolean;
  /** Whether Alt was held. */
  readonly alt: boolean;
  /** Whether Meta (Cmd/Win) was held. */
  readonly meta: boolean;
  /** What pressed: `"mouse"`, `"touch"`, `"pen"`, or `""`. */
  readonly pointerType: "mouse" | "touch" | "pen" | "";
}

/**
 * The events `onDocument` listens for, with their payloads.
 */
export interface DocumentEvents {
  readonly keydown: Keyboard.KeyPayload;
  readonly keyup: Keyboard.KeyPayload;
  readonly mousedown: PointerPayload;
  readonly mouseup: PointerPayload;
  readonly click: PointerPayload;
  readonly pointerup: PointerPayload;
  readonly pointercancel: PointerPayload;
}

/**
 * The events `onWindow` listens for. `focus` and `blur` don't bubble, so a
 * listener hears only the window's own focus changes.
 */
export interface WindowEvents {
  readonly focus: Readonly<Record<never, never>>;
  readonly blur: Readonly<Record<never, never>>;
}

/**
 * The payload of a document or window listener: the event's payload, and
 * whether something already cancelled the event's default. In the bubble
 * phase `defaultPrevented` includes every element handler's
 * `preventDefault`; in the capture phase it depends on listener order, so
 * don't read it there.
 */
export type GlobalPayload<P> = P & {
  readonly defaultPrevented: boolean;
};

/**
 * The payload of `onCustomEvent`: the event's `detail`, `null` when the
 * event has none.
 */
export interface CustomEventPayload {
  /** The event's detail, or `null`. */
  readonly detail: unknown;
}

/**
 * The options of `onDocument`, `onCustomEvent` and `onWindow`:
 * `preventDefault`, as on an element's handler, and `capture`, to listen in
 * the capture phase. `preventDefault: true` cancels only when the handler
 * returns a message; `"always"` cancels unconditionally, before the handler
 * runs.
 */
export interface GlobalEventOptions {
  /** Cancel the default only for a message, always, or never. */
  readonly preventDefault?: boolean | "always" | undefined;
  /** Listen in the capture phase, before any element sees the event. */
  readonly capture?: boolean | undefined;
}

/**
 * A handler for a page event: a message, or a function of the payload that
 * returns one or `undefined` for nothing.
 */
export type Handler<Msg, Payload> =
  | Msg
  | ((payload: Payload) => Msg | undefined);

/**
 * The source of document and window events, which `onDocument`,
 * `onCustomEvent` and `onWindow` listen to. `listen` adds a listener and
 * returns the function that removes it. The default never fires. A test
 * fires events with `TestGlobalEvents` from `@ilha/model/test`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the interface is the service contract, the const its Reference; intentional merging like ilha's `Fragment`.
export interface GlobalEvents {
  /** Listen for `event` on `target`; returns the function that removes the listener. */
  readonly listen: (
    target: "document" | "window",
    event: string,
    options: {
      readonly capture: boolean;
      readonly custom?: boolean | undefined;
    },
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- listeners receive opaque per-event payloads; `eventPayload` decodes each event at the browser boundary.
    listener: (payload: unknown, preventDefault: () => void) => void
  ) => () => void;
}

/**
 * The source of document and window events. It defaults to one that never
 * fires.
 */
/** A document/window source that never fires: the default without a document. */
const silentEvents: GlobalEvents = {
  listen: () => (): void => {
    // never fires
  },
};

/**
 * The source of document and window events. It defaults to one that never
 * fires.
 */
export const GlobalEvents: Context.Reference<GlobalEvents> =
  Context.Reference<GlobalEvents>("@ilha/model/DomSubscription/GlobalEvents", {
    defaultValue: () => silentEvents,
  });

/**
 * The source of animation frames, which `onAnimationFrame` listens to.
 * `listen` calls the listener once per frame with the frame's time in ms,
 * until the function it returns is called. `now` is the current time on the
 * same clock. The default never fires (`now` returns `0`). A test fires
 * frames with `TestAnimationFrames` from `@ilha/model/test`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the interface is the service contract, the const its Reference; intentional merging like ilha's `Fragment`.
export interface AnimationFrames {
  /** The current time on the frames' clock, in ms. */
  readonly now: () => number;
  /** Call `listener` with each frame's time, until the returned function runs. */
  readonly listen: (listener: (time: number) => void) => () => void;
}

/** A frame source that never fires: the default without a document. */
const stillFrames: AnimationFrames = {
  listen: () => (): void => {
    // never fires
  },
  now: () => 0,
};

/**
 * The source of animation frames. It defaults to one that never fires.
 */
export const AnimationFrames: Context.Reference<AnimationFrames> =
  Context.Reference<AnimationFrames>(
    "@ilha/model/DomSubscription/AnimationFrames",
    { defaultValue: () => stillFrames }
  );

/** One listener the runtime attaches: its declaration, read back from the latest `subscriptions` result. */
interface Declared {
  readonly target: "document" | "window";
  readonly handler: Handler<unknown, unknown>;
  readonly preventDefault: boolean | "always" | undefined;
}

const pointerTypeOf = (event: Event): PointerPayload["pointerType"] => {
  // SAFETY: press events carry pointer fields; a missing `pointerType` falls back to `"mouse"`.
  const { pointerType } = event as Partial<PointerEvent>;
  return pointerType === "mouse" ||
    pointerType === "touch" ||
    pointerType === "pen" ||
    pointerType === ""
    ? pointerType
    : "mouse";
};

const pointerPayloadOf = (event: Event): PointerPayload => {
  // SAFETY: press events carry mouse fields; missing fields fall back to unpressed at the origin.
  const mouse = event as Partial<MouseEvent>;
  return {
    alt: mouse.altKey ?? false,
    button: mouse.button ?? 0,
    ctrl: mouse.ctrlKey ?? false,
    meta: mouse.metaKey ?? false,
    pointerType: pointerTypeOf(event),
    shift: mouse.shiftKey ?? false,
    x: mouse.clientX ?? 0,
    y: mouse.clientY ?? 0,
  };
};

/**
 * Build a document or window listener's payload from a DOM event: keyboard
 * payloads for `keydown`/`keyup` (see {@link Keyboard.keyPayload}), pointer
 * payloads for press events, and an empty payload otherwise — always with
 * `defaultPrevented`. Custom events carry `detail` instead; see the
 * `custom` branch of the browser listener.
 *
 * @internal
 */
export const eventPayload = (
  event: string,
  domEvent: Event,
  defaultPrevented: boolean
): GlobalPayload<unknown> => {
  if (event === "keydown" || event === "keyup") {
    // SAFETY: reached only for `keydown`/`keyup`, whose DOM events are `KeyboardEvent`s.
    return {
      ...Keyboard.keyPayload(domEvent as KeyboardEvent),
      defaultPrevented,
    };
  }
  if (
    event === "mousedown" ||
    event === "mouseup" ||
    event === "click" ||
    event === "pointerup" ||
    event === "pointercancel"
  ) {
    return { ...pointerPayloadOf(domEvent), defaultPrevented };
  }
  return { defaultPrevented };
};
/** Whether a declared handler is a function of the payload (otherwise it is a plain message). */
// oxlint-disable-next-line typescript/ban-types, typescript/no-unsafe-function-type -- the guard only tests callability; `runHandler` invokes it with the decoded payload.
const isHandlerFunction = (handler: Declared["handler"]): handler is Function =>
  typeof handler === "function";

const runHandler = (
  declared: Declared,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- handlers receive opaque per-event payloads; the declaration carries the payload shape.
  payload: unknown,
  preventDefault: () => void,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the runtime forwards decoded messages opaquely; the log encodes them by schema.
  emit: (message: unknown, accepted?: () => void) => void
): void => {
  if (declared.preventDefault === "always") {
    preventDefault();
  }
  const message = isHandlerFunction(declared.handler)
    ? declared.handler(payload)
    : declared.handler;
  if (message !== undefined) {
    emit(
      message,
      declared.preventDefault === true ? preventDefault : undefined
    );
  }
};

const listenFor = (
  target: "document" | "window",
  event: string,
  handler: Handler<unknown, unknown>,
  options: GlobalEventOptions | undefined,
  custom = false
): Subscription.Subscription<unknown> => {
  const capture = options?.capture === true;
  const declared: Declared = {
    handler,
    preventDefault: options?.preventDefault,
    target,
  };
  // The runtime attaches the listener here and runs no Stream. `enter`
  // renders the pending ancestors first, so an event goes to the latest
  // declaration, or nowhere if they removed it.
  return Subscription.direct(
    target === "document" ? "@ilha/model/document" : "@ilha/model/window",

    capture ? [event, "capture"] : [event],
    declared,
    (context, controls: Subscription.DirectControls<Declared, unknown>) => {
      // The kernel passes the instance's env, which always provides the
      // source; a missing one throws, and the instance fails in
      // `"subscription"`.
      // SAFETY: the kernel passes the instance's env, which `baseEnv` seeds with the event source.
      const source = Context.get(
        context as Context.Context<GlobalEvents>,
        GlobalEvents
      );
      return source.listen(
        target,
        event,
        { capture, custom },
        (payload, preventDefault) =>
          controls.enter((latest) => {
            try {
              // SAFETY: the kernel replays the latest `subscriptions` declaration, which keeps the `Declared` shape.
              runHandler(
                (latest ?? declared) as Declared,
                payload,
                preventDefault,
                controls.emit
              );
            } catch (error) {
              controls.fail(error);
            }
          })
      );
    }
  );
};

/**
 * A Subscription that sends a message on every animation frame, with the
 * time since the last one in ms. Gate the entry on the Model, so frames
 * come only while the component wants them: a hidden tab sends no frames,
 * so the first frame back covers the whole time away — cap the delta in
 * `update` when it drives motion.
 *
 * The first delta counts from when the Subscription starts, so a pause and
 * resume doesn't jump. The key is `@ilha/model/animationFrame`, and an
 * instance has one.
 */
export const onAnimationFrame = <Msg>(
  handler: Handler<Msg, number>
): Subscription.Subscription<Msg> => {
  // SAFETY: `Msg` is opaque to the document listener; the runtime reattaches the latest declaration per render.
  const declared: Declared = {
    handler: handler as Handler<unknown, unknown>,
    preventDefault: undefined,
    target: "document",
  };
  const subscription: Subscription.Subscription<unknown> = Subscription.direct(
    "@ilha/model/animationFrame",
    [],
    declared,
    (context, controls: Subscription.DirectControls<Declared, unknown>) => {
      // SAFETY: the kernel passes the instance's env, which `baseEnv` seeds with the frame source.
      const source = Context.get(
        context as Context.Context<AnimationFrames>,
        AnimationFrames
      );
      let last = source.now();
      return source.listen((time) => {
        const delta = Math.max(0, time - last);
        last = time;
        controls.enter((latest) => {
          try {
            // SAFETY: the kernel replays the latest `subscriptions` declaration, which keeps the `Declared` shape.
            const use = (latest ?? declared) as Declared;
            const message = isHandlerFunction(use.handler)
              ? use.handler(delta)
              : use.handler;
            if (message !== undefined) {
              controls.emit(message);
            }
          } catch (error) {
            controls.fail(error);
          }
        });
      });
    }
  );
  // SAFETY: the frame listener emits numbers through `Msg` handlers; the outer type recovers the message channel.
  return subscription as Subscription.Subscription<Msg>;
};

/**
 * A Subscription that listens for an event on the host's document: input no
 * element of the component hears, such as a shortcut, a game's arrow keys,
 * or a press outside a popup. Gate the entry on the Model, so the listener
 * exists only while it's wanted.
 *
 * `handler` is a message or a function of the payload, and the payload is
 * plain data with `defaultPrevented` added. The listener calls the handler
 * of the latest `subscriptions` result. The key is
 * `@ilha/model/document` with the event as its dep
 * (`@ilha/model/document:"keydown"`), and `"capture"` after it for a
 * capture listener. An instance has one listener per event and phase:
 * listing a second fails the instance as a duplicate key.
 */
export const onDocument = <K extends keyof DocumentEvents, Msg>(
  event: K,
  handler: Handler<Msg, GlobalPayload<DocumentEvents[K]>>,
  options?: GlobalEventOptions | undefined
): Subscription.Subscription<Msg> =>
  // SAFETY: `Msg` is opaque to the document listener; the runtime reattaches the latest declaration per render.
  listenFor(
    "document",
    event,
    handler as Handler<unknown, unknown>,
    options
  ) as Subscription.Subscription<Msg>;

/**
 * A Subscription that listens for a table of single-key shortcuts on the
 * host's document: `onDocument` on `"keydown"` with the handler of
 * `Keyboard.shortcuts`. `preventDefault` defaults to `true`, so the
 * browser's default is cancelled for a matched key and kept for every other
 * key. It uses the key of `onDocument("keydown")`, so it can't coexist with
 * one; combine via `Keyboard.shortcuts` inside `onDocument` instead.
 */
export const shortcuts = <
  const Rows extends readonly Keyboard.Shortcut<unknown>[],
>(
  table: Rows,
  options?: GlobalEventOptions | undefined
): Subscription.Subscription<Rows[number]["message"]> =>
  onDocument("keydown", Keyboard.shortcuts(table), {
    ...options,
    preventDefault: options?.preventDefault ?? true,
  });

/**
 * A Subscription that listens for an event on the host's window. It works
 * as `onDocument` does, with the key `@ilha/model/window`.
 */
export const onWindow = <K extends keyof WindowEvents, Msg>(
  event: K,
  handler: Handler<Msg, GlobalPayload<WindowEvents[K]>>,
  options?: GlobalEventOptions | undefined
): Subscription.Subscription<Msg> =>
  // SAFETY: `Msg` is opaque to the window listener; the runtime reattaches the latest declaration per render.
  listenFor(
    "window",
    event,
    handler as Handler<unknown, unknown>,
    options
  ) as Subscription.Subscription<Msg>;

/**
 * A Subscription that listens for a `CustomEvent` on the host's document.
 * It works as `onDocument` does, with the key `@ilha/model/document`, for
 * an event type outside `DocumentEvents`. The payload carries the event's
 * `detail` and `defaultPrevented`.
 */
export const onCustomEvent = <Msg>(
  event: string,
  handler: Handler<Msg, GlobalPayload<CustomEventPayload>>,
  options?: GlobalEventOptions | undefined
): Subscription.Subscription<Msg> =>
  // SAFETY: `Msg` is opaque to the document listener; the runtime reattaches the latest declaration per render.
  listenFor(
    "document",
    event,
    handler as Handler<unknown, unknown>,
    options,
    true
  ) as Subscription.Subscription<Msg>;
