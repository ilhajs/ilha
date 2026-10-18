import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { isAtomHandle } from "./atom.ts";
import { ilhaWarn } from "./diagnostics.ts";
import { eventTypeFromProp } from "./events.ts";
import { closeFiber, makeFiber } from "./runtime.ts";
import type { FiberLocal, Hole } from "./runtime.ts";
import {
  isSafeUrlAttrValue,
  isUrlAttributeName,
  serializeStyleAttr,
} from "./security.ts";
import {
  isFunction,
  isIterable,
  isObject,
  isString,
  KEEP,
  KEY_ATTR,
  noop,
  SLOT_ATTR,
  skip,
  unwrap,
} from "./shared.ts";
import { notifyRoots, rootListeners, runSetup } from "./start.ts";
import { Fragment } from "./types.ts";
import type {
  AtomHandle,
  Component,
  ComponentFn,
  PropBag,
  PropValue,
  StyleObject,
  VNode,
  View,
} from "./types.ts";
import { isUnsafeHtml } from "./unsafe.ts";
import { isVNode } from "./vnode.ts";

/** Structural element API shared by DOM `Element`, the SSR shim, and custom hosts. */
export interface PaintEl<Node> {
  readonly tagName: string;
  readonly isConnected?: boolean;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  append: (...nodes: Node[]) => void;
}

export type FormControlKey = "value" | "checked" | "selected";

/**
 * Host operations behind the shared painter. Fiber roots are the mount root
 * or a hole host element; hosts cast them back to their own node type.
 */
export interface PaintOps<Node, El extends PaintEl<Node>> {
  createElement: (tag: string, ns?: string) => El;
  createText: (text: string) => Node;
  /** Parse pre-rendered HTML into nodes for `parent`. */
  createRaw: (html: string, parent: ParentNode) => Node[];
  /** Make `root`'s children exactly `nodes`, moving as little as possible. */
  placeChildren: (root: ParentNode, nodes: Node[]) => void;
  /**
   * Reconcile `root` with a fresh render, keeping live nodes (DOM morph).
   * Defaults to `placeChildren`. `hydrate` marks a mount's first paint.
   */
  morph?: (root: ParentNode, nodes: Node[], hydrate: boolean) => void;
  /** Node a render returns for a reused host. Defaults to the host itself. */
  reuseNode?: (host: El) => Node;
  /** The element a rendered element ended up as after `morph`. */
  committed?: (el: El) => El;
  /**
   * Take a prop as the component wrote it, before it is stringified. Return
   * `true` to claim it. Event props, `children`, `key` and `ref` never reach it.
   */
  setProp?: (el: El, key: string, value: PropValue) => boolean;
  /** Defaults to the `style` attribute. */
  setStyle?: (el: El, css: string) => void;
  /** Defaults to attribute writes. */
  setFormControl?: (el: El, key: FormControlKey, v: PropValue) => void;
  bindEvents?: (el: El, props: PropBag, fiber: FiberLocal) => void;
}

