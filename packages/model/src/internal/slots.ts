/**
 * Slots: declared `slots`, `h.slots.name` outlets, `slots={{...}}` call
 * content, and the double-placement check. Ported from Effect UI's slot
 * rules (`component §1.8`): content belongs to the author that wrote it
 * (handlers, emits and failures map to the parent), a slot is placed at
 * most once per render, and the slot's path segment is `[name]`.
 *
 * An outlet is a real (internal) model component whose view is the placed
 * content, so slot children mount under `placerPath/[name]` and unmount
 * with the outlet. The outlet's walk stamps nothing new: the writer's walk
 * already visited (and stamped) the content through the child's `slots`
 * prop, so authorship stays with the writer.
 *
 * @internal
 */
import * as Schema from "effect/Schema";
import type { PropBag, View, VNode } from "ilha";

import { TypeId } from "../component.ts";
import type * as Component from "../component.ts";
import type { ChildProps } from "./child.ts";
import type { InstanceRecord } from "./kernel.ts";
import { definitionNameOf, isModelComponent } from "./paths.ts";

/** The definition name of the outlet placing slot `name`. */
export const outletName = (name: string): string => `[${name}]`;

const outletPattern = /^\[(?<name>[^\]]+)\]$/u;

/**
 * Whether a definition name is a slot outlet's, and if so which slot it
 * places. `paths.ts` gives these path segments verbatim (`[name]`).
 *
 * @internal
 */
export const outletSlotOf = (definitionName: string): string | undefined => {
  const match = outletPattern.exec(definitionName);
  return match === null ? undefined : match.groups?.name;
};

interface OutletDefinition extends Component.DefinitionAny {
  readonly "~ilhaModelSlotOutlet"?: string | undefined;
}

type OutletRenderer = (
  definition: Component.DefinitionAny,
  implementation: Component.MakeImpl<unknown, unknown, never>,
  options: Component.CallOptions<unknown, never>
) => View;

// Set once by the kernel module, which owns `renderModelComponent`.
let renderOutlet: OutletRenderer = (): View => "";

/**
 * Give outlets their render function. Called once by the kernel module.
 *
 * @internal
 */
export const bindOutletRenderer = (render: OutletRenderer): void => {
  renderOutlet = render;
};

/**
 * Whether a definition is an internal slot outlet, and if so which slot
 * it places.
 *
 * @internal
 */
// SAFETY: outlet definitions carry the `"~ilhaModelSlotOutlet"` brand; foreign definitions lack it and read `undefined`.
export const slotOutletOf = (
  definition: Component.DefinitionAny
): string | undefined =>
  (definition as OutletDefinition)["~ilhaModelSlotOutlet"];

/**
 * The outlet component placing slot `name`, built once per name. Its view
 * is the placed content from the call; it renders nothing when the placer
 * was given nothing. The kernel renders outlet records directly from
 * `callProps.slotContent`, so the implementation view never runs.
 *
 * @internal
 */
const outlets = new Map<
  string,
  Component.ModelComponent<unknown, never, never>
>();

export const outletFor = (
  name: string
): Component.ModelComponent<unknown, never, never> => {
  const cached = outlets.get(name);
  if (cached !== undefined) {
    return cached;
  }
  // SAFETY: the literal carries the outlet brand `"~ilhaModelSlotOutlet"` alongside the definition fields; the kernel reads the brand back through `slotOutletOf`.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the brand field keeps the literal from overlapping `DefinitionAny`; the kernel reads the brand, not the definition.
  const definition = {
    events: Schema.Never,
    message: Schema.Never,
    model: Schema.Struct({}),
    name: outletName(name),
    props: Schema.Struct({}),
    "~ilhaModelSlotOutlet": name,
  } as unknown as Component.DefinitionAny;
  const implementation: Component.MakeImpl<unknown, unknown, never> = {
    init: () => ({}),
    update: ($) => $.set($.model),
    view: () => "",
  };
  // SAFETY: the assembled outlet carries its definition, implementation and brand; the kernel calls it through `renderOutlet`.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- `Object.assign` hides the component shape from the checker; the kernel reads definition and implementation back.
  const component = Object.assign(
    (options: Component.CallOptions<unknown, never>): View =>
      renderOutlet(definition, implementation, options),
    // oxlint-disable-next-line eslint/sort-keys -- keys mirror the kernel's component record; the `TypeId` brand reads last.
    {
      definition,
      definitionName: outletName(name),
      implementation,
      [TypeId]: TypeId,
    }
  ) as unknown as Component.ModelComponent<unknown, never, never>;
  outlets.set(name, component);
  return component;
};

