import { eventTypeFromProp } from "./events.ts";
import { createPainter } from "./paint-core.ts";
import type { PaintOps } from "./paint-core.ts";
import { closeFiber, makeFiber, makeRuntime } from "./runtime.ts";
import type { FiberLocal } from "./runtime.ts";
import { errorView, isFunction, SLOT_ATTR } from "./shared.ts";
import { createSsrElement, createSsrRoot, createSsrText } from "./ssr-dom.ts";
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

interface Deferred {
  promise: Promise<null>;
  resolve: () => void;
}

const defer = (): Deferred => {
  const { promise, resolve } = Promise.withResolvers<null>();
  return {
    promise,
    resolve: () => {
      resolve(null);
    },
  };
};

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
  // SAFETY: under SSR, fiber.root is always an SsrRoot/SsrEl host.
  clearRoot: (root) => ssrAs<SsrHost>(root as never).replaceChildren(),
  createElement: createSsrElement,
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
  setFormControl: (el, key, v) => {
    if (key === "value") {
      el.setAttribute("value", String(v ?? ""));
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
  // SSR rebuilds the whole tree each paint — no DOM morph identity to preserve.
  core.disposeHoles(fiber);
  ssrOps.clearRoot(fiber.root);
  core.insert(fiber, core.materialize(view, fiber));
};

export const paintError = <E>(fiber: FiberLocal, e: E): void => {
  console.error(e);
  paint(fiber, errorView(e));
};

export interface AttachSsrHandle {
  root: SsrRoot;
  ready: Promise<null>;
  runtime: IlhaRuntime;
  unmount: () => void;
}

export const attachSsr = (
  fn: Component,
  opts?: { onError?: <E>(error: E) => void; ssrCapture?: boolean }
): AttachSsrHandle => {
  const root = createSsrRoot();
  const runtime = makeRuntime({
    ssr: true,
    ssrCapture: opts?.ssrCapture === true,
  });
  const { promise: ready, resolve } = defer();
  // SAFETY: SsrRoot is the SSR stand-in for ParentNode on the fiber.
  const fiber = makeFiber(runtime, ssrAs<ParentNode>(root as never), paint, {
    onFail: (e) => {
      opts?.onError?.(e);
      paintError(fiber, e);
      resolve();
    },
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
