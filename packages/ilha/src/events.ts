import * as Effect from "effect/Effect";

import type { FiberLocal } from "./runtime.ts";

type IlhaNode = Element & {
  __ilhaProps?: Record<string, unknown>;
  __ilhaEvents?: Set<string>;
};

export function isEventProp(key: string): boolean {
  return key.length > 2 && key.startsWith("on") && key === key.toLowerCase();
}

let capture: ((key: string, args: unknown[]) => void) | undefined;

/** Record a server-action call during SSR event capture. Returns true when capturing. */
export function recordServerAction(key: string, args: unknown[]): boolean {
  if (!capture) return false;
  capture(key, args);
  return true;
}

export function bindEvents(node: Element, props: Record<string, unknown>, fiber: FiberLocal): void {
  const el = node as IlhaNode;
  el.__ilhaProps = props;
  el.__ilhaEvents ??= new Set();
  for (const key of Object.keys(props)) {
    if (!isEventProp(key)) continue;
    const type = key.slice(2);
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
      let rec: { k: string; a: unknown[] } | undefined = branded?.k
        ? { k: branded.k, a: branded.a ?? [] }
        : undefined;
      if (!rec) {
        if (!fiber.runtime.ssrCapture) continue;
        const prev = capture;
        capture = (k, a) => {
          rec = { k, a };
        };
        try {
          fn({
            type,
            preventDefault() {},
            stopPropagation() {},
            currentTarget: el,
            target: el,
          });
        } catch {
          /* capture only */
        } finally {
          capture = prev;
        }
      }
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