/**
 * The `h.slots` value for one render: an outlet vnode per declared slot
 * with content, `""` for slots the parent passed nothing for. Outlets are
 * made once per render, so a forwarded slot is the same value every time
 * it is read. Built as vnodes (not direct calls) so the painter gives
 * each outlet its own fiber.
 *
 * @internal
 */
export const slotHelpers = (rec: InstanceRecord) => {
  const out: Record<string, View> = {};
  // SAFETY: `DefinitionAny` erases the declaration; slot hosts declare their slot names as strings.
  const declared =
    (rec.definition as { readonly slots?: readonly string[] | undefined })
      .slots ?? [];
  const given = rec.callProps.slots ?? {};
  for (const name of declared) {
    const content = given[name];
    if (content === undefined || content === null || content === false) {
      out[name] = "";
      continue;
    }
    const outlet: VNode = {
      $$ilha: 1,
      children: [],
      // SAFETY: the kernel reads `slotContent` back as a View; the bag only carries it.
      props: { slotContent: content } as PropBag,
      // SAFETY: the outlet component renders placed slot content; the kernel replaces it before painting.
      type: outletFor(name) as VNode["type"],
    };
    out[name] = outlet;
  }
  return out;
};

interface PlacementSet {
  readonly byName: Map<string, VNode>;
  readonly seen: Set<VNode>;
}

const placementSets = new WeakMap<object, PlacementSet>();

/**
 * Fresh placement state for an author's render. Headless closures and
 * outlet content count into the vnode author's set, so forwarding the same
 * outlet twice still throws, while forwarding it once through is fine.
 *
 * @internal
 */
export const resetPlacements = (author: InstanceRecord): void => {
  placementSets.set(author, { byName: new Map(), seen: new Set() });
};

const setFor = (author: InstanceRecord): PlacementSet => {
  let set = placementSets.get(author);
  if (set === undefined) {
    set = { byName: new Map(), seen: new Set() };
    placementSets.set(author, set);
  }
  return set;
};

/** Whether `value` is callable (handlers and components arrive untyped at runtime boundaries). */
// oxlint-disable-next-line typescript/ban-types, typescript/no-unsafe-function-type -- the guard only tests callability; component types and handlers arrive untyped at runtime boundaries.
const isFunctionValue = (value: unknown): value is Function =>
  typeof value === "function";

/** Whether `value` reads string keys (props bags and slot tables decode at their boundary). */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- view trees are untyped nested data; leaves are rejected during the visit.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Whether the walk descends into `value` as nested views (streams and generators nest them). */
const isViewIterable = (value: unknown): value is Iterable<unknown> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!(Symbol.iterator in value)) {
    return false;
  }
  return typeof value[Symbol.iterator] === "function";
};

/** Whether `node` is an Ilha vnode (brand-checked; foreign objects fall through). */
const isVNode = (node: unknown): node is VNode =>
  typeof node === "object" &&
  node !== null &&
  "$$ilha" in node &&
  node.$$ilha === 1;

const isOutletVNode = (vnode: VNode): string | undefined => {
  if (!isFunctionValue(vnode.type)) {
    return undefined;
  }
  const name = definitionNameOf(vnode.type);
  return name === undefined ? undefined : outletSlotOf(name);
};

type WrittenBy = (vnode: VNode) => InstanceRecord | undefined;

/**
 * Count the outlet placements in an author's walked view, including
 * outlets inside slot content and plain wrappers. Each distinct outlet
 * vnode counts once per author; placing one slot twice throws with the
 * inventory's message. Runs after the author's walk, so forwarded vnodes
 * already carry their writer's stamp.
 *
 * @internal
 */
export const checkSlotPlacements = (
  author: InstanceRecord,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- walks accept any view tree; leaves are rejected during the visit.
  view: unknown,
  writtenBy: WrittenBy
): void => {
  // oxlint-disable-next-line eslint/no-use-before-define -- `visitOutlets` is defined below; all calls run after module load.
  visitOutlets(view, (vnode, slot) => {
    const writer = writtenBy(vnode) ?? author;
    const set = setFor(writer);
    if (set.seen.has(vnode)) {
      return;
    }
    const previous = set.byName.get(slot);
    if (previous !== undefined && previous !== vnode) {
      throw new Error(`${writer.path} places its slot ${slot} twice`);
    }
    set.seen.add(vnode);
    set.byName.set(slot, vnode);
  });
};

