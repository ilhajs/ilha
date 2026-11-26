import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
/**
 * `Component.provide` runtime: per-instance Layer environments with
 * sharing, keyed reselection and failure handling.
 *
 * Each provided record owns its env *delta* (`rec.env`); the effective env
 * is resolved by walking the `rec.parent` chain (nearest wins), so
 * descendants see a settled Layer without re-rendering. The kernel boots
 * provides in `mountRecord`, rese­lects keyed provides after updates, and
 * gates Commands/Subscriptions while a provider above waits.
 *
 * Sharing: a Layer *value* is built once per (parent record × Layer
 * identity), reference-counted, and released when the last instance closes.
 * `{ local: true }`, props-function and keyed forms build per instance.
 * Memoised Layers inside a build reuse one memo map per parent, via
 * `Layer.buildWithMemoMap`. Nested provides build outer-first with the
 * accumulated context, so the inner provide wins and sees the outer's
 * services.
 */
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Scope from "effect/Scope";

import type * as MessageLog from "../message-log.ts";
import type { InstanceRecord } from "./kernel.ts";
import type * as Kernel from "./kernel.ts";
// oxlint-disable-next-line unicorn/prefer-export-from -- the markers live in provide-markers.ts but layer-run re-exports them so feature.ts keeps a single internal import; the local binding is also used below.
import { FailedLayer, PendingLayer } from "./provide-markers.ts";

// Set once by the kernel module, which owns dispatch and run control.
let dispatch: typeof Kernel.dispatch = () => {
  throw new Error("layer-run used before the kernel bound dispatch");
};
let failOutside: typeof Kernel.failOutside = () => {
  throw new Error("layer-run used before the kernel bound failOutside");
};
let issueCommands: typeof Kernel.issueCommands = () => {
  throw new Error("layer-run used before the kernel bound issueCommands");
};
// oxlint-disable-next-line unicorn/no-useless-undefined -- typeof Kernel.logDraft returns number | undefined; an empty body would widen to void.
let logDraft: typeof Kernel.logDraft = () => undefined;
let stopAllRuns: typeof Kernel.stopAllRuns = () => {
  throw new Error("layer-run used before the kernel bound stopAllRuns");
};
let stopAllSubs: typeof Kernel.stopAllSubs = () => {
  throw new Error("layer-run used before the kernel bound stopAllSubs");
};

/**
 * Give provides the kernel's dispatch and run control. Called once by the
 * kernel module.
 *
 * @internal
 */
export const bindLayerRunKernel = (hooks: {
  readonly dispatch: typeof Kernel.dispatch;
  readonly failOutside: typeof Kernel.failOutside;
  readonly issueCommands: typeof Kernel.issueCommands;
  readonly logDraft: typeof Kernel.logDraft;
  readonly stopAllRuns: typeof Kernel.stopAllRuns;
  readonly stopAllSubs: typeof Kernel.stopAllSubs;
}): void => {
  ({
    dispatch,
    failOutside,
    issueCommands,
    logDraft,
    stopAllRuns,
    stopAllSubs,
  } = hooks);
};

/**
 * One `provide` in a component's chain, outermost first. Keyed specs reselect
 * the Layer when `key(props, model)` changes.
 */
export interface ProvideSpec {
  /** Build the Layer for the mounting props. May throw (a defect). */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- build takes the mounting props at the kernel seam; ProvideSpec states the contract.
  readonly build: (props: unknown) => Layer.Layer<unknown, unknown, unknown>;
  /** Selects the Layer from the current key; set for keyed provides. */
  readonly layerOfKey:
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- layerOfKey takes the opaque key the spec's own key selected; ProvideSpec states the contract.
    ((key: unknown) => Layer.Layer<unknown, unknown, unknown>) | undefined;
  /** Reads the selection; `undefined` for unkeyed provides. May throw. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- key reads untyped props and model at the kernel seam; ProvideSpec states the contract.
  readonly key: ((props: unknown, model: unknown) => unknown) | undefined;
  /** Per-instance builds, never shared. */
  readonly local: boolean;
  /** Maps a build failure to a message. Required for fallible Layers. */
  readonly onFailure:
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- onFailure's return is dispatched as a message; unknown is the honest type.
    ((failure: AsyncResult.Failure<never, unknown>) => unknown) | undefined;
}

