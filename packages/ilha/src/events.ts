import * as Effect from "effect/Effect";

import type { FiberLocal } from "./runtime.ts";
import { isFunction } from "./shared.ts";
import type { PropBag, PropValue, SsrAction } from "./types.ts";

interface IlhaNode extends Element {
  dataset: DOMStringMap;
  __ilhaProps?: PropBag;
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

export const bindEvents = (
  node: Element,
  props: PropBag,
  fiber: FiberLocal
): void => {
  // SAFETY: bindEvents runs on real DOM elements from the painter; the ilha
  // bookkeeping fields (including dataset) are attached to that element here.
  const el = node as IlhaNode;
  el.__ilhaProps = props;
  el.__ilhaEvents ??= new Set();
  for (const key of Object.keys(props)) {
    const type = eventTypeFromProp(key);
    if (!type) {
      continue;
    }
    if (el.__ilhaEvents.has(type)) {
      continue;
    }
    el.__ilhaEvents.add(type);
    if (fiber.runtime.ssr) {
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
      continue;
    }
    el.addEventListener(type, (ev) => {
      if (fiber.closed) {
        return;
      }
      const fn = el.__ilhaProps?.[key];
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
    });
  }
};
