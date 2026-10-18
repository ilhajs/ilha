import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";

import type { FiberLocal } from "./runtime.ts";
import { isFunction } from "./shared.ts";
import type { PropBag, PropValue } from "./types.ts";

interface IlhaNode extends Element {
  /** Current handler per event type; replaced on every render. */
  __ilhaHandlers?: Map<string, PropValue>;
  /** Fiber that owns the current handlers. */
  __ilhaFiber?: FiberLocal;
  /** Event types with a native listener installed on this element. */
  __ilhaEvents?: Set<string>;
}

type HandlerResult = PropValue | Effect.Effect<unknown, unknown, AtomRegistry>;

const EVENT_PROP = /^on(?:[A-Z].{2,}|[a-z]{3,}$)/u;

/** `onClick` / `onclick` → `click`; non-event props → `undefined`. */
export const eventTypeFromProp = (key: string): string | undefined =>
  EVENT_PROP.test(key) ? key.slice(2).toLowerCase() : undefined;

/** One native listener per type; it reads the latest handler at dispatch. */
const listen = (el: IlhaNode, type: string): void => {
  el.__ilhaEvents ??= new Set();
  if (el.__ilhaEvents.has(type)) {
    return;
  }
  el.__ilhaEvents.add(type);
  el.addEventListener(type, (ev) => {
    const fiber = el.__ilhaFiber;
    const fn = el.__ilhaHandlers?.get(type);
    if (!fiber || fiber.closed || !isFunction(fn)) {
      return;
    }
    // SAFETY: isFunction narrowed the prop to a callable event handler; a
    // handler may return an effect needing at most the AtomRegistry.
    const handler = fn as (event: Event) => HandlerResult;
    const out = handler(ev);
    if (Effect.isEffect(out)) {
      fiber.run(out);
    }
  });
};

const install = (
  el: IlhaNode,
  handlers: Map<string, PropValue> | undefined,
  fiber: FiberLocal | undefined
): void => {
  el.__ilhaHandlers = handlers;
  el.__ilhaFiber = fiber;
  for (const type of handlers?.keys() ?? []) {
    listen(el, type);
  }
};

export const bindEvents = (
  el: Element,
  props: PropBag,
  fiber: FiberLocal
): void => {
  const handlers = new Map<string, PropValue>();
  for (const [key, value] of Object.entries(props)) {
    const type = eventTypeFromProp(key);
    if (type && !handlers.has(type)) {
      handlers.set(type, value);
    }
  }
  install(el, handlers, fiber);
};

/**
 * The morph kept `live` in place of the freshly rendered `fresh`: hand the
 * render's handlers to the live node, so closures never go stale and handlers
 * added on a later render still fire.
 */
export const adoptEvents = (live: Element, fresh: IlhaNode): void => {
  if (fresh.__ilhaFiber) {
    install(live, fresh.__ilhaHandlers, fresh.__ilhaFiber);
  }
};
