import { eventTypeFromProp } from "./events.ts";
import { createPainter } from "./paint-core.ts";
import type { PaintOps } from "./paint-core.ts";
import { closeFiber, makeRootFiber, makeRuntime } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import { defer, isFunction, SLOT_ATTR } from "./shared.ts";
import {
  createSsrElement,
  createSsrRaw,
  createSsrRoot,
  createSsrText,
} from "./ssr-dom.ts";
import type { SsrEl, SsrNode, SsrRoot } from "./ssr-dom.ts";
import { runSetup } from "./start.ts";
import type {
  Component,
  IlhaRuntime,
  PropBag,
  SsrAction,
  View,
} from "./types.ts";

type SsrHost = SsrRoot | SsrEl;

// SAFETY: SSR fibers are constructed with SsrNode values, but the shared
// FiberLocal/IslandSlot types are typed for the DOM (ParentNode/Element) so both
// painters can use them. These casts restore the SSR view of those values.
const ssrAs = <T>(n: T): T => n;

const ACTION_CALL = Symbol.for("ilha.actionCall");

interface ActionBrand {
  k?: string;
  a?: SsrAction["a"];
}

const bindSsrEvents = (el: SsrEl, props: PropBag, fiber: FiberLocal): void => {
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
    // SAFETY: event handlers may carry a Symbol.for("ilha.actionCall") stamp from
    // action.with(); Function's type has no symbol index, so we read it via brand.
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

const WHITESPACE_RUN = /\s+/gu;

/**
 * Mark the first option whose value is `value` selected and clear the rest,
 * as setting a live select's `.value` does. Returns whether one matched.
 */
const selectOption = (
  parent: SsrEl,
  value: string,
  found: boolean
): boolean => {
  let matched = found;
  for (const child of parent.children) {
    if (child.kind !== "element") {
      continue;
    }
    if (child.localName === "optgroup") {
      matched = selectOption(child, value, matched);
    } else if (child.localName === "option") {
      const optionValue =
        child.getAttribute("value") ??
        child.textContent.trim().replaceAll(WHITESPACE_RUN, " ");
      if (!matched && optionValue === value) {
        child.setAttribute("selected", "");
        matched = true;
      } else {
        child.removeAttribute("selected");
      }
    }
  }
  return matched;
};

const ssrOps: PaintOps<SsrNode, SsrEl> = {
  // SAFETY: under SSR, fiber.root is always an SsrRoot/SsrEl host.
  appendRoot: (root, node) => ssrAs<SsrHost>(root as never).append(node),
  // SAFETY: SsrEl is the SSR stand-in for Element in the shared painter.
  asElement: (el) => ssrAs<Element>(el as never),
  // SAFETY: reused SSR hosts are SsrNode values.
  asNode: (host) => ssrAs<SsrNode>(host as never),
  // SAFETY: SsrEl hosts act as ParentNode for nested fiber roots.
  asRoot: (el) => ssrAs<ParentNode>(el as never),
  bindEvents: bindSsrEvents,
  committed: (el) => el,
  createElement: createSsrElement,
  createRaw: (html, _parent) => [createSsrRaw(html)],
  createSlotHost: (slotId) => {
    const host = createSsrElement("span");
    if (slotId !== null) {
      host.setAttribute(SLOT_ATTR, slotId);
    }
    host.setAttribute("style", "display:contents");
    return host;
  },
  createText: createSsrText,
  disconnect: (el) => {
    el.isConnected = false;
  },
  placeChildren: (root, nodes) => {
    // SAFETY: under SSR, fiber.root is always an SsrRoot/SsrEl host.
    const host = ssrAs<SsrHost>(root as never);
    host.replaceChildren();
    for (const n of nodes) {
      host.append(n);
    }
  },
  // SAFETY: reused SSR hosts are SsrNode values; SSR has no morph to protect.
  reuseNode: (host) => ssrAs<SsrNode>(host as never),
  setFormControl: (el, key, v) => {
    if (key === "value") {
      const text = String(v ?? "");
      if (el.localName === "textarea") {
        // A textarea's value is its text; a `value` attribute is ignored.
        el.textContent = text;
      } else if (el.localName === "select") {
        // `null`/`undefined` leave the options' own `selected` alone.
        if (v !== null && v !== undefined) {
          selectOption(el, text, false);
        }
      } else {
        el.setAttribute("value", text);
      }
    } else if (v) {
      el.setAttribute(key, "");
    } else {
      el.removeAttribute(key);
    }
  },
  setStyle: (el, css) => el.setAttribute("style", css),
};

const core = createPainter(ssrOps);

export const paint = (fiber: FiberLocal, view: View): void => {
  fiber.islandFrame ??= { i: 0, slots: [] };
  core.pass(fiber, () => {
    // SSR rebuilds the whole tree each paint — no DOM morph identity to preserve.
    core.disposeHoles(fiber);
    // SAFETY: under SSR, fiber.root is always an SsrRoot/SsrEl host.
    ssrAs<SsrHost>(fiber.root as never).replaceChildren();
    core.insert(fiber, core.materialize(view, fiber));
  });
};

export interface AttachSsrHandle {
  root: SsrRoot;
  ready: Promise<null>;
  runtime: IlhaRuntime;
  unmount: () => void;
}

export const attachSsr = (
  fn: Component,
  opts?: { onError?: (error: Error) => void; ssrCapture?: boolean }
): AttachSsrHandle => {
  const root = createSsrRoot();
  const runtime = makeRuntime({
    onError: opts?.onError,
    ssr: true,
    ssrCapture: opts?.ssrCapture === true,
  });
  const { promise: ready, resolve } = defer();
  const fiber = makeRootFiber({
    paint,
    // SAFETY: SsrRoot is the SSR stand-in for ParentNode on the fiber.
    root: ssrAs<ParentNode>(root as never),
    runtime,
    settle: resolve,
  });
  runtime.begin();
  runtime.setIdle(resolve);
  runSetup(fiber, fn);
  runtime.end();
  return {
    ready,
    root,
    runtime,
    unmount: () => {
      closeFiber(fiber);
      runtime.close();
      root.replaceChildren();
    },
  };
};
