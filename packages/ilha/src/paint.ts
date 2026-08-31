import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import { isAtomHandle } from "./atom.ts";
import { failureMessage } from "./errors.ts";
import { bindEvents, isEventProp } from "./events.ts";
import { KEY_ATTR, SLOT_ATTR, morphInner } from "./morph.ts";
import { closeFiber, makeFiber, type FiberLocal } from "./runtime.ts";
import { isSafeUrlAttrValue, isUrlAttributeName, serializeStyle } from "./security.ts";
import { runSetup } from "./start.ts";
import { Fragment, type Setup, type View } from "./types.ts";
import { isSetupFn, isVNode } from "./vnode.ts";

const ISLAND = Symbol.for("ilha.island");
const ISLAND_MOUNT_INTERNAL = Symbol.for("ilha.islandMountInternal");
const ISLAND_SLOT_TAG = Symbol.for("ilha.islandSlotTag");

function insert(fiber: FiberLocal, nodes: Node[]): void {
  for (const n of nodes) fiber.root.appendChild(n);
}

function disposeHoles(fiber: FiberLocal): void {
  for (const h of fiber.holes) h.dispose();
  fiber.holes = [];
}

function skip(x: unknown): boolean {
  return x === null || x === undefined || typeof x === "boolean";
}

function applyProps(el: Element, props: Record<string, unknown>, fiber: FiberLocal): void {
  for (const [k, v] of Object.entries(props)) {
    if (k === "children" || k === "key" || k === "ref") continue;
    if (k === "className") {
      el.setAttribute("class", String(v ?? ""));
      continue;
    }
    if (k === "htmlFor") {
      el.setAttribute("for", String(v ?? ""));
      continue;
    }
    if (k.toLowerCase() === "srcdoc") continue;
    if (k === "style" && v && typeof v === "object") {
      (el as HTMLElement).style.cssText = serializeStyle(v as Record<string, unknown>);
      continue;
    }
    if (isEventProp(k)) continue;
    if (k === "value" || k === "checked" || k === "selected") {
      const setProp = (x: unknown) => {
        const node = el as HTMLElement & {
          value?: string;
          checked?: boolean;
          selected?: boolean;
        };
        if (k === "value") node.value = String(x ?? "");
        else if (k === "checked") {
          node.checked = Boolean(x);
          if (fiber.runtime.ssr) {
            if (x) el.setAttribute("checked", "");
            else el.removeAttribute("checked");
          }
        } else node.selected = Boolean(x);
      };
      if (isAtomHandle(v)) {
        const elAny = el as Element & { __ilhaVal?: unknown };
        if (elAny.__ilhaVal === v) continue;
        elAny.__ilhaVal = v;
        const unsub = fiber.registry.subscribe(v.atom, setProp, {
          immediate: true,
        });
        fiber.holes.push({ dispose: unsub });
      } else setProp(v);
      continue;
    }
    if (v === false || v === null || v === undefined) el.removeAttribute(k);
    else {
      const str = v === true ? "" : String(v);
      if (isUrlAttributeName(k) && !isSafeUrlAttrValue(el.tagName, k, str)) continue;
      el.setAttribute(k, str);
    }
  }
  bindEvents(el, props, fiber);
  const ref = props.ref;
  if (typeof ref === "function") {
    ref(el);
    fiber.holes.push({ dispose: () => ref(null) });
  }
}

const KEEP = Symbol("keep");

function unwrap(value: unknown, keep: View | undefined): View | typeof KEEP {
  if (AsyncResult.isAsyncResult(value)) {
    if (AsyncResult.isWaiting(value) && keep !== undefined) return KEEP;
    if (AsyncResult.isFailure(value) && !AsyncResult.isWaiting(value)) {
      return String(AsyncResult.error(value) ?? "error");
    }
    const v = AsyncResult.value(value);
    if (v._tag === "Some") return v.value as View;
    return "";
  }
  return value as View;
}

function paintHole(fiber: FiberLocal, view: View | typeof KEEP): void {
  if (view === KEEP) return;
  const list = Array.isArray(view) ? view : null;
  if (list && list.length > 0 && list.every((v) => isVNode(v) && v.key != null)) {
    keyedPaintHole(fiber, list as import("./types.ts").VNode[]);
    return;
  }
  disposeHoles(fiber);
  if (fiber.root instanceof Element) fiber.root.replaceChildren();
  insert(fiber, materialize(view, fiber));
}

