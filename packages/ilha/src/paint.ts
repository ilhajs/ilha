import type { Atom } from "effect/unstable/reactivity";

import { bindEvents } from "./events.ts";
import { morphInner } from "./morph.ts";
import { createPainter } from "./paint-core.ts";
import type { PaintOps } from "./paint-core.ts";
import type { FiberLocal } from "./runtime.ts";
import { errorView, isString, KEEP, SLOT_ATTR, unwrap } from "./shared.ts";
import type { VNode, View } from "./types.ts";
import { isVNode } from "./vnode.ts";

const noopDisconnect = (): void => {
  /* empty — DOM tracks connectedness */
};

const domOps: PaintOps<Node, Element> = {
  appendRoot: (root, node) => root.append(node),
  asElement: (el) => el,
  asNode: (host) => host,
  asRoot: (el) => el,
  bindEvents,
  clearRoot: (root) => {
    if (root instanceof Element) {
      root.replaceChildren();
    }
  },
  createElement: (tag) => document.createElement(tag),
  createSlotHost: (slotId) => {
    const host = document.createElement("span");
    if (slotId !== null) {
      host.setAttribute(SLOT_ATTR, slotId);
    }
    host.style.display = "contents";
    return host;
  },
  createText: (text) => document.createTextNode(text),
  disconnect: noopDisconnect,
  setFormControl: (el, key, v) => {
    // SAFETY: form controls expose value/checked/selected live properties.
    const node = el as HTMLElement & {
      value?: string;
      checked?: boolean;
      selected?: boolean;
    };
    if (key === "value") {
      node.value = String(v ?? "");
    } else if (key === "checked") {
      node.checked = Boolean(v);
    } else {
      node.selected = Boolean(v);
    }
  },
  setStyle: (el, css) => {
    // SAFETY: style props are applied to HTMLElements from the DOM painter.
    (el as HTMLElement).style.cssText = css;
  },
};

const core = createPainter(domOps);

const refreshAtomHost = (
  fiber: FiberLocal,
  atom: Atom.Atom<unknown>,
  host: Element,
  hole: FiberLocal
): void => {
  if (hole.closed || !host.isConnected) {
    return;
  }
  const next = unwrap(fiber.registry.get(atom));
  if (next === KEEP) {
    return;
  }
  // SAFETY: unwrap returns View | KEEP; KEEP already returned above.
  core.paintHole(hole, next as View);
};

const refreshAllAtomHosts = (fiber: FiberLocal): void => {
  for (const h of fiber.holes) {
    if (h.atom && h.host && h.holeFiber) {
      refreshAtomHost(fiber, h.atom, h.host, h.holeFiber);
    }
  }
};

const pruneDisconnectedAtomHoles = (fiber: FiberLocal): void => {
  fiber.holes = fiber.holes.filter((h) => {
    if (!h.atom || !h.host || !h.holeFiber) {
      return true;
    }
    if (h.host.isConnected) {
      return true;
    }
    h.dispose();
    return false;
  });
};

const canHydrate = (fiber: FiberLocal, view: View): view is VNode => {
  if (!isVNode(view) || !isString(view.type)) {
    return false;
  }
  const el = fiber.root.firstElementChild;
  return !!el && el.tagName === view.type.toUpperCase();
};

const paintHydrate = (fiber: FiberLocal, view: VNode): void => {
  const el = fiber.root.firstElementChild;
  if (!el) {
    return;
  }
  fiber.hydrate = false;
  fiber.liveEl = el;
  core.applyProps(el, view.props, fiber);
  const childFiber: FiberLocal = {
    ...fiber,
    holes: fiber.holes,
    root: el,
  };
  el.replaceChildren();
  for (const c of view.children) {
    for (const n of core.materialize(c, childFiber)) {
      el.append(n);
    }
  }
};

const paintMorphLive = (fiber: FiberLocal, view: VNode): void => {
  if (!fiber.liveEl) {
    return;
  }
  core.disposeHoles(fiber, { morph: true });
  core.applyProps(fiber.liveEl, view.props, fiber);
  const tmp = document.createElement(fiber.liveEl.localName);
  for (const c of view.children) {
    for (const n of core.materialize(c, fiber)) {
      tmp.append(n);
    }
  }
  morphInner(fiber.liveEl, tmp);
  refreshAllAtomHosts(fiber);
  pruneDisconnectedAtomHoles(fiber);
};

export const paint = (fiber: FiberLocal, view: View): void => {
  fiber.islandFrame ??= { i: 0, slots: [] };
  if (fiber.hydrate) {
    if (canHydrate(fiber, view)) {
      paintHydrate(fiber, view);
      return;
    }
    console.warn("[ilha] hydrate mismatch, full mount");
    fiber.hydrate = false;
    if (fiber.root instanceof Element) {
      fiber.root.replaceChildren();
    }
  }
  if (
    fiber.liveEl &&
    isVNode(view) &&
    isString(view.type) &&
    fiber.liveEl.localName === view.type
  ) {
    paintMorphLive(fiber, view);
    return;
  }
  core.disposeHoles(fiber);
  if (fiber.root instanceof Element && fiber.root.childNodes.length > 0) {
    const tmp = document.createElement("div");
    for (const n of core.materialize(view, fiber)) {
      tmp.append(n);
    }
    morphInner(fiber.root, tmp);
    const first = fiber.root.firstElementChild;
    if (first) {
      fiber.liveEl = first;
    }
    return;
  }
  core.insert(fiber, core.materialize(view, fiber));
  const first =
    fiber.root instanceof Element ? fiber.root.firstElementChild : null;
  if (first) {
    fiber.liveEl = first;
  }
};

export const paintError = <E>(fiber: FiberLocal, e: E): void => {
  console.error(e);
  paint(fiber, errorView(e));
};