/**
 * The spec chain on a provided implementation, outermost first.
 */
export const ProvideSpecs = "~@ilha/model/ProvideSpecs" as const;

// SAFETY: the property check above proves the marker exists; the cast only recovers the spec-chain record the kernel wrote.
const hasSpecs = (
  value: unknown
): value is Record<typeof ProvideSpecs, readonly ProvideSpec[]> =>
  typeof value === "object" &&
  value !== null &&
  ProvideSpecs in value &&
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the implementation record is heterogeneous; ProvideSpec states the contract.
  Array.isArray((value as Record<string, unknown>)[ProvideSpecs]);

/**
 * The provide chain of an implementation, or `[]`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- specsOf reads the ProvideSpecs marker off any implementation value; unknown is the honest input.
export const specsOf = (implementation: unknown): readonly ProvideSpec[] =>
  hasSpecs(implementation) ? implementation[ProvideSpecs] : [];

export { FailedLayer, PendingLayer };

interface SharedEntry {
  ctx: Context.Context<unknown>;
  count: number;
  scope: Scope.Closeable;
}

/** Shared builds, per parent record (or kernel for roots) × Layer identity. */
const sharedBuilds = new WeakMap<object, Map<unknown, SharedEntry>>();

/** One memo map per parent, so memoised Layers inside a build share per Env. */
const memoMaps = new WeakMap<object, Layer.MemoMap>();

// oxlint-disable-next-line anti-slop/no-object-parameters -- WeakMap keys are record/kernel identities; object is the precise key type.
const memoMapOf = (parent: object): Layer.MemoMap => {
  const existing = memoMaps.get(parent);
  if (existing !== undefined) {
    return existing;
  }
  const fresh = Layer.makeMemoMapUnsafe();
  memoMaps.set(parent, fresh);
  return fresh;
};

interface Stashed {
  readonly rec: InstanceRecord;
  readonly command: Parameters<typeof issueCommands>[1][number];
  readonly seq: number;
}

interface ProvideState {
  readonly specs: readonly ProvideSpec[];
  /** The record's own env delta before the pending marker. */
  base: Context.Context<never>;
  /** Key selections, one entry per keyed spec. */
  keys: readonly unknown[];
  /** `true` while a build (or rebuild) is in flight. */
  waiting: boolean;
  /** Commands stashed while waiting, flushed on settle. */
  stashed: Stashed[];
  /** Shared entries held by the current selection. */
  held: { readonly parent: object; readonly layer: unknown }[];
  /** Previous selection, released once the new one settles. */
  retired: { readonly parent: object; readonly layer: unknown }[];
  /** Interrupt the in-flight build on unmount. */
  interruptBuild: (() => void) | undefined;
  /** Selection generation; stale build completions are dropped. */
  generation: number;
  /** Local (non-shared) build scopes owned by the current selection. */
  scopes: Scope.Closeable[];
}

const stateKey = "layerRun";

// SAFETY: the kernel stores only ProvideState under "layerRun"; the cast recovers the record the kernel wrote.
const stateOf = (rec: InstanceRecord): ProvideState | undefined =>
  rec.extensions.get(stateKey) as ProvideState | undefined;

/**
 * Whether `rec` and every provider above it settled. Commands and
 * Subscriptions wait while this is `false`.
 */
export const provideSettled = (rec: InstanceRecord): boolean => {
  for (
    let at: InstanceRecord | undefined = rec;
    at !== undefined;
    at = at.parent
  ) {
    const state = stateOf(at);
    if (state !== undefined && state.waiting) {
      return false;
    }
  }
  return true;
};

/**
 * The chain-resolved env of a record line, merged outermost-first so the
 * nearest record wins. Used as the build-site context for provides.
 */
