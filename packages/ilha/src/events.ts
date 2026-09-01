import * as Effect from "effect/Effect";

import type { FiberLocal } from "./runtime.ts";

type IlhaNode = Element & {
  __ilhaProps?: Record<string, unknown>;
  __ilhaEvents?: Set<string>;
};

export function eventTypeFromProp(key: string): string | undefined {
  if (key.length < 4) return undefined;
  let type: string | undefined;
  if (/^on[A-Z]/.test(key)) type = key.slice(2).toLowerCase();
  else if (/^on[a-z]{3,}$/.test(key)) type = key.slice(2).toLowerCase();
  else return undefined;
  return type.length >= 3 ? type : undefined;
}

export function isEventProp(key: string): boolean {
  return eventTypeFromProp(key) !== undefined;
}

export function bindEvents(node: Element, props: Record<string, unknown>, fiber: FiberLocal): void {
  const el = node as IlhaNode;
  el.__ilhaProps = props;
  el.__ilhaEvents ??= new Set();
  for (const key of Object.keys(props)) {
    const type = eventTypeFromProp(key);
    if (!type) continue;
    if (el.__ilhaEvents.has(type)) continue;
    el.__ilhaEvents.add(type);
    if (fiber.runtime.ssr) {
      const fn = props[key];
      if (typeof fn !== "function") continue;
      // SAFETY: event handlers may carry a Symbol.for("ilha.actionCall") stamp from
      // action.with(); Function's type has no symbol index, so we read it via unknown.
      const branded = (fn as unknown as Record<symbol, { k?: string; a?: unknown[] }>)[
        Symbol.for("ilha.actionCall")
      ];
      const rec = branded?.k ? { k: branded.k, a: branded.a ?? [] } : undefined;
      if (!rec) continue;
      const id = `${type}:${fiber.runtime.ssrEventI++}`;
      fiber.runtime.ssrActions[id] = rec;
      const existing = el.getAttribute("data-ilha-on");
      el.setAttribute("data-ilha-on", existing ? `${existing},${id}` : id);
      continue;
    }
    el.addEventListener(type, (ev) => {
      if (fiber.closed) return;
      const fn = el.__ilhaProps?.[key];
      if (typeof fn !== "function") return;
      const out = fn(ev);
      if (Effect.isEffect(out)) fiber.run(out as Effect.Effect<unknown, unknown, never>);
    });
  }
}
