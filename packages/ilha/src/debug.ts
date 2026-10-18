/**
 * Introspection for tests, devtools, and coding agents (`ilha/debug`).
 *
 * `inspect()` returns JSON-serializable trees of the live roots, and
 * `onChange()` reports when a root settles. Nothing here runs unless you
 * import it: the core keeps only a set of live root fibers.
 */
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

import type { FiberLocal } from "./runtime.ts";
import { isFunction, isObject, isString, SLOT_ATTR } from "./shared.ts";
import type { SnapshotValue } from "./snapshot.ts";
import { liveRoots, rootListeners } from "./start.ts";

/** An atom value made JSON-safe: functions and Effects become `<…>` strings. */
export type InspectValue = SnapshotValue | string;

export interface IlhaInspectAtom {
  /** Position among the component's `atom()` slots, in declaration order. */
  readonly index: number;
  readonly value: InspectValue;
}

export interface IlhaInspectNode {
  /** Stable while the component lives; pass it to `setAtom` and `element`. */
  readonly id: string;
  readonly component: string;
  /** CSS-like description of the host element; absent for non-DOM roots. */
  readonly host?: string;
  readonly atoms: readonly IlhaInspectAtom[];
  readonly children: readonly IlhaInspectNode[];
}

export type SetAtomResult = { ok: true } | { ok: false; reason: string };

const MAX_DEPTH = 6;
const MAX_ITEMS = 100;
const MAX_STRING = 2000;
const UNSAFE_KEY = /^(?:__proto__|constructor|prototype)$/u;

const isNumber = <T>(value: T): value is T & number =>
  typeof value === "number";

const isBoolean = <T>(value: T): value is T & boolean =>
  typeof value === "boolean";

const isBigInt = <T>(value: T): value is T & bigint =>
  typeof value === "bigint";

const isSymbol = <T>(value: T): value is T & symbol =>
  typeof value === "symbol";

const isDomElement = <T>(value: T): value is T & Element =>
  "Element" in globalThis && value instanceof globalThis.Element;

const nameOfFunction = <T>(value: T): string => {
  if (!isFunction(value)) {
    return "";
  }
  return Object.getOwnPropertyDescriptor(value, "name")?.value ?? "";
};

const constructorName = <T extends object>(value: T): string => {
  const proto = Object.getPrototypeOf(value);
  return proto === null
    ? "Object"
    : nameOfFunction(
        Object.getOwnPropertyDescriptor(proto, "constructor")?.value
      ) || "Object";
};

const isPlainObject = <T extends object>(value: T): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
};

type Summarize = <T>(
  value: T,
  depth: number,
  seen: WeakSet<object>
) => InspectValue;

// Late-bound: the container summaries below recurse through `summarize`.
interface Walker {
  summarize: Summarize;
}

const walk: Walker = { summarize: () => null };

const summarizeAsync = <A, E>(
  value: AsyncResult.AsyncResult<A, E>,
  depth: number,
  seen: WeakSet<object>
): InspectValue => {
  if (AsyncResult.isFailure(value)) {
    const failure = AsyncResult.error(value);
    return `<AsyncResult failure: ${failure._tag === "Some" ? String(failure.value) : "defect"}>`;
  }
  const payload = AsyncResult.value(value);
  if (payload._tag === "Some") {
    return walk.summarize(payload.value, depth, seen);
  }
  return AsyncResult.isWaiting(value)
    ? "<AsyncResult waiting>"
    : "<AsyncResult initial>";
};

const summarizeList = <T>(
  items: readonly T[],
  depth: number,
  seen: WeakSet<object>
): InspectValue => {
  if (depth >= MAX_DEPTH) {
    return `<Array(${items.length})>`;
  }
  const out: InspectValue[] = items
    .slice(0, MAX_ITEMS)
    .map((item) => walk.summarize(item, depth + 1, seen));
  if (items.length > MAX_ITEMS) {
    out.push(`<${items.length - MAX_ITEMS} more>`);
  }
  return out;
};

