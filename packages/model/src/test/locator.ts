/**
 * Locators over a minimal structural tree, so one locator works on a scene's
 * view value and on `TestHost`'s rendered tree alike.
 *
 * A node is anything with some of `tag`, `attrs`, `text` and `children`:
 * an element has a `tag`, a text node has `text`. Locators match elements.
 * `text` matches the innermost elements whose text contains the string,
 * `attr` and `testId` match by attribute, and `inside` narrows a locator to
 * the subtree of another.
 *
 * **Example** (Finding a row's button)
 *
 * ```ts
 * import { Locator } from "@ilha/model/test"
 *
 * const row = (id: string) => ({
 *   tag: "li",
 *   attrs: { "data-testid": id },
 *   children: [{ tag: "button", children: [{ text: "Save" }] }]
 * })
 * const tree = { tag: "ul", children: [row("row-1"), row("row-2")] }
 *
 * const button = Locator.get(tree, Locator.inside(Locator.testId("row-2"), Locator.text("Save")))
 * console.log(button === tree.children[1].children[0]) // true
 * ```
 */

import type { PropBag, View, VNode } from "ilha";
import { Fragment } from "ilha";

/** Whether `value` is a function. */
const isFunctionValue = <T>(
  value: T
): value is T & ((...args: readonly never[]) => never) =>
  typeof value === "function";

/** Whether `value` is a string. */
const isStringValue = <T>(value: T): value is T & string =>
  typeof value === "string";

/** Whether `value` is a number or bigint. */
const isNumberValue = <T>(value: T): value is T & (number | bigint) =>
  typeof value === "number" || typeof value === "bigint";

/** Whether `view` is a boolean: nothing to locate. */
const isBooleanView = <T>(view: T): view is T & boolean =>
  typeof view === "boolean";

/** Whether `view` is text content: a string, number, or bigint. */
const isTextualView = <T>(view: T): view is T & (string | number | bigint) =>
  isStringValue(view) || isNumberValue(view);

/** Whether `view` is an iterable of child views. */
const isIterableView = (view: View): view is Iterable<View> =>
  typeof view === "object" && view !== null && Symbol.iterator in view;

/**
 * Whether `view` is an Ilha vnode. Kept local so locators don't need the
 * core's `isVNode` export; Scene will narrow further when it wires handlers.
 */
const isVNodeView = (view: View): view is VNode =>
  typeof view === "object" &&
  view !== null &&
  "$$ilha" in view &&
  view.$$ilha === 1;

/**
 * The structural tree every locator runs over.
 *
 * **Details**
 *
 * `props` holds the typed values set with `.prop`, such as a field's
 * `value` and `checked`, which aren't attributes. A scene's view value and a
 * `TestHost` tree both have them, and a vocabulary's readers, such as
 * `DomLocator.value`, read them.
 */
export interface Node {
  readonly tag?: string | undefined;
  readonly attrs?: Readonly<Record<string, string | undefined>> | undefined;
  readonly props?: PropBag | undefined;
  readonly text?: string | undefined;
  readonly children?: readonly Node[] | undefined;
}

/**
 * Finds elements under a root, in document order.
 */
export interface Locator {
  readonly description: string;
  readonly all: <N extends Node>(root: N) => readonly N[];
}

/**
 * The text of a node and everything under it.
 */
export const textOf = (node: Node): string =>
  node.text !== undefined && node.tag === undefined
    ? node.text
    : (node.children ?? []).map(textOf).join("");

/**
 * Every element under `root`, `root` included, in document order.
 */
export const elements = <N extends Node>(root: N): readonly N[] => {
  const out: N[] = [];
  const walk = (node: N) => {
    if (node.tag !== undefined) {
      out.push(node);
    }
    for (const child of node.children ?? []) {
      // SAFETY: `child` comes from `node`'s own subtree, so it is the same `N` as its parent.
      walk(child as N);
    }
  };
  walk(root);
  return out;
};

