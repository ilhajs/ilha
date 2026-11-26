/**
 * Child paths: the segment a child adds to its parent's path, and the check
 * that no two children of one view share a path. Ported from Effect UI's
 * `internal/paths.ts`, adapted to Ilha VNodes.
 *
 * @internal
 */
import type { VNode } from "ilha";

const outletNamePattern = /^\[(?<inner>[^\]]+)\]$/u;
/**
 * Whether a model definition name is a slot outlet's: `[name]` with an
 * empty key segments verbatim instead of `Name[key]`, so slot children
 * mount under `placerPath/[name]`.
 *
 * @internal
 */
export const outletNameInner = (name: string): string | undefined => {
  const match = outletNamePattern.exec(name);
  return match === null ? undefined : match.groups?.inner;
};

// Most names and keys need no escaping, so the regular expressions run only for those that do.
const escapeChar = (char: string): string =>
  `%${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`;
const escapeName = (name: string): string =>
  name.includes("%") || name.includes("[")
    ? name.replaceAll(/[%[]/gu, escapeChar)
    : name;
const escapeKey = (key: string): string =>
  key.includes("%") || key.includes("]/")
    ? key.replaceAll(/%|(?<=\])\//gu, escapeChar)
    : key;

/**
 * The segment a child adds to its parent's path: `Name[key]`, or `[name]`
 * for a slot outlet with an empty key.
 *
 * A segment's name ends at its first `[`, and the segment at its first `]/`
 * or at the end of the path. So a name's `[` is written as `%5B`, the `/`
 * of a key's `]/` as `%2F`, and `%` as `%25` in both. Two different children
 * never share a path: a key `a]/B[b` can't stand for a grandchild. Names and
 * keys keep `/` and brackets otherwise. A root's name is its path as given.
 *
 * @internal
 */
export const segmentOf = (name: string, key: string): string => {
  if (key === "" && outletNameInner(name) !== undefined) {
    return `/${name}`;
  }
  return `/${escapeName(name)}[${escapeKey(key)}]`;
};

/**
 * A model-component child vnode in an author's view, with the call options
 * the author wrote: the vnode's key plus the props the painter kept.
 *
 * @internal
 */
export interface ChildCall {
  readonly name: string;
  readonly key: string;
  /** The author's path plus this child's segment. */
  readonly path: string;
  /** The vnode the author wrote, for the authorship stamp. */
  readonly vnode: VNode;
}

/**
 * Read the definition name off a component function. Returns `undefined`
 * for plain Ilha components. This is also the model-component brand check,
 * kept here (instead of `component.ts`) so the import graph stays acyclic.
 *
 * @internal
 */
export const definitionNameOf = (
  // oxlint-disable-next-line anti-slop/no-object-parameters -- the brand check reads one optional field off any component value.
  type: object
): string | undefined => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates the brand field before returning it.
  if ("definitionName" in type && typeof type.definitionName === "string") {
    return type.definitionName;
  }
  return undefined;
};

/**
 * Whether `type` is a model component function built by
 * `defineComponent().make()`.
 *
 * @internal
 */
export const isModelComponent = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the brand check accepts any component value; definitionNameOf decodes it.
  type: unknown
): boolean =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- selects component functions before reading their brand.
  typeof type === "function" && definitionNameOf(type) !== undefined;

// oxlint-disable-next-line anti-slop/no-object-parameters -- the walk passes any author value; the brand check below establishes the vnode contract.
const isIlhaVNode = (node: object): node is VNode => {
  if (!("$$ilha" in node)) {
    return false;
  }
  return node.$$ilha === 1;
};

// oxlint-disable-next-line anti-slop/no-object-parameters -- the walk passes any author value; the iterator check below establishes the iterable contract.
const isIterableView = (node: object): node is Iterable<unknown> => {
  if (!(Symbol.iterator in node)) {
    return false;
  }
  return typeof node[Symbol.iterator] === "function"; // oxlint-disable-line anti-slop/no-runtime-typeof -- reads the iterator method of an iterable view; the call protocol establishes the contract.
};

