import type { PropBag, VNode } from "ilha";

import { groupKeyOf, nameOf } from "../command.ts";
import type * as Command from "../command.ts";
/**
 * The parts slice behind `givenChild` and `parts`: headless children
 * expand from stored Models, and headless components run their `parts`
 * against a real `p` helper. `p.child` returns a descriptor the Scene
 * tree renders as a leaf, so `childEmit` reaches composed children.
 * Feature children never render in the pure engine (they need a live
 * fiber); `childEmit` still names them by feature.
 */
import { HeadlessTypeId } from "../component.ts";
import type {
  HeadlessComponent,
  PartDecorate,
  PartsHelper,
  SendOptions,
} from "../component.ts";
import type { Engine } from "./engine.ts";
import { isVNode } from "./engine.ts";
import { readsForUpdate } from "./shared.ts";

/** The engine's heterogeneous slice states, keyed by slice name. Each slice narrows its own entry. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the engine's slice states are heterogeneous by design; each slice narrows its own entry.
export type Slices = Record<string, unknown>;

/** The brand on a `p.child` descriptor. */
export const childBrand = "~ilha/model/test/child" as const;

/** A composed headless child waiting for its consumer's view. */
export interface ChildDescriptor {
  readonly [childBrand]: typeof childBrand;
  readonly headless: object;
  readonly key: string;
  readonly options: unknown;
}

/** Whether `u` is a `p.child` descriptor. */
export const isChildDescriptor = (u: unknown): u is ChildDescriptor =>
  typeof u === "object" && u !== null && childBrand in u;

/** Whether `value` is a non-null object. */
const isObject = <T>(value: T): value is T & object =>
  typeof value === "object" && value !== null;

/** Whether `value` is a string. */
const isStringValue = <T>(value: T): value is T & string =>
  typeof value === "string";

/** Whether `value` can be called. The result type is set by inference at each use. */
const isCallable = <T, R>(
  value: T
): value is T & ((...args: readonly unknown[]) => R) =>
  typeof value === "function";

/** The parts slice's engine state, under `slices["parts"]`. */
export interface PartsState {
  /** The Model each headless child expands from, by headless name then key. */
  readonly givenChild: Map<string, Map<string, unknown>>;
}

/** The parts slice's state, creating it on first use. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- slices maps slice names to heterogeneous slice states; each slice narrows its own entry.
export const partsStateOf = (slices: Slices): PartsState => {
  // SAFETY: a present "parts" entry was stored as PartsState below; absent entries are created now.
  const existing = slices["parts"] as PartsState | undefined;
  if (existing !== undefined) {
    return existing;
  }
  const state: PartsState = { givenChild: new Map() };
  slices["parts"] = state;
  return state;
};

/** Whether `u` is a headless component function. */
export const isHeadlessComponent = (u: unknown): u is HeadlessComponent =>
  typeof u === "function" && HeadlessTypeId in u;

/** The definition name of a headless or model component. */
const componentName = <T extends object>(component: T): string => {
  if (
    "definitionName" in component &&
    isStringValue(component.definitionName)
  ) {
    return component.definitionName;
  }
  return "a component";
};

/**
 * Stores the Model a headless child expands from, keyed by headless
 * component then key.
 */
export const givenChildSet = (
  engine: Engine,
  step: string,
  // oxlint-disable-next-line anti-slop/no-object-parameters -- headless components are narrowed with isHeadlessComponent below.
  headless: object,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- with an explicit model this is the key string, otherwise the model itself; split below.
  keyOrModel: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the stored model is an arbitrary user value; keyed by headless name below.
  model?: unknown
): void => {
  if (!isHeadlessComponent(headless)) {
    throw new Error(
      `${step}: givenChild takes a headless component, not ${componentName(headless)}`
    );
  }
  // SAFETY: with an explicit model the second argument is its key string; without one the first argument is the model.
  const key = model === undefined ? "" : (keyOrModel as string);
  const value = model === undefined ? keyOrModel : model;
  const name = componentName(headless);
  // SAFETY: slices holds one state per slice name; the "parts" entry is created as PartsState in partsStateOf.
  const state = partsStateOf(engine.state.slices as Slices);
  let byKey = state.givenChild.get(name);
  if (byKey === undefined) {
    byKey = new Map();
    state.givenChild.set(name, byKey);
  }
  byKey.set(key, value);
};

/** The stored Model of a headless child, or `undefined`. */
export const givenChildGet = (
  engine: Engine,
  // oxlint-disable-next-line anti-slop/no-object-parameters -- headless components are narrowed with componentName below.
  headless: object,
  key: string
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- stored models are arbitrary user values; callers narrow them for their headless component.
): unknown =>
  // SAFETY: slices holds one state per slice name; the "parts" entry is created as PartsState in partsStateOf.
  partsStateOf(engine.state.slices as Slices)
    .givenChild.get(componentName(headless))
    ?.get(key);

