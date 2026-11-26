/**
 * Headless components: `parts(p, model)`, `p.part`/`p.child`/`p.id`, the
 * part merge algebra on Ilha VNodes, event layers with per-layer
 * `preventDefault`, and the dev errors. Ported from Effect UI's
 * `internal/parts-run.ts`, adapted: upstream decorates element builders,
 * while here a part decorates an Ilha VNode and `decorate` returns the
 * props to merge.
 *
 * A part application merges onto a VNode:
 * - part attributes win;
 * - token-list attributes (`class`, `rel`, the `aria-*` id lists) are added
 *   and deduplicated;
 * - `attr: undefined` removes a non-token attribute (never the consumer's
 *   tokens);
 * - handlers become one layer per part, deepest owner first and the
 *   consumer last; each layer's `preventDefault` applies only to its own
 *   message, while `"always"` from any layer wins;
 * - part children come after the consumer's earlier children.
 *
 * Dev-mode failures: a part applied outside its owner's view (owner
 * closed), a part for `<x>` given `<y>`, a part setting `key`, and a part
 * applying another part.
 *
 * @internal
 */
import type { PropBag, View, VNode } from "ilha";

import type * as Command from "../command.ts";
import type * as Component from "../component.ts";
import type * as MessageLog from "../message-log.ts";
import type { InstanceRecord } from "./kernel.ts";
import type * as Kernel from "./kernel.ts";
import { readsRecord } from "./shared-run.ts";

// Set once by the kernel module, which owns dispatch.
let dispatch: typeof Kernel.dispatch = () => {
  throw new Error("parts-run used before the kernel bound dispatch");
};

/**
 * Give headless parts the kernel's dispatch. Called once by the kernel
 * module.
 *
 * @internal
 */
export const bindPartsRunKernel = (hooks: {
  readonly dispatch: typeof Kernel.dispatch;
}): void => {
  ({ dispatch } = hooks);
};

/** Attributes merged by token union instead of overwrite. */
const tokenLists = {
  "aria-controls": true,
  "aria-describedby": true,
  "aria-flowto": true,
  "aria-labelledby": true,
  "aria-owns": true,
  class: true,
  rel: true,
} as const;

const eventProp = /^on(?:[A-Z].{2,}|[a-z]{3,})$/u;

const isVNode = (value: unknown): value is VNode => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("$$ilha" in value)) {
    return false;
  }
  // SAFETY: the brand probe passed; reading it only compares against the VNode literal.
  const branded = value as { readonly $$ilha?: unknown };
  return branded.$$ilha === 1;
};

/**
 * Whether an implementation is headless: `parts` instead of `view`, or
 * neither (an owner with no parts, whose consumer closure gets `{}`).
 *
 * @internal
 */
export const isHeadlessImpl = (implementation: {
  readonly view?: unknown;
  readonly parts?: unknown;
}): boolean => implementation.view === undefined;

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- layers map the raw DOM event to an optional message; partSend validates the dispatch.
type ProduceMessage = (event: unknown) => unknown;
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- host listeners receive the raw DOM event; produce maps it to a message.
type PartListener = (event: unknown) => void;

interface LayerInfo {
  readonly owner: InstanceRecord;
  readonly event: string;
  readonly produce: ProduceMessage;
  readonly preventDefault: boolean | "always" | undefined;
}

/** `p.send` handlers, so part application can layer them per owner. */
const handlerLayers = new WeakMap<object, LayerInfo>();