/**
 * The elements directly under `node`. A node with children but no tag, such
 * as the content a story shows under a child's slots, is seen through.
 */
const childElements = (node: Node): readonly Node[] =>
  (node.children ?? []).flatMap((child) =>
    child.tag === undefined ? childElements(child) : [child]
  );

const make = (
  description: string,
  all: <N extends Node>(root: N) => readonly N[]
): Locator => ({
  all,
  description,
});

/**
 * The innermost elements whose text contains `text`, or equals it with
 * `{ exact: true }`.
 */
export const text = (
  wanted: string,
  options?: { readonly exact?: boolean | undefined }
): Locator => {
  const matches = (node: Node) =>
    options?.exact === true
      ? textOf(node).trim() === wanted
      : textOf(node).includes(wanted);
  return make(`text ${JSON.stringify(wanted)}`, (root) =>
    elements(root).filter(
      (node) => matches(node) && !childElements(node).some(matches)
    )
  );
};

/**
 * Elements with the attribute `name`, equal to `value` when one is given.
 */
export const attr = (name: string, value?: string): Locator =>
  make(
    value === undefined ? `[${name}]` : `[${name}=${JSON.stringify(value)}]`,
    (root) =>
      elements(root).filter((node) =>
        value === undefined
          ? node.attrs?.[name] !== undefined
          : node.attrs?.[name] === value
      )
  );

/**
 * Elements with `data-testid` equal to `id`.
 */
export const testId = (id: string): Locator => attr("data-testid", id);

/**
 * Elements with the tag `tag`.
 */
export const tag = (tagName: string): Locator =>
  make(`<${tagName}>`, (root) =>
    elements(root).filter((node) => node.tag === tagName)
  );

/**
 * What `locator` finds inside the elements `container` finds.
 */
export const inside = (container: Locator, locator: Locator): Locator =>
  make(`${locator.description} inside ${container.description}`, (root) => {
    const found = new Set<unknown>();
    for (const outer of container.all(root)) {
      for (const node of locator.all(outer)) {
        if (node !== outer) {
          found.add(node);
        }
      }
    }
    return elements(root).filter((node) => found.has(node));
  });

/**
 * Every match, in document order.
 */
export const all = <N extends Node>(root: N, locator: Locator): readonly N[] =>
  locator.all(root);

/**
 * The one match, or `undefined`. Throws when there are several.
 */
export const query = <N extends Node>(
  root: N,
  locator: Locator
): N | undefined => {
  const found = locator.all(root);
  if (found.length > 1) {
    throw new Error(
      `Locator: ${found.length} elements match ${locator.description}`
    );
  }
  return found[0];
};

/**
 * The one match. Throws when there's none or several.
 */
export const get = <N extends Node>(root: N, locator: Locator): N => {
  const found = query(root, locator);
  if (found === undefined) {
    throw new Error(`Locator: nothing matches ${locator.description}`);
  }
  return found;
};

/**
 * A node that can receive events, as `TestHost`'s nodes can.
 */
export interface Firable extends Node {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- event payloads are vocabulary-shaped plain data; hosts forward them untouched.
  readonly fire: (event: string, payload: unknown) => void;
}

/**
 * Sends `event` with `payload` to `node`. The innermost element with a
 * handler for it, `node` or an ancestor, gets it.
 *
 * **Details**
 *
 * Payloads are plain data shaped by the vocabulary, such as `{ value }` for
 * `input`. A scene's view value has no host, so scene tests use the
 * `fire` and `click` steps of `Scene.Steps` instead.
 */
export const fire = (
  node: Firable,
  event: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- event payloads are vocabulary-shaped plain data; hosts forward them untouched.
  payload: unknown = {}
): void => node.fire(event, payload);

/** Event props (`onClick` / `onclick`) never become attributes. */
const EVENT_PROP = /^on(?:[A-Z].{2,}|[a-z]{3,}$)/u;

/** Props that stay live values instead of becoming string attributes. */
const LIVE_PROPS: ReadonlySet<string> = new Set([
  "checked",
  "open",
  "popoverOpen",
  "selected",
  "value",
]);

