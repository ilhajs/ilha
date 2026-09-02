import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import { isAtomHandle } from "./atom.ts";
import { failureMessage } from "./errors.ts";
import { eventTypeFromProp, isEventProp } from "./events.ts";
import { closeFiber, makeFiber, makeRuntime, withFiber, type FiberLocal } from "./runtime.ts";
import { isSafeUrlAttrValue, isUrlAttributeName, serializeStyleAttr } from "./security.ts";
import {
  createSsrElement,
  createSsrRoot,
  createSsrText,
  type SsrEl,
  type SsrNode,
  type SsrRoot,
} from "./ssr-dom.ts";
import { runSetup } from "./start.ts";
import { Fragment, type Component, type IlhaRuntime, type View } from "./types.ts";
import { isSetupFn, isVNode } from "./vnode.ts";

const KEY_ATTR = "data-ilha-key";
const SLOT_ATTR = "data-ilha-slot";

const ISLAND = Symbol.for("ilha.island");
const ISLAND_MOUNT_INTERNAL = Symbol.for("ilha.islandMountInternal");
const ISLAND_SLOT_TAG = Symbol.for("ilha.islandSlotTag");

type SsrHost = SsrRoot | SsrEl;

function insert(fiber: FiberLocal, nodes: SsrNode[]): void {
  const root = fiber.root as SsrHost;
  for (const n of nodes) root.appendChild(n);
}

function disposeHoles(fiber: FiberLocal): void {
  for (const h of fiber.holes) h.dispose();
  fiber.holes = [];
}

function skip(x: unknown): boolean {
  return x === null || x === undefined || typeof x === "boolean";
}

function bindSsrEvents(el: SsrEl, props: Record<string, unknown>, fiber: FiberLocal): void {
  const seen = new Set<string>();
  for (const key of Object.keys(props)) {
    const type = eventTypeFromProp(key);
    if (!type || seen.has(type)) continue;
    seen.add(type);
    const fn = props[key];
    if (typeof fn !== "function") continue;
    const branded = (fn as unknown as Record<symbol, { k?: string; a?: unknown[] }>)[
      Symbol.for("ilha.actionCall")
    ];
    const rec = branded?.k ? { k: branded.k, a: branded.a ?? [] } : undefined;
    if (!rec) continue;
    const id = `${type}:${fiber.runtime.ssrEventI++}`;
    fiber.runtime.ssrActions[id] = rec;
    const existing = el.getAttribute("data-ilha-on");
    el.setAttribute("data-ilha-on", existing ? `${existing},${id}` : id);
  }
}

function applyProps(el: SsrEl, props: Record<string, unknown>, fiber: FiberLocal): void {
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
    if (k === "style" && v != null && v !== false) {
      const css =
        typeof v === "string" || typeof v === "object"
          ? serializeStyleAttr(v as string | Record<string, unknown>)
          : "";
      if (css) el.setAttribute("style", css);
      continue;
    }
    if (isEventProp(k)) continue;
    if (/^on[A-Z]/.test(k)) continue;
    if (k === "value" || k === "checked" || k === "selected") {
      const setProp = (x: unknown) => {
        if (k === "value") el.setAttribute("value", String(x ?? ""));
        else if (k === "checked") {
          if (x) el.setAttribute("checked", "");
          else el.removeAttribute("checked");
        } else if (x) el.setAttribute("selected", "");
        else el.removeAttribute("selected");
      };
      if (isAtomHandle(v)) {
        const unsub = fiber.registry.subscribe(v.atom, setProp, { immediate: true });
        fiber.holes.push({ dispose: unsub });
      } else setProp(v);
      continue;
    }
    if (typeof v === "function") continue;
    if (v === false || v === null || v === undefined) el.removeAttribute(k);
    else {
      const str = v === true ? "" : String(v);
      if (isUrlAttributeName(k) && !isSafeUrlAttrValue(el.tagName, k, str)) continue;
      el.setAttribute(k, str);
    }
  }
  bindSsrEvents(el, props, fiber);
  const ref = props.ref;
  if (typeof ref === "function") {
    ref(el as unknown as Element);
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
  const frame = (fiber.islandFrame ??= { i: 0, slots: [] });
  frame.i = 0;
  const list = Array.isArray(view) ? view : null;
  if (list && list.length > 0 && list.every((v) => isVNode(v) && v.key != null)) {
    keyedPaintHole(fiber, list as import("./types.ts").VNode[]);
    return;
  }
  disposeHoles(fiber);
  (fiber.root as SsrHost).replaceChildren();
  insert(fiber, materialize(view, fiber));
}

