import * as Effect from "effect/Effect";
import type { Atom } from "effect/reactivity";
import * as Stream from "effect/Stream";

import { isAtomHandle } from "./atom.ts";
import { toError } from "./errors.ts";
import { isEventProp } from "./events.ts";
import { morphInner } from "./morph.ts";
import { closeFiber, makeFiber, reportFiberError } from "./runtime.ts";
import type {
  ComponentFrame,
  FiberLocal,
  Hole,
  IslandFrame,
} from "./runtime.ts";
import {
  isSafeUrlAttrValue,
  isUrlAttributeName,
  serializeStyleAttr,
} from "./security.ts";
import {
  errorView,
  ISLAND,
  ISLAND_MOUNT_INTERNAL,
  ISLAND_SLOT_TAG,
  KEEP,
  KEY_ATTR,
  isBigInt,
  isFunction,
  isNumber,
  isObject,
  isString,
  skip,
  unwrap,
} from "./shared.ts";
import { runSetup } from "./start.ts";
import { Fragment } from "./types.ts";
import type {
  AtomHandle,
  Component,
  ComponentFn,
  JsxComponent,
  PropBag,
  PropValue,
  StyleObject,
  VNode,
  View,
} from "./types.ts";
import { isUnsafeHtml } from "./unsafe.ts";
import { isSetupFn, isVNode } from "./vnode.ts";

type AtomRef = Atom.Atom<unknown>;

/** Structural element API shared by DOM `Element` and the SSR `SsrEl` shim. */
export interface PaintEl<Node> {
  readonly tagName: string;
  dataset: DOMStringMap;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  appendChild: (node: Node) => void;
  append: (...nodes: Node[]) => void;
}

export const SVG_NS = "http://www.w3.org/2000/svg";
export const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
export const HTML_NS = "http://www.w3.org/1999/xhtml";

export type FormControlKey = "value" | "checked" | "selected";

export interface PaintOps<Node, El extends PaintEl<Node>> {
  createElement: (tag: string, ns?: string) => El;
  createText: (text: string) => Node;
  /**
   * Parse pre-rendered HTML into nodes under `parent` (DOM:
   * context-aware fragment parse; SSR: raw node, parent unused).
   */
  createRaw: (html: string, parent: ParentNode) => Node[];
  /** Display-contents span marking a dynamic hole; `null` omits the slot attr. */
  createSlotHost: (slotId: string | null) => El;
  /** Fiber root for a host element (SSR: cast SsrEl up to ParentNode). */
  asRoot: (el: El) => ParentNode;
  /** Insertable node for a reused fiber/island host. */
  asNode: (host: ParentNode) => Node;
  /**
   * Node a render returns for a reused live host (DOM: a stand-in the morph
   * swaps for the host in place, so the host is never detached).
   */
  reuseNode: (host: ParentNode) => Node;
  /** Make `root`'s children exactly `nodes`, moving as little as possible. */
  placeChildren: (root: ParentNode, nodes: Node[]) => void;
  /** Append one node to `root`. Only `Painter.insert` calls it. */
  appendRoot: (root: ParentNode, node: Node) => void;
  /** Element view of a host (SSR: SsrEl masquerades as Element). */
  asElement: (el: El) => Element;
  /**
   * The element a rendered element ended up as (DOM: the live node the morph
   * kept in its place; SSR: itself).
   */
  committed: (el: El) => El;
  /** Mark a host disconnected (SSR: flag flip; DOM: noop, the DOM tracks it). */
  disconnect: (el: El) => void;
  /**
   * Take a prop as the component wrote it, before it is stringified. Return
   * `true` to claim it; anything else falls through to the attribute, style
   * and form-control handling below. A host that is not a DOM uses it to keep
   * object values. Event props, `children`, `key` and `ref` never reach it.
   */
  setProp?: (el: El, key: string, value: PropValue) => boolean;
  setStyle: (el: El, css: string) => void;
  setFormControl: (el: El, key: FormControlKey, v: PropValue) => void;
  bindEvents: (el: El, props: PropBag, fiber: FiberLocal) => void;
}