interface DomEvent {
  readonly type?: string | undefined;
  readonly preventDefault?: (() => void) | undefined;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- cancel runs on the raw DOM event before dispatch.
const cancel = (event: unknown): void => {
  try {
    // SAFETY: DOM events carry preventDefault; the optional call tolerates synthetics without it.
    const target = event as DomEvent | undefined;
    target?.preventDefault?.();
  } catch {
    // A synthetic event without preventDefault still dispatches.
  }
};
/** Resolve a part message into its event producer. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- producers map the raw DOM event to a message; dispatch validates it in update.
const toProducer = (message: unknown): ProduceMessage => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- a function message is a producer; otherwise the message itself is dispatched.
  if (typeof message !== "function") {
    return () => message;
  }
  // SAFETY: the typeof branch proves message is the producer; the host calls it with the DOM event.
  return message as ProduceMessage;
};
/**
 * `p.send`: an event handler dispatching to the headless owner. Inside a
 * part's props it becomes the part's layer for its event, firing deepest
 * owner first with per-layer `preventDefault`.
 *
 * @internal
 */
export const partSend = (
  owner: InstanceRecord,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- part messages are arbitrary user messages; dispatch validates them in update.
  message: unknown,
  options: Component.SendOptions | undefined
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- partSend returns the host's event listener; the message contract is checked by update.
): PartListener => {
  const produce = toProducer(message);
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- handlers receive the raw DOM event; produce maps it to a message.
  const handler = (event: unknown): void => {
    const produced = produce(event);
    const prevent = options?.preventDefault ?? false;
    if (prevent === "always" || (prevent === true && produced !== undefined)) {
      cancel(event);
    }
    if (produced !== undefined && owner.status === "live") {
      // SAFETY: handlers run on DOM events; the type is only read for dispatch naming.
      const domEvent = event as DomEvent | undefined;
      dispatch(
        owner,
        { _tag: "DomEvent", name: domEvent?.type ?? "event" },
        produced
      );
    }
  };
  // SAFETY: brand lookup for part layering; the handler stays a plain function.
  const branded = handler as PartListener;
  handlerLayers.set(branded, {
    event: "",
    owner,
    preventDefault: options?.preventDefault,
    produce,
  });
  return branded;
};

interface StoredLayers {
  readonly layers: LayerInfo[];
  readonly consumer: Map<string, PartListener>;
}

/** Part layers already applied to a VNode, carried across applications. */
const storedLayers = new WeakMap<object, StoredLayers>();

/** VNodes a part produced, which no part may apply again. */
const partedVNodes = new WeakSet<object>();

const chainLayers = (
  name: string,
  layers: readonly LayerInfo[],
  final: PartListener | undefined
): PartListener => {
  const ordered = layers
    .filter((layer) => layer.event === name)
    .toSorted((a, b) => b.owner.path.length - a.owner.path.length);
  const always = ordered.some((layer) => layer.preventDefault === "always");
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the combined listener keeps the host listener shape; layers map the raw event.
  return (event: unknown): void => {
    // SAFETY: combined listeners run on DOM events; the type is only read for dispatch naming.
    const domEvent = event as DomEvent | undefined;
    let told = false;
    for (const layer of ordered) {
      const produced = layer.produce(event);
      if (produced === undefined) {
        continue;
      }
      if (layer.owner.status !== "live") {
        continue;
      }
      dispatch(
        layer.owner,
        { _tag: "DomEvent", name: domEvent?.type ?? "event" },
        produced
      );
      if (layer.preventDefault === true && !told) {
        told = true;
        cancel(event);
      }
    }
    if (always) {
      cancel(event);
    }
    final?.(event);
  };
};

const mergeTokens = (into: PropBag[string], value: PropBag[string]): string => {
  const seen = new Set<string>();
  const out: string[] = [];
  const parts = `${String(into ?? "")} ${String(value ?? "")}`.split(/\s+/u);
  for (const part of parts) {
    if (part === "" || seen.has(part)) {
      continue;
    }
    seen.add(part);
    out.push(part);
  }
  return out.join(" ");
};

/** Split `decorate` output: the props to merge and the children to append. */
interface PatchInput {
  readonly patchProps: PropBag;
  readonly patchChildren: readonly View[];
}

/** Split `decorate`'s return into mergeable props and appended children. */
const resolvePatch = (
  owner: InstanceRecord,
  blank: VNode,
  decorate: Component.PartDecorate,
  args: readonly unknown[]
): PatchInput => {
  const patch = decorate(blank, ...args);
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- decorate returns props or a vnode; the object check selects the merge input.
  if (typeof patch !== "object" || patch === null) {
    throw new Error(`${owner.path}: a part returns the props to merge`);
  }
  if (partedVNodes.has(patch)) {
    throw new Error(`${owner.path}: a part can't apply another part`);
  }
  const patchProps = isVNode(patch) ? patch.props : patch;
  let patchChildren: readonly View[];
  if (isVNode(patch)) {
    patchChildren = patch.children;
  } else if (patchProps["children"] === undefined) {
    patchChildren = [];
  } else {
    // SAFETY: a non-vnode patch carries children only through the children prop; the kernel reads it as a View.
    patchChildren = [patchProps["children"] as View];
  }
  if (patchProps["key"] !== undefined) {
    throw new Error(`${owner.path}: a part can't set an element's key`);
  }
  return { patchChildren, patchProps };
};

/** Merge non-event props: part attributes win, token lists union. */
const mergePartProps = (target: VNode, patchProps: PropBag): PropBag => {
  const merged = { ...target.props };
  for (const name of Object.keys(patchProps)) {
    if (name === "children" || name === "key") {
      continue;
    }
    const value = patchProps[name];
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- part values arrive untyped from decorate; the function check selects event layering.
    if (typeof value === "function" && eventProp.test(name)) {
      continue;
    }
    if (value === undefined && !(name in tokenLists)) {
      // oxlint-disable-next-line typescript/no-dynamic-delete -- merged is a fresh copy of the consumer props; delete restores key absence.
      delete merged[name];
      continue;
    }
    if (name in tokenLists) {
      if (merged[name] !== undefined || value !== undefined) {
        merged[name] = mergeTokens(merged[name], value);
      }
      continue;
    }
    if (value !== undefined) {
      merged[name] = value;
    }
  }
  return merged;
};

/** Collect handler layers, deepest owner first and the consumer last. */
const collectEventLayers = (
  owner: InstanceRecord,
  target: VNode,
  patchProps: PropBag,
  stored: StoredLayers | undefined,
  layers: LayerInfo[],
  consumer: Map<string, PartListener>
): Set<string> => {
  const touched = new Set<string>();
  for (const name of Object.keys(patchProps)) {
    const value = patchProps[name];
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- part values arrive untyped from decorate; the function check selects event layering.
    if (typeof value !== "function" || !eventProp.test(name)) {
      continue;
    }
    const known = handlerLayers.get(value);
    if (known === undefined) {
      // SAFETY: the typeof branch proves a plain listener; it fires without producing a message.
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- plain consumer listeners keep the host listener shape.
      const plain = value as PartListener;
      layers.push({
        event: name,
        owner,
        preventDefault: undefined,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- plain layers forward the raw DOM event without producing a message.
        produce: (event: unknown): undefined => {
          plain(event);
          return undefined;
        },
      });
    } else {
      layers.push({ ...known, event: name });
    }
    touched.add(name);
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- consumer props arrive untyped from the host; the function check finds plain listeners.
    if (stored === undefined && typeof target.props[name] === "function") {
      // SAFETY: the typeof branch proves a plain consumer listener; it becomes the final layer.
      const current = target.props[name] as PartListener;
      if (handlerLayers.get(current) === undefined) {
        consumer.set(name, current);
      }
    }
  }
  return touched;
};

/**
 * Make a part: `p.part(tag | [tags], decorate)` or `p.part(decorate)` for
 * any element. Applying it to a VNode merges `decorate(blank)` onto it.
 *
 * @internal
 */
export const makePart = (
  owner: InstanceRecord,
  tags: readonly string[] | string | undefined,
  decorate: Component.PartDecorate
): Component.PartApplier => {
  let wanted: readonly string[] | undefined;
  if (tags === undefined) {
    wanted = undefined;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- tags is the decorate-or-names union; the string check selects the single-tag form.
  } else if (typeof tags === "string") {
    wanted = [tags];
  } else {
    wanted = tags;
  }
  return (target: VNode, ...args: readonly unknown[]): VNode => {
    if (owner.status !== "live") {
      throw new Error(`${owner.path}: applied a part whose owner is closed`);
    }
    // oxlint-disable-next-line anti-slop/no-known-value-widening, anti-slop/no-runtime-typeof -- target is already a VNode; the guard re-verifies the brand, and the element check selects element vnodes.
    if (!isVNode(target) || typeof target.type !== "string") {
      throw new Error(`${owner.path}: a part takes an element vnode`);
    }
    if (wanted !== undefined && !wanted.includes(target.type)) {
      throw new Error(
        `${owner.path}: a part for <${wanted.join("> or <")}> was given <${target.type}>`
      );
    }
    const blank: VNode = {
      $$ilha: 1,
      children: [],
      props: {},
      type: target.type,
    };
    const { patchChildren, patchProps } = resolvePatch(
      owner,
      blank,
      decorate,
      args
    );
    const stored = storedLayers.get(target);
    const layers = stored === undefined ? [] : [...stored.layers];
    const consumer = new Map(stored?.consumer);
    const merged = mergePartProps(target, patchProps);
    const touched = collectEventLayers(
      owner,
      target,
      patchProps,
      stored,
      layers,
      consumer
    );
    const out = { ...merged };
    for (const name of touched) {
      // SAFETY: the combined listener keeps the host listener shape; layers dispatch per owner.
      out[name] = chainLayers(
        name,
        layers,
        consumer.get(name)
      ) as PropBag[string];
    }
    const next: VNode =
      target.key === undefined
        ? {
            $$ilha: 1,
            children: [...target.children, ...patchChildren],
            props: out,
            type: target.type,
          }
        : {
            $$ilha: 1,
            children: [...target.children, ...patchChildren],
            key: target.key,
            props: out,
            type: target.type,
          };
    if (layers.length > 0) {
      storedLayers.set(next, { consumer, layers });
      partedVNodes.add(next);
    }
    return next;
  };
};

/**
 * Validate `p.child` options: a composed child belongs to this component,
 * so it takes no `view`, `slots` or `fallback` (each throws).
 *
 * @internal
 */
export const checkChildCall = (
  parent: InstanceRecord,
  options: {
    readonly view?: unknown;
    readonly slots?: unknown;
    readonly fallback?: unknown;
  }
): void => {
  if (options.view !== undefined) {
    throw new Error(`${parent.path}: p.child takes no view`);
  }
  if (options.slots !== undefined) {
    throw new Error(`${parent.path}: p.child takes no slots`);
  }
  if (options.fallback !== undefined) {
    throw new Error(`${parent.path}: p.child takes no fallback`);
  }
};

/**
 * Build the `p` helper `parts(p, model)` runs with: the owner's props and
 * shared reads, `isRunning`, `id`, `send`, `part` and `child`.
 *
 * @internal
 */
export const makePartsHelper = (
  owner: InstanceRecord,
  base: {
    readonly isRunning: (
      definition: Command.Definition.Any,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- run groups are author-defined; isRunning compares them by identity.
      group?: unknown
    ) => boolean;
    readonly id: (name: string, key?: string | number | undefined) => string;
    readonly child: <C extends Component.Headless.Any, Out>(
      component: C,
      options: Component.ComposedChildOptions<Component.Headless.Parts<C>, Out>
    ) => Out;
  }
): Component.PartsHelper => {
  const part = (
    tagsOrDecorate: string | readonly string[] | Component.PartDecorate,
    decorate?: Component.PartDecorate
  ): Component.PartApplier => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- a function first argument is the decorate form; otherwise tags plus a required decorate.
    if (typeof tagsOrDecorate === "function") {
      return makePart(owner, undefined, tagsOrDecorate);
    }
    if (decorate === undefined) {
      throw new Error(`${owner.path}: p.part needs a decorate function`);
    }
    return makePart(owner, tagsOrDecorate, decorate);
  };
  const helper: Component.PartsHelper = {
    child: base.child,
    id: base.id,
    isRunning: base.isRunning,
    part,
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- props are the author's decoded model input; the helper only exposes them.
    get props(): unknown {
      return owner.props;
    },
    get reads(): MessageLog.SharedRecord {
      return readsRecord(owner);
    },
    send: (
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- part messages are arbitrary user messages; dispatch validates them in update.
      message: unknown,
      options?: Component.SendOptions | undefined
    ): PartListener => partSend(owner, message, options),
  };
  return helper;
};
