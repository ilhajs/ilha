import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
/**
 * Scene tests drive one component through its rendered view and assert on
 * what it renders: pure, with no runtime, no Layers and no host.
 *
 * A scene has no `send` and shows no Model; interactions reach `update`
 * through view handlers. Commands stay pending as data until a step resolves
 * them. A child is a leaf, named by component then key: `childEmit` stands
 * in for what it emits. Every step follows the acknowledgement rule
 * described in `steps.ts`. An interaction no handler turned into a message
 * must be followed by `expectIgnored()`.
 */
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Scope from "effect/Scope";
import type { PropBag, View, VNode } from "ilha";

import type { HeadlessComponent } from "../component.ts";
import { routeEmit } from "../internal/child.ts";
import type * as Mount from "../mount.ts";
import { fireCustomEvent, fireFrame, fireGlobal } from "./dom-events.ts";
import {
  componentNameOf,
  Engine,
  isModelChild,
  isVNode,
  rootPathOf,
} from "./engine.ts";
import { childNameOf } from "./features.ts";
import * as Locator from "./locator.ts";
import { mountExpectMount, mountMounted } from "./mounts.ts";
import {
  givenChildSet,
  isChildDescriptor,
  isHeadlessComponent,
  partsOfHeadless,
} from "./parts.ts";
import type { ChildDescriptor } from "./parts.ts";
import { sharedCollected } from "./shared.ts";
import { atSite } from "./steps.ts";
import type {
  AnyComponent,
  EventsOf,
  Given,
  MessageOf,
  ModelOf,
  PropsOf,
  Record as TestRecord,
  Steps as SharedSteps,
} from "./steps.ts";
import { StepsImpl } from "./story.ts";

/** A mount's definition, or an issued mount to also match the args. */
export type MountTarget = Mount.AnyDefinition | Mount.Any;

/**
 * A node of the scene's view tree: the structural `Locator.Node` shape plus
 * the handlers the view put on the element. Model components are leaves;
 * plain wrappers and fragments are seen through.
 */
export interface TestNode extends Locator.Node {
  readonly children: readonly TestNode[];
  /** Handlers by event type (`click` for `onclick`/`onClick`). */
  readonly handlers: ReadonlyMap<string, (event: SyntheticEvent) => void>;
  /** The vnode this node was built from, when it is an element or a child leaf. */
  readonly vnode?: VNode | undefined;
  /** The parent node, for handler bubbling and disabled checks. */
  readonly parent?: TestNode | undefined;
  /** The child entry, when this node is a model-component leaf. */
  readonly childPath?: string | undefined;
  /** The author's `fallback` for a child leaf, when one was written. */
  readonly fallbackFn?: ((result: never) => View) | undefined;
  /** The raw props bag, for `value`/`checked`/`disabled` reads. */
  readonly rawProps: PropBag;
}

/**
 * The event object an interaction hands a handler: the event `type`, the
 * step's payload fields, and a `preventDefault` the `h.send` wrapper honors.
 */
export interface SyntheticEvent {
  readonly type: string;
  preventDefault: () => void;
  readonly defaultPrevented: boolean;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- synthetic events carry arbitrary payload fields beside type.
  readonly [field: string]: unknown;
}

/** `onClick` / `onclick` → `click`; non-event props → `undefined`. */
const EVENT_PROP = /^on(?:[A-Z].{2,}|[a-z]{3,}$)/u;

const eventTypeFromProp = (key: string): string | undefined =>
  EVENT_PROP.test(key) ? key.slice(2).toLowerCase() : undefined;

/**
 * The state of one instance between steps, as a scene records it: what the
 * view shows, and no Model.
 */
export interface Scene<Props, _Model, _Msg, Events> extends TestRecord<
  Props,
  _Model,
  _Msg,
  Events
> {
  /**
   * Whether the interaction that made this record cancelled its event's
   * default: its handler was set with `preventDefault: true` and produced a
   * message, or with `"always"`, or the event is `submit`. Any other step
   * that makes a record resets it to `false`.
   */
  readonly defaultPrevented: boolean;
  /** The view of the current Model and props. */
  readonly view: () => View;
  /** The view as a `Locator.Node` tree. */
  readonly root: TestNode;
  /** The one element matching `locator`. Throws when there's none or several. */
  readonly get: (locator: Locator.Locator) => TestNode;
  /** The one element matching `locator`, or `undefined`. Throws when there are several. */
  readonly query: (locator: Locator.Locator) => TestNode | undefined;
  /** Every element matching `locator`, in document order. */
  readonly all: (locator: Locator.Locator) => readonly TestNode[];
}

/**
 * The assertions `expect(locator)` offers. Each one checks the elements
 * `locator` matches in the current view and returns the cursor. A failure
 * lists the view's elements.
 */
export interface Expect<S> {
  /** Asserts that at least one element matches. */
  toExist: () => S;
  /** Asserts that nothing matches. */
  toBeAbsent: () => S;
  /**
   * Asserts that exactly one element matches and that its text, with
   * whitespace collapsed and trimmed, is `text`, or matches it.
   */
  toHaveText: (text: string | RegExp) => S;
  /** Asserts that exactly `count` elements match. */
  toHaveCount: (count: number) => S;
  /** Asserts that exactly one element matches and its field value is `value`. */
  toHaveValue: (value: string) => S;
  /** Asserts that exactly one element matches and its checked state is `checked`. */
  toBeChecked: (checked?: boolean) => S;
  /** Asserts that exactly one element matches and its disabled state is `disabled`. */
  toBeDisabled: (disabled?: boolean) => S;
  /**
   * Asserts that exactly one element matches and its accessible name is
   * `name`, or matches it. The name is computed as the DOM engine does:
   * `aria-labelledby` → `aria-label` → label → content → `title`.
   */
  toHaveAccessibleName: (name: string | RegExp) => S;
}