const summarizeRecord = <T extends object>(
  value: T,
  depth: number,
  seen: WeakSet<object>
): InspectValue => {
  if (depth >= MAX_DEPTH) {
    return "<Object>";
  }
  const out: Record<string, InspectValue> = {};
  const entries = Object.entries(value).filter(
    ([key]) => !UNSAFE_KEY.test(key)
  );
  for (const [key, item] of entries.slice(0, MAX_ITEMS)) {
    out[key] = walk.summarize(item, depth + 1, seen);
  }
  if (entries.length > MAX_ITEMS) {
    out["…"] = `<${entries.length - MAX_ITEMS} more>`;
  }
  return out;
};

/** Non-container values: scalars, functions, and anything else by name. */
const summarizeLeaf = <T>(value: T): InspectValue => {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return "<undefined>";
  }
  if (isString(value)) {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (isNumber(value)) {
    return Number.isFinite(value) ? value : String(value);
  }
  if (isBoolean(value)) {
    return value;
  }
  if (isBigInt(value)) {
    return `<bigint ${value}>`;
  }
  if (isSymbol(value)) {
    return `<symbol ${value.description ?? ""}>`.replace(" >", ">");
  }
  if (isFunction(value)) {
    return `<function ${nameOfFunction(value) || "anonymous"}>`;
  }
  return `<${String(value)}>`;
};

/** Effect values and dates, maps, errors: named rather than expanded. */
const summarizeOpaque = <T extends object>(
  value: T
): InspectValue | undefined => {
  if (Atom.isAtom(value)) {
    return "<Atom>";
  }
  if (Effect.isEffect(value)) {
    return "<Effect>";
  }
  if (Stream.isStream(value)) {
    return "<Stream>";
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? "<Invalid Date>"
      : value.toISOString();
  }
  if (value instanceof Map || value instanceof Set) {
    return `<${constructorName(value)}(${value.size})>`;
  }
  if (value instanceof Error) {
    return `<${constructorName(value)}: ${value.message}>`;
  }
  return undefined;
};

const summarizeContainer = <T extends object>(
  value: T,
  depth: number,
  seen: WeakSet<object>
): InspectValue => {
  if (AsyncResult.isAsyncResult(value)) {
    return summarizeAsync(value, depth, seen);
  }
  const opaque = summarizeOpaque(value);
  if (opaque !== undefined) {
    return opaque;
  }
  if (seen.has(value)) {
    return "<circular>";
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return summarizeList(value, depth, seen);
    }
    return isPlainObject(value)
      ? summarizeRecord(value, depth, seen)
      : `<${constructorName(value)}>`;
  } finally {
    seen.delete(value);
  }
};

/** Reduce any value to JSON, naming what JSON cannot carry. */
const summarize: Summarize = (value, depth, seen) =>
  isObject(value) || Array.isArray(value)
    ? summarizeContainer(value, depth, seen)
    : summarizeLeaf(value);

walk.summarize = summarize;

const ids = new WeakMap<FiberLocal, string>();
let lastId = 0;

const idOf = (fiber: FiberLocal): string => {
  let id = ids.get(fiber);
  if (id === undefined) {
    lastId += 1;
    id = `i${lastId}`;
    ids.set(fiber, id);
  }
  return id;
};

const describeHost = (el: Element): string => {
  const tag = el.tagName.toLowerCase();
  if (el.id) {
    return `${tag}#${el.id}`;
  }
  const slot = el.getAttribute(SLOT_ATTR);
  if (slot !== null) {
    return `${tag}[${SLOT_ATTR}="${slot}"]`;
  }
  const [first] = el.classList;
  return first ? `${tag}.${first}` : tag;
};

const componentName = (fiber: FiberLocal): string =>
  nameOfFunction(fiber.componentType) ||
  (fiber.parent === undefined ? "Root" : "Anonymous");