const visitModelChild = (
  node: VNode,
  type: object, // oxlint-disable-line anti-slop/no-object-parameters -- the narrowed component value of the call site; definitionNameOf reads its brand field.
  out: ChildCall[],
  record: boolean,
  stamp: (vnode: VNode) => void
): void => {
  stamp(node);
  const name = definitionNameOf(type);
  if (name !== undefined && record) {
    const key =
      node.key === null || node.key === undefined ? "" : String(node.key);
    out.push({ key, name, path: "", vnode: node });
  }
  for (const child of node.children) {
    // oxlint-disable-next-line eslint/no-use-before-define -- visit and visitModelChild recurse into each other, so one is necessarily referenced before its definition.
    visit(child, out, false, stamp);
  }
  // Slot content belongs to whoever wrote it, so the writer's walk
  // stamps it: the outlet's later walk keeps the writer (first walk
  // wins) and mounts it under its own `[name]` segment.
  const { slots } = node.props;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates the slotted content before walking it; the walk decodes each entry.
  if (slots !== null && typeof slots === "object") {
    // SAFETY: slots holds placed vnodes keyed by slot name; each entry is re-decoded by the walk.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- slot content is keyed by declared name.
    const contents = Object.values(slots as Record<string, unknown>);
    for (const content of contents) {
      // oxlint-disable-next-line eslint/no-use-before-define -- visit and visitModelChild recurse into each other, so one is necessarily referenced before its definition.
      visit(content, out, false, stamp);
    }
  }
};

const visit = (
  node: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- the walk decodes any author value; each branch below establishes its domain.
  out: ChildCall[],
  record: boolean,
  stamp: (vnode: VNode) => void
): void => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- prunes everything the walk cannot contain; the survivors are decoded below.
  if (node === null || node === undefined || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      visit(item, out, record, stamp);
    }
    return;
  }
  if (isIterableView(node)) {
    for (const item of node) {
      visit(item, out, record, stamp);
    }
    return;
  }
  if (!isIlhaVNode(node)) {
    return;
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- selects component vnodes; the model brand check below establishes the domain.
  if (typeof node.type === "function") {
    // A model child mounts in its own subtree: record it, but walk its
    // vnode-children stamp-only. Everything nested there was written by
    // whoever wrote this vnode (call options, `on<Event>` handlers), so
    // the first walk stamps it even when a forwarder renders it later.
    if (isModelComponent(node.type)) {
      visitModelChild(node, node.type, out, record, stamp);
      return;
    }
    // A plain wrapper's static children belong to the author writing them.
    for (const child of node.children) {
      visit(child, out, record, stamp);
    }
    return;
  }
  for (const child of node.children) {
    visit(child, out, record, stamp);
  }
};
/**
 * Collect the model-component children of one author's view: its own vnode
 * children at any depth below elements, arrays, fragments and iterables.
 * Model component vnodes are not expanded: the child mounts in its own
 * subtree and the author's walk must not claim it. Plain component vnodes
 * are expanded through their static children, so a model child hidden one
 * level inside a plain wrapper keeps its path and stays mounted while the
 * author renders it (see `kernel.md`).
 *
 * @internal
 */
export const collectChildren = (
  view: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- the walk decodes any author value; each branch below establishes its domain.
  stamp: (vnode: VNode) => void = () => {
    // Collecting without a stamp records calls but claims no authorship.
  }
): ChildCall[] => {
  const out: ChildCall[] = [];
  visit(view, out, true, stamp);
  return out;
};

// A missing key is a runtime error, not a type error, so the message names the fix.
const keyHint = (name: string, key: string): string =>
  key === ""
    ? `. A child without a key must be the only ${name} where it is rendered: give each ${name} its own \`key\``
    : `. Give each ${name} its own \`key\``;

/**
 * Throws when two children of the author's view, at any depth below its
 * elements, have the same path. Two instances at one path would share a log
 * path, a snapshot entry and a hydration marker, so the author fails
 * instead. Returns the calls with their paths resolved under `at`.
 *
 * @internal
 */
export const checkChildPaths = (
  at: string,
  view: unknown, // oxlint-disable-line anti-slop/no-unknown-parameters -- the walk decodes any author value; each branch of the walk establishes its domain.
  stamp: (vnode: VNode) => void = () => {
    // Checking without a stamp resolves paths but claims no authorship.
  }
): ChildCall[] => {
  const resolved = collectChildren(view, stamp).map((call) => ({
    ...call,
    path: `${at}${segmentOf(call.name, call.key)}`,
  }));
  const taken = new Set<string>();
  for (const call of resolved) {
    if (taken.has(call.path)) {
      throw new Error(
        `${at} renders two children at ${segmentOf(call.name, call.key)}${keyHint(call.name, call.key)}`
      );
    }
    taken.add(call.path);
  }
  return resolved;
};
