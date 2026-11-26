import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
/**
 * `Component.lazy` runtime: a component whose module loads on first render.
 *
 * The load runs once per lazy object ("once per app"): a module-level atom
 * counts the settled loads, so the handle is declared without a fiber and
 * can be shared across islands. While loading, the child shows its
 * `fallback(Initial)`; a failed load shows the `Failure` branch, retries
 * once on the next render, and retries again on a mount that never rendered
 * it before. Loaded children mount directly, so their paths use the loaded
 * component's name.
 *
 * Rerendering works through the shared version atom the calling view reads
 * with a slot-free tracked read: settling the load bumps the atom in every
 * registry that rendered it (atom state is per-registry, so one bump cannot
 * wake another island), and each author's view re-renders. On the server the
 * load is tracked in the rendering fiber, so `renderToString` awaits it,
 * and the settled load repaints the server view by hand (the server
 * subscribes to nothing).
 */
import type { View } from "ilha";
import { getFiber, readTracked, withFiber } from "ilha/internal";
import type { FiberLocal } from "ilha/internal";

import type { InstanceRecord } from "./kernel.ts";
import type * as Kernel from "./kernel.ts";
import { definitionNameOf } from "./paths.ts";

// Set once by the kernel module, which owns the caller record and refresh.
// oxlint-disable-next-line eslint/no-empty-function, unicorn/no-useless-undefined -- placeholder until the kernel binds the real implementation, which returns a record or undefined.
let recordOfCaller: typeof Kernel.recordOfCaller = () => undefined;
let refreshForQuery: typeof Kernel.refreshForQuery = () => {
  throw new Error("lazy used before the kernel bound refreshForQuery");
};

/**
 * Give lazy components the kernel's caller record and refresh. Called once
 * by the kernel module.
 *
 * @internal
 */
export const bindLazyKernel = (hooks: {
  readonly recordOfCaller: typeof Kernel.recordOfCaller;
  readonly refreshForQuery: typeof Kernel.refreshForQuery;
}): void => {
  ({ recordOfCaller, refreshForQuery } = hooks);
};

/**
 * A lazy component's load state.
 */
export type LazyState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Loading"; readonly promise: Promise<void> }
  | { readonly _tag: "Loaded"; readonly component: unknown }
  | { readonly _tag: "Failed"; readonly error: unknown };

/**
 * A lazy component object: callable like the loaded component, with
 * `preload` and introspectable load state.
 */
export interface LazyComponent {
  readonly state: LazyState;
  readonly preload: () => Promise<void>;
}

interface LazyOptions {
  readonly fallback?:
    | ((
        result:
          | AsyncResult.Initial<never, unknown>
          | AsyncResult.Failure<never, unknown>
      ) => View)
    | undefined;
}

const loadError = (name: string): Error =>
  new Error(`Component.lazy: "${name}" loaded no component that can be called`);

const isCallableComponent = (
  value: unknown
): value is (options: LazyOptions) => View =>
  typeof value === "function" && definitionNameOf(value) !== undefined;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- failureOf is the load-rejection boundary; unknown is the honest input.
const failureOf = (name: string, error: unknown): LazyState =>
  error instanceof Error && error.message.startsWith("Component.lazy: ")
    ? { _tag: "Failed", error }
    : { _tag: "Failed", error: error ?? loadError(name) };

/**
 * Whether `u` is the `Initial` branch (loading) or `Failure` (failed load).
 * Anything else means the load resolved to an unusable value.
 */
export const resultOf = (
  name: string,
  state: LazyState
):
  | {
      readonly _tag: "Loaded";
      readonly component: (options: LazyOptions) => View;
    }
  | {
      readonly _tag: "Pending";
      readonly result: AsyncResult.Initial<never, unknown>;
    }
  | {
      readonly _tag: "Failed";
      readonly result: AsyncResult.Failure<never, unknown>;
    } => {
  // oxlint-disable-next-line eslint/default-case -- LazyState is a closed union; all four tags are handled and the return type makes tsc enforce exhaustiveness.
  switch (state._tag) {
    case "Loaded": {
      return isCallableComponent(state.component)
        ? { _tag: "Loaded", component: state.component }
        : {
            _tag: "Failed",
            result: AsyncResult.failure(Cause.die(loadError(name))),
          };
    }
    case "Loading": {
      return { _tag: "Pending", result: AsyncResult.initial(true) };
    }
    case "Failed": {
      return {
        _tag: "Failed",
        result: AsyncResult.failure(
          Cause.isCause(state.error) ? state.error : Cause.fail(state.error)
        ),
      };
    }
    case "Idle": {
      return { _tag: "Pending", result: AsyncResult.initial(false) };
    }
  }
};

/** Per-handle mutable shell; the handle itself is safe to declare at module scope. */
interface LazyBox {
  state: LazyState;
  /** One automatic retry per failure, shared across every call site. */
  retried: boolean;
  /** Mounts that rendered this lazy; a failed load retries on an unseen one. */
  seen: Set<WeakRef<InstanceRecord | FiberLocal>>;
  /** Registries that rendered this lazy; version bumps fan out to each. */
  registries: Set<WeakRef<AtomRegistry>>;
  /** Server records rendered while a load was in flight; repainted on settle. */
  serverRecs: Set<WeakRef<InstanceRecord>>;
}

const prune = <T extends object>(refs: Set<WeakRef<T>>): void => {
  for (const ref of refs) {
    if (ref.deref() === undefined) {
      refs.delete(ref);
    }
  }
};