/**
 * A cursor over one scene. It has the shared steps plus view interactions,
 * and drives the instance through its view.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the namespace below holds Steps' helper types; interface/namespace merging is the documented pattern.
export interface Steps<
  C extends AnyComponent,
  Parts = never,
> extends SharedSteps<C> {
  /** The scene after the last step. */
  readonly current: Scene<PropsOf<C>, ModelOf<C>, MessageOf<C>, EventsOf<C>>;
  /** Whether the last interaction cancelled its event's default. */
  readonly defaultPrevented: boolean;
  /** The view after the last step. */
  readonly view: View;
  /** The view after the last step, as a `Locator.Node` tree. */
  readonly root: TestNode;
  /** The one element matching `locator` in the current view. Throws when there's none or several. */
  get: (locator: Locator.Locator) => TestNode;
  /** The one element matching `locator` in the current view, or `undefined`. Throws when there are several. */
  query: (locator: Locator.Locator) => TestNode | undefined;
  /** Every element matching `locator` in the current view, in document order. */
  all: (locator: Locator.Locator) => readonly TestNode[];
  /**
   * Gives an owner of shared state the reports of its readers: runs its
   * `shares.collects.onChange` and delivers when the result differs from
   * the last one. A message step when it delivers.
   */
  /**
   * Clicks the one element `target` matches: the innermost element with a
   * `click` handler, that element or an ancestor, sends its message. A
   * string means `Locator.text(target)`. An interaction. The payload is a
   * mouse's primary button at the origin with no modifier keys. The click
   * sends `pointerdown`, `mousedown`, `mouseup`, `click`, then the browser
   * defaults (submit, checkbox, radio, popover); cancelling `pointerdown`
   * skips `mousedown`/`mouseup` but not `click`, and only a cancelled
   * `click` skips the defaults. A disabled control throws.
   */
  click: (target: string | Locator.Locator) => this;
  /**
   * Sends `event` with `payload`, `{}` by default, to the one element
   * `locator` matches: the innermost element with a handler for it, that
   * element or an ancestor, sends its message. An interaction: one whose
   * handlers produced no message must be followed by `expectIgnored()`.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- synthetic payloads carry arbitrary DOM event fields the component decodes.
  fire: (locator: Locator.Locator, event: string, payload?: unknown) => this;
  /** Sends the message the parent's `onEmit` maps `event` from the child to, if any. `child` is a component, stub or feature service. A message step. Sends the message for the child at `key`. */
  // oxlint-disable-next-line anti-slop/no-object-parameters, anti-slop/no-unknown-parameters -- children are matched by identity; childEmit takes the key or the event by design.
  childEmit: (child: object, keyOrEvent: unknown, event?: unknown) => this;
  /** Fails the child: its slot shows the fallback's failure branch, and the parent's `onFailure` message is sent, if any. A message step. Fails the child at `key`. */
  // oxlint-disable-next-line anti-slop/no-object-parameters, anti-slop/no-unknown-parameters -- children are matched by identity; childFailure takes the key or the failure by design.
  childFailure: (
    // oxlint-disable-next-line anti-slop/no-object-parameters -- children are matched by identity; the engine resolves them.
    child: object,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- childFailure takes the key or the failure by design.
    keyOrCause: unknown,
    cause?: Cause.Cause<unknown>
  ) => this;
  /**
   * Shows the child's fallback with `AsyncResult.initial(true)` until a
   * `childFailure`, optionally at `key`. An acting step.
   */
  // oxlint-disable-next-line anti-slop/no-object-parameters -- children are matched by identity; the engine resolves them.
  childPending: (child: object, key?: string) => this;
  /** The Model a headless child expands from, keyed by the headless component; optionally at `key`. */
  // oxlint-disable-next-line anti-slop/no-object-parameters, anti-slop/no-unknown-parameters -- headless children are matched by identity; givenChild takes the key or the model by design.
  givenChild: (headless: object, keyOrModel: unknown, model?: unknown) => this;
  /** Ends the one matching mount and sends the view's mapped message. An acting step. */
  mounted: (target: MountTarget, ...result: readonly unknown[]) => this;
  /** Acknowledges exactly one running mount. */
  expectMount: (mount: MountTarget) => this;
  /** Asserts on the elements `locator` matches in the current view. */
  expect: (locator: Locator.Locator) => Expect<this>;
  /** Asserts nothing: marks the interaction handled without checking. */
  expectHandled: () => this;
  /** Acknowledges an ignored interaction. Required after one; throws after any other step. */
  expectIgnored: () => this;
  /** Asserts whether the last interaction cancelled its event's default. */
  expectDefaultPrevented: (expected?: boolean) => this;
  /** Asserts on a headless component's parts. The component under test must be headless. */
  parts: (f: (parts: Parts) => void) => this;
  /** Types into a text field: fires `input` with the value. An interaction. */
  type: (
    locator: Locator.Locator,
    value: string,
    options?: {
      readonly composing?: boolean | undefined;
      readonly inputType?: string | undefined;
    }
  ) => this;
  /** Changes a field: fires `change` with the value or payload. An interaction. */
  change: (
    locator: Locator.Locator,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- a change carries a field map when one string cannot name the value.
    value: string | Record<string, unknown>
  ) => this;
  /** Presses a key: fires `keydown` with the key and modifiers. An interaction. */
  keydown: (
    locator: Locator.Locator,
    key: string,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- key details carry arbitrary KeyboardEvent init fields.
    details?: Record<string, unknown>
  ) => this;
  /** Submits a form as pressing Enter in it would: no submitter. An interaction. */
  submit: (locator: Locator.Locator) => this;
  /** Moves focus to the element. An interaction. */
  focus: (locator: Locator.Locator) => this;
  /** Moves focus away from the element. An interaction. */
  blur: (locator: Locator.Locator) => this;
  /** Runs document listeners for `event`: capture, then bubble. An interaction. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- synthetic payloads carry arbitrary DOM event fields the component decodes.
  fireDocument: (event: string, payload?: unknown) => this;
  /** Runs window listeners for `event`: capture, then bubble. An interaction. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- synthetic payloads carry arbitrary DOM event fields the component decodes.
  fireWindow: (event: string, payload?: unknown) => this;
  /** Runs custom-event listeners for `event`, receiving the payload as `detail`. An interaction. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- synthetic payloads carry arbitrary DOM event fields the component decodes.
  fireCustomEvent: (event: string, payload?: unknown) => this;
  /** Runs animation-frame listeners with `delta`. An interaction. */
  frame: (delta?: number) => this;
}

// oxlint-disable-next-line typescript/no-namespace -- helper types for Steps live in the merged namespace by design.
export declare namespace Steps {
  /**
   * A cursor over any component, for steps shared across components.
   */
  export type Any = Steps<AnyComponent, never>;
}

interface TreeContext {
  readonly parentPath: string;
  readonly failed: ReadonlyMap<
    string,
    AsyncResult.AsyncResult<unknown, unknown>
  >;
  readonly children: ReadonlyMap<string, { readonly fallback: unknown }>;
}

/**
 * A composed headless child (`p.child`) in the scene tree: a leaf like a
 * model child, matched by headless component then key.
 */
export interface ComposedChild {
  readonly name: string;
  readonly key: string;
  readonly path: string;
  readonly onEmit: unknown;
  readonly onFailure: unknown;
}

/**
 * Builds the leaves for a `p.child` descriptor: a failed one renders
 * nothing, like a model child without a fallback.
 */
const composedLeaf = (view: View, ctx: TreeContext): TestNode[] => {
  // SAFETY: composed leaves are built from view-declared child descriptors; the tag dispatch above rejects the rest.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the view union blocks a direct cast to the descriptor.
  const descriptor = view as unknown as ChildDescriptor;
  // SAFETY: composed descriptors declare their headless component.
  const headless = descriptor.headless as { readonly definitionName?: unknown };
  const name =
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- descriptors name their component or fall back to unknown by design.
    typeof headless.definitionName === "string"
      ? headless.definitionName
      : "unknown";
  const key = descriptor.key ?? "";
  const path = `${ctx.parentPath}/${name}${key === "" ? "" : `[${key}]`}`;
  if (ctx.failed.get(path) !== undefined) {
    return [];
  }
  return [
    {
      attrs: {},
      childPath: path,
      children: [],
      handlers: new Map(),
      rawProps: {},
      tag: name,
    },
  ];
};
/**
 * Collects the composed headless children (`p.child`) a view declares,
 * with the same paths `composedLeaf` builds, so `matchChild` finds them.
 */
const collectComposed = (
  view: View,
  parentPath: string
): readonly ComposedChild[] => {
  const out: ComposedChild[] = [];
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the collector walks schemaless declared views.
  const visit = (node: unknown, path: string): void => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- only objects can declare children; primitives return early.
    if (node === null || node === undefined || typeof node !== "object") {
      return;
    }
    if (isChildDescriptor(node)) {
      // SAFETY: isChildDescriptor narrows to declared children; the cast only names the descriptor.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the view union blocks a direct cast to the descriptor.
      const descriptor = node as unknown as ChildDescriptor;
      // SAFETY: composed descriptors declare their headless component.
      const headless = descriptor.headless as {
        readonly definitionName?: unknown;
      };
      const name =
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- descriptors name their component or fall back to unknown by design.
        typeof headless.definitionName === "string"
          ? headless.definitionName
          : "unknown";
      const key = descriptor.key ?? "";
      // SAFETY: descriptor options carry the declared onEmit and onFailure handlers.
      const options = (descriptor.options ?? {}) as {
        readonly onEmit?: unknown;
        readonly onFailure?: unknown;
      };
      out.push({
        key,
        name,
        onEmit: options.onEmit,
        onFailure: options.onFailure,
        path: `${path}/${name}${key === "" ? "" : `[${key}]`}`,
      });
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, path);
      }
      return;
    }
    if ("$$ilha" in node || "children" in node) {
      // SAFETY: declared view children ride beside the vnode envelope.
      visit((node as { readonly children?: unknown }).children, path);
      return;
    }
    if (
      Symbol.iterator in node &&
      // SAFETY: the `in` check above guarantees an iterable shape for the probe.
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- views are checked for iterability before spreading.
      typeof (node as Iterable<unknown>)[Symbol.iterator] === "function"
    ) {
      // SAFETY: the check above guarantees an iterable view.
      for (const item of node as Iterable<unknown>) {
        visit(item, path);
      }
    }
  };
  visit(view, parentPath);
  return out;
};

const textOf = (node: TestNode): string =>
  node.text !== undefined && node.tag === undefined
    ? node.text
    : (node.children ?? []).map(textOf).join("");

const normalizeText = (text: string): string =>
  text.replaceAll(/\s+/gu, " ").trim();

