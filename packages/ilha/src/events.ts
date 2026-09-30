import * as Effect from "effect/Effect";

import type { FiberLocal } from "./runtime.ts";
import { isFunction } from "./shared.ts";
import type { PropBag, PropValue, SsrAction } from "./types.ts";

interface IlhaNode extends Element {
  dataset: DOMStringMap;
  /** Current handler per event type; replaced on every render. */
  __ilhaHandlers?: Map<string, PropValue>;
  /** Fiber that owns the current handlers. */
  __ilhaFiber?: FiberLocal;
  /** Event types with a native listener installed on this element. */
  __ilhaEvents?: Set<string>;
}

const ACTION_CALL: unique symbol = Symbol.for("ilha.actionCall");

interface ActionBrand {
  k?: string;
  a?: SsrAction["a"];
}

export const eventTypeFromProp = (key: string): string | undefined => {
  if (key.length < 4) {
    return undefined;
  }
  let type: string | undefined;
  if (/^on[A-Z]/u.test(key)) {
    type = key.slice(2).toLowerCase();
  } else if (/^on[a-z]{3,}$/u.test(key)) {
    type = key.slice(2).toLowerCase();
  } else {
    return undefined;
  }
  return type.length >= 3 ? type : undefined;
};

export const isEventProp = (key: string): boolean =>
  eventTypeFromProp(key) !== undefined;

const dispatch = (el: IlhaNode, type: string, ev: Event): void => {
  const fiber = el.__ilhaFiber;
  if (!fiber || fiber.closed) {
    return;
  }
  const fn = el.__ilhaHandlers?.get(type);
  if (!isFunction(fn)) {
    return;
  }
  // SAFETY: isFunction narrowed the prop to a callable event handler.
  const handler = fn as (event: Event) => PropValue;
  const out = handler(ev);
  if (Effect.isEffect(out)) {
    // SAFETY: Effect.isEffect verified the value is an Effect; fiber.run
    // provides the runtime services it needs.
    fiber.run(out as Effect.Effect<unknown, unknown, never>);
  }
};

/** One native listener per type; it reads the latest handler at dispatch. */
const listen = (el: IlhaNode, type: string): void => {
  el.__ilhaEvents ??= new Set();
  if (el.__ilhaEvents.has(type)) {
    return;
  }
  el.__ilhaEvents.add(type);
  el.addEventListener(type, (ev) => {
    dispatch(el, type, ev);
  });
};

const bindSsrActions = (
  el: IlhaNode,
  props: PropBag,
  fiber: FiberLocal
): void => {
  const seen = new Set<string>();
  for (const key of Object.keys(props)) {
    const type = eventTypeFromProp(key);
    if (!type || seen.has(type)) {
      continue;
    }
    seen.add(type);
    const fn = props[key];
    if (!isFunction(fn)) {
      continue;
    }
    // SAFETY: event handlers may carry a Symbol.for("ilha.actionCall") stamp
    // from action.with(); Function's type has no symbol index, so the brand
    // is read through the computed key.
    const branded = (fn as { [ACTION_CALL]?: ActionBrand })[ACTION_CALL];
    const rec = branded?.k ? { a: branded.a ?? [], k: branded.k } : undefined;
    if (!rec) {
      continue;
    }
    const id = `${type}:${fiber.runtime.ssrEventI}`;
    fiber.runtime.ssrEventI += 1;
    fiber.runtime.ssrActions[id] = rec;
    const existing = el.dataset.ilhaOn;
    el.dataset.ilhaOn = existing ? `${existing},${id}` : id;
  }
};

export const bindEvents = (
  node: Element,
  props: PropBag,
  fiber: FiberLocal
): void => {
  // SAFETY: bindEvents runs on real DOM elements from the painter; the ilha
  // bookkeeping fields (including dataset) are attached to that element here.
  const el = node as IlhaNode;
  if (fiber.runtime.ssr) {
    bindSsrActions(el, props, fiber);
    return;
  }
  const handlers = new Map<string, PropValue>();
  for (const key of Object.keys(props)) {
    const type = eventTypeFromProp(key);
    if (type && !handlers.has(type)) {
      handlers.set(type, props[key]);
    }
  }
  el.__ilhaHandlers = handlers;
  el.__ilhaFiber = fiber;
  for (const type of handlers.keys()) {
    listen(el, type);
  }
};

/**
 * The morph kept `live` in place of the freshly rendered `fresh`: hand the
 * render's handlers to the live node, so closures never go stale and handlers
 * added on a later render still fire.
 */
export const adoptEvents = (live: Element, fresh: Element): void => {
  // SAFETY: both are painter elements carrying ilha bookkeeping fields.
  const from = fresh as IlhaNode;
  if (!from.__ilhaFiber) {
    return;
  }
  // SAFETY: same bookkeeping fields on the live node.
  const to = live as IlhaNode;
  to.__ilhaHandlers = from.__ilhaHandlers;
  to.__ilhaFiber = from.__ilhaFiber;
  for (const type of from.__ilhaHandlers?.keys() ?? []) {
    listen(to, type);
  }
};