function keyedPaintHole(fiber: FiberLocal, views: import("./types.ts").VNode[]): void {
  const prev = fiber.keyedHoles ?? new Map();
  const keep = new Set(views.map((v) => String(v.key)));
  for (const [k, h] of prev) {
    if (!keep.has(k)) closeFiber(h);
  }
  const next = new Map<string, FiberLocal>();
  const nodes: SsrNode[] = [];
  for (const v of views) {
    const k = String(v.key);
    const reuse = prev.get(k);
    if (reuse && !reuse.closed) {
      next.set(k, reuse);
      nodes.push(reuse.root as SsrNode);
      continue;
    }
    const made = materialize(v, fiber);
    const hole = fiber.keyedHoles?.get(k);
    if (hole) next.set(k, hole);
    nodes.push(...made);
  }
  fiber.keyedHoles = next;
  (fiber.root as SsrHost).replaceChildren();
  insert(fiber, nodes);
}

function openHole(parent: FiberLocal): { fiber: FiberLocal; nodes: SsrEl[] } {
  const id = parent.runtime.nextHole();
  const host = createSsrElement("span");
  host.setAttribute(SLOT_ATTR, String(id));
  host.setAttribute("style", "display:contents");
  const child = makeFiber(parent.runtime, host as unknown as ParentNode, paint, {
    onFail: (e) => {
      console.error(e);
      paintHole(child, errorView(e));
    },
  });
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

function findReusableAtomHost(
  fiber: FiberLocal,
  atom: import("effect/unstable/reactivity/Atom").Atom<unknown>,
): { host: SsrEl; hole: FiberLocal } | undefined {
  for (const h of fiber.holes) {
    const host = h.host as SsrEl | undefined;
    if (h.atom === atom && host?.isConnected && h.holeFiber && !h.holeFiber.closed) {
      return { host, hole: h.holeFiber };
    }
  }
}

function atomHostPlaceholder(host: SsrEl): SsrEl {
  const placeholder = createSsrElement("span");
  const slot = host.getAttribute(SLOT_ATTR);
  if (slot !== null) placeholder.setAttribute(SLOT_ATTR, slot);
  placeholder.setAttribute("style", "display:contents");
  return placeholder;
}

function trackHole(
  parent: FiberLocal,
  hole: FiberLocal,
  extra?: () => void,
  meta?: {
    atom?: import("effect/unstable/reactivity/Atom").Atom<unknown>;
    host?: SsrEl;
    keyed?: boolean;
  },
): void {
  parent.holes.push({
    keepOnMorph: !!(meta?.atom && meta?.host) || !!meta?.keyed,
    atom: meta?.atom,
    host: meta?.host as Element | undefined,
    holeFiber: hole,
    dispose() {
      extra?.();
      if (meta?.host) meta.host.isConnected = false;
      closeFiber(hole);
    },
  });
}

function materialize(view: View, fiber: FiberLocal): SsrNode[] {
  if (skip(view)) return [];
  if (typeof view === "string" || typeof view === "number" || typeof view === "bigint") {
    return [createSsrText(String(view))];
  }
  if (isAtomHandle(view)) {
    const reused = findReusableAtomHost(fiber, view.atom);
    if (reused) return [atomHostPlaceholder(reused.host)];

    const { fiber: hole, nodes } = openHole(fiber);
    const host = nodes[0]!;
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
    trackHole(fiber, hole, () => unsub(), { atom: view.atom, host });
    return nodes;
  }
  if (Stream.isStream(view)) {
    const { fiber: hole, nodes } = openHole(fiber);
    hole.run(
      Stream.runForEach(view.pipe(Stream.take(1)), (v) =>
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
      () => {},
    );
    trackHole(fiber, hole);
    return nodes;
  }
  if (isSetupFn(view)) {
    const { fiber: hole, nodes } = openHole(fiber);
    fiber.runtime.later(() => {
      if (!hole.closed) runSetup(hole, view as Component);
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
        const frame = (fiber.islandFrame ??= { i: 0, slots: [] });
        const i = frame.i++;
        const existing = frame.slots[i];
        if (
          existing &&
          existing.type === type &&
          (existing.host as SsrEl).isConnected &&
          typeof existing.updateProps === "function"
        ) {
          existing.updateProps(props);
          return [existing.host as SsrEl];
        }
        existing?.unmount?.();
        const tag =
          typeof type[ISLAND_SLOT_TAG] === "string" ? (type[ISLAND_SLOT_TAG] as string) : "div";
        const el = createSsrElement(tag);
        el.setAttribute("data-ilha", "");
        const mountFn = type[ISLAND_MOUNT_INTERNAL];
        if (typeof mountFn === "function") {
          const handle = (
            mountFn as (
              host: Element,
              props?: unknown,
            ) => {
              unmount?: () => void;
              updateProps?: (props?: Record<string, unknown>) => void;
            }
          )(el as unknown as Element, props);
          const slot = {
            type,
            host: el as unknown as Element,
            updateProps: handle?.updateProps,
            unmount: handle?.unmount,
          };
          frame.slots[i] = slot;
          fiber.holes.push({
            keepOnMorph: true,
            dispose: () => {
              el.isConnected = false;
              handle?.unmount?.();
              if (frame.slots[i] === slot) frame.slots[i] = undefined;
            },
          });
        }
        return [el];
      }
      const k = view.key == null ? undefined : String(view.key);
      const reuse = k ? fiber.keyedHoles?.get(k) : undefined;
      if (reuse && !reuse.closed) {
        if (reuse.propsBox) reuse.propsBox.current = props;
        const next = withFiber(fiber, () => type(reuse.propsBox?.current ?? props));
        if (next && typeof (next as Promise<unknown>).then !== "function" && !isSetupFn(next)) {
          reuse.paint(next as View);
        }
        return [reuse.root as SsrNode];
      }
      const { fiber: hole, nodes } = openHole(fiber);
      hole.propsBox = { current: props };
      if (k) {
        fiber.keyedHoles ??= new Map();
        fiber.keyedHoles.set(k, hole);
      }
      fiber.runtime.later(() => {
        if (!hole.closed)
          runSetup(hole, () => type(hole.propsBox!.current) as ReturnType<Component>);
      });
      trackHole(fiber, hole, undefined, k ? { keyed: true } : undefined);
      return nodes;
    }
    const el = createSsrElement(view.type);
    if (view.key != null) el.setAttribute(KEY_ATTR, String(view.key));
    applyProps(el, view.props, fiber);
    fiber.keyedHoles ??= new Map();
    const childFiber: FiberLocal = {
      ...fiber,
      root: el as unknown as ParentNode,
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
  return [createSsrText(String(view))];
}

export function paint(fiber: FiberLocal, view: View): void {
  fiber.islandFrame ??= { i: 0, slots: [] };
  // SSR rebuilds the whole tree each paint — no DOM morph identity to preserve.
  disposeHoles(fiber);
  (fiber.root as SsrHost).replaceChildren();
  insert(fiber, materialize(view, fiber));
}

export function paintError(fiber: FiberLocal, e: unknown): void {
  console.error(e);
  paint(fiber, errorView(e));
}

export function attachSsr(
  fn: Component,
  opts?: { onError?: (error: unknown) => void; ssrCapture?: boolean },
): { root: SsrRoot; ready: Promise<void>; runtime: IlhaRuntime; unmount: () => void } {
  const root = createSsrRoot();
  const runtime = makeRuntime({
    ssr: true,
    ssrCapture: opts?.ssrCapture === true,
  });
  let resolve!: () => void;
  const ready = new Promise<void>((r) => {
    resolve = r;
  });
  const fiber = makeFiber(runtime, root as unknown as ParentNode, paint, {
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
    root,
    ready,
    runtime,
    unmount() {
      closeFiber(fiber);
      runtime.close();
      root.replaceChildren();
    },
  };
}