/** Every element under `root`, `root` included, in document order. */
const elementsOf = (root: TestNode): readonly TestNode[] => {
  const out: TestNode[] = [];
  const visit = (node: TestNode): void => {
    if (node.tag !== undefined) {
      out.push(node);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return out;
};

/** Whether `view` is an iterable view (not a VNode, string or array). */
const isIterableView = (view: View): view is Iterable<View> =>
  typeof view === "object" &&
  view !== null &&
  !isVNode(view) &&
  Symbol.iterator in view;

const buildChildren = (
  views: readonly View[],
  ctx: TreeContext
): TestNode[] => {
  const out: TestNode[] = [];
  for (const view of views) {
    // oxlint-disable-next-line eslint/no-use-before-define -- buildChildren and buildNodes recurse mutually; neither can come first.
    const built = buildNodes(view, ctx);
    for (const node of built) {
      out.push(node);
    }
  }
  return out;
};

const buildModelChild = (vnode: VNode, ctx: TreeContext): TestNode[] => {
  const name = componentNameOf(vnode.type) ?? "unknown";
  const key =
    vnode.key === null || vnode.key === undefined ? "" : String(vnode.key);
  const path = `${ctx.parentPath}/${name}${key === "" ? "" : `[${key}]`}`;
  const failed = ctx.failed.get(path);
  if (failed !== undefined) {
    const entry = ctx.children.get(path);
    // SAFETY: failed entries carry the child's own fallback when one was written.
    const fallback = entry?.fallback as ((result: never) => View) | undefined;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- fallbacks are functions when written; the check guards the call.
    if (typeof fallback === "function") {
      // SAFETY: failed runs carry the child's own failure; the fallback decodes it.
      // oxlint-disable-next-line eslint/no-use-before-define -- the fallback branch recurses into buildNodes below.
      return buildNodes(fallback(failed as never), ctx);
    }
    return [];
  }
  const entry = ctx.children.get(path);
  // SAFETY: the check below guarantees a fallback function when one was written.
  const fallbackFn =
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- fallbacks are functions when written.
    typeof entry?.fallback === "function"
      ? (entry.fallback as (result: never) => View)
      : undefined;
  return [
    {
      attrs: {},
      childPath: path,
      children: [],
      fallbackFn,
      handlers: new Map(),
      // SAFETY: element props ride beside the vnode; PropBag names the raw bag.
      rawProps: (vnode.props ?? {}) as PropBag,
      tag: name,
      vnode,
    },
  ];
};

const buildElementNode = (
  vnode: VNode,
  tag: string,
  ctx: TreeContext
): TestNode[] => {
  // SAFETY: element props ride beside the vnode; PropBag names the raw bag.
  const props = (vnode.props ?? {}) as PropBag;
  const attrs: Record<string, string> = {};
  const handlers = new Map<string, (event: SyntheticEvent) => void>();
  for (const [name, value] of Object.entries(props)) {
    const type = eventTypeFromProp(name);
    if (type !== undefined) {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- handler props are functions by construction; the check guards the set.
      if (typeof value === "function" && !handlers.has(type)) {
        // SAFETY: the check above guarantees a handler function.
        handlers.set(type, value as (event: SyntheticEvent) => void);
      }
      continue;
    }
    if (value === false || value === null || value === undefined) {
      continue;
    }
    if (
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- string, number and boolean props render as attributes.
      typeof value === "string" ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- string, number and boolean props render as attributes.
      typeof value === "number" ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- string, number and boolean props render as attributes.
      typeof value === "boolean"
    ) {
      attrs[name] = String(value);
    }
  }
  return [
    {
      attrs,
      // SAFETY: element children are views; the tree builder decodes them.
      children: buildChildren(vnode.children as View[], {
        ...ctx,
        parentPath: ctx.parentPath,
      }),
      handlers,
      rawProps: props,
      tag,
      vnode,
    },
  ];
};

const buildNodes = (view: View, ctx: TreeContext): TestNode[] => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- views are null, text, descriptors, arrays, iterables or vnodes by construction; the dispatch reads each shape.
  if (view === null || view === undefined || typeof view === "boolean") {
    return [];
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- text views are strings or numbers by construction.
  if (typeof view === "string" || typeof view === "number") {
    return [
      {
        children: [],
        handlers: new Map(),
        rawProps: {},
        tag: undefined,
        text: String(view),
      },
    ];
  }
  if (isChildDescriptor(view)) {
    return composedLeaf(view, ctx);
  }
  if (Array.isArray(view)) {
    return buildChildren(view, ctx);
  }
  if (isIterableView(view)) {
    return buildChildren([...view], ctx);
  }
  // SAFETY: descriptors, arrays and iterables return above; only vnodes remain.
  const vnode = view as VNode;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- component vnodes carry function types by construction.
  if (typeof vnode.type === "function") {
    if (isModelChild(vnode)) {
      return buildModelChild(vnode, ctx);
    }
    // A plain wrapper's static children belong to the author: see through it.
    // SAFETY: function vnodes that are not model children are plain wrappers; their children are views.
    return buildChildren(vnode.children as View[], ctx);
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- fragment vnodes carry symbol types by construction.
  if (typeof vnode.type === "symbol") {
    // A fragment: see through it.
    // SAFETY: symbol vnodes are fragments; their children are views.
    return buildChildren(vnode.children as View[], ctx);
  }
  return buildElementNode(vnode, vnode.type, ctx);
};

/** Links parents after the build, for handler lookup and disabled checks. */
const linkParents = (
  node: TestNode,
  parent?: TestNode | undefined
): TestNode => {
  // Nodes are freshly built by `buildNodes`, so linking mutates in place:
  // copies would leave children's `parent` pointing at a discarded
  // intermediate, and `identityPath` would resolve every node to -1.
  if (parent !== undefined) {
    // SAFETY: nodes are freshly built, so linking mutates the parent slot in place.
    (node as { parent: TestNode | undefined }).parent = parent;
  }
  for (const child of node.children) {
    linkParents(child, node);
  }
  return node;
};

/**
 * Builds the scene's node tree for `view`: model children stay leaves (or
 * show their pending/failure fallback), everything else renders.
 */
export const viewTree = (
  view: View,
  failed: ReadonlyMap<
    string,
    AsyncResult.AsyncResult<unknown, unknown>
  > = new Map(),
  children: ReadonlyMap<string, { readonly fallback: unknown }> = new Map(),
  parentPath = "/scene"
): TestNode => {
  const root: TestNode = {
    children: buildChildren([view], { children, failed, parentPath }),
    handlers: new Map(),
    rawProps: {},
    tag: undefined,
  };
  return linkParents(root);
};

/** The index path of `node` from the root, for tracking it across renders. */
const identityPath = (node: TestNode): number[] => {
  const path: number[] = [];
  let current: TestNode | undefined = node;
  while (current?.parent !== undefined) {
    const siblings = current.parent.children;
    path.unshift(siblings.indexOf(current));
    current = current.parent;
  }
  return path;
};

const nodeAtPath = (
  root: TestNode,
  path: readonly number[]
): TestNode | undefined => {
  let current: TestNode | undefined = root;
  for (const index of path) {
    current = current?.children[index];
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
};

const makeEvent = (
  type: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- synthetic payloads carry arbitrary DOM event fields the component decodes.
  payload: unknown
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- synthetic events carry arbitrary payload fields beside type.
): SyntheticEvent & Readonly<Record<string, unknown>> => {
  let prevented = false;
  // SAFETY: the check below guarantees an object payload for the record view.
  const fields =
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- only objects spread onto the event; primitives dispatch bare.
    typeof payload === "object" && payload !== null
      ? // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the record view reads arbitrary payload fields.
        (payload as Record<string, unknown>)
      : {};
  return {
    ...fields,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault: () => {
      prevented = true;
    },
    type,
  };
};

const isDisabled = (node: TestNode): boolean => {
  const raw = node.rawProps["disabled"];
  if (raw === true || raw === "" || raw === "disabled") {
    return true;
  }
  if (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- only string tags name elements that can disable.
    typeof node.tag === "string" &&
    ["button", "input", "select", "textarea"].includes(node.tag)
  ) {
    let ancestor = node.parent;
    while (ancestor !== undefined) {
      if (ancestor.tag === "fieldset") {
        const { disabled } = ancestor.rawProps;
        if (disabled === true || disabled === "" || disabled === "disabled") {
          return true;
        }
      }
      ancestor = ancestor.parent;
    }
  }
  return false;
};

const describeTarget = (target: string | Locator.Locator): string =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- resolve targets are selector strings or locators by design; the branch runs the selector path.
  typeof target === "string"
    ? `text ${JSON.stringify(target)}`
    : target.description;

/** The brand `TestHost.stub` puts on its component. Imported by `test-host.ts`; kept here with Scene. */
export const stubBrand = "~ilha/model/stub" as const;

/** Whether `child` is a `TestHost.stub` component, whose keyless emit reaches every mount. */
// oxlint-disable-next-line anti-slop/no-object-parameters -- stubs are detected by identity; the brand probe reads the marker.
const isStubComponent = (child: object): boolean =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- stub detection is a function check plus a brand probe by design.
  typeof child === "function" &&
  // SAFETY: TestHost.stub marks its components with the brand; the probe only reads the marker.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- the brand lookup needs a record view of the erased component.
  (child as unknown as Record<string | symbol, unknown>)[stubBrand] !==
    undefined;

/** The browser default action a click runs after the click handler. */
type DefaultKind =
  | {
      readonly _tag: "submit";
      readonly submitter: {
        readonly name?: string | undefined;
        readonly value?: unknown | undefined;
      };
    }
  | { readonly _tag: "checkbox" }
  | { readonly _tag: "radio" }
  | { readonly _tag: "popover"; readonly target?: string | undefined };

const attrOf = (node: TestNode, name: string): string | undefined => {
  const raw = node.rawProps[name];
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- attributes are strings when present.
  if (typeof raw === "string") {
    return raw;
  }
  return (node.attrs ?? {})[name];
};

const defaultKind = (node: TestNode): DefaultKind | undefined => {
  const popover = attrOf(node, "popovertarget");
  if (node.tag === "button" || node.tag === "input") {
    if (popover !== undefined) {
      return { _tag: "popover", target: popover === "" ? undefined : popover };
    }
    const type = attrOf(node, "type");
    if (node.tag === "input" && type === "checkbox") {
      return { _tag: "checkbox" };
    }
    if (node.tag === "input" && type === "radio") {
      return { _tag: "radio" };
    }
    if (
      type === "submit" ||
      type === "image" ||
      (node.tag === "button" && type === undefined)
    ) {
      return {
        _tag: "submit",
        submitter: { name: attrOf(node, "name"), value: attrOf(node, "value") },
      };
    }
  }
  return undefined;
};

const byId = (root: TestNode, id: string): TestNode | undefined => {
  let found: TestNode | undefined = undefined;
  const visit = (node: TestNode): void => {
    if (found !== undefined) {
      return;
    }
    if (node.tag !== undefined && attrOf(node, "id") === id) {
      found = node;
      return;
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return found;
};

const describeNode = (node: TestNode): string =>
  node.tag === undefined ? "text" : `<${node.tag}>`;

const ancestorForm = (node: TestNode): TestNode | undefined => {
  let current = node.parent;
  while (current !== undefined) {
    if (current.tag === "form") {
      return current;
    }
    current = current.parent;
  }
  return undefined;
};

/** A field's current value: its `value` prop, else its attribute. */
export const fieldValue = (node: TestNode): string | undefined => {
  const raw = node.rawProps["value"];
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- value props are strings or numbers when present.
  if (typeof raw === "string" || typeof raw === "number") {
    return String(raw);
  }
  const attr = (node.attrs ?? {})["value"];
  return attr;
};

/** Whether a checkbox or radio is checked: `aria-checked`, else the prop, else the attribute. */
export const fieldChecked = (node: TestNode): boolean => {
  const aria = (node.attrs ?? {})["aria-checked"];
  if (aria !== undefined) {
    return aria === "true";
  }
  const raw = node.rawProps["checked"];
  if (raw === true || raw === "" || raw === "checked") {
    return true;
  }
  if (raw === false) {
    return false;
  }
  const attr = (node.attrs ?? {})["checked"];
  return attr !== undefined && attr !== "false";
};

const formFields = (
  form: TestNode,
  submitter?:
    | {
        readonly name?: string | undefined;
        readonly value?: unknown | undefined;
      }
    | undefined
) => {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- form fields are dynamic string keys by construction.
  const fields: Record<string, unknown> = {};
  const visit = (node: TestNode): void => {
    if (
      node.tag === "input" ||
      node.tag === "select" ||
      node.tag === "textarea"
    ) {
      const rawName = node.rawProps["name"];
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- named fields carry string names by construction.
      if (typeof rawName === "string" && rawName !== "") {
        const { type } = node.rawProps;
        if (node.tag === "input" && (type === "checkbox" || type === "radio")) {
          if (fieldChecked(node)) {
            fields[rawName] = fieldValue(node) ?? "on";
          }
        } else if (
          node.tag === "input" ||
          node.tag === "select" ||
          node.tag === "textarea"
        ) {
          const value = fieldValue(node);
          if (value !== undefined) {
            fields[rawName] = value;
          }
        }
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const child of form.children) {
    visit(child);
  }
  if (submitter?.name !== undefined && submitter.name !== "") {
    fields[submitter.name] = submitter.value;
  }
  return fields;
};

const submitPayload = (
  form: TestNode,
  submitter?:
    | {
        readonly name?: string | undefined;
        readonly value?: unknown | undefined;
      }
    | undefined
) => ({
  fields: formFields(form, submitter),
  submitter,
});

const findLabelFor = (root: TestNode, id: string): TestNode | undefined => {
  let found: TestNode | undefined = undefined;
  const visit = (node: TestNode): void => {
    if (found !== undefined) {
      return;
    }
    if (node.tag === "label" && attrOf(node, "for") === id) {
      found = node;
      return;
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return found;
};

/** The accessible name: `aria-labelledby` → `aria-label` → label → content → `title`. */
export const accessibleName = (node: TestNode): string => {
  let root: TestNode = node;
  while (root.parent !== undefined) {
    root = root.parent;
  }
  const byIdText = (id: string): string => {
    const target = byId(root, id);
    return target === undefined ? "" : normalizeText(textOf(target));
  };
  const labelledBy = attrOf(node, "aria-labelledby");
  if (labelledBy !== undefined && labelledBy !== "") {
    return normalizeText(labelledBy.split(/\s+/u).map(byIdText).join(" "));
  }
  const labelled = attrOf(node, "aria-label");
  if (labelled !== undefined && labelled !== "") {
    return normalizeText(labelled);
  }
  const id = attrOf(node, "id");
  if (id !== undefined && id !== "") {
    const label = findLabelFor(root, id);
    if (label !== undefined) {
      return normalizeText(textOf(label));
    }
  }
  let ancestor = node.parent;
  while (ancestor !== undefined) {
    if (ancestor.tag === "label") {
      return normalizeText(textOf(ancestor));
    }
    ancestor = ancestor.parent;
  }
  if (node.tag === "img") {
    const alt = attrOf(node, "alt");
    if (alt !== undefined) {
      return normalizeText(alt);
    }
  }
  const content = normalizeText(textOf(node));
  if (content !== "") {
    return content;
  }
  const title = attrOf(node, "title");
  if (title !== undefined && title !== "") {
    return normalizeText(title);
  }
  return attrOf(node, "placeholder") ?? "";
};

const splitChildPath = (
  path: string
): [name: string, key: string | undefined] => {
  const segment = path.slice(path.lastIndexOf("/") + 1);
  const open = segment.indexOf("[");
  if (open === -1) {
    return [segment, undefined];
  }
  return [segment.slice(0, open), segment.slice(open + 1, -1)];
};
/**
 * The children declared in a view: the model-child leaves, optionally of one
 * component.
 */
export const children = (
  root: TestNode,
  // oxlint-disable-next-line anti-slop/no-object-parameters -- children filters by component identity; the engine resolves it.
  component?: object
): readonly {
  readonly name: string;
  readonly key: string | undefined;
  readonly path: string;
}[] => {
  const out: {
    readonly name: string;
    readonly key: string | undefined;
    readonly path: string;
  }[] = [];
  const wanted =
    component === undefined
      ? undefined
      : childNameOf("Scene.children", component);
  const visit = (node: TestNode): void => {
    if (node.childPath !== undefined && node.tag !== undefined) {
      const [name, key] = splitChildPath(node.childPath);
      if (wanted === undefined || name === wanted) {
        out.push({ key, name, path: node.childPath });
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return out;
};
/**
 * Throws on the runtime's path conflicts: two children at one path, or a
 * child at another child's path.
 */
const checkFallbackPaths = (leaves: readonly TestNode[]): void => {
  const paths = leaves.map((leaf) => leaf.childPath ?? "");
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) {
      throw new Error(
        `Scene.fallback: two children at one path ${path}: give each child its own \`key\``
      );
    }
    seen.add(path);
  }
  for (const first of paths) {
    for (const second of paths) {
      if (first !== second && second.startsWith(`${first}/`)) {
        throw new Error(
          `Scene.fallback: a child at another child's path ${second}: give each child its own \`key\``
        );
      }
    }
  }
};

/**
 * The child's `fallback` output for `result`, or `undefined` without a
 * fallback. Throws on the runtime's path conflicts (two children at one
 * path, or a child at another child's path).
 */
export const fallback = (
  root: TestNode,
  // oxlint-disable-next-line anti-slop/no-object-parameters -- fallbacks are looked up by component identity.
  child: object,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the caller passes either the key or the result by design.
  keyOrResult: unknown,
  result?: AsyncResult.AsyncResult<unknown, unknown>
): readonly TestNode[] | undefined => {
  const name = childNameOf("Scene.fallback", child);
  // SAFETY: the undefined check below guarantees the key-or-result holds the key.
  const [key, actual] =
    result === undefined
      ? [undefined, keyOrResult]
      : [keyOrResult as string, result];
  const leaves: TestNode[] = [];
  const visit = (node: TestNode): void => {
    if (node.childPath !== undefined && node.tag !== undefined) {
      const [leafName, leafKey] = splitChildPath(node.childPath);
      if (leafName === name && (key === undefined || leafKey === key)) {
        leaves.push(node);
      }
    }
    for (const nested of node.children) {
      visit(nested);
    }
  };
  visit(root);
  checkFallbackPaths(leaves);
  if (leaves.length === 0) {
    return undefined;
  }
  // SAFETY: the length check above guarantees a leaf.
  const leaf = leaves[0] as TestNode;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- fallbacks are functions by construction; the check guards the call.
  if (typeof leaf.fallbackFn !== "function") {
    return undefined;
  }
  // SAFETY: the fallback check above guarantees a function; actual is its result type.
  return buildNodes(leaf.fallbackFn(actual as never), {
    children: new Map(),
    failed: new Map(),
    parentPath: "",
  });
};

class SceneStepsImpl<C extends AnyComponent> extends StepsImpl<
  C,
  Scene<PropsOf<C>, ModelOf<C>, MessageOf<C>, EventsOf<C>>
> {
  private tree: TestNode;
  private readonly failed = new Map<
    string,
    AsyncResult.AsyncResult<unknown, unknown>
  >();
  private lastWasIgnoredInteraction = false;
  private readonly runView: () => View;

  /**
   * Runs the headless component's parts through a consumer view, for
   * `make`/`start` with a `view` option.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the view option receives the headless parts and h erased; runHeadless decodes nothing.
  runHeadless(view: (parts: unknown, h: unknown) => View): View {
    const parts = partsOfHeadless(
      this.engine,
      "Scene.make",
      // SAFETY: the engine holds this scene's headless component; the cast only recovers its definition.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the erased component blocks a direct cast; the value is this scene's component.
      this.engine.state.component as unknown as HeadlessComponent
    );
    return view(parts, this.engine.viewHelper());
  }

  constructor(
    component: C,
    props: PropsOf<C>,
    runView?: ((cursor: SceneStepsImpl<C>) => View) | undefined
  ) {
    // SAFETY: the engine erases props; the cursor narrows them back through C.
    super("Scene", new Engine("Scene", component, props as unknown));
    this.runView =
      runView === undefined
        ? () => this.engine.renderView()
        : () => runView(this);
    this.tree = this.rebuild();
  }

  private childMap(): ReadonlyMap<string, { readonly fallback: unknown }> {
    const map = new Map<string, { readonly fallback: unknown }>();
    for (const child of this.engine.state.children) {
      map.set(child.path, { fallback: child.fallback });
    }
    return map;
  }

  private rebuild(): TestNode {
    const view = this.runView();
    this.engine.refreshChildren(view);
    this.composed = collectComposed(
      view,
      rootPathOf(this.engine.state.component)
    );
    return viewTree(
      view,
      this.failed,
      this.childMap(),
      rootPathOf(this.engine.state.component)
    );
  }

  private refresh(): void {
    this.tree = this.rebuild();
  }

  protected override act(
    kind: "message" | "acting",
    step: string,
    fn: () => void
  ): this {
    return atSite(() => {
      this.engine.checkBefore(this.stepName(step), kind);
      this.engine.state.ignored = false;
      this.engine.state.defaultPrevented = false;
      this.lastWasIgnoredInteraction = false;
      fn();
      this.engine.state.acted = true;
      this.refresh();
      return this;
    });
  }

  protected override buildCurrent(): Scene<
    PropsOf<C>,
    ModelOf<C>,
    MessageOf<C>,
    EventsOf<C>
  > {
    const record = this.engine.record();
    // oxlint-disable-next-line typescript/no-this-alias, unicorn/no-this-assignment -- the record closes over cursor methods that need the cursor.
    const self = this;
    // SAFETY: the record plus view accessors is exactly the scene state; the cursor holds them erased.
    return {
      ...record,
      all: (locator) => self.all(locator),
      defaultPrevented: this.engine.state.defaultPrevented,
      get: (locator) => self.get(locator),
      query: (locator) => self.query(locator),
      root: this.tree,
      view: () => this.runView(),
      // SAFETY: the record plus view accessors is exactly the scene state; the engine holds them erased.
    } as Scene<PropsOf<C>, ModelOf<C>, MessageOf<C>, EventsOf<C>>;
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- implements the shared Steps interface; scenes have no send.
  override send(_message: never): this {
    throw new Error(
      `Scene.send: a scene has no send: drive the instance through its view with click or fire`
    );
  }

  /**
   * The shared `given` sets the state without rendering (Story has no
   * view); a Scene rebuilds its tree afterwards so `expect` reads the new
   * Model.
   */
  override given(
    model: ModelOf<C> | ((model: ModelOf<C>) => ModelOf<C>),
    queries?: Given,
    shared?: readonly (readonly [unknown, unknown])[]
  ): this {
    // SAFETY: the scene cursor's model, queries and shared values satisfy the shared step contract.
    super.given(model as never, queries as never, shared as never);
    this.refresh();
    return this;
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- implements the shared Steps interface; scenes show no Model.
  override get model(): ModelOf<C> {
    throw new Error(
      `Scene.model: a scene shows no Model: assert on the view with expect`
    );
  }

  // oxlint-disable-next-line eslint/class-methods-use-this, anti-slop/no-unknown-returns -- implements the shared Steps interface; scenes show no results.
  override get results(): unknown {
    throw new Error(
      `Scene.results: a scene shows no results: assert on the view with expect`
    );
  }

  // oxlint-disable-next-line eslint/class-methods-use-this, anti-slop/no-unsafe-dictionary-type -- implements the shared Steps interface; scenes show no queries.
  override get queries(): Record<string, unknown> {
    throw new Error(
      `Scene.queries: a scene shows no queries: assert on the view with expect`
    );
  }

  get defaultPrevented(): boolean {
    return this.engine.state.defaultPrevented;
  }

  get view(): View {
    return this.runView();
  }

  get root(): TestNode {
    return this.tree;
  }

  get(locator: Locator.Locator): TestNode {
    // SAFETY: locators over the current tree return scene nodes.
    return Locator.get(this.tree, locator) as TestNode;
  }

  query(locator: Locator.Locator): TestNode | undefined {
    // SAFETY: locators over the current tree return scene nodes.
    return Locator.query(this.tree, locator) as TestNode | undefined;
  }

  all(locator: Locator.Locator): readonly TestNode[] {
    // SAFETY: locators over the current tree return scene nodes.
    return Locator.all(this.tree, locator) as readonly TestNode[];
  }

  private resolveOne(step: string, target: string | Locator.Locator): TestNode {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- resolveOne accepts a selector string or a locator by design; the branch runs the selector path.
    const locator = typeof target === "string" ? Locator.text(target) : target;
    // SAFETY: locators over the current tree return scene nodes.
    const matches = Locator.all(this.tree, locator) as readonly TestNode[];
    if (matches.length === 0) {
      throw new Error(
        `${step}: nothing matches ${describeTarget(target)}${this.listHint()}`
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `${step}: ${matches.length} elements match ${describeTarget(target)}: expected exactly one`
      );
    }
    // SAFETY: the length checks above guarantee exactly one match.
    return matches[0] as TestNode;
  }

  private listHint(): string {
    const tags = [
      ...new Set(elementsOf(this.tree).map((node) => `<${node.tag}>`)),
    ];
    return tags.length === 0
      ? `: the view is empty`
      : `; the view has:\n  - ${tags.join("\n  - ")}`;
  }

  /** The innermost handler for `event` at `node` or above it. */
  // oxlint-disable-next-line eslint/class-methods-use-this -- the handler lookup walks node parents; no step state is read.
  private handlerFor(
    node: TestNode,
    event: string
  ): ((ev: SyntheticEvent) => void) | undefined {
    let current: TestNode | undefined = node;
    while (current !== undefined) {
      const handler = current.handlers.get(event);
      if (handler !== undefined) {
        return handler;
      }
      current = current.parent;
    }
    return undefined;
  }

  /**
   * Invokes the innermost handler for `event` on the node at `path`,
   * re-rendering first. Returns the outcome, or `undefined` when the node
   * is gone or newly disabled.
   */
  private invoke(
    path: readonly number[],
    tag: string | undefined,
    event: string,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- invoked payloads carry arbitrary DOM event fields the component decodes.
    payload: unknown,
    required: { step: string; at: string } | undefined = undefined
  ): { produced: boolean; prevented: boolean } | undefined {
    this.refresh();
    const node = nodeAtPath(this.tree, path);
    if (node === undefined || node.tag !== tag) {
      return undefined;
    }
    if (isDisabled(node)) {
      return undefined;
    }
    const handler = this.handlerFor(node, event);
    if (handler === undefined) {
      if (required !== undefined) {
        throw new Error(
          `${required.step}: nothing handles "${event}" at ${required.at}${this.listHint()}`
        );
      }
      return { prevented: false, produced: false };
    }
    // A click that sends its message is handled, even when the update emits
    // nothing upward: count deliveries as well as emitted events and sends.
    // (`fire` and the other synthetic steps keep the narrower count, so an
    // interaction that only updates the Model still needs `expectIgnored`.)
    const before =
      this.engine.state.emitted.length +
      this.engine.state.sent.length +
      this.engine.state.deliveries;
    const synthetic = makeEvent(event, payload);
    handler(synthetic);
    const produced =
      this.engine.state.emitted.length +
        this.engine.state.sent.length +
        this.engine.state.deliveries >
      before;
    return { prevented: synthetic.defaultPrevented, produced };
  }

  private invokeRequired(
    step: string,
    node: TestNode,
    event: string,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- invoked payloads carry arbitrary DOM event fields the component decodes.
    payload: unknown
  ) {
    const handler = this.handlerFor(node, event);
    if (handler === undefined) {
      throw new Error(
        `${step}: nothing handles "${event}" at ${describeNode(node)}${this.listHint()}`
      );
    }
    const before =
      this.engine.state.emitted.length + this.engine.state.sent.length;
    const synthetic = makeEvent(event, payload);
    handler(synthetic);
    const produced =
      this.engine.state.emitted.length + this.engine.state.sent.length > before;
    return { prevented: synthetic.defaultPrevented, produced };
  }

  click(target: string | Locator.Locator): this {
    return this.act("message", "click", () => {
      const step = this.stepName("click");
      const found = this.resolveOne(step, target);
      if (isDisabled(found)) {
        throw new Error(
          `${step}: the <${found.tag}> ${describeTarget(target)} matches is disabled`
        );
      }
      const path = identityPath(found);
      const { tag } = found;
      let produced = false;
      let prevented = false;
      // The pointer sequence: cancelling pointerdown skips mousedown/mouseup but not click.
      const pointer = {
        altKey: false,
        button: 0,
        ctrlKey: false,
        metaKey: false,
        pointerType: "mouse",
        shiftKey: false,
        x: 0,
        y: 0,
      };
      let pointerCancelled = false;
      for (const event of ["pointerdown", "mousedown", "mouseup"] as const) {
        if (pointerCancelled) {
          continue;
        }
        const outcome = this.invoke(path, tag, event, pointer);
        // The press removed or disabled the element: the rest isn't sent.
        if (outcome === undefined) {
          this.finishInteraction(produced, prevented);
          return;
        }
        if (event === "pointerdown" && outcome.prevented) {
          pointerCancelled = true;
        }
        produced = outcome.produced || produced;
      }
      // The click itself: it must be handled, by a handler or a default action.
      this.refresh();
      const node = nodeAtPath(this.tree, path);
      if (node === undefined || node.tag !== tag || isDisabled(node)) {
        this.finishInteraction(produced, prevented);
        return;
      }
      const handler = this.handlerFor(node, "click");
      const kind = defaultKind(node);
      if (handler === undefined && kind === undefined) {
        throw new Error(
          `${step}: nothing handles "click" at ${describeTarget(target)}${this.listHint()}`
        );
      }
      if (handler !== undefined) {
        // A click that sends its message is handled, even when the update
        // emits nothing upward: count deliveries as well.
        const before =
          this.engine.state.emitted.length +
          this.engine.state.sent.length +
          this.engine.state.deliveries;
        const synthetic = makeEvent("click", pointer);
        handler(synthetic);
        produced =
          this.engine.state.emitted.length +
            this.engine.state.sent.length +
            this.engine.state.deliveries >
            before || produced;
        prevented = synthetic.defaultPrevented;
      }
      // Only a cancelled click skips the defaults; only click and its
      // defaults set defaultPrevented.
      if (!prevented && kind !== undefined) {
        const outcome = this.runDefault(step, path, tag, node, kind);
        if (outcome !== undefined) {
          produced = outcome.produced || produced;
          prevented = outcome.prevented || prevented;
        }
      }
      this.finishInteraction(produced, prevented);
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- synthetic payloads carry arbitrary DOM event fields the component decodes.
  fire(locator: Locator.Locator, event: string, payload: unknown = {}): this {
    return this.act("message", "fire", () => {
      const step = this.stepName("fire");
      const node = this.resolveOne(step, locator);
      if (isDisabled(node) && (event === "click" || event === "submit")) {
        throw new Error(
          `${step}: the <${node.tag}> ${locator.description} matches is disabled`
        );
      }
      if (event === "submit") {
        const form = node.tag === "form" ? node : ancestorForm(node);
        if (form === undefined) {
          throw new Error(
            `${step}: nothing handles "submit" at ${describeNode(node)}${this.listHint()}`
          );
        }
        const outcome = this.invokeRequired(
          step,
          form,
          "submit",
          submitPayload(form)
        );
        this.finishInteraction(outcome.produced, true);
        return;
      }
      const outcome = this.invokeRequired(step, node, event, payload);
      this.finishInteraction(outcome.produced, outcome.prevented);
    });
  }

  private finishInteraction(produced: boolean, prevented: boolean): void {
    this.engine.state.ignored = !produced;
    this.lastWasIgnoredInteraction = !produced;
    if (prevented) {
      this.engine.state.defaultPrevented = true;
    }
    this.refresh();
  }

  private runSubmitDefault(
    step: string,
    path: readonly number[],
    tag: string | undefined,
    kind: DefaultKind
  ) {
    // The submit reads the form as it stands after the click's own
    // message: re-render, then fire submit on the form.
    this.refresh();
    const live = nodeAtPath(this.tree, path);
    if (live === undefined || live.tag !== tag || isDisabled(live)) {
      return;
    }
    const form = live.tag === "form" ? live : ancestorForm(live);
    if (form === undefined) {
      return { prevented: false, produced: false };
    }
    const delivered = this.engine.state.deliveries;
    const outcome = this.invokeRequired(
      step,
      form,
      "submit",
      submitPayload(form, kind._tag === "submit" ? kind.submitter : undefined)
    );
    return {
      prevented: true,
      produced: outcome.produced || this.engine.state.deliveries > delivered,
    };
  }

  private runCheckableDefault(
    path: readonly number[],
    tag: string | undefined,
    toggle: boolean
  ) {
    this.refresh();
    const live = nodeAtPath(this.tree, path);
    if (live === undefined || live.tag !== tag || isDisabled(live)) {
      return;
    }
    if (!toggle && fieldChecked(live)) {
      return { prevented: false, produced: false };
    }
    const checked = toggle ? !fieldChecked(live) : true;
    let produced = false;
    let prevented = false;
    for (const event of ["input", "change"] as const) {
      const outcome = this.invoke(path, tag, event, {
        checked,
        value: fieldValue(live),
      });
      if (outcome === undefined) {
        break;
      }
      produced = outcome.produced || produced;
      prevented = outcome.prevented || prevented;
    }
    return { prevented, produced };
  }

  private runDefault(
    step: string,
    path: readonly number[],
    tag: string | undefined,
    node: TestNode,
    kind: DefaultKind
  ): { produced: boolean; prevented: boolean } | undefined {
    void node;
    if (kind._tag === "submit") {
      return this.runSubmitDefault(step, path, tag, kind);
    }
    if (kind._tag === "checkbox") {
      return this.runCheckableDefault(path, tag, true);
    }
    if (kind._tag === "radio") {
      return this.runCheckableDefault(path, tag, false);
    }
    // A popover button toggles its target; without a target or a toggle
    // handler there is nothing to run.
    const target =
      kind.target === undefined ? undefined : byId(this.tree, kind.target);
    if (target === undefined) {
      return { prevented: false, produced: false };
    }
    const outcome = this.invoke(identityPath(target), target.tag, "toggle", {
      newState: "open",
      oldState: "closed",
    });
    if (outcome === undefined) {
      return { prevented: false, produced: false };
    }
    return outcome;
  }

  // oxlint-disable-next-line anti-slop/no-object-parameters, anti-slop/no-unknown-parameters -- children are matched by identity; childEmit takes the key or the event by design.
  childEmit(child: object, keyOrEvent: unknown, event?: unknown): this {
    return this.act("message", "childEmit", () => {
      const step = this.stepName("childEmit");
      // SAFETY: the undefined check below guarantees the key-or-event holds the key.
      const [key, actual] =
        event === undefined
          ? [undefined, keyOrEvent]
          : [keyOrEvent as string, event];
      // SAFETY: the branches above produce a key or undefined.
      const matches = this.matchChild(step, child, key as string | undefined);
      let produced = false;
      for (const entry of matches) {
        // SAFETY: the child declares its onEmit contract; routeEmit only reads it.
        const message = routeEmit(entry.onEmit as never, actual as never);
        if (message !== undefined) {
          this.engine.deliver(message);
          produced = true;
        }
      }
      if (!produced) {
        this.engine.state.ignored = true;
        this.lastWasIgnoredInteraction = true;
      }
    });
  }

  // oxlint-disable-next-line anti-slop/no-object-parameters -- children are matched by identity; the engine resolves them.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- childFailure takes the key or the failure by design; both are decoded by onFailure.
  childFailure(
    // oxlint-disable-next-line anti-slop/no-object-parameters -- children are matched by identity; the engine resolves them.
    child: object,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- childFailure takes the key or the failure by design.
    keyOrCause: unknown,
    cause?: Cause.Cause<unknown>
  ): this {
    return this.act("message", "childFailure", () => {
      const step = this.stepName("childFailure");
      // SAFETY: the undefined check below guarantees the key-or-cause holds the failure.
      const [key, actual] =
        cause === undefined
          ? [undefined, keyOrCause as Cause.Cause<unknown>]
          : [keyOrCause as string, cause];
      // SAFETY: failure() returns the failure carrier the failed map stores.
      const failure = AsyncResult.failure(actual) as AsyncResult.Failure<
        never,
        unknown
      >;
      const matches = this.matchChild(step, child, key);
      let produced = false;
      for (const entry of matches) {
        this.failed.set(entry.path, failure);
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- onFailure handlers are functions by construction; the check guards the call.
        if (typeof entry.onFailure === "function") {
          // SAFETY: the function check above guarantees a callable onFailure.
          const message = (
            entry.onFailure as (
              failure: AsyncResult.Failure<never, unknown>
              // oxlint-disable-next-line anti-slop/no-unknown-returns -- onFailure handlers return the parent's message or nothing.
            ) => unknown
          )(failure);
          if (message !== undefined) {
            this.engine.deliver(message);
            produced = true;
          }
        } else if (entry.onFailure !== undefined) {
          throw new Error(
            `${step}: onFailure for ${entry.name} isn't a function`
          );
        }
      }
      if (!produced) {
        this.engine.state.ignored = true;
        this.lastWasIgnoredInteraction = true;
      }
    });
  }

  // oxlint-disable-next-line anti-slop/no-object-parameters -- children are matched by identity; the engine resolves them.
  childPending(child: object, key?: string): this {
    return this.act("acting", "childPending", () => {
      const step = this.stepName("childPending");
      const matches = this.matchChild(step, child, key);
      for (const entry of matches) {
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- fallbacks are functions by construction; the check guards the call.
        if (typeof entry.fallback !== "function") {
          throw new TypeError(
            `${step}: the child ${entry.name} has no fallback: a pending child needs one`
          );
        }
        this.failed.set(entry.path, AsyncResult.initial(true));
      }
    });
  }

  /**
   * Every composed headless child (`p.child`) the latest view declares.
   * Collected alongside the tree in `rebuild`, with the same paths.
   */
  private composed: readonly ComposedChild[] = [];

  private matchChild(
    step: string,
    // oxlint-disable-next-line anti-slop/no-object-parameters -- matches are looked up by component identity.
    child: object,
    key: string | undefined
  ): readonly {
    readonly name: string;
    readonly path: string;
    readonly onEmit: unknown;
    readonly onFailure: unknown;
    readonly fallback?: unknown;
  }[] {
    const name = childNameOf(step, child);
    const stubbed = isStubComponent(child);
    const matches = [
      ...this.engine.state.children.filter(
        (entry) =>
          entry.name === name && (key === undefined || entry.key === key)
      ),
      ...this.composed.filter(
        (entry) =>
          entry.name === name && (key === undefined || entry.key === key)
      ),
    ];
    if (matches.length === 0) {
      const names = [
        ...this.engine.state.children.map(
          (entry) => `${entry.name}${entry.key === "" ? "" : `[${entry.key}]`}`
        ),
        ...this.composed.map(
          (entry) => `${entry.name}${entry.key === "" ? "" : `[${entry.key}]`}`
        ),
      ];
      throw new Error(
        `${step}: the view has no child ${name}${key === undefined ? "" : `[${key}]`}${
          names.length === 0
            ? `: it renders no children`
            : `; it renders:\n  - ${names.join("\n  - ")}`
        }`
      );
    }
    if (matches.length > 1 && !(stubbed && key === undefined)) {
      throw new Error(
        `${step}: several children match ${name}: name the key, as childEmit takes it`
      );
    }
    return matches;
  }

  // oxlint-disable-next-line anti-slop/no-object-parameters, anti-slop/no-unknown-parameters -- headless children are matched by identity; givenChild takes the key or the model by design.
  givenChild(headless: object, keyOrModel: unknown, model?: unknown): this {
    return this.act("acting", "givenChild", () => {
      givenChildSet(
        this.engine,
        this.stepName("givenChild"),
        headless,
        keyOrModel,
        model
      );
    });
  }

  collected(reports: readonly unknown[]): this {
    return this.act("message", "collected", () => {
      const delivered = sharedCollected(
        this.engine,
        this.stepName("collected"),
        reports
      );
      if (!delivered) {
        this.engine.markIgnored();
        this.lastWasIgnoredInteraction = true;
      }
    });
  }

  mounted(target: MountTarget, ...result: readonly unknown[]): this {
    return this.act("acting", "mounted", () => {
      mountMounted(this.engine, this.stepName("mounted"), target, result);
    });
  }

  expectMount(mount: MountTarget): this {
    return atSite(() => {
      mountExpectMount(this.engine, this.stepName("expectMount"), mount);
      return this;
    });
  }

  expect(locator: Locator.Locator): Expect<this> {
    // oxlint-disable-next-line typescript/no-this-alias, unicorn/no-this-assignment -- Effect-free closures capture the cursor for the assertion bodies below.
    const self = this;
    const step = this.stepName("expect");
    const only = (): TestNode => {
      // SAFETY: locators over the current tree return scene nodes.
      const matches = Locator.all(self.tree, locator) as readonly TestNode[];
      if (matches.length !== 1) {
        throw new Error(
          `${step}: expected exactly one element for ${locator.description}, found ${matches.length}${self.listHint()}`
        );
      }
      // SAFETY: the length check above guarantees exactly one match.
      return matches[0] as TestNode;
    };
    const markOther = (): void => {
      self.lastWasIgnoredInteraction = false;
    };
    // SAFETY: every assertion returns the same cursor; the cast only views them through the shared interface.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the literal's methods return the concrete cursor; the chain bridges to the generic Expect.
    return {
      toBeAbsent(): SceneStepsImpl<C> {
        markOther();
        const matches = Locator.all(self.tree, locator);
        if (matches.length > 0) {
          throw new Error(
            `${step}: expected ${locator.description} to be absent, found ${matches.length}${self.listHint()}`
          );
        }
        return self;
      },
      toBeChecked(checked = true): SceneStepsImpl<C> {
        markOther();
        const node = only();
        const actual = fieldChecked(node);
        if (actual !== checked) {
          throw new Error(
            `${step}: expected ${locator.description} to be ${checked ? "checked" : "unchecked"}`
          );
        }
        return self;
      },
      toBeDisabled(disabled = true): SceneStepsImpl<C> {
        markOther();
        const node = only();
        const actual = isDisabled(node);
        if (actual !== disabled) {
          throw new Error(
            `${step}: expected ${locator.description} to be ${disabled ? "disabled" : "enabled"}`
          );
        }
        return self;
      },
      toExist(): SceneStepsImpl<C> {
        markOther();
        const matches = Locator.all(self.tree, locator);
        if (matches.length === 0) {
          throw new Error(
            `${step}: expected ${locator.description} to exist${self.listHint()}`
          );
        }
        return self;
      },
      toHaveAccessibleName(name: string | RegExp): SceneStepsImpl<C> {
        markOther();
        const node = only();
        const actual = accessibleName(node);
        const pass =
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- accessible names accept a literal or a pattern by design.
          typeof name === "string" ? actual === name : name.test(actual);
        if (!pass) {
          throw new Error(
            `${step}: expected ${locator.description} to have accessible name ${JSON.stringify(String(name))}, got ${JSON.stringify(actual)}`
          );
        }
        return self;
      },
      toHaveCount(count: number): SceneStepsImpl<C> {
        markOther();
        const matches = Locator.all(self.tree, locator);
        if (matches.length !== count) {
          throw new Error(
            `${step}: expected ${count} elements for ${locator.description}, found ${matches.length}${self.listHint()}`
          );
        }
        return self;
      },
      toHaveText(text: string | RegExp): SceneStepsImpl<C> {
        markOther();
        const node = only();
        const actual = normalizeText(textOf(node));
        const pass =
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- text assertions accept a literal or a pattern by design.
          typeof text === "string" ? actual === text : text.test(actual);
        if (!pass) {
          throw new Error(
            `${step}: expected ${locator.description} to have text ${JSON.stringify(String(text))}, got ${JSON.stringify(actual)}`
          );
        }
        return self;
      },
      toHaveValue(value: string): SceneStepsImpl<C> {
        markOther();
        const node = only();
        const actual = fieldValue(node);
        if (actual !== value) {
          throw new Error(
            `${step}: expected ${locator.description} to have value ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`
          );
        }
        return self;
      },
      // SAFETY: every assertion returns the same cursor; the cast only views them through the shared interface.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the literal's methods return the concrete cursor; the chain bridges to the generic Expect.
    } as unknown as Expect<this>;
  }

  expectHandled(): this {
    return atSite(() => {
      this.lastWasIgnoredInteraction = false;
      return this;
    });
  }

  expectIgnored(): this {
    return atSite(() => {
      const step = this.stepName("expectIgnored");
      if (!this.lastWasIgnoredInteraction) {
        throw new Error(
          `${step}: the last step wasn't an ignored interaction: only an interaction that produced no message needs it`
        );
      }
      if (!this.engine.state.ignored) {
        throw new Error(
          `${step}: the last interaction produced a message: acknowledge it with the steps that check it`
        );
      }
      this.engine.state.ignored = false;
      this.lastWasIgnoredInteraction = false;
      return this;
    });
  }

  expectDefaultPrevented(expected = true): this {
    return atSite(() => {
      this.lastWasIgnoredInteraction = false;
      const actual = this.engine.state.defaultPrevented;
      if (actual !== expected) {
        throw new Error(
          `${this.stepName("expectDefaultPrevented")}: expected defaultPrevented to be ${String(expected)}`
        );
      }
      return this;
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- parts callbacks receive the headless parts erased.
  parts(f: (parts: unknown) => void): this {
    return atSite(() => {
      const step = this.stepName("parts");
      if (!isHeadlessComponent(this.engine.state.component)) {
        throw new Error(
          `${step}: parts takes a headless component, but ${this.engine.state.component.definitionName} renders a view`
        );
      }
      f(partsOfHeadless(this.engine, step, this.engine.state.component));
      return this;
    });
  }

  type(
    locator: Locator.Locator,
    value: string,
    options?: {
      readonly composing?: boolean | undefined;
      readonly inputType?: string | undefined;
    }
  ): this {
    return this.act("message", "type", () => {
      const step = this.stepName("type");
      const node = this.resolveOne(step, locator);
      const raw = node.rawProps["checked"];
      const checked =
        raw === true || raw === "" || raw === "checked" ? true : undefined;
      const input = {
        composing: options?.composing ?? false,
        data: value,
        inputType: options?.inputType ?? "insertText",
        value,
      };
      const outcome = this.invokeRequired(
        step,
        node,
        "input",
        checked === undefined ? input : { ...input, checked }
      );
      this.finishInteraction(outcome.produced, outcome.prevented);
    });
  }

  change(
    locator: Locator.Locator,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- a change carries a field map when one string cannot name the value.
    value: string | Record<string, unknown>
  ): this {
    return this.act("message", "change", () => {
      const step = this.stepName("change");
      const node = this.resolveOne(step, locator);
      const payload =
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- change accepts a string or a field map by design; the branch builds the string payload.
        typeof value === "string"
          ? { composing: false, inputType: "", value }
          : { composing: false, inputType: "", ...value };
      const outcome = this.invokeRequired(step, node, "change", payload);
      this.finishInteraction(outcome.produced, outcome.prevented);
    });
  }

  keydown(
    locator: Locator.Locator,
    key: string,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- key details carry arbitrary KeyboardEvent init fields.
    details: Record<string, unknown> = {}
  ): this {
    return this.act("message", "keydown", () => {
      const step = this.stepName("keydown");
      const node = this.resolveOne(step, locator);
      const tag = node.tag ?? "";
      const editable =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        node.rawProps["contenteditable"] === true ||
        node.rawProps["contenteditable"] === "" ||
        node.rawProps["contenteditable"] === "true";
      const outcome = this.invokeRequired(step, node, "keydown", {
        altKey: false,
        composing: false,
        ctrlKey: false,
        editable,
        key,
        metaKey: false,
        repeat: false,
        shiftKey: false,
        ...details,
      });
      this.finishInteraction(outcome.produced, outcome.prevented);
    });
  }

  submit(locator: Locator.Locator): this {
    return this.act("message", "submit", () => {
      const step = this.stepName("submit");
      const node = this.resolveOne(step, locator);
      const form = node.tag === "form" ? node : ancestorForm(node);
      if (form === undefined) {
        throw new Error(
          `${step}: nothing handles "submit" at ${describeNode(node)}${this.listHint()}`
        );
      }
      const outcome = this.invokeRequired(
        step,
        form,
        "submit",
        submitPayload(form)
      );
      this.finishInteraction(outcome.produced, true);
    });
  }

  focus(locator: Locator.Locator): this {
    return this.act("message", "focus", () => {
      const step = this.stepName("focus");
      const node = this.resolveOne(step, locator);
      const outcome = this.invokeRequired(step, node, "focus", {
        focusVisible: true,
      });
      this.finishInteraction(outcome.produced, outcome.prevented);
    });
  }

  blur(locator: Locator.Locator): this {
    return this.act("message", "blur", () => {
      const step = this.stepName("blur");
      const node = this.resolveOne(step, locator);
      const outcome = this.invokeRequired(step, node, "blur", {});
      this.finishInteraction(outcome.produced, outcome.prevented);
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- synthetic payloads carry arbitrary DOM event fields the component decodes.
  fireDocument(event: string, payload: unknown = {}): this {
    return this.act("message", "fireDocument", () => {
      const outcome = fireGlobal(
        this.engine,
        this.stepName("fireDocument"),
        "document",
        event,
        payload
      );
      this.finishInteraction(outcome.produced, outcome.prevented);
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- synthetic payloads carry arbitrary DOM event fields the component decodes.
  fireWindow(event: string, payload: unknown = {}): this {
    return this.act("message", "fireWindow", () => {
      const outcome = fireGlobal(
        this.engine,
        this.stepName("fireWindow"),
        "window",
        event,
        payload
      );
      this.finishInteraction(outcome.produced, outcome.prevented);
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- synthetic payloads carry arbitrary DOM event fields the component decodes.
  fireCustomEvent(event: string, payload: unknown = {}): this {
    return this.act("message", "fireCustomEvent", () => {
      const outcome = fireCustomEvent(
        this.engine,
        this.stepName("fireCustomEvent"),
        event,
        payload
      );
      this.finishInteraction(outcome.produced, outcome.prevented);
    });
  }

  frame(delta = 16): this {
    return this.act("message", "frame", () => {
      const outcome = fireFrame(this.engine, this.stepName("frame"), delta);
      this.finishInteraction(outcome.produced, outcome.prevented);
    });
  }
}

/**
 * The cursor after `init`, with the first view rendered. Its steps follow
 * the acknowledgement rule, but nothing checks what's pending or
 * unacknowledged at the end.
 */
export const start = <C extends AnyComponent>(
  component: C,
  props: PropsOf<C>,
  options?: {
    readonly slots?: unknown;
    readonly view?: unknown;
    readonly elements?: unknown;
  }
): Steps<C> => {
  if (options?.slots !== undefined) {
    throw new Error(
      `Scene.make: the \`slots\` option needs the slots slice, which isn't implemented yet`
    );
  }
  if (options?.elements !== undefined) {
    throw new Error(
      `Scene.make: the \`elements\` option needs the mounts slice's elements, which isn't implemented yet`
    );
  }
  if (options?.view === undefined) {
    // SAFETY: SceneStepsImpl implements every shared step; the cast only hides the engine.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- StepsImpl's engine field blocks a direct cast to the public cursor.
    return new SceneStepsImpl<C>(component, props) as unknown as Steps<C>;
  }
  if (!isHeadlessComponent(component)) {
    throw new Error(
      `Scene.make: the \`view\` option takes a headless component, but ${component.definitionName} renders a view`
    );
  }
  // SAFETY: the view option receives the headless parts and h erased; runHeadless decodes nothing.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the view option receives the headless parts and h erased.
  const view = options.view as (parts: unknown, h: unknown) => View;
  // SAFETY: SceneStepsImpl implements every shared step; the cast only hides the engine.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- StepsImpl's engine field blocks a direct cast to the public cursor.
  return new SceneStepsImpl<C>(component, props, (cursor) =>
    cursor.runHeadless(view)
  ) as unknown as Steps<C>;
};
/**
 * Starts a scene: renders `init` with `props`. A headless component renders
 * through `options.view`, which receives its parts and `h`. `slots` and
 * `elements` need slices that aren't implemented yet.
 */
export const make = <C extends AnyComponent>(
  component: C,
  props: PropsOf<C>,
  options?: {
    readonly slots?: unknown;
    readonly view?: unknown;
    readonly elements?: unknown;
  }
): Effect.Effect<Steps<C>, never, Scope.Scope> => {
  if (options?.slots !== undefined) {
    return Effect.die(
      new Error(
        `Scene.make: the \`slots\` option needs the slots slice, which isn't implemented yet`
      )
    );
  }
  if (options?.elements !== undefined) {
    return Effect.die(
      new Error(
        `Scene.make: the \`elements\` option needs the mounts slice's elements, which isn't implemented yet`
      )
    );
  }
  if (options?.view !== undefined && !isHeadlessComponent(component)) {
    return Effect.die(
      new Error(
        `Scene.make: the \`view\` option takes a headless component, but ${component.definitionName} renders a view`
      )
    );
  }
  return Effect.acquireRelease(
    Effect.sync(() => start(component, props, options)),
    (cursor) =>
      Effect.sync(() =>
        // SAFETY: make hands the scoped cursor to the end check; the cast only recovers the scene engine.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the public cursor hides the engine; the value is the scoped cursor.
        (cursor as unknown as SceneStepsImpl<C>).checkScopeEnd()
      )
  );
};