/** The attribute name a prop paints as: `className`/`htmlFor` map to their DOM names. */
const attrName = (key: string): string => {
  if (key === "className") {
    return "class";
  }
  if (key === "htmlFor") {
    return "for";
  }
  return key;
};

/** The attribute and live-value props split for painting. */
interface SplitProps {
  readonly attrs?: Record<string, string> | undefined;
  readonly live?: PropBag | undefined;
}

/** An element node under construction: every field but the tag arrives conditionally. */
interface ElementOut {
  tag: string;
  attrs?: Record<string, string> | undefined;
  props?: PropBag | undefined;
  children?: Node[] | undefined;
}

const splitProps = (props: PropBag): SplitProps => {
  let attrs: Record<string, string> | undefined;
  let live: Record<string, PropBag[string]> | undefined;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (EVENT_PROP.test(key) || isFunctionValue(value)) {
      continue;
    }
    if (LIVE_PROPS.has(key)) {
      live ??= {};
      live[key] = value;
      continue;
    }
    if (isStringValue(value)) {
      attrs ??= {};
      attrs[attrName(key)] = value;
      continue;
    }
    if (isNumberValue(value) || value === true) {
      attrs ??= {};
      attrs[key] = String(value);
      continue;
    }
    // Objects (style bags), arrays and atoms have no locator meaning.
  }
  return { attrs, live };
};

const fromChild = (view: View): Node | undefined => {
  if (view === null || view === undefined || isBooleanView(view)) {
    return undefined;
  }
  if (isTextualView(view)) {
    return { text: String(view) };
  }
  if (Array.isArray(view)) {
    const children: Node[] = [];
    for (const item of view) {
      const node = fromChild(item);
      if (node !== undefined) {
        children.push(node);
      }
    }
    return { children };
  }
  if (isVNodeView(view)) {
    // oxlint-disable-next-line eslint/no-use-before-define -- mutually recursive with fromVNode below.
    return fromVNode(view);
  }
  // Atom views, streams, generators, components, unsafe HTML and other
  // iterables only resolve at render; the locator tree skips them.
  if (isIterableView(view)) {
    const children: Node[] = [];
    for (const item of view) {
      const node = fromChild(item);
      if (node !== undefined) {
        children.push(node);
      }
    }
    return { children };
  }
  return undefined;
};

/**
 * Adapt an Ilha view to a {@link Node} tree for {@link Locator} and
 * `DomLocator` queries. Only intrinsic elements and text are expanded:
 * fragments flatten to tagless nodes, and component vnodes become tagless
 * nodes holding their raw props (so a Scene can find children by component)
 * with their declared children underneath. Event handlers stay in the
 * component node's props; they never become attributes.
 */
export const fromVNode = (view: View): Node => {
  if (!isVNodeView(view)) {
    return fromChild(view) ?? {};
  }
  const node = view;
  if (node.type === Fragment) {
    const children: Node[] = [];
    for (const child of node.children) {
      const converted = fromChild(child);
      if (converted !== undefined) {
        children.push(converted);
      }
    }
    return { children };
  }
  if (!isStringValue(node.type)) {
    // A component vnode: tagless, holding its props for lookup by component.
    const children: Node[] = [];
    for (const child of node.children) {
      const converted = fromChild(child);
      if (converted !== undefined) {
        children.push(converted);
      }
    }
    if (children.length === 0) {
      return { props: node.props };
    }
    return { children, props: node.props };
  }
  const { attrs, live } = splitProps(node.props);
  const children: Node[] = [];
  for (const child of node.children) {
    const converted = fromChild(child);
    if (converted !== undefined) {
      children.push(converted);
    }
  }
  const out: ElementOut = { tag: node.type };
  if (attrs !== undefined) {
    out.attrs = attrs;
  }
  if (live !== undefined) {
    out.props = live;
  }
  if (children.length > 0) {
    out.children = children;
  }
  return out;
};