interface IslandBrand {
  [ISLAND]?: boolean;
  [ISLAND_SLOT_TAG]?: string;
  [ISLAND_MOUNT_INTERNAL]?: (
    host: Element,
    props?: PropBag
  ) => {
    unmount?: () => void;
    updateProps?: (props?: PropBag) => void;
  };
}

interface ValMemo {
  __ilhaVal?: PropValue;
}

const disposeHoles = (fiber: FiberLocal, opts?: { morph?: boolean }): void => {
  const keep: Hole[] = [];
  for (const h of fiber.holes) {
    if (opts?.morph && h.keepOnMorph) {
      keep.push(h);
      continue;
    }
    h.dispose();
  }
  fiber.holes = keep;
};

const parentNsOf = (root: ParentNode): string | null => {
  if ("namespaceURI" in root) {
    // SAFETY: `in` narrowed root to a host exposing namespaceURI (DOM Element).
    const ns = (root as Element).namespaceURI;
    return ns ?? null;
  }
  return null;
};

const elementNs = (
  lower: string,
  parentNs: string | null
): string | undefined => {
  if (lower === "svg") {
    return SVG_NS;
  }
  if (lower === "math") {
    return MATHML_NS;
  }
  if (lower === "foreignobject") {
    return HTML_NS;
  }
  if (parentNs === SVG_NS || parentNs === MATHML_NS) {
    return parentNs;
  }
  return undefined;
};

const canMorphRoot = (root: ParentNode): root is Element =>
  typeof Element !== "undefined" &&
  typeof document !== "undefined" &&
  root instanceof Element &&
  root.childNodes.length > 0;

/** Close a child hole through the parent's hole list, so it disposes once. */
const releaseHole = (fiber: FiberLocal, hole: FiberLocal): void => {
  const idx = fiber.holes.findIndex((h) => h.holeFiber === hole);
  if (idx === -1) {
    closeFiber(hole);
  } else {
    const [removed] = fiber.holes.splice(idx, 1);
    removed?.dispose();
  }
};

const sweepComponentSlots = (fiber: FiberLocal): void => {
  const cframe = fiber.componentFrame;
  if (!cframe) {
    return;
  }
  const { slots } = cframe;
  for (let j = cframe.i; j < slots.length; j += 1) {
    const s = slots[j];
    if (s && !s.hole.closed) {
      releaseHole(fiber, s.hole);
    }
    // SAFETY: swept slots are unreachable after truncation below.
    slots[j] = undefined as never;
  }
  slots.length = cframe.i;
};

/** Close the keyed components the paint that just ran did not reach. */
const sweepKeyedHoles = (fiber: FiberLocal): void => {
  const { keyedHoles, keyedGen } = fiber;
  if (!keyedHoles) {
    return;
  }
  for (const [k, hole] of keyedHoles) {
    if (!hole.closed && hole.keyedSeen === keyedGen) {
      continue;
    }
    keyedHoles.delete(k);
    if (!hole.closed) {
      releaseHole(fiber, hole);
    }
  }
};

/**
 * Run `fn` as one paint of `fiber`: the keyed components it materializes stay
 * alive, and the ones it no longer reaches are closed afterwards.
 */
const pass = (fiber: FiberLocal, fn: () => void): void => {
  // Created here so the element fibers spread from `fiber` share the map.
  fiber.keyedHoles ??= new Map();
  fiber.keyedGen = (fiber.keyedGen ?? 0) + 1;
  fn();
  sweepKeyedHoles(fiber);
};

/**
 * Dispose a hole fiber's child holes before it repaints, except the component
 * and island holes the repaint can reuse: positional children, keyed
 * children, and islands. Reuse pushes new props instead of remounting, and the
 * sweeps that end the paint close whatever it did not reach.
 */