function keyedPaintHole(fiber: FiberLocal, views: import("./types.ts").VNode[]): void {
  const prev = fiber.keyedHoles ?? new Map();
  const keep = new Set(views.map((v) => String(v.key)));
  for (const [k, h] of prev) {
    if (!keep.has(k)) closeFiber(h);
  }
  const next = new Map<string, FiberLocal>();
  const nodes: Node[] = [];
  for (const v of views) {
    const k = String(v.key);
    const reuse = prev.get(k);
    if (reuse && !reuse.closed) {
      next.set(k, reuse);
      nodes.push(reuse.root as Node);
      continue;
    }
    const made = materialize(v, fiber);
    const hole = fiber.keyedHoles?.get(k);
    if (hole) next.set(k, hole);
    nodes.push(...made);
  }
  fiber.keyedHoles = next;
  if (fiber.root instanceof Element) fiber.root.replaceChildren();
  insert(fiber, nodes);
}

function openHole(parent: FiberLocal): { fiber: FiberLocal; nodes: Element[] } {
  const id = parent.runtime.nextHole();
  const host = document.createElement("span");
  host.setAttribute(SLOT_ATTR, String(id));
  host.style.display = "contents";
  const child = makeFiber(
    parent.runtime,
    host,
    (f, v) => {
      disposeHoles(f);
      if (f.root instanceof Element) f.root.replaceChildren();
      insert(f, materialize(v, f));
    },
    {
      onFail: (e) => {
        console.error(e);
        paintHole(child, errorView(e));
      },
    },
  );
  return { fiber: child, nodes: [host] };
}

function errorView(e: unknown): View {
  return {
    $$ilha: 1,
    type: "pre",
    props: { "data-ilha-error": "" },
    children: [failureMessage(e)],
  };
}

function trackHole(parent: FiberLocal, hole: FiberLocal, extra?: () => void): void {
  parent.holes.push({
    dispose() {
      extra?.();
      closeFiber(hole);
    },
  });
}

function materialize(view: View, fiber: FiberLocal): Node[] {
  if (skip(view)) return [];
  if (typeof view === "string" || typeof view === "number" || typeof view === "bigint") {
    return [document.createTextNode(String(view))];
  }
  if (isAtomHandle(view)) {
    const { fiber: hole, nodes } = openHole(fiber);
    let unsub = () => {};
    fiber.runtime.later(() => {
      if (hole.closed) return;
      let keep: View | undefined;
      unsub = fiber.registry.subscribe(
        view.atom,
        (v) => {
          if (hole.closed) return;
          const next = unwrap(v, keep);
          if (next === KEEP) return;
          keep = next;
          paintHole(hole, next);
        },
        { immediate: true },
      );
    });
    trackHole(fiber, hole, () => unsub());
    return nodes;
  }
  if (Stream.isStream(view)) {
    const { fiber: hole, nodes } = openHole(fiber);
    const src = fiber.runtime.ssr ? view.pipe(Stream.take(1)) : view;
    hole.run(
      Stream.runForEach(src, (v) =>
        Effect.sync(() => {
          if (!hole.closed) paintHole(hole, v);
        }),
      ).pipe(
        Effect.catch((e: unknown) =>
          Effect.sync(() => {
            if (!hole.closed) paintHole(hole, String(e));
          }),
        ),
      ) as never,
      fiber.runtime.ssr ? () => {} : undefined,
    );
    trackHole(fiber, hole);
    return nodes;
  }
  if (isSetupFn(view)) {
    const { fiber: hole, nodes } = openHole(fiber);
    fiber.runtime.later(() => {
      if (!hole.closed) runSetup(hole, view as Setup);
    });
    trackHole(fiber, hole);
    return nodes;
  }
  if (isVNode(view)) {
    if (view.type === Fragment) return view.children.flatMap((c) => materialize(c, fiber));
    if (typeof view.type === "function") {
      const props = { ...view.props, children: view.children };
      const type = view.type as ((p: Record<string, unknown>) => unknown) & Record<symbol, unknown>;
      if (type[ISLAND] === true) {
        const tag =
          typeof type[ISLAND_SLOT_TAG] === "string" ? (type[ISLAND_SLOT_TAG] as string) : "div";
        const el = document.createElement(tag);
        el.setAttribute("data-ilha", "");
        const mountFn = type[ISLAND_MOUNT_INTERNAL];
        if (typeof mountFn === "function") {
          const handle = (mountFn as (host: Element, props?: unknown) => { unmount?: () => void })(
            el,
            props,
          );
          fiber.holes.push({ dispose: () => handle?.unmount?.() });
        }
        return [el];
      }
      const k = view.key == null ? undefined : String(view.key);
      const reuse = k ? fiber.keyedHoles?.get(k) : undefined;
      if (reuse && !reuse.closed) {
        if (reuse.propsBox) reuse.propsBox.current = props;
        const next = type(reuse.propsBox?.current ?? props);
        if (next && typeof (next as Promise<unknown>).then !== "function" && !isSetupFn(next)) {
          reuse.paint(next as View);
        }
        return [reuse.root as Node];
      }
      const { fiber: hole, nodes } = openHole(fiber);
      hole.propsBox = { current: props };
      if (k) {
        fiber.keyedHoles ??= new Map();
        fiber.keyedHoles.set(k, hole);
      }
      fiber.runtime.later(() => {
        if (!hole.closed) runSetup(hole, () => type(hole.propsBox!.current) as ReturnType<Setup>);
      });
      trackHole(fiber, hole);
      return nodes;
    }
    const el = document.createElement(view.type);
    if (view.key != null) el.setAttribute(KEY_ATTR, String(view.key));
    applyProps(el, view.props, fiber);
    fiber.keyedHoles ??= new Map();
    const childFiber: FiberLocal = {
      ...fiber,
      root: el,
      holes: fiber.holes,
      keyedHoles: fiber.keyedHoles,
    };
    for (const c of view.children) {
      for (const n of materialize(c, childFiber)) el.appendChild(n);
    }
    return [el];
  }
  if (
    Array.isArray(view) ||
    (view && typeof view === "object" && Symbol.iterator in Object(view))
  ) {
    return [...(view as Iterable<View>)].flatMap((c) => materialize(c, fiber));
  }
  return [document.createTextNode(String(view))];
}