const holdRenderOpen = (): void => {
  // FiberLocal.run uses the callback's presence to include this effect in
  // runtime readiness; the lazy state transition itself needs no callback.
};

/**
 * Declare a lazy component. `load` resolves to the component, usually from a
 * dynamic `import()`.
 */
export const makeLazy = (
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- load resolves to an unvalidated module value; isCallableComponent validates it.
  load: () => Promise<unknown>
): LazyComponent & ((options: LazyOptions) => View) => {
  const box: LazyBox = {
    registries: new Set(),
    retried: false,
    seen: new Set(),
    serverRecs: new Set(),
    state: { _tag: "Idle" },
  };
  // Module-level and kept alive: islands drop atoms nothing subscribes to,
  // and this one is subscribed only between renders. State is per-registry,
  // so the settle below bumps every registry that rendered this lazy.
  const version = Atom.keepAlive(Atom.make(0));
  const bump = (): void => {
    prune(box.registries);
    for (const ref of box.registries) {
      const registry = ref.deref();
      if (registry === undefined) {
        box.registries.delete(ref);
        continue;
      }
      try {
        registry.update(version, (n) => n + 1);
      } catch {
        // A disposed registry never notifies again; drop it.
        box.registries.delete(ref);
      }
    }
  };
  const repaintServer = (): void => {
    const recs: InstanceRecord[] = [];
    for (const ref of box.serverRecs) {
      const rec = ref.deref();
      if (rec !== undefined) {
        recs.push(rec);
      }
    }
    box.serverRecs.clear();
    for (const rec of recs) {
      try {
        // The server subscribes to nothing, so the bump above repaints
        // nothing: re-render each record that rendered through the load by
        // hand, with its fiber active so views resolving services keep them.
        // oxlint-disable-next-line eslint/no-loop-func -- for-of const bindings are fresh per iteration, so the closure is safe.
        withFiber(rec.fiber, () => refreshForQuery(rec));
      } catch {
        // Racing an unmount: client fibers already woke through the bump.
      }
    }
  };
  const onSettled = (): void => {
    bump();
    repaintServer();
  };
  const self = {
    preload: (): Promise<void> => {
      const current = self.state;
      if (current._tag === "Loaded") {
        return Promise.resolve();
      }
      if (current._tag === "Loading") {
        return current.promise;
      }
      if (current._tag === "Failed" && box.retried) {
        return Promise.resolve();
      }
      if (current._tag === "Failed") {
        box.retried = true;
      }
      const { promise, resolve } = Promise.withResolvers<unknown>();
      resolve(load());
      const tracked = (async (): Promise<void> => {
        try {
          const component = await promise;
          self.state = isCallableComponent(component)
            ? { _tag: "Loaded", component }
            : failureOf(name, loadError(name));
        } catch (error) {
          self.state = failureOf(name, error);
        }
        onSettled();
      })();
      self.state = { _tag: "Loading", promise: tracked };
      // Hold the rendering fiber (and the server's `ready`) until the load
      // settles: the client replaces placeholders and SSR awaits content.
      try {
        getFiber().run(
          Effect.promise(() => tracked),
          holdRenderOpen
        );
      } catch {
        // Rendered outside a fiber: the version bump still re-renders.
      }
      return tracked;
    },
    get state(): LazyState {
      return box.state;
    },
    set state(next: LazyState) {
      box.state = next;
    },
  } satisfies { state: LazyState; preload: () => Promise<void> };
  const trackCaller = (fiber: FiberLocal): void => {
    prune(box.registries);
    let known = false;
    for (const ref of box.registries) {
      if (ref.deref() === fiber.registry) {
        known = true;
        break;
      }
    }
    if (!known) {
      box.registries.add(new WeakRef(fiber.registry));
    }
    const caller = recordOfCaller();
    const identity: InstanceRecord | FiberLocal = caller ?? fiber;
    prune(box.seen);
    for (const ref of box.seen) {
      if (ref.deref() === identity) {
        return;
      }
    }
    box.seen.add(new WeakRef(identity));
    // A failed load retries on a mount that never rendered it before. Mounts
    // already seen stay on the Failure branch: without this, two call sites
    // rendering in turn would reset each other's retry budget forever.
    if (self.state._tag === "Failed") {
      self.state = { _tag: "Idle" };
    }
    // The server subscribes to nothing, so each record that renders through
    // a load is repainted by hand when the load settles.
    if (fiber.runtime.ssr && caller !== undefined) {
      prune(box.serverRecs);
      box.serverRecs.add(new WeakRef(caller));
    }
  };
  const call = (options: LazyOptions): View => {
    let fiber: FiberLocal | undefined;
    try {
      fiber = getFiber();
    } catch {
      fiber = undefined;
    }
    if (fiber !== undefined) {
      trackCaller(fiber);
    }
    // The tracked read subscribes the rendering fiber without taking an
    // order-based primitive slot, so this call works at module scope and in
    // any island.
    readTracked(version);
    // A failed load retries once, on the next render after the failure;
    // further renders while still failed stay on the fallback instead of
    // looping forever (a permanently failing load would starve the loop).
    // `outcome` is read before the retry starts it, so the failure still
    // paints on this render; the retry's `Loading` shows on the next one.
    const outcome = resultOf(name, self.state);
    if (outcome._tag === "Loaded") {
      return outcome.component(options);
    }
    if (self.state._tag === "Idle" || self.state._tag === "Failed") {
      void self.preload();
    }
    if (options.fallback === undefined) {
      return "";
    }
    return options.fallback(outcome.result);
  };
  return Object.assign(call, self);
};