const keepReusableHoles = (
  fiber: FiberLocal,
  cframe: ComponentFrame,
  frame: IslandFrame
): void => {
  const kept = new Set<FiberLocal>();
  for (const s of cframe.slots) {
    if (s && !s.hole.closed) {
      kept.add(s.hole);
    }
  }
  for (const hole of fiber.keyedHoles?.values() ?? []) {
    if (!hole.closed) {
      kept.add(hole);
    }
  }
  const keptIslands = new Set(frame.slots);
  const keep: Hole[] = [];
  for (const h of fiber.holes) {
    const reusable =
      (h.holeFiber && kept.has(h.holeFiber)) ||
      (h.islandSlot && keptIslands.has(h.islandSlot));
    if (reusable) {
      keep.push(h);
      continue;
    }
    h.dispose();
  }
  fiber.holes = keep;
};

/** Shallow equality of two prop bags, children compared item by item. */
const sameProps = (prev: PropBag | undefined, next: PropBag): boolean => {
  if (!prev) {
    return false;
  }
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(prev).length) {
    return false;
  }
  return keys.every((k) => {
    const a = prev[k];
    const b = next[k];
    if (k === "children" && Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
    }
    return Object.is(a, b);
  });
};

/**
 * Rerun a reused component hole with new props, in its own fiber. The props
 * box is updated in place, so every render closure of the hole reads the
 * latest props, including a self-render queued while an async render ran.
 */
const rerunHole = (
  hole: FiberLocal,
  run: ComponentFn,
  props: PropBag
): void => {
  const box = hole.propsBox ?? { current: props };
  box.current = props;
  hole.propsBox = box;
  runSetup(hole, () => run(box.current));
};

/**
 * Run a new component hole's first render after the paint that opened it. A
 * repaint that reached the hole first already rendered it with newer props.
 */
const mountHoleLater = (
  fiber: FiberLocal,
  hole: FiberLocal,
  run: ComponentFn
): void => {
  fiber.runtime.later(() => {
    const box = hole.propsBox;
    if (hole.closed || hole.renderGen !== undefined || !box) {
      return;
    }
    runSetup(hole, () => run(box.current));
  });
};

const warnedKeys = new Set<string>();

const warnDuplicateKey = (key: string): void => {
  if (warnedKeys.has(key)) {
    return;
  }
  warnedKeys.add(key);
  console.warn(
    `ilha: key "${key}" is used by more than one component in the same parent component; keys must be unique there. The duplicate keeps its state by position instead.`
  );
};

const sweepIslandSlots = (fiber: FiberLocal): void => {
  const frame = fiber.islandFrame;
  if (!frame) {
    return;
  }
  // Match by identity: a slot replaced in place keeps the count unchanged
  // but orphans the previous slot's hole.
  const active = new Set(frame.slots.slice(0, frame.i));
  const keep: Hole[] = [];
  for (const h of fiber.holes) {
    if (h.islandSlot && !active.has(h.islandSlot)) {
      h.dispose();
      continue;
    }
    keep.push(h);
  }
  fiber.holes = keep;
  frame.slots.length = Math.min(frame.slots.length, frame.i);
};

const findReusableAtomHost = (
  fiber: FiberLocal,
  atom: AtomRef
): { host: Element; hole: FiberLocal } | undefined => {
  for (const h of fiber.holes) {
    if (
      h.atom === atom &&
      h.host?.isConnected &&
      h.holeFiber &&
      !h.holeFiber.closed
    ) {
      return { hole: h.holeFiber, host: h.host };
    }
  }
};

const emptyUnsub = (): void => {
  /* empty */
};

const isTextish = <T>(view: T): boolean =>
  isString(view) || isNumber(view) || isBigInt(view);

const isIterableView = (view: View): view is Iterable<View> => {
  if (Array.isArray(view)) {
    return true;
  }
  if (!view || !isObject(view)) {
    return false;
  }
  return Symbol.iterator in view;
};

const styleCss = (v: PropValue): string => {
  if (isString(v) || isObject(v)) {
    // SAFETY: style props are string CSS or StyleObject bags.
    return serializeStyleAttr(v as string | StyleObject);
  }
  return "";
};

interface HoleOpen<El> {
  fiber: FiberLocal;
  nodes: El[];
}