const chainEnv = (rec: InstanceRecord | undefined): Context.Context<never> => {
  const chain: InstanceRecord[] = [];
  for (let at = rec; at !== undefined; at = at.parent) {
    chain.unshift(at);
  }
  // SAFETY: Context.empty is the never env; the cast only recovers the merged record-env type the builder consumes.
  let out = Context.empty() as Context.Context<never>;
  for (const at of chain) {
    out = Context.merge(out, at.env);
  }
  return out;
};

const sameKeys = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((key, index) => Equal.equals(key, b[index]));

const readKeys = (
  specs: readonly ProvideSpec[],
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- readKeys forwards untyped props and model to each spec's own key; ProvideSpec states the contract.
  props: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- readKeys forwards untyped props and model to each spec's own key; ProvideSpec states the contract.
  model: unknown
): readonly unknown[] => specs.map((spec) => spec.key?.(props, model));

// oxlint-disable-next-line anti-slop/no-object-parameters, anti-slop/no-unknown-parameters -- parent is the record/kernel identity keying shared builds; layer is the shared Layer value keyed by identity.
const releaseOne = (parent: object, layer: unknown): void => {
  const byLayer = sharedBuilds.get(parent);
  const held = byLayer?.get(layer);
  if (held === undefined) {
    return;
  }
  held.count -= 1;
  if (held.count > 0) {
    return;
  }
  byLayer?.delete(layer);
  void Effect.runPromiseExit(Scope.close(held.scope, Exit.void));
};

const releaseHeld = (state: ProvideState): void => {
  for (const entry of state.held.splice(0)) {
    releaseOne(entry.parent, entry.layer);
  }
};

const releaseRetired = (state: ProvideState): void => {
  for (const entry of state.retired.splice(0)) {
    releaseOne(entry.parent, entry.layer);
  }
};

/**
 * Stash a Command whose service is missing while a provider above waits.
 * Returns `true` when stashed (the kernel must not fail the instance).
 */
export const stashProvideCommand = (
  rec: InstanceRecord,
  command: Stashed["command"],
  issued: MessageLog.Issued
): boolean => {
  for (
    let at: InstanceRecord | undefined = rec;
    at !== undefined;
    at = at.parent
  ) {
    const state = stateOf(at);
    if (state !== undefined && state.waiting) {
      state.stashed.push({ command, rec, seq: issued.seq });
      return true;
    }
  }
  return false;
};

const flushStashed = (state: ProvideState): void => {
  const stashed = state.stashed.splice(0);
  for (const entry of stashed) {
    if (entry.rec.status !== "live" || entry.rec.fiber.closed) {
      continue;
    }
    issueCommands(entry.rec, [entry.command], entry.seq);
  }
};

const failBuild = (
  rec: InstanceRecord,
  state: ProvideState,
  cause: Cause.Cause<unknown>,
  scope: Scope.Closeable,
  shared: boolean
): void => {
  state.waiting = false;
  state.interruptBuild = undefined;
  if (shared) {
    releaseHeld(state);
  } else {
    void Effect.runPromiseExit(Scope.close(scope, Exit.void));
  }
  if (rec.status === "closed") {
    state.stashed.splice(0);
    return;
  }
  const handler = [...state.specs]
    .toReversed()
    .find((spec) => spec.onFailure !== undefined)?.onFailure;
  if (handler === undefined) {
    state.stashed.splice(0);
    failOutside(rec, "layer", cause);
    return;
  }
  rec.env = Context.merge(state.base, Context.make(FailedLayer, cause));
  logDraft(rec, { _tag: "LayerFailed", cause });
  flushStashed(state);
  rec.signal.update((n) => n + 1);
  // SAFETY: AsyncResult.failure builds the Failure the onFailure contract takes; the cast only names its static type.
  const message = handler(
    AsyncResult.failure(cause) as AsyncResult.Failure<never, unknown>
  );
  if (message !== undefined && rec.status === "live" && !rec.fiber.closed) {
    dispatch(rec, rec, message);
  }
};
const settleBuild = (
  rec: InstanceRecord,
  state: ProvideState,
  built: Context.Context<unknown>
): void => {
  state.waiting = false;
  state.interruptBuild = undefined;
  if (rec.status !== "live" || rec.fiber.closed) {
    // The instance closed mid-build: drop the result and release.
    releaseHeld(state);
    return;
  }
  rec.env = Context.merge(state.base, built);
  releaseRetired(state);
  logDraft(rec, { _tag: "LayerReady" });
  flushStashed(state);
  rec.signal.update((n) => n + 1);
};