/** Painter surface returned by `createPainter`, shared by every host. */
export interface Painter<Node> {
  /** Paint `view` into `fiber.root`, reusing the holes it still reaches. */
  paint: (fiber: FiberLocal, view: View) => void;
  materialize: (view: View, fiber: FiberLocal) => Node[];
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

const elementNs = (lower: string, parent: ParentNode): string | undefined => {
  if (lower === "svg") {
    return SVG_NS;
  }
  if (lower === "math") {
    return MATHML_NS;
  }
  if (lower === "foreignobject") {
    return "http://www.w3.org/1999/xhtml";
  }
  // SAFETY: hosts without namespaces (SSR, custom) leave this undefined.
  const ns = (parent as Partial<Element>).namespaceURI;
  return ns === SVG_NS || ns === MATHML_NS ? ns : undefined;
};

const hasKey = (view: VNode): boolean =>
  view.key !== null && view.key !== undefined;

/** Shallow equality of two prop bags, children compared item by item. */
const sameProps = (prev: PropBag | undefined, next: PropBag): boolean => {
  if (!prev) {
    return false;
  }
  const keys = Object.keys(next);
  return (
    keys.length === Object.keys(prev).length &&
    keys.every((k) => {
      const a = prev[k];
      const b = next[k];
      return k === "children" && Array.isArray(a) && Array.isArray(b)
        ? a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
        : Object.is(a, b);
    })
  );
};

/** Rerun a component hole with `props`; render closures read the latest box. */
const rerunHole = (
  hole: FiberLocal,
  run: ComponentFn,
  props: PropBag
): void => {
  hole.propsBox ??= { current: props };
  const box = hole.propsBox;
  box.current = props;
  runSetup(hole, () => run(box.current));
};

// SAFETY: a hole fiber's root is the host element `openHole` created.
const hostOf = <El>(fiber: FiberLocal): El => fiber.root as never;

/** Dispose `hole` and drop it from a `filter` pass. */
const dispose = (hole: Hole): false => {
  hole.dispose();
  return false;
};

interface OpenedHole<El> {
  hole: FiberLocal;
  host: El;
}

const isSkippedPropKey = (k: string): boolean =>
  k === "children" ||
  k === "key" ||
  k === "ref" ||
  k.toLowerCase() === "srcdoc" ||
  eventTypeFromProp(k) !== undefined ||
  /^on[A-Z]/u.test(k);

/**
 * The painter shared by DOM mount, SSR and custom hosts: props,
 * materialization, holes, and keyed reconciliation.
 */
export const createPainter = <Node, El extends PaintEl<Node> & Node>(
  ops: PaintOps<Node, El>
): Painter<Node> => {
  const {
    committed = (el: El) => el,
    reuseNode = (host: El): Node => host,
    setStyle = (el: El, css: string) => el.setAttribute("style", css),
  } = ops;
  // SAFETY: host elements serve as fiber roots for the holes they carry.
  const asRoot = (el: El): ParentNode => el as never;
  // Late-bound: holes paint through `self.paint`, which materializes them.
  // SAFETY: both members are assigned below, before the painter returns.
  const self = {} as Painter<Node>;

  // Refs run once the outermost paint commits, so they receive the element
  // that is in the document rather than a scratch copy the morph discards.
  let depth = 0;
  const pendingRefs: (() => void)[] = [];

  const setFormControl =
    ops.setFormControl ??
    ((el: El, key: FormControlKey, v: PropValue) => {
      if (v === null || v === undefined || v === false) {
        el.removeAttribute(key);
      } else {
        el.setAttribute(key, key === "value" ? String(v) : "");
      }
    });

  const writeAttr = (el: El, k: string, v: PropValue): void => {
    if (v === false || v === null || v === undefined) {
      el.removeAttribute(k);
      return;
    }
    const str = v === true ? "" : String(v);
    if (!isUrlAttributeName(k) || isSafeUrlAttrValue(el.tagName, k, str)) {
      el.setAttribute(k, str);
    }
  };

  const applyProp = (
    el: El,
    k: string,
    v: PropValue,
    fiber: FiberLocal
  ): void => {
    if (isSkippedPropKey(k) || ops.setProp?.(el, k, v) === true) {
      return;
    }
    if (k === "className" || k === "htmlFor") {
      el.setAttribute(k === "className" ? "class" : "for", String(v ?? ""));
    } else if (k === "style") {
      // SAFETY: style props are string CSS or StyleObject bags.
      const css =
        isString(v) || isObject(v)
          ? serializeStyleAttr(v as string | StyleObject)
          : "";
      if (css) {
        setStyle(el, css);
      }
    } else if (k === "value" || k === "checked" || k === "selected") {
      if (isAtomHandle(v)) {
        // Later values go to the live element the morph kept for `el`.
        const unsub = fiber.registry.subscribe(
          v.atom,
          // SAFETY: a form-control prop handle holds a PropValue.
          (x) => setFormControl(committed(el), k, x as PropValue),
          { immediate: true }
        );
        fiber.holes.push({ dispose: unsub });
      } else {
        setFormControl(el, k, v);
      }
    } else if (!isFunction(v)) {
      writeAttr(el, k, v);
    }
  };

  const applyProps = (el: El, props: PropBag, fiber: FiberLocal): void => {
    for (const [k, v] of Object.entries(props)) {
      applyProp(el, k, v, fiber);
    }
    ops.bindEvents?.(el, props, fiber);
    const { ref } = props;
    if (isFunction(ref)) {
      // SAFETY: ref callbacks accept the live host element (or null on dispose).
      const refFn = ref as (node: El | null) => void;
      const attach = () => refFn(committed(el));
      if (depth > 0) {
        pendingRefs.push(attach);
      } else {
        attach();
      }
      fiber.holes.push({ dispose: () => refFn(null) });
    }
  };

  /**
   * Open a child fiber rooted in a fresh `display: contents` host. `keep`
   * holes survive repaints that reach them again; others close on repaint.
   */
  const openHole = (
    parent: FiberLocal,
    meta: Omit<Hole, "dispose" | "fiber"> = {},
    onDispose?: () => void
  ): OpenedHole<El> => {
    parent.runtime.holeSeq += 1;
    const host = ops.createElement("span");
    host.setAttribute(SLOT_ATTR, String(parent.runtime.holeSeq));
    setStyle(host, "display:contents");
    const hole = makeFiber(parent.runtime, asRoot(host), self.paint, {
      parent,
    });
    hole.seen = parent.gen;
    parent.holes.push({
      ...meta,
      dispose: () => {
        onDispose?.();
        closeFiber(hole);
      },
      fiber: hole,
    });
    return { hole, host };
  };

  /** Reuse a kept hole in this paint: mark it reached, return its host. */
  const reuse = (fiber: FiberLocal, hole: FiberLocal): Node => {
    hole.seen = fiber.gen;
    return reuseNode(hostOf<El>(hole));
  };

  const materializeAtom = (
    view: AtomHandle<unknown>,
    fiber: FiberLocal
  ): Node[] => {
    const found = fiber.holes.find(
      (h) =>
        h.atom === view.atom &&
        h.fiber &&
        !h.fiber.closed &&
        h.fiber.seen !== fiber.gen &&
        hostOf<El>(h.fiber).isConnected !== false
    )?.fiber;
    if (found) {
      return [reuse(fiber, found)];
    }
    let unsub: (() => void) | undefined;
    const { hole, host } = openHole(
      fiber,
      { atom: view.atom, keep: true },
      () => unsub?.()
    );
    fiber.runtime.later(() => {
      if (hole.closed) {
        return;
      }
      let last: View | undefined;
      unsub = fiber.registry.subscribe(
        view.atom,
        (v) => {
          const next = unwrap(v, last);
          if (next !== KEEP && !hole.closed) {
            last = next;
            self.paint(hole, next);
          }
        },
        { immediate: true }
      );
    });
    return [host];
  };

  const materializeStream = (
    view: Stream.Stream<View, unknown, unknown>,
    fiber: FiberLocal
  ): Node[] => {
    const { ssr } = fiber.runtime;
    const { hole, host } = openHole(fiber);
    hole.run(
      // SAFETY: hole.run provides AtomRegistry; stream views need nothing else.
      (ssr ? view.pipe(Stream.take(1)) : view).pipe(
        Stream.runForEach((v) => Effect.sync(() => self.paint(hole, v))),
        Effect.tapError((reason) =>
          Effect.sync(() => self.paint(hole, String(reason)))
        )
      ) as Effect.Effect<void>,
      // SSR holds renderToString open until the first value lands.
      ssr ? noop : undefined
    );
    return [host];
  };

  const mountComponent = (
    fiber: FiberLocal,
    type: ComponentFn,
    props: PropBag
  ): OpenedHole<El> => {
    const opened = openHole(fiber, { keep: true });
    const { hole } = opened;
    hole.propsBox = { current: props };
    hole.componentType = type;
    // The first render runs after this paint; a repaint that reached the hole
    // first already rendered it with newer props.
    fiber.runtime.later(() => {
      if (!hole.closed && hole.renderGen === undefined) {
        rerunHole(hole, type, props);
      }
    });
    return opened;
  };

  const materializeComponent = (view: VNode, fiber: FiberLocal): Node[] => {
    // SAFETY: children ride along in the component's prop bag.
    const props = { ...view.props, children: view.children } as PropBag;
    // SAFETY: paint always supplies a PropBag; JSX prop types are for typing.
    const run = view.type as ComponentFn;
    const keyed = fiber.keyedHoles;
    const key = String(view.key);
    let prev = hasKey(view) ? keyed?.get(key) : undefined;
    if (prev && prev.seen === fiber.gen && !prev.closed) {
      // This paint already placed the hole: a second use would move its host.
      ilhaWarn("ILHA005", `key "${key}"`);
      prev = undefined;
    } else if (hasKey(view)) {
      // A different component under the key mounts fresh.
      if (!prev || prev.closed || prev.componentType !== run) {
        const { hole, host } = mountComponent(fiber, run, props);
        keyed?.set(key, hole);
        return [host];
      }
      // Equal props leave the row alone; it still reruns on its own atoms.
      if (!sameProps(prev.propsBox?.current, props)) {
        rerunHole(prev, run, props);
      }
      return [reuse(fiber, prev)];
    }
    // `paint` opens the frame; a direct `materialize` call opens it here.
    fiber.componentFrame ??= { i: 0, slots: [] };
    const frame = fiber.componentFrame;
    const at = frame.i;
    frame.i += 1;
    const slot = frame.slots[at];
    if (slot && slot.type === run && !slot.hole.closed) {
      rerunHole(slot.hole, run, props);
      return [reuse(fiber, slot.hole)];
    }
    const { hole, host } = mountComponent(fiber, run, props);
    frame.slots[at] = { hole, type: run };
    return [host];
  };

  const materializeElement = (view: VNode, fiber: FiberLocal): Node[] => {
    // SAFETY: the caller narrowed view.type to a string tag.
    const tag = view.type as string;
    const lower = tag.toLowerCase();
    const el = ops.createElement(tag, elementNs(lower, fiber.root));
    if (hasKey(view)) {
      el.setAttribute(KEY_ATTR, String(view.key));
    }
    // A select's `value` picks among its options, so they must exist first.
    const late = lower === "select";
    if (!late) {
      applyProps(el, view.props, fiber);
    }
    const inner: FiberLocal = { ...fiber, root: asRoot(el) };
    for (const c of view.children) {
      el.append(...self.materialize(c, inner));
    }
    if (late) {
      applyProps(el, view.props, fiber);
    }
    return [el];
  };

  self.materialize = (view, fiber) => {
    if (skip(view)) {
      // Stable placeholder keeps sibling indexes aligned across renders, so a
      // conditional above an input does not shift the morph below it.
      return [ops.createText("")];
    }
    if (isUnsafeHtml(view)) {
      return ops.createRaw(view.html, fiber.root);
    }
    if (isAtomHandle(view)) {
      return materializeAtom(view, fiber);
    }
    if (Stream.isStream(view)) {
      return materializeStream(view, fiber);
    }
    if (isFunction(view)) {
      // Generator and async components render in their own hole.
      const { hole, host } = openHole(fiber);
      fiber.runtime.later(() => {
        if (!hole.closed) {
          // SAFETY: function views are components.
          runSetup(hole, view as Component);
        }
      });
      return [host];
    }
    if (isVNode(view)) {
      if (view.type === Fragment) {
        return view.children.flatMap((c) => self.materialize(c, fiber));
      }
      return isFunction(view.type)
        ? materializeComponent(view, fiber)
        : materializeElement(view, fiber);
    }
    if (isIterable(view)) {
      return [...view].flatMap((c) => self.materialize(c, fiber));
    }
    return [ops.createText(String(view))];
  };

  self.paint = (fiber, view) => {
    depth += 1;
    try {
      const gen = (fiber.gen ?? 0) + 1;
      fiber.gen = gen;
      fiber.keyedHoles ??= new Map();
      fiber.componentFrame ??= { i: 0, slots: [] };
      const frame = fiber.componentFrame;
      frame.i = 0;
      // Close per-paint holes; kept holes wait to see if this paint reaches them.
      fiber.holes = fiber.holes.filter((h) => h.keep || dispose(h));
      const hydrate = fiber.hydrate === true;
      fiber.hydrate = false;
      // A list of keyed components reorders the reused rows in place.
      if (
        Array.isArray(view) &&
        view.length > 0 &&
        view.every((v) => isVNode(v) && isFunction(v.type) && hasKey(v))
      ) {
        ops.placeChildren(
          fiber.root,
          view.flatMap((v) => self.materialize(v, fiber))
        );
      } else {
        const nodes = self.materialize(view, fiber);
        if (ops.morph) {
          ops.morph(fiber.root, nodes, hydrate);
        } else {
          ops.placeChildren(fiber.root, nodes);
        }
      }
      // Close the kept holes this paint did not reach.
      frame.slots.length = frame.i;
      fiber.holes = fiber.holes.filter(
        (h) => !h.keep || h.fiber?.seen === gen || dispose(h)
      );
      for (const [k, hole] of fiber.keyedHoles) {
        if (hole.closed) {
          fiber.keyedHoles.delete(k);
        }
      }
    } finally {
      depth -= 1;
      if (depth === 0) {
        for (const run of pendingRefs.splice(0)) {
          run();
        }
        if (rootListeners.size > 0) {
          notifyRoots();
        }
      }
    }
  };

  return self;
};
