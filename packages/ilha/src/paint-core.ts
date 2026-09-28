import * as Effect from "effect/Effect";
import type { Atom } from "effect/reactivity";
import * as Stream from "effect/Stream";

import { isAtomHandle } from "./atom.ts";
import { toError } from "./errors.ts";
import { isEventProp } from "./events.ts";
import { morphInner } from "./morph.ts";
import {
  closeFiber,
  makeFiber,
  reportFiberError,
  withFiber,
} from "./runtime.ts";
import type { FiberLocal, Hole } from "./runtime.ts";
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
  SLOT_ATTR,
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
  appendRoot: (root: ParentNode, node: Node) => void;
  clearRoot: (root: ParentNode) => void;
  /** Element view of a host (SSR: SsrEl masquerades as Element). */
  asElement: (el: El) => Element;
  /** Mark a host disconnected (SSR: flag flip; DOM: noop, the DOM tracks it). */
  disconnect: (el: El) => void;
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

const sweepComponentSlots = (fiber: FiberLocal): void => {
  const cframe = fiber.componentFrame;
  if (!cframe) {
    return;
  }
  const { slots } = cframe;
  for (let j = cframe.i; j < slots.length; j += 1) {
    const s = slots[j];
    if (s) {
      const { hole } = s;
      if (!hole.closed) {
        const idx = fiber.holes.findIndex((h) => h.holeFiber === hole);
        if (idx === -1) {
          closeFiber(hole);
        } else {
          const [removed] = fiber.holes.splice(idx, 1);
          removed?.dispose();
        }
      }
    }
    // SAFETY: swept slots are unreachable after truncation below.
    slots[j] = undefined as never;
  }
  slots.length = cframe.i;
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

const isThenable = <T>(value: T): boolean => {
  if (!isObject(value) && !isFunction(value)) {
    return false;
  }
  // SAFETY: Promise-like detection for sync vs async component returns.
  return isFunction((value as { then?: unknown }).then);
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
) => {
  const applyFormControl = (
    el: El,
    key: FormControlKey,
    v: PropValue,
    fiber: FiberLocal
  ): void => {
    const setProp = (x: PropValue) => ops.setFormControl(el, key, x);
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
      fiber.holes.push({ dispose: unsub });
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
      refFn(ops.asElement(el));
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
      if (
        list &&
        list.length > 0 &&
        list.every((v) => isVNode(v) && v.key !== null && v.key !== undefined)
      ) {
        // SAFETY: every() verified each item is a keyed VNode.
        paintFns.keyedPaintHole(fiber, list as VNode[]);
        return;
      }
      // Unkeyed component holes survive disposal so positional reuse below can
      // push new props instead of remounting; leftovers are swept afterwards.
      const kept = new Set<FiberLocal>();
      for (const s of cframe.slots) {
        if (s && !s.hole.closed) {
          kept.add(s.hole);
        }
      }
      const keep: Hole[] = [];
      for (const h of fiber.holes) {
        if (h.holeFiber && kept.has(h.holeFiber)) {
          keep.push(h);
          continue;
        }
        h.dispose();
      }
      fiber.holes = keep;
      const fresh = api.materialize(view, fiber);
      if (canMorphRoot(fiber.root)) {
        // Live DOM: morph so reused holes (same slot id) keep their nodes.
        // SSR shims and empty roots take the clear-and-insert path below.
        const tmp = document.createElement("div");
        for (const n of fresh) {
          // SAFETY: painter Nodes are DOM Nodes under the DOM ops.
          tmp.append(n as Node);
        }
        morphInner(fiber.root, tmp);
      } else {
        ops.clearRoot(fiber.root);
        api.insert(fiber, fresh);
      }
      // Sweep component slots that no longer match this render.
      sweepComponentSlots(fiber);
    },
  };

  const materializeAtom = (
    view: AtomHandle<unknown>,
    fiber: FiberLocal
  ): Node[] => {
    const reused = findReusableAtomHost(fiber, view.atom);
    if (reused) {
      return [ops.createSlotHost(reused.host.getAttribute(SLOT_ATTR))];
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
      return [ops.asNode(existing.host)];
    }
    existing?.unmount?.();
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
        hole.propsBox = { current: props };
        runSetup(hole, () => run(props));
        return [ops.asNode(hole.root)];
      }
      if (!hole.closed) {
        const idx = fiber.holes.findIndex((h) => h.holeFiber === hole);
        if (idx === -1) {
          closeFiber(hole);
        } else {
          const [removed] = fiber.holes.splice(idx, 1);
          removed?.dispose();
        }
      }
    }
    const { fiber: hole, nodes } = api.openHole(fiber);
    hole.propsBox = { current: props };
    hole.componentType = type;
    cframe.slots[at] = { hole, type };
    fiber.runtime.later(() => {
      if (hole.closed) {
        return;
      }
      const box = hole.propsBox;
      if (!box) {
        return;
      }
      runSetup(hole, () => run(box.current));
    });
    trackHole(fiber, hole, undefined, { keyed: true });
    return nodes;
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
    const k =
      view.key === null || view.key === undefined
        ? undefined
        : String(view.key);
    const reuse = k ? fiber.keyedHoles?.get(k) : undefined;
    // SAFETY: paint always supplies a PropBag bag; JSX component props are for typing.
    const run = type as ComponentFn;
    if (reuse && !reuse.closed) {
      if (reuse.propsBox) {
        reuse.propsBox.current = props;
      }
      const next = withFiber(fiber, () =>
        run(reuse.propsBox?.current ?? props)
      );
      if (next && !isThenable(next) && !isSetupFn(next)) {
        // SAFETY: sync non-setup return values are Views.
        reuse.paint(next as View);
      }
      return [ops.asNode(reuse.root)];
    }
    if (!k) {
      return materializeUnkeyedComponent(run, type, props, fiber);
    }
    const { fiber: khole, nodes: knodes } = api.openHole(fiber);
    khole.propsBox = { current: props };
    fiber.keyedHoles ??= new Map();
    fiber.keyedHoles.set(k, khole);
    fiber.runtime.later(() => {
      if (khole.closed) {
        return;
      }
      const box = khole.propsBox;
      if (!box) {
        return;
      }
      runSetup(khole, () => run(box.current));
    });
    trackHole(fiber, khole, undefined, { keyed: true });
    return knodes;
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
    api.applyProps(el, view.props, fiber);
    fiber.keyedHoles ??= new Map();
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
    const prev = fiber.keyedHoles ?? new Map();
    const keep = new Set(views.map((v) => String(v.key)));
    for (const [k, h] of prev) {
      if (!keep.has(k)) {
        closeFiber(h);
      }
    }
    const next = new Map<string, FiberLocal>();
    const nodes: Node[] = [];
    for (const v of views) {
      const k = String(v.key);
      const reuse = prev.get(k);
      if (reuse && !reuse.closed) {
        next.set(k, reuse);
        nodes.push(ops.asNode(reuse.root));
        continue;
      }
      const made = api.materialize(v, fiber);
      const hole = fiber.keyedHoles?.get(k);
      if (hole) {
        next.set(k, hole);
      }
      nodes.push(...made);
    }
    fiber.keyedHoles = next;
    ops.clearRoot(fiber.root);
    api.insert(fiber, nodes);
  };

  return {
    applyProps: api.applyProps,
    disposeHoles: (fiber: FiberLocal, opts?: { morph?: boolean }) =>
      disposeHoles(fiber, opts),
    insert: api.insert,
    materialize: api.materialize,
    paintHole: api.paintHole,
  };
};