function canHydrate(fiber: FiberLocal, view: View): boolean {
  if (!isVNode(view) || typeof view.type !== "string") return false;
  const el = fiber.root.firstElementChild;
  return !!el && el.tagName === view.type.toUpperCase();
}

export function paint(fiber: FiberLocal, view: View): void {
  if (fiber.hydrate) {
    if (canHydrate(fiber, view)) {
      const el = fiber.root.firstElementChild!;
      fiber.hydrate = false;
      fiber.liveEl = el;
      applyProps(el, (view as import("./types.ts").VNode).props, fiber);
      const childFiber: FiberLocal = {
        ...fiber,
        root: el,
        holes: fiber.holes,
      };
      el.replaceChildren();
      for (const c of (view as import("./types.ts").VNode).children) {
        for (const n of materialize(c, childFiber)) el.appendChild(n);
      }
      return;
    } else {
      console.warn("[ilha] hydrate mismatch, full mount");
      fiber.hydrate = false;
      if (fiber.root instanceof Element) fiber.root.replaceChildren();
    }
  }
  if (
    fiber.liveEl &&
    isVNode(view) &&
    typeof view.type === "string" &&
    fiber.liveEl.localName === view.type
  ) {
    applyProps(fiber.liveEl, view.props, fiber);
    const tmp = document.createElement(fiber.liveEl.localName);
    for (const c of view.children) for (const n of materialize(c, fiber)) tmp.appendChild(n);
    morphInner(fiber.liveEl, tmp);
    return;
  }
  disposeHoles(fiber);
  if (fiber.root instanceof Element && fiber.root.childNodes.length > 0) {
    const tmp = document.createElement("div");
    for (const n of materialize(view, fiber)) tmp.appendChild(n);
    morphInner(fiber.root as Element, tmp);
    const first = fiber.root.firstElementChild;
    if (first) fiber.liveEl = first;
    return;
  }
  insert(fiber, materialize(view, fiber));
  const first = fiber.root instanceof Element ? fiber.root.firstElementChild : null;
  if (first) fiber.liveEl = first;
}

export function paintError(fiber: FiberLocal, e: unknown): void {
  console.error(e);
  paint(fiber, errorView(e));
}
