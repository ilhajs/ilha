/**
 * The document, window, custom-event and animation-frame steps behind
 * Scene's `fireDocument`, `fireWindow`, `fireCustomEvent` and `frame`.
 * They run the active `direct` subscriptions' handlers purely: capture
 * listeners first, then bubble, with each phase re-reading the current
 * subscriptions. Nothing listens, or an `undefined` handler result that
 * isn't a frame tick, marks the interaction ignored.
 */
import { isDirect } from "../subscription.ts";
import type { Engine } from "./engine.ts";

/** The subscription names `fireDocument` and `fireWindow` select. */
const DOCUMENT = "@ilha/model/document";
const WINDOW = "@ilha/model/window";
const ANIMATION_FRAME = "@ilha/model/animationFrame";

/** A direct subscription's declared handler and options. */
interface Declared {
  readonly handler: unknown;
  readonly preventDefault?: boolean | undefined;
}

/** Whether `value` is a non-null object. */
const isObject = <T>(value: T): value is T & object =>
  typeof value === "object" && value !== null;

const declaredOf = (subscription: {
  readonly directState?: unknown;
}): Declared | undefined => {
  const state = subscription.directState;
  if (!isObject(state) || !("handler" in state)) {
    return undefined;
  }
  // SAFETY: `in` narrows `state` to a record carrying `handler`; Declared's other field is optional.
  return state as Declared;
};

/** An active global listener: its handler, options, and capture phase. */
interface ActiveListener {
  readonly handler: unknown;
  readonly preventDefault: boolean | undefined;
  readonly capture: boolean;
}

/** The active direct subscriptions for a global target and event. */
const targetDecls = (
  engine: Engine,
  name: string,
  event?: string
): ActiveListener[] => {
  const out: ActiveListener[] = [];
  for (const sub of engine.subscriptionDecls()) {
    if (sub.name !== name || !isDirect(sub)) {
      continue;
    }
    const deps = sub.deps ?? [];
    if (event !== undefined && deps[0] !== event) {
      continue;
    }
    const declared = declaredOf(sub);
    if (declared === undefined) {
      continue;
    }
    out.push({
      capture: deps.includes("capture"),
      handler: declared.handler,
      preventDefault: declared.preventDefault,
    });
  }
  return out;
};

/** The payload object a global listener receives. */
interface GlobalPayload {
  readonly type: string;
  defaultPrevented: boolean;
  preventDefault: () => void;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- global listeners receive arbitrary event fields; makePayload spreads them onto a fresh object.
  readonly [field: string]: unknown;
}

/** Whether `value` is a handler callable with the given payload. */
const isHandler = <T, P>(value: T): value is T & ((payload: P) => never) =>
  typeof value === "function";

/** Builds the payload object a global listener receives. */
const makePayload = <T>(type: string, payload: T): GlobalPayload => {
  const base = isObject(payload) ? { ...payload } : {};
  // SAFETY: base carries only the caller's own fields; the known fields below take precedence as before.
  const event = { ...base, defaultPrevented: false, type } as GlobalPayload;
  event.preventDefault = () => {
    event.defaultPrevented = true;
  };
  return event;
};

/** Runs one listener's handler, delivering its message if any. */
const runListener = <H, P>(
  engine: Engine,
  step: string,
  handler: H,
  payload: P
): Fired => {
  let message: unknown;
  try {
    message = isHandler(handler) ? handler(payload) : handler;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    throw new Error(`${step}: a subscription handler threw: ${messageText}`, {
      cause: error,
    });
  }
  if (message === undefined) {
    return { prevented: false, produced: false };
  }
  engine.deliver(message);
  return { prevented: false, produced: true };
};

/** The outcome of firing global listeners. */
export interface Fired {
  readonly produced: boolean;
  readonly prevented: boolean;
}

/**
 * Runs document or window listeners for `event`: capture listeners with
 * the capture flag first, then the rest, each phase re-reading the
 * current subscriptions. Throws when nothing listens.
 */
export const fireGlobal = (
  engine: Engine,
  step: string,
  target: "document" | "window",
  event: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- global listeners receive arbitrary event payloads; the payload is spread onto a fresh object in makePayload.
  payload: unknown = {}
): Fired => {
  const name = target === "document" ? DOCUMENT : WINDOW;
  const active = engine.subscriptionKeys(`${engine.module}.subscriptions`);
  if (!active.some((key) => key === name || key.startsWith(`${name}:`))) {
    throw new Error(
      `${step}: nothing listens for "${event}" on ${target}${
        active.length === 0
          ? `: the component has no active subscriptions`
          : `; active subscriptions:\n  - ${active.join("\n  - ")}`
      }`
    );
  }
  let produced = false;
  let prevented = false;
  for (const capture of [true, false]) {
    const decls = targetDecls(engine, name, event).filter(
      (decl) => decl.capture === capture
    );
    for (const decl of decls) {
      const eventPayload = makePayload(event, payload);
      const outcome = runListener(engine, step, decl.handler, eventPayload);
      if (decl.preventDefault === true && outcome.produced) {
        eventPayload.preventDefault();
      }
      produced = outcome.produced || produced;
      prevented = eventPayload.defaultPrevented || prevented;
    }
  }
  return { prevented, produced };
};

/**
 * Runs custom-event listeners for `event`: the document listeners for the
 * type, receiving the payload as their `detail`. Throws when nothing
 * listens.
 */
export const fireCustomEvent = (
  engine: Engine,
  step: string,
  event: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- custom-event details carry arbitrary payloads; the payload is spread onto a fresh object in makePayload.
  payload: unknown = {}
): Fired => {
  const active = engine.subscriptionKeys(`${engine.module}.subscriptions`);
  if (
    !active.some((key) => key === DOCUMENT || key.startsWith(`${DOCUMENT}:`))
  ) {
    throw new Error(
      `${step}: nothing listens for the custom event "${event}"${
        active.length === 0
          ? `: the component has no active subscriptions`
          : `; active subscriptions:\n  - ${active.join("\n  - ")}`
      }`
    );
  }
  return fireGlobal(engine, step, "document", event, { detail: payload });
};

/**
 * Runs animation-frame listeners with `delta`, delivering each defined
 * message. Throws when nothing listens.
 */
export const fireFrame = (
  engine: Engine,
  step: string,
  delta: number
): Fired => {
  const decls = targetDecls(engine, ANIMATION_FRAME);
  if (decls.length === 0) {
    throw new Error(
      `${step}: nothing listens for animation frames: gate an onAnimationFrame subscription on the Model first`
    );
  }
  let produced = false;
  for (const decl of decls) {
    const outcome = runListener(engine, step, decl.handler, delta);
    produced = outcome.produced || produced;
  }
  return { prevented: false, produced };
};