/** Builds the `p` helper `parts(p, model)` runs with. */
export const makePartsHelper = (
  engine: Engine
): PartsHelper<unknown, never> => {
  const id = (name: string, key?: string | number | undefined): string =>
    `${engine.module}-${name}${key === undefined ? "" : `-${String(key)}`}`;
  const send = <M>(message: M, options?: SendOptions | undefined) => {
    const handler = <E>(event: E): void => {
      const produced = isCallable(message) ? message(event) : message;
      if (produced !== undefined) {
        engine.deliver(produced);
      }
    };
    // SAFETY: sendOptions keys handlers by identity; the cast reuses this handler's options for that WeakMap.
    engine.sendOptions.set(handler, options as SendOptions);
    return handler;
  };
  const isRunning = (
    definition: Command.Definition.Any,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- command groups are arbitrary user values; groupKeyOf decodes them per definition.
    group?: unknown
  ): boolean => {
    const name = nameOf(definition);
    const key = group === undefined ? undefined : groupKeyOf(definition, group);
    return engine.state.pending.some(
      (entry) =>
        entry.command.name === name &&
        (group === undefined || entry.command.groupKey === key)
    );
  };
  // SAFETY: this implements the `part` overloads: tags-or-nothing up front, any element at apply time.
  const part = ((
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- part takes tags or a decorate function; narrowed with isCallable below.
    first: unknown,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- part takes tags or a decorate function; narrowed with isCallable below.
    second?: unknown
  ) => {
    // SAFETY: parts pass a decorate function here (or as `first`); it is called with the target vnode below.
    const decorate = (isCallable(first) ? first : second) as PartDecorate;
    return (target: VNode, ...args: readonly unknown[]): VNode => {
      if (!isVNode(target)) {
        throw new Error(
          `${engine.module}.parts: p.part applies to a vnode, not ${JSON.stringify(target)}`
        );
      }
      let out: PropBag | VNode;
      try {
        out = decorate(target, ...args);
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : String(error);
        throw new Error(
          `${engine.module}.parts: a part decorate threw: ${messageText}`,
          { cause: error }
        );
      }
      if (isVNode(out)) {
        return out;
      }
      if (isObject(out)) {
        return { ...target, props: { ...target.props, ...out } };
      }
      throw new Error(
        `${engine.module}.parts: a part decorate must return props or a vnode`
      );
    };
    // SAFETY: this implements the `part` overloads: tags-or-nothing up front, any element at apply time.
  }) as PartsHelper<unknown, never>["part"];
  // SAFETY: this implements the generic `child` signature with the test descriptor.
  const child = ((
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- child takes any headless component; narrowed with isHeadlessComponent below.
    component: unknown,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- child takes any options record; the key is read with `in` below.
    options: unknown
  ) => {
    if (!isHeadlessComponent(component) && !isCallable(component)) {
      throw new Error(
        `${engine.module}.parts: p.child takes a headless component`
      );
    }
    const key =
      isObject(options) && "key" in options ? String(options.key ?? "") : "";
    // SAFETY: the descriptor carries the narrowed component and its options; scenes read it with isChildDescriptor.
    return {
      [childBrand]: childBrand,
      headless: component,
      key,
      options,
    } as ChildDescriptor;
    // SAFETY: this implements the generic `child` signature with the test descriptor.
  }) as PartsHelper<unknown, never>["child"];
  // SAFETY: `makePartsHelper` builds the full `p` helper; the casts reuse its untyped pieces for the helper record below.
  return {
    child,
    id,
    isRunning,
    part,
    props: engine.state.props,
    reads: readsForUpdate(engine) as never,
    send: send as never,
  } as PartsHelper<unknown, never>;
};

/**
 * Runs a headless component's `parts` against the current Model (or an
 * explicit one) and returns them.
 */
export const partsOfHeadless = (
  engine: Engine,
  step: string,
  headless: HeadlessComponent,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the model a headless child's parts run against is an arbitrary user value.
  model?: unknown
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- parts return arbitrary user values; scenes narrow them per headless component.
): unknown => {
  const { implementation } = headless;
  if (!("parts" in implementation) || !isCallable(implementation.parts)) {
    throw new Error(
      `${step}: ${componentName(headless)} has no parts: only a headless component does`
    );
  }
  const p = makePartsHelper(engine);
  try {
    return implementation.parts(p, model ?? engine.state.model);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${step}: the parts of ${componentName(headless)} threw: ${messageText}`,
      { cause: error }
    );
  }
};

/** An explicit `{model, props}` pair a parts source resolves to. */
export interface PartsSource {
  readonly model: unknown;
  readonly props: unknown;
}

/**
 * Resolves `Story.parts` source to an explicit `{model, props}` pair: an
 * explicit pair passes through, a Story record contributes its Model and
 * props, and a Scene record contributes the stored `givenChild` Model of
 * the headless component.
 */
export const partsSourceOf = (
  engine: Engine,
  step: string,
  headless: HeadlessComponent,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- sources are explicit pairs or scene records; narrowed with `in` below.
  source: unknown
): PartsSource => {
  if (isObject(source)) {
    if ("model" in source && "props" in source) {
      return { model: source.model, props: source.props };
    }
    if ("root" in source || "view" in source) {
      const stored = givenChildGet(engine, headless, "");
      if (stored === undefined) {
        throw new Error(
          `${step}: the scene has no Model for ${componentName(headless)}: pass {model, props} or givenChild it first`
        );
      }
      return { model: stored, props: engine.state.props };
    }
  }
  throw new Error(
    `${step}: parts takes {model, props} or a Story or Scene record`
  );
};