interface PainterApi<Node, El> {
  applyProps: (el: El, props: PropBag, fiber: FiberLocal) => void;
  insert: (fiber: FiberLocal, nodes: Node[]) => void;
  materialize: (view: View, fiber: FiberLocal) => Node[];
  openHole: (parent: FiberLocal) => HoleOpen<El>;
  paintHole: (fiber: FiberLocal, view: View | typeof KEEP) => void;
}

interface PaintFns {
  materialize: (view: View, fiber: FiberLocal) => Node[];
  keyedPaintHole: (fiber: FiberLocal, views: VNode[]) => void;
}

/** Painter surface returned by `createPainter`, shared by every host. */
export interface Painter<Node, El> {
  applyProps: (el: El, props: PropBag, fiber: FiberLocal) => void;
  /** Runs `fn` and flushes queued refs once the outermost paint commits. */
  commit: (fn: () => void) => void;
  /**
   * Runs `fn` as one paint of `fiber`: the keyed components it materializes
   * stay alive, and the ones it no longer reaches are closed afterwards.
   */
  pass: (fiber: FiberLocal, fn: () => void) => void;
  disposeHoles: (fiber: FiberLocal, opts?: { morph?: boolean }) => void;
  insert: (fiber: FiberLocal, nodes: Node[]) => void;
  materialize: (view: View, fiber: FiberLocal) => Node[];
  paintHole: (fiber: FiberLocal, view: View | typeof KEEP) => void;
}

const writeAttr = <Node, El extends PaintEl<Node>>(
  el: El,
  k: string,
  v: PropValue
): void => {
  if (v === false || v === null || v === undefined) {
    el.removeAttribute(k);
    return;
  }
  const str = v === true ? "" : String(v);
  if (isUrlAttributeName(k) && !isSafeUrlAttrValue(el.tagName, k, str)) {
    return;
  }
  el.setAttribute(k, str);
};

const isSkippedPropKey = (k: string): boolean =>
  k === "children" ||
  k === "key" ||
  k === "ref" ||
  k.toLowerCase() === "srcdoc" ||
  isEventProp(k) ||
  /^on[A-Z]/u.test(k);

/**
 * The painter shared by DOM mount and SSR: props, materialization, holes, and
 * keyed reconciliation. Host differences live in `PaintOps`.
 */