const runBuild = (
  rec: InstanceRecord,
  state: ProvideState,
  layer: Layer.Layer<unknown, unknown, unknown>,
  shared: boolean,
  // oxlint-disable-next-line anti-slop/no-object-parameters -- parent is the record/kernel identity keying shared builds; WeakMap keys are objects by design.
  parent: object,
  memo: Layer.MemoMap,
  status: "Pending" | "Rebuilding"
): void => {
  logDraft(rec, { _tag: "LayerPending", status });
  const scope = Effect.runSync(Scope.make());
  if (shared) {
    const existing = sharedBuilds.get(parent)?.get(layer);
    if (existing !== undefined) {
      existing.count += 1;
      state.held.push({ layer, parent });
      void Effect.runPromiseExit(Scope.close(scope, Exit.void));
      settleBuild(rec, state, existing.ctx);
      return;
    }
  }
  // The build sees the record's own line, not just its parent's: a root
  // record's own delta holds the island's `Client`, which the parent line
  // alone leaves out.
  // SAFETY: buildWithMemoMap only needs the Layer's requirements; the cast pins the never-requirements form the provide call consumes.
  const buildable = layer as Layer.Layer<unknown, never, never>;
  const build: Effect.Effect<
    Context.Context<unknown>,
    never,
    never
  > = Effect.provide(
    Layer.buildWithMemoMap(buildable, memo, scope),
    chainEnv(rec)
  );
  const fiber = Effect.runFork(build);
  state.generation += 1;
  const { generation } = state;
  state.interruptBuild = () => {
    void Effect.runFork(Fiber.interrupt(fiber));
  };
  // oxlint-disable-next-line promise/prefer-await-to-then -- the join continuation runs detached after dispatch; awaiting it would suspend the build caller and change unmount timing.
  void Effect.runPromiseExit(Effect.exit(Fiber.join(fiber))).then((exit) => {
    if (generation !== state.generation) {
      // Superseded by a reselect: drop the result and release the scope
      // without touching the new build's state.
      void Effect.runPromiseExit(Scope.close(scope, Exit.void));
      return;
    }
    if (rec.status === "closed") {
      // Unmounted mid-build: never publish, just release the scope.
      state.waiting = false;
      state.interruptBuild = undefined;
      state.stashed.splice(0);
      void Effect.runPromiseExit(Scope.close(scope, Exit.void));
      return;
    }
    if (!Exit.isSuccess(exit)) {
      failBuild(rec, state, exit.cause, scope, shared);
      return;
    }
    const inner = exit.value;
    if (!Exit.isSuccess(inner)) {
      failBuild(rec, state, inner.cause, scope, shared);
      return;
    }
    const ctx = inner.value;
    if (shared) {
      let byLayer = sharedBuilds.get(parent);
      if (byLayer === undefined) {
        byLayer = new Map();
        sharedBuilds.set(parent, byLayer);
      }
      const raced = byLayer.get(layer);
      if (raced === undefined) {
        byLayer.set(layer, { count: 1, ctx, scope });
        state.held.push({ layer, parent });
        settleBuild(rec, state, ctx);
      } else {
        raced.count += 1;
        state.held.push({ layer, parent });
        void Effect.runPromiseExit(Scope.close(scope, Exit.void));
        settleBuild(rec, state, raced.ctx);
      }
    } else {
      state.scopes.push(scope);
      settleBuild(rec, state, ctx);
      rec.onClose.push(() => {
        void Effect.runPromiseExit(Scope.close(scope, Exit.void));
      });
    }
  });
};
const startBuild = (
  rec: InstanceRecord,
  state: ProvideState,
  status: "Pending" | "Rebuilding",
  shared: boolean
): void => {
  rec.env = Context.merge(state.base, Context.make(PendingLayer, true));
  // SAFETY: rec.parent and rec.kernel are the record/kernel identities keying shared builds; the cast only names the WeakMap key type.
  // oxlint-disable-next-line anti-slop/no-object-parameters -- parent is the record/kernel identity keying shared builds; WeakMap keys are objects by design.
  const parent = (rec.parent ?? rec.kernel) as object;
  let layers: Layer.Layer<unknown, unknown, unknown>[];
  try {
    layers = state.specs.map((spec, index) =>
      spec.layerOfKey === undefined
        ? spec.build(rec.props)
        : spec.layerOfKey(state.keys[index])
    );
  } catch (error) {
    const scope = Effect.runSync(Scope.make());
    void Effect.runPromiseExit(Scope.close(scope, Exit.void));
    failBuild(rec, state, Cause.die(error), scope, false);
    return;
  }
  // Each spec sees every sibling spec's outputs, and the last-applied spec
  // wins conflicts: branch i feeds all other specs' outputs into spec i's
  // requirements, and the outer `mergeAll` keeps last-branch-wins. A flat
  // `mergeAll` alone leaves sibling specs unwired, so a service needing
  // another spec's output fails with "Service not found"; a single
  // `provideMerge` fold wires only one direction and picks the wrong
  // winner. (Both orders verified against Effect's `mergeAll` last-wins
  // and `provideMerge` self-wins semantics.)
  // SAFETY: a single spec's built Layer is already the build input; the cast only names the Layer type the merge consumes.
  const single = layers[0] as
    | Layer.Layer<unknown, unknown, unknown>
    | undefined;
  const wired =
    layers.length === 1 && single !== undefined
      ? [single]
      : layers.map((spec, index) => {
          const others = layers.filter((_, other) => other !== index);
          // SAFETY: others[0] is the only sibling branch; the cast only names the Layer type the merge consumes.
          const only = others[0] as
            | Layer.Layer<unknown, unknown, unknown>
            | undefined;
          // SAFETY: merging sibling Layers only recovers the erased Layer shapes the build consumes; the spread passes the sibling branch array through.
          const rest =
            only !== undefined && others.length === 1
              ? only
              : // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- merging arbitrary instance Layers has no single-step assertion to the erased Layer type.
                (Layer.mergeAll(
                  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the merged sibling Layer has no single-step assertion to the erased Layer type.
                  ...(others as [
                    Layer.Layer<unknown, unknown, unknown>,
                    ...Layer.Layer<unknown, unknown, unknown>[],
                  ])
                  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- merging arbitrary instance Layers has no single-step assertion to the erased Layer type.
                ) as unknown as Layer.Layer<unknown, unknown, unknown>);
          // SAFETY: wiring feeds sibling outputs into the spec's requirements; the casts only recover the erased Layer shapes the merge consumes.
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the wired spec shape has no single-step assertion to the erased Layer type.
          return (spec as Layer.Layer<unknown, unknown, unknown>).pipe(
            Layer.provideMerge(rest)
          ) as unknown as Layer.Layer<unknown, unknown, unknown>;
        });
  // SAFETY: merging the wired branches only recovers the erased Layer shape the build consumes; the spread passes the branch array through.
  const layer =
    wired.length === 1 && wired[0] !== undefined
      ? wired[0]
      : // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the merged Layer has no single-step assertion to the erased Layer type.
        (Layer.mergeAll(
          ...(wired as [
            Layer.Layer<unknown, unknown, unknown>,
            ...Layer.Layer<unknown, unknown, unknown>[],
          ])
        ) as unknown as Layer.Layer<unknown, unknown, unknown>);
  runBuild(
    rec,
    state,
    layer,
    shared,
    parent,
    shared ? memoMapOf(parent) : Layer.makeMemoMapUnsafe(),
    status
  );
};