/** Read an atom without starting work: unread effect atoms stay unevaluated. */
const readAtom = (
  fiber: FiberLocal,
  atom: Atom.Atom<unknown>
): InspectValue => {
  const node = fiber.registry.getNodes().get(atom);
  const state = node?.currentState();
  if (!node || state === "uninitialized" || state === "removed") {
    return "<unread>";
  }
  return summarize(node.value(), 0, new WeakSet());
};

/** Hole fibers that are components; atom and stream holes are looked through. */
const componentChildren = (fiber: FiberLocal): FiberLocal[] =>
  fiber.holes.flatMap(({ fiber: hole }) => {
    if (!hole || hole.closed) {
      return [];
    }
    return hole.componentType === undefined ? componentChildren(hole) : [hole];
  });

const toNode = (fiber: FiberLocal): IlhaInspectNode => {
  const node = {
    atoms: (fiber.primitives ?? []).map((atom, index) => ({
      index,
      value: readAtom(fiber, atom),
    })),
    children: componentChildren(fiber).map(toNode),
    component: componentName(fiber),
    id: idOf(fiber),
  };
  return isDomElement(fiber.root)
    ? { ...node, host: describeHost(fiber.root) }
    : node;
};

/** Every fiber under `fiber` (itself included) whose root is `host`. */
const fibersAt = (fiber: FiberLocal, host: Element): FiberLocal[] =>
  fiber.root === host
    ? [fiber]
    : fiber.holes.flatMap(({ fiber: hole }) =>
        hole && !hole.closed ? fibersAt(hole, host) : []
      );

/** The live component fiber that `inspect()` gave `id`. */
const findFiber = (id: string): FiberLocal | undefined => {
  const visit = (fiber: FiberLocal): FiberLocal | undefined => {
    if (ids.get(fiber) === id) {
      return fiber;
    }
    for (const child of componentChildren(fiber)) {
      const hit = visit(child);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  };
  for (const root of liveRoots) {
    const hit = visit(root);
    if (hit) {
      return hit;
    }
  }
  return undefined;
};

/**
 * JSON-serializable trees of the live roots: component names, atom values,
 * and child components. Pass `host` to inspect one root or component host.
 */
export const inspect = (host?: Element): IlhaInspectNode[] => {
  const found = [...liveRoots].flatMap((root) =>
    host === undefined ? [root] : fibersAt(root, host)
  );
  return found.map(toNode);
};

/** Host elements of the live DOM roots. SSR and custom-renderer roots have none. */
export const roots = (): Element[] =>
  [...liveRoots].map((fiber) => fiber.root).filter(isDomElement);

/** The element an inspected component paints into, to highlight or measure. */
export const element = (id: string): Element | undefined => {
  const root = findFiber(id)?.root;
  return isDomElement(root) ? root : undefined;
};

/**
 * Replace atom `index` of component `id` with a JSON `value`. Only writable
 * state atoms accept it; derived atoms and Effect atoms report why they cannot.
 */
export const setAtom = <T extends SnapshotValue>(
  id: string,
  index: number,
  value: T
): SetAtomResult => {
  const fiber = findFiber(id);
  if (!fiber) {
    return {
      ok: false,
      reason: `No live component has id "${id}". Call inspect() again.`,
    };
  }
  const atom = fiber.primitives?.[index];
  if (!atom) {
    return {
      ok: false,
      reason: `Component "${id}" has no atom at index ${index}.`,
    };
  }
  if (!Atom.isWritable(atom)) {
    return {
      ok: false,
      reason: `Atom ${index} of "${id}" is derived and read-only.`,
    };
  }
  fiber.registry.set(atom, value);
  return { ok: true };
};

/**
 * Call `listener` after any root settles, mounts, or unmounts. The listener
 * runs synchronously, so coalesce in it if you re-read the whole tree.
 * Returns an unsubscribe function.
 */
export const onChange = (listener: () => void): (() => void) => {
  const guarded = (): void => {
    try {
      listener();
    } catch (error) {
      console.error(error);
    }
  };
  rootListeners.add(guarded);
  return () => {
    rootListeners.delete(guarded);
  };
};