export const createPainter = <Node, El extends PaintEl<Node> & Node>(
  ops: PaintOps<Node, El>
): Painter<Node, El> => {
  // Refs run once the outermost paint commits, so they receive the element
  // that is in the document rather than a scratch copy the morph discards.
  let paintDepth = 0;
  const pendingRefs: (() => void)[] = [];
  const commit = (fn: () => void): void => {
    paintDepth += 1;
    try {
      fn();
    } finally {
      paintDepth -= 1;
      if (paintDepth === 0) {
        for (const run of pendingRefs.splice(0)) {
          run();
        }
      }
    }
  };

  const applyFormControl = (
    el: El,
    key: FormControlKey,
    v: PropValue,
    fiber: FiberLocal
  ): void => {
    // Later values go to the live element the morph kept for `el`.
    const setProp = (x: PropValue) =>
      ops.setFormControl(ops.committed(el), key, x);
    if (isAtomHandle(v)) {
      // SAFETY: per-element memo of the last value handle; on re-apply the
      // old subscription is replaced by the morph path, not duplicated.
      const memo = el as El & ValMemo;
      if (memo.__ilhaVal === v) {
        return;
      }
      memo.__ilhaVal = v;
      const unsub = fiber.registry.subscribe(v.atom, setProp, {
        immediate: true,
      });
      fiber.holes.push({
        dispose: () => {
          unsub();
          // A later render on this same element must subscribe again.
          if (memo.__ilhaVal === v) {
            memo.__ilhaVal = undefined;
          }
        },
      });
    } else {
      setProp(v);
    }
  };

  const trackHole = (
    parent: FiberLocal,
    hole: FiberLocal,
    extra?: () => void,
    meta?: { atom?: AtomRef; host?: El; keyed?: boolean }
  ): void => {
    parent.holes.push({
      atom: meta?.atom,
      dispose() {
        extra?.();
        if (meta?.host) {
          ops.disconnect(meta.host);
        }
        closeFiber(hole);
      },
      holeFiber: hole,
      host: meta?.host ? ops.asElement(meta.host) : undefined,
      keepOnMorph: !!(meta?.atom && meta?.host) || !!meta?.keyed,
    });
  };

  const insert = (fiber: FiberLocal, nodes: Node[]): void => {
    for (const n of nodes) {
      ops.appendRoot(fiber.root, n);
    }
  };

  const applyProps = (el: El, props: PropBag, fiber: FiberLocal): void => {
    for (const [k, v] of Object.entries(props)) {
      if (isSkippedPropKey(k)) {
        continue;
      }
      if (ops.setProp?.(el, k, v) === true) {
        continue;
      }
      if (k === "className") {
        el.setAttribute("class", String(v ?? ""));
        continue;
      }
      if (k === "htmlFor") {
        el.setAttribute("for", String(v ?? ""));
        continue;
      }
      if (k === "style" && v !== null && v !== undefined && v !== false) {
        const css = styleCss(v);
        if (css) {
          ops.setStyle(el, css);
        }
        continue;
      }
      if (k === "value" || k === "checked" || k === "selected") {
        applyFormControl(el, k, v, fiber);
        continue;
      }
      if (isFunction(v)) {
        continue;
      }
      writeAttr(el, k, v);
    }
    ops.bindEvents(el, props, fiber);
    const { ref } = props;
    if (isFunction(ref)) {
      // SAFETY: ref callbacks accept the live host element (or null on dispose).
      const refFn = ref as (node: Element | null) => void;
      const attach = () => refFn(ops.asElement(ops.committed(el)));
      if (paintDepth > 0) {
        pendingRefs.push(attach);
      } else {
        attach();
      }
      fiber.holes.push({ dispose: () => refFn(null) });
    }
  };

  const paintFns: PaintFns = {
    keyedPaintHole: () => {
      /* assigned below after helpers */
    },
    materialize: () => [],
  };

  const api: PainterApi<Node, El> = {
    applyProps,
    insert,
    materialize: (view, fiber) => paintFns.materialize(view, fiber),
    openHole: (parent) => {
      const id = parent.runtime.nextHole();
      const host = ops.createSlotHost(String(id));
      const child = makeFiber(
        parent.runtime,
        ops.asRoot(host),
        (f, v) => api.paintHole(f, v),
        {
          onFail: (e) => {
            const error = toError(e);
            if (reportFiberError(child, error)) {
              return;
            }
            parent.runtime.onError?.(error);
            console.error(error);
            api.paintHole(child, errorView(error));
          },
          parent,
        }
      );
      return { fiber: child, nodes: [host] };
    },
    paintHole: (fiber, view) => {
      if (view === KEEP) {
        return;
      }
      commit(() => {
        pass(fiber, () => {
          let frame = fiber.islandFrame;
          if (!frame) {
            frame = { i: 0, slots: [] };
            fiber.islandFrame = frame;
          }
          frame.i = 0;
          let cframe = fiber.componentFrame;
          if (!cframe) {
            cframe = { i: 0, slots: [] };
            fiber.componentFrame = cframe;
          }
          cframe.i = 0;
          const list = Array.isArray(view) ? view : null;
          // Only keyed component lists reuse holes by key here. Keyed elements
          // take the morph below, where alignKeyedNode keeps their live nodes.
          if (
            list &&
            list.length > 0 &&
            list.every(
              (v) =>
                isVNode(v) &&
                isFunction(v.type) &&
                v.key !== null &&
                v.key !== undefined
            )
          ) {
            // SAFETY: every() verified each item is a keyed component VNode.
            paintFns.keyedPaintHole(fiber, list as VNode[]);
            // Release slots left over from an earlier unkeyed render.
            sweepComponentSlots(fiber);
            sweepIslandSlots(fiber);
            return;
          }
          keepReusableHoles(fiber, cframe, frame);
          const fresh = api.materialize(view, fiber);
          if (canMorphRoot(fiber.root)) {
            // Live DOM: morph so reused holes (same slot id) keep their nodes.
            // Hosts without a morph and empty roots take the placement path below.
            const tmp = document.createElement("div");
            for (const n of fresh) {
              // SAFETY: painter Nodes are DOM Nodes under the DOM ops.
              tmp.append(n as Node);
            }
            morphInner(fiber.root, tmp);
          } else {
            // One call with the whole list, so a host can diff it against what it
            // holds instead of rebuilding from a clear and a run of appends.
            ops.placeChildren(fiber.root, fresh);
          }
          // Sweep component and island slots that no longer match this render.
          sweepComponentSlots(fiber);
          sweepIslandSlots(fiber);
        });
      });
    },
  };

  const materializeAtom = (
    view: AtomHandle<unknown>,
    fiber: FiberLocal
  ): Node[] => {
    const reused = findReusableAtomHost(fiber, view.atom);
    if (reused) {
      return [ops.reuseNode(reused.host)];
    }

    const { fiber: hole, nodes } = api.openHole(fiber);
    const [host] = nodes;
    if (!host) {
      return nodes;
    }
    let unsub = emptyUnsub;
    fiber.runtime.later(() => {
      if (hole.closed) {
        return;
      }
      let keep: View | undefined;
      unsub = fiber.registry.subscribe(
        view.atom,
        (v) => {
          if (hole.closed) {
            return;
          }
          const next = unwrap(v, keep);
          if (next === KEEP) {
            return;
          }
          keep = next;
          api.paintHole(hole, next);
        },
        { immediate: true }
      );
    });
    trackHole(fiber, hole, () => unsub(), {
      atom: view.atom,
      host,
    });
    return nodes;
  };

  const materializeStream = (
    view: Stream.Stream<View, unknown, unknown>,
    fiber: FiberLocal
  ): Node[] => {
    const { fiber: hole, nodes } = api.openHole(fiber);
    const src = fiber.runtime.ssr ? view.pipe(Stream.take(1)) : view;
    const effect = Effect.gen(function* streamPaint() {
      const result = yield* Effect.result(
        Stream.runForEach(src, (v) =>
          Effect.sync(() => {
            if (!hole.closed) {
              api.paintHole(hole, v);
            }
          })
        )
      );
      if (result._tag === "Failure" && !hole.closed) {
        api.paintHole(hole, String(result.failure));
      }
    });
    // SAFETY: hole.run provides AtomRegistry; stream effects only need that service.
    hole.run(
      effect as Effect.Effect<void, never, never>,
      fiber.runtime.ssr ? emptyUnsub : undefined
    );
    trackHole(fiber, hole);
    return nodes;
  };

  const materializeIsland = (
    type: ComponentFn & IslandBrand,
    props: PropBag,
    fiber: FiberLocal
  ): Node[] => {
    let frame = fiber.islandFrame;
    if (!frame) {
      frame = { i: 0, slots: [] };
      fiber.islandFrame = frame;
    }
    const { i } = frame;
    frame.i = i + 1;
    const existing = frame.slots[i];
    if (
      existing &&
      existing.type === type &&
      existing.host.isConnected &&
      isFunction(existing.updateProps)
    ) {
      existing.updateProps(props);
      return [ops.reuseNode(existing.host)];
    }
    if (existing) {
      // Dispose through the hole so the old island unmounts exactly once.
      const idx = fiber.holes.findIndex((h) => h.islandSlot === existing);
      if (idx === -1) {
        existing.unmount?.();
      } else {
        const [removed] = fiber.holes.splice(idx, 1);
        removed?.dispose();
      }
    }
    const tag = isString(type[ISLAND_SLOT_TAG]) ? type[ISLAND_SLOT_TAG] : "div";
    const el = ops.createElement(tag);
    el.dataset.ilha = "";
    const mountFn = type[ISLAND_MOUNT_INTERNAL];
    if (isFunction(mountFn)) {
      const handle = mountFn(ops.asElement(el), props);
      const slot = {
        host: ops.asElement(el),
        type,
        unmount: handle?.unmount,
        updateProps: handle?.updateProps,
      };
      frame.slots[i] = slot;
      fiber.holes.push({
        dispose: () => {
          ops.disconnect(el);
          handle?.unmount?.();
          if (frame.slots[i] === slot) {
            frame.slots[i] = undefined;
          }
        },
        islandSlot: slot,
        keepOnMorph: true,
      });
    }
    return [el];
  };

  const materializeUnkeyedComponent = (
    run: ComponentFn,
    type: ComponentFn | JsxComponent,
    props: PropBag,
    fiber: FiberLocal
  ): Node[] => {
    let { componentFrame: cframe } = fiber;
    if (!cframe) {
      cframe = { i: 0, slots: [] };
      fiber.componentFrame = cframe;
    }
    const at = cframe.i;
    cframe.i = at + 1;
    const existing = cframe.slots[at];
    if (existing) {
      const { hole } = existing;
      if (existing.type === type && !hole.closed) {
        rerunHole(hole, run, props);
        return [ops.reuseNode(hole.root)];
      }
      if (!hole.closed) {
        releaseHole(fiber, hole);
      }
    }
    const { fiber: hole, nodes } = api.openHole(fiber);
    hole.propsBox = { current: props };
    hole.componentType = type;
    cframe.slots[at] = { hole, type };
    mountHoleLater(fiber, hole, run);
    trackHole(fiber, hole, undefined, { keyed: true });
    return nodes;
  };

  const materializeKeyedComponent = ({
    run,
    type,
    props,
    key,
    fiber,
  }: {
    run: ComponentFn;
    type: ComponentFn | JsxComponent;
    props: PropBag;
    key: string;
    fiber: FiberLocal;
  }): Node[] => {
    let reuse = fiber.keyedHoles?.get(key);
    const gen = fiber.keyedGen;
    if (reuse && !reuse.closed && reuse.keyedSeen === gen) {
      // This paint already placed the hole: a second use would move its host.
      warnDuplicateKey(key);
      return materializeUnkeyedComponent(run, type, props, fiber);
    }
    if (reuse && !reuse.closed && reuse.componentType !== type) {
      // Another component under the same key: its atoms and watches belong to
      // the old one, so the key mounts fresh.
      fiber.keyedHoles?.delete(key);
      releaseHole(fiber, reuse);
      reuse = undefined;
    }
    if (reuse && !reuse.closed) {
      reuse.keyedSeen = gen;
      // Equal props leave the row alone, so a long keyed list costs what
      // changed in it; the row still reruns when an atom it read changes.
      if (!sameProps(reuse.propsBox?.current, props)) {
        rerunHole(reuse, run, props);
      }
      return [ops.reuseNode(reuse.root)];
    }
    const { fiber: khole, nodes: knodes } = api.openHole(fiber);
    khole.propsBox = { current: props };
    khole.componentType = type;
    khole.keyedSeen = gen;
    fiber.keyedHoles?.set(key, khole);
    mountHoleLater(fiber, khole, run);
    trackHole(fiber, khole, undefined, { keyed: true });
    return knodes;
  };

  const materializeComponent = (
    view: VNode,
    type: ComponentFn | JsxComponent,
    fiber: FiberLocal
  ): Node[] => {
    const props = { ...view.props, children: view.children };
    // SAFETY: island components carry Symbol.for brands on the function object.
    const branded = type as (ComponentFn | JsxComponent) & IslandBrand;
    if (branded[ISLAND] === true) {
      // SAFETY: island brand implies ComponentFn mount surface.
      return materializeIsland(
        branded as ComponentFn & IslandBrand,
        props,
        fiber
      );
    }
    // SAFETY: paint always supplies a PropBag bag; JSX component props are for typing.
    const run = type as ComponentFn;
    if (view.key === null || view.key === undefined) {
      return materializeUnkeyedComponent(run, type, props, fiber);
    }
    return materializeKeyedComponent({
      fiber,
      key: String(view.key),
      props,
      run,
      type,
    });
  };

  const materializeElement = (view: VNode, fiber: FiberLocal): Node[] => {
    // SAFETY: caller narrowed view.type to a string tag.
    const tag = view.type as string;
    const lower = tag.toLowerCase();
    // The fiber root may be a DOM Element (namespaceURI) or the SSR shim
    // (no such field) — narrow instead of casting.
    const ns = elementNs(lower, parentNsOf(fiber.root));
    const el = ops.createElement(tag, ns);
    if (view.key !== null && view.key !== undefined) {
      el.setAttribute(KEY_ATTR, String(view.key));
    }
    // A select's `value` picks among its options, so they must exist first.
    const propsAfterChildren = lower === "select";
    if (!propsAfterChildren) {
      api.applyProps(el, view.props, fiber);
    }
    const childFiber: FiberLocal = {
      ...fiber,
      holes: fiber.holes,
      keyedHoles: fiber.keyedHoles,
      root: ops.asRoot(el),
    };
    for (const c of view.children) {
      for (const n of api.materialize(c, childFiber)) {
        el.append(n);
      }
    }
    if (propsAfterChildren) {
      api.applyProps(el, view.props, fiber);
    }
    return [el];
  };

  const materializeVNode = (view: VNode, fiber: FiberLocal): Node[] => {
    if (view.type === Fragment) {
      return view.children.flatMap((c) => api.materialize(c, fiber));
    }
    if (isFunction(view.type)) {
      // SAFETY: isFunction narrowed type to a component function.
      return materializeComponent(
        view,
        view.type as ComponentFn | JsxComponent,
        fiber
      );
    }
    return materializeElement(view, fiber);
  };

  paintFns.materialize = (view: View, fiber: FiberLocal): Node[] => {
    if (skip(view)) {
      // Stable placeholder keeps sibling indexes aligned across renders, so a
      // conditional above an input no longer shifts the morph below it. The
      // empty text serializes to "" — SSR string output is unchanged.
      return [ops.createText("")];
    }
    if (isUnsafeHtml(view)) {
      return ops.createRaw(view.html, fiber.root);
    }
    if (isTextish(view)) {
      return [ops.createText(String(view))];
    }
    if (isAtomHandle(view)) {
      return materializeAtom(view, fiber);
    }
    if (Stream.isStream(view)) {
      return materializeStream(view, fiber);
    }
    if (isSetupFn(view)) {
      const { fiber: hole, nodes } = api.openHole(fiber);
      fiber.runtime.later(() => {
        if (!hole.closed) {
          // SAFETY: isSetupFn marks generator/async components.
          runSetup(hole, view as Component);
        }
      });
      trackHole(fiber, hole);
      return nodes;
    }
    if (isVNode(view)) {
      return materializeVNode(view, fiber);
    }
    if (isIterableView(view)) {
      return [...view].flatMap((c) => api.materialize(c, fiber));
    }
    return [ops.createText(String(view))];
  };

  paintFns.keyedPaintHole = (fiber: FiberLocal, views: VNode[]): void => {
    // Rows this paint does not reach are closed by the sweep that ends it.
    const nodes: Node[] = [];
    for (const v of views) {
      const reuse = fiber.keyedHoles?.get(String(v.key));
      // A duplicate key or a different component under the key takes the
      // general path, which warns or remounts.
      const reusable =
        reuse &&
        !reuse.closed &&
        reuse.keyedSeen !== fiber.keyedGen &&
        reuse.componentType === v.type;
      if (reuse && reusable) {
        reuse.keyedSeen = fiber.keyedGen;
        const props = { ...v.props, children: v.children };
        if (!sameProps(reuse.propsBox?.current, props)) {
          // SAFETY: the caller verified every item is a component vnode.
          rerunHole(reuse, v.type as ComponentFn, props);
        }
        nodes.push(ops.asNode(reuse.root));
        continue;
      }
      nodes.push(...api.materialize(v, fiber));
    }
    // Reused rows stay attached; only new, removed, and reordered rows move.
    ops.placeChildren(fiber.root, nodes);
  };

  return {
    applyProps: api.applyProps,
    commit,
    disposeHoles: (fiber: FiberLocal, opts?: { morph?: boolean }) =>
      disposeHoles(fiber, opts),
    insert: api.insert,
    materialize: api.materialize,
    paintHole: api.paintHole,
    pass,
  };
};