/**
 * Boot a provided record's Layer build. No specs, or a server render: no-op.
 * Runs before `init` Commands issue, so they wait for the Layer.
 */
export const bootProvide = (
  rec: InstanceRecord,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- bootProvide forwards untyped props and model to each spec's key and build; ProvideSpec states the contract.
  props: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- bootProvide forwards untyped props and model to each spec's key and build; ProvideSpec states the contract.
  model: unknown
): void => {
  const specs = specsOf(rec.implementation);
  if (specs.length === 0) {
    return;
  }
  const keyed = specs.some((spec) => spec.key !== undefined);
  let keys: readonly unknown[] = [];
  try {
    keys = readKeys(specs, props, model);
  } catch (error) {
    const failed: ProvideState = {
      base: rec.env,
      generation: 0,
      held: [],
      interruptBuild: undefined,
      keys,
      retired: [],
      scopes: [],
      specs,
      stashed: [],
      waiting: true,
    };
    rec.extensions.set(stateKey, failed);
    const scope = Effect.runSync(Scope.make());
    void Effect.runPromiseExit(Scope.close(scope, Exit.void));
    failBuild(rec, failed, Cause.die(error), scope, false);
    return;
  }
  const state: ProvideState = {
    base: rec.env,
    generation: 0,
    held: [],
    interruptBuild: undefined,
    keys,
    retired: [],
    scopes: [],
    specs,
    stashed: [],
    waiting: true,
  };
  rec.extensions.set(stateKey, state);
  rec.onClose.push(() => {
    state.interruptBuild?.();
    state.interruptBuild = undefined;
    state.stashed.splice(0);
    releaseHeld(state);
    releaseRetired(state);
  });
  startBuild(
    rec,
    state,
    "Pending",
    !keyed && specs.every((spec) => !spec.local)
  );
};

