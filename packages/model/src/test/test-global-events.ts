/**
 * A fake `DomSubscription.GlobalEvents` for whole-app tests, so a test
 * fires document and window events without a document, in Node too.
 *
 * Provide `layer` next to the host layer. Fire events with `fire` and
 * `fireCustomEvent`, then settle the host to see the updates.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DomSubscription from "../dom-subscription";

/**
 * The `TestGlobalEvents` service: the fake's control.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair, mirroring ilha's Fragment.
export interface TestGlobalEvents {
  /**
   * Fires `event` on `target` through the fake, and returns whether a
   * listener cancelled the default.
   */
  readonly fire: (
    target: "document" | "window",
    event: string,
    // oxlint-disable-next-line anti-slop/no-object-parameters -- payloads are spreadable event objects merged with per-event defaults below.
    payload?: object | undefined
  ) => boolean;
  /**
   * Fires a custom `event` on the document through the fake, and returns
   * whether a listener cancelled the default.
   */
  readonly fireCustomEvent: (
    event: string,
    // oxlint-disable-next-line anti-slop/no-object-parameters -- payloads are spreadable event objects merged with the detail below.
    payload?: object | undefined
  ) => boolean;
}

/**
 * The `TestGlobalEvents` service.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair, mirroring ilha's Fragment.
export const TestGlobalEvents: Context.Service<
  TestGlobalEvents,
  TestGlobalEvents
> = Context.Service<TestGlobalEvents>("@ilha/model/test/TestGlobalEvents");

interface Entry<Payload> {
  readonly target: string;
  readonly event: string;
  readonly capture: boolean;
  readonly listener: (payload: Payload, preventDefault: () => void) => void;
}

/**
 * Makes a fake source and its control. `layer` provides a new one per
 * build.
 */
export const make = (): DomSubscription.GlobalEvents & TestGlobalEvents => {
  const entries = new Set<Entry<unknown>>();
  const pointerDefaults = {
    alt: false,
    button: 0,
    ctrl: false,
    meta: false,
    pointerType: "mouse" as const,
    shift: false,
    x: 0,
    y: 0,
  };
  const defaultsFor = (event: string): object | undefined => {
    if (event === "keydown" || event === "keyup") {
      return {
        alt: false,
        composing: false,
        ctrl: false,
        editable: false,
        key: "",
        meta: false,
        repeat: false,
        selectionEnd: null,
        selectionStart: null,
        shift: false,
      };
    }
    if (
      event === "mousedown" ||
      event === "mouseup" ||
      event === "click" ||
      event === "pointerup" ||
      event === "pointercancel"
    ) {
      return { ...pointerDefaults };
    }
    return undefined;
  };
  const fireTarget = <G extends object>(
    target: string,
    event: string,
    given: G | undefined
  ): boolean => {
    const prevented =
      given !== undefined &&
      "defaultPrevented" in given &&
      given.defaultPrevented === true;
    let cancelled = false;
    const preventDefault = (): void => {
      cancelled = true;
    };
    // Capture listeners, then bubble, in insertion order; snapshotted per
    // phase, skipping any an earlier one's message removed — as a browser
    // reads them.
    for (const capture of [true, false]) {
      // oxlint-disable-next-line unicorn/no-useless-spread -- entries are snapshotted per phase: a listener's message may remove later entries mid-phase.
      for (const entry of [...entries]) {
        if (
          entry.target !== target ||
          entry.event !== event ||
          entry.capture !== capture ||
          !entries.has(entry)
        ) {
          continue;
        }
        entry.listener(
          {
            ...defaultsFor(event),
            ...given,
            defaultPrevented: prevented || cancelled,
          },
          preventDefault
        );
      }
    }
    return cancelled;
  };
  const fire = <G extends object>(
    target: "document" | "window",
    event: string,
    payload?: G | undefined
  ): boolean => fireTarget(target, event, payload);
  return {
    fire,
    fireCustomEvent: (event, payload) =>
      fire("document", event, {
        ...payload,
        detail:
          payload !== undefined && "detail" in payload
            ? (payload.detail ?? null)
            : null,
      }),
    listen: (target, event, { capture }, listener) => {
      const entry: Entry<unknown> = { capture, event, listener, target };
      entries.add(entry);
      return () => {
        entries.delete(entry);
      };
    },
  };
};

/**
 * Provides a fake `DomSubscription.GlobalEvents` with its control,
 * `TestGlobalEvents`.
 */
export const layer: Layer.Layer<TestGlobalEvents> = Layer.effectContext(
  Effect.sync(() => {
    const events = make();
    return Context.make(TestGlobalEvents, events).pipe(
      // SAFETY: `make` returns one object implementing both services; the cast reuses it for each key.
      Context.add(
        DomSubscription.GlobalEvents,
        events as DomSubscription.GlobalEvents
      )
    );
  })
);

/**
 * Fires `event` on `target` through the fake, and returns whether a
 * listener cancelled the default.
 */
export const fire = (
  target: "document" | "window",
  event: string,
  // oxlint-disable-next-line anti-slop/no-object-parameters -- payloads are spreadable event objects merged with per-event defaults in make.
  payload?: object | undefined
): Effect.Effect<boolean, never, TestGlobalEvents> =>
  TestGlobalEvents.useSync((events) => events.fire(target, event, payload));

/**
 * Fires a custom `event` on the document through the fake, and returns
 * whether a listener cancelled the default.
 */
export const fireCustomEvent = (
  event: string,
  // oxlint-disable-next-line anti-slop/no-object-parameters -- payloads are spreadable event objects, carried as the custom event's detail.
  payload?: object | undefined
): Effect.Effect<boolean, never, TestGlobalEvents> =>
  TestGlobalEvents.useSync((events) => events.fireCustomEvent(event, payload));
