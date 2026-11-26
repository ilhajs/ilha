import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { Issued } from "./command";

/**
 * What `init` and `update` accumulate: the next model, commands to issue,
 * and events to emit to the author's `onEmit`. Each builder returns a new
 * step, so chains like `$.set(model).run(cmd).emit(event)` keep extending.
 */
export interface Step<Model, Msg, R = never, Events = never> {
  /** The model the step carries. */
  readonly model: Model;
  /**
   * Pending issues, in order. The runner executes them; `Story` exposes
   * them as `{ name, args }`.
   */
  readonly commands: readonly Issued<Msg, R>[];
  /** Emitted events, in order. */
  readonly events: readonly Events[];
  /** Replace the model, no merge. */
  readonly set: (model: Model) => Step<Model, Msg, R, Events>;
  /** Change some fields; each patch value replaces, or maps the previous. */
  readonly evolve: (patch: EvolvePatch<Model>) => Step<Model, Msg, R, Events>;
  /** Issue commands, owned by the instance. Results come back as messages. */
  readonly run: <R2>(
    ...issued: readonly Issued<Msg, R2>[]
  ) => Step<Model, Msg, R | R2, Events>;
  /** Report events to the author's `onEmit`, after the model commits. */
  readonly emit: (...events: readonly Events[]) => Step<Model, Msg, R, Events>;
}

/** Shallow patch: each field is a value, or an updater from the previous. */
export type EvolvePatch<Model> = {
  readonly [K in keyof Model]?:
    | Model[K]
    | ((previous: Model[K]) => Model[K])
    | undefined;
};

/** One field update: a replacement value, or an updater from the previous. */
export type PatchValue<Model> =
  | Model[keyof Model]
  | ((previous: Model[keyof Model]) => Model[keyof Model]);

/** `$` in `init`: the current props, and `set` to build the first model. */
export interface InitDollar<Model, Msg, Props, Events> {
  readonly props: Props;
  readonly set: (model: Model) => Step<Model, Msg, never, Events>;
}

/** `$` in `update`: a step seeded with the current model, plus props. */
export interface UpdateDollar<Model, Msg, Props, Events> extends Step<
  Model,
  Msg,
  never,
  Events
> {
  readonly props: Props;
}

/**
 * Shared runtime bits for the component loop and the `Story` test helper.
 * Everything here is generic over the component's own types, so no value
 * is ever erased to `unknown`: each bundle keeps full static evidence.
 */

/** Log a defect through the Effect logger; interruption stays silent. */
export const reportCause = (cause: Cause.Cause<never>): Effect.Effect<void> =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.void
    : Effect.logError(Cause.pretty(cause));

/**
 * A defect inside a subscription stream is logged and silences only that
 * stream, so the next deps change starts a fresh one. Interruption passes
 * through so restarts and unmount stay silent.
 */
export const quietStream = <A>(cause: Cause.Cause<never>): Stream.Stream<A> =>
  Cause.hasInterruptsOnly(cause)
    ? Stream.failCause(cause)
    : Stream.unwrap(
        Effect.as(Effect.logError(Cause.pretty(cause)), Stream.empty)
      );

/** Whether `value` is a non-null object. */
const isObject = <T>(value: T): value is T & object =>
  typeof value === "object" && value !== null;

const isUpdater = <T>(
  change: T | ((previous: T) => T)
): change is (previous: T) => T => typeof change === "function";

/** Brand marking step values built by {@link createStep}. */
const stepMarker = "__ilhaModelStep";

/** Whether `value` is a step built by {@link createStep}. */
export const isStepValue = (
  value: unknown
): value is Step<never, never, never, never> =>
  isObject(value) &&
  Object.getOwnPropertyDescriptor(value, stepMarker)?.value === true;

/** Replace every field listed in `patch`; a function receives the previous value. */
export const applyEvolve = <Model>(
  model: Model,
  patch: EvolvePatch<Model>
): Model => {
  if (!isObject(model) || Array.isArray(model)) {
    throw new Error("@ilha/model evolve needs an object model");
  }

  const out: Model = { ...model };
  // SAFETY: `patch` only carries the model's own keys (EvolvePatch is a
  // mapped type over the model), so every key read here is a model key.
  const keys = Object.keys(patch) as (keyof Model)[];

  for (const key of keys) {
    // SAFETY: the key comes from the patch itself, so the value is one of
    // the model's field updates, not an arbitrary unknown.
    const change = patch[key] as PatchValue<Model> | undefined;

    if (change === undefined) {
      continue;
    }

    out[key] = isUpdater(change) ? change(model[key]) : change;
  }

  return out;
};

/** Build a step; every builder returns a new step with the change applied. */
export const createStep = <Model, Msg, R, Events>(
  model: Model,
  commands: readonly Issued<Msg, R>[] = [],
  events: readonly Events[] = []
): Step<Model, Msg, R, Events> => {
  const step: Step<Model, Msg, R, Events> = {
    commands,
    emit: (...emitted) => createStep(model, commands, [...events, ...emitted]),
    events,
    evolve: (patch) => createStep(applyEvolve(model, patch), commands, events),
    model,
    run: <R2>(...issued: readonly Issued<Msg, R2>[]) =>
      createStep<Model, Msg, R | R2, Events>(
        model,
        [...commands, ...issued],
        events
      ),
    set: (next) => createStep(next, commands, events),
  };

  return Object.assign(step, { [stepMarker]: true });
};

/** `$` for `init`: the current props, and `set` to build the first model. */
export const initDollar = <Model, Msg, Props, Events>(
  props: Props
): InitDollar<Model, Msg, Props, Events> => ({
  props,
  set: (model) => createStep(model),
});

/** `$` for `update`: a step seeded with the current model, plus props. */
export const updateDollar = <Model, Msg, Props, Events>(
  model: Model,
  props: Props
): UpdateDollar<Model, Msg, Props, Events> =>
  Object.assign(createStep<Model, Msg, never, Events>(model), { props });