/**
 * Reselect keyed provides after the Model or props changed. Reads each key
 * once, compares with `Equal`, and on a change keeps the Model, interrupts
 * in-flight work, and rebuilds in place (keyed provides never share).
 */
export const reselectProvide = (rec: InstanceRecord): void => {
  const state = stateOf(rec);
  if (state === undefined || rec.status !== "live" || rec.fiber.closed) {
    return;
  }
  if (!state.specs.some((spec) => spec.key !== undefined)) {
    return;
  }
  let keys: readonly unknown[];
  try {
    keys = readKeys(state.specs, rec.props, rec.model());
  } catch (error) {
    if (state.waiting) {
      return;
    }
    state.keys = [];
    stopAllRuns(rec, "layer");
    stopAllSubs(rec);
    // Drop the previous selection first: interrupt its build so a stale
    // completion cannot win (the generation check drops it), and close its
    // local scopes instead of leaving them open until unmount.
    state.interruptBuild?.();
    state.interruptBuild = undefined;
    for (const scope of state.scopes.splice(0)) {
      void Effect.runPromiseExit(Scope.close(scope, Exit.void));
    }
    state.stashed.splice(0);
    state.waiting = true;
    state.retired.push(...state.held.splice(0));
    logDraft(rec, { _tag: "LayerPending", status: "Rebuilding" });
    const scope = Effect.runSync(Scope.make());
    void Effect.runPromiseExit(Scope.close(scope, Exit.void));
    failBuild(rec, state, Cause.die(error), scope, false);
    rec.signal.update((n) => n + 1);
    return;
  }
  if (sameKeys(state.keys, keys)) {
    return;
  }
  state.keys = keys;
  stopAllRuns(rec, "layer");
  stopAllSubs(rec);
  // Drop the previous selection first: interrupt its build so a stale
  // completion cannot win (the generation check drops it), and close its
  // local scopes instead of leaving them open until unmount.
  state.interruptBuild?.();
  state.interruptBuild = undefined;
  for (const scope of state.scopes.splice(0)) {
    void Effect.runPromiseExit(Scope.close(scope, Exit.void));
  }
  state.stashed.splice(0);
  state.waiting = true;
  state.retired.push(...state.held.splice(0));
  logDraft(rec, { _tag: "LayerPending", status: "Rebuilding" });
  rec.signal.update((n) => n + 1);
  startBuild(rec, state, "Rebuilding", false);
};