const visitOutlets = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- walks descend into arbitrary nested view trees; leaves are rejected below.
  node: unknown,
  onOutlet: (vnode: VNode, slot: string) => void
): void => {
  if (!isRecord(node)) {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      visitOutlets(item, onOutlet);
    }
    return;
  }
  if (isViewIterable(node) && !isVNode(node)) {
    for (const item of node) {
      visitOutlets(item, onOutlet);
    }
    return;
  }
  if (!isVNode(node)) {
    return;
  }
  const vnode: VNode = node;
  const slot = isOutletVNode(vnode);
  if (slot !== undefined) {
    onOutlet(vnode, slot);
    return;
  }
  for (const child of vnode.children) {
    visitOutlets(child, onOutlet);
  }
  const slotsProp = vnode.props["slots"];
  if (slotsProp !== undefined && isRecord(slotsProp)) {
    for (const content of Object.values(slotsProp)) {
      visitOutlets(content, onOutlet);
    }
  }
};

/**
 * A slot host's last fully-rendered view, keyed in `rec.extensions` after
 * each successful view walk, so a parent-driven rerender that changes only
 * slot content can answer with patched outlets instead of re-running the
 * child's view.
 *
 * @internal
 */
const lastViewKey = "slots.lastView";

/**
 * Structural equality for decoded props: plain objects and arrays by
 * value, everything else (functions, class instances) by reference, so a
 * fresh callbacks object never compares equal.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- compares decoded props of any shape structurally; functions and class instances compare by reference.
const propsEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) {
    return true;
  }
  if (!isRecord(a) || !isRecord(b)) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.getPrototypeOf(b)) {
    return false;
  }
  if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  for (const key of keys) {
    if (!Object.hasOwn(b, key) || !propsEqual(a[key], b[key])) {
      return false;
    }
  }
  return true;
};

/**
 * A parent-driven rerender's slot-only fast path. When the painter reaches
 * a slot host with a fresh call whose decoded props and non-slot call
 * options match the last render — and which slots hold content matches too
 * — the child's own view would rebuild the same shell around new outlet
 * content, so answer with the last view with fresh outlets spliced in and
 * let the outlets repaint through the normal path. Anything else (a
 * self-driven rerender reuses the painter's props bag, so `freshCall` is
 * false; new props, handlers, children, queries, reads or shares; a
 * changed slot presence) re-runs the view. Returns `undefined` when the
 * view must re-run.
 *
 * @internal
 */
// oxlint-disable-next-line eslint/complexity -- the fast path checks every shell input in one pass; splitting it would scatter the bail-out ladder.
export const patchSlotOutlets = (
  rec: InstanceRecord,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- previous props are opaque decoded values; `propsEqual` compares them structurally.
  prevProps: unknown,
  prevCall: ChildProps,
  freshCall: boolean
): View | undefined => {
  if (!freshCall || rec.status !== "live") {
    return undefined;
  }
  if (slotOutletOf(rec.definition) !== undefined) {
    return undefined;
  }
  const declared = rec.definition.slots ?? [];
  if (declared.length === 0) {
    return undefined;
  }
  if (rec.definition.queries !== undefined) {
    return undefined;
  }
  if (rec.definition.reads !== undefined) {
    return undefined;
  }
  if (rec.definition.shares !== undefined) {
    return undefined;
  }
  if (rec.implementation.subscriptions !== undefined) {
    return undefined;
  }
  if (!propsEqual(prevProps, rec.props)) {
    return undefined;
  }
  const next = rec.callProps;
  if (!Object.is(prevCall.onEmit, next.onEmit)) {
    return undefined;
  }
  if (!Object.is(prevCall.onFailure, next.onFailure)) {
    return undefined;
  }
  if (!Object.is(prevCall.fallback, next.fallback)) {
    return undefined;
  }
  if (!Object.is(prevCall.view, next.view)) {
    return undefined;
  }
  const prevEmpty =
    prevCall.children === undefined ||
    prevCall.children === null ||
    prevCall.children === false ||
    prevCall.children === "" ||
    (Array.isArray(prevCall.children) && prevCall.children.length === 0);
  const nextEmpty =
    next.children === undefined ||
    next.children === null ||
    next.children === false ||
    next.children === "" ||
    (Array.isArray(next.children) && next.children.length === 0);
  if (
    (!prevEmpty || !nextEmpty) &&
    !Object.is(prevCall.children, next.children)
  ) {
    return undefined;
  }
  const prevSlots = prevCall.slots ?? {};
  const nextSlots = next.slots ?? {};
  for (const name of declared) {
    // The same emptiness rule `slotHelpers` renders as `""`.
    const had = prevSlots[name];
    const has = nextSlots[name];
    const hadPlaced = had !== undefined && had !== null && had !== false;
    const hasPlaced = has !== undefined && has !== null && has !== false;
    if (hadPlaced !== hasPlaced) {
      return undefined;
    }
  }
  // SAFETY: the kernel stores the last fully-rendered view under this key after each successful walk.
  const lastView = rec.extensions.get(lastViewKey) as View | undefined;
  if (lastView === undefined) {
    return undefined;
  }
  // oxlint-disable-next-line eslint/no-use-before-define -- `spliceOutlets` is defined below; all calls run after module load.
  return spliceOutlets(lastView, new Set(declared), slotHelpers(rec));
};

/**
 * Splice fresh outlet vnodes into a slot host's last view, replacing every
 * outlet the host placed (in its shell or forwarded into a child's
 * `slots`) without descending into replaced content. Unchanged subtrees
 * keep their identity, so the painter skips them. Returns `undefined` when
 * an outlet has no fresh counterpart, so the view re-runs instead.
 */
// oxlint-disable-next-line eslint/complexity -- the splice walks shells, children and forwarded slots in one pass; splitting it would scatter the identity-preserving merge.
const spliceOutlets = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the splice walks arbitrary nested view trees; leaves pass through below.
  node: unknown,
  declared: ReadonlySet<string>,
  fresh: Record<string, View>
): View | undefined => {
  if (!isRecord(node)) {
    // SAFETY: leaves pass through untouched; only vnodes and arrays are rebuilt.
    return node as View;
  }
  if (Array.isArray(node)) {
    let changed = false;
    const out: View[] = [];
    for (const item of node) {
      const next = spliceOutlets(item, declared, fresh);
      if (next === undefined) {
        return undefined;
      }
      if (next !== item) {
        changed = true;
      }
      out.push(next);
    }
    // SAFETY: unchanged subtrees keep their identity so the painter skips them; changed ones rebuild as views.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the union of the rebuilt array and the passed-through node overlaps `View` only through `unknown`.
    return (changed ? out : node) as unknown as View;
  }
  if (!isVNode(node)) {
    // SAFETY: non-vnode objects pass through untouched; only vnodes are rebuilt.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- records overlap `View` only through `unknown`; the branch returns them unchanged.
    return node as unknown as View;
  }
  const vnode: VNode = node;
  const slot = isOutletVNode(vnode);
  if (slot !== undefined) {
    if (!declared.has(slot)) {
      return undefined;
    }
    const replacement = fresh[slot];
    if (
      replacement === undefined ||
      replacement === "" ||
      !isRecord(replacement)
    ) {
      return undefined;
    }
    return replacement;
  }
  const children = spliceOutlets(vnode.children, declared, fresh);
  if (children === undefined) {
    return undefined;
  }
  let { props } = vnode;
  if (isFunctionValue(vnode.type) && isModelComponent(vnode.type)) {
    // Slot content belongs to whoever wrote it: only a model child's own
    // `slots` can hold this host's forwarded outlets.
    const { slots } = vnode.props;
    if (isRecord(slots) && !Array.isArray(slots)) {
      let slotsChanged = false;
      const nextSlots: Record<string, View | undefined> = {};
      for (const [name, content] of Object.entries(slots)) {
        const next = spliceOutlets(content, declared, fresh);
        if (next === undefined) {
          return undefined;
        }
        if (next !== content) {
          slotsChanged = true;
        }
        nextSlots[name] = next;
      }
      if (slotsChanged) {
        // SAFETY: the merge only swaps slot tables; every other prop keeps its bag value.
        props = { ...vnode.props, slots: nextSlots } as PropBag;
      }
    }
  }
  if (children !== vnode.children || props !== vnode.props) {
    // SAFETY: the rebuilt vnode keeps the outlet's type and key; only children and props refresh.
    return { ...vnode, children: children as View[], props };
  }
  return vnode;
};
