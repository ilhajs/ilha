import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Atom from "effect/reactivity/Atom";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import type * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { atom, untrack, watch } from "ilha";
import type { Component, View } from "ilha";

/** Send a message into the app loop. */
export type Dispatch<Message> = (message: Message) => void;

/**
 * One-shot work returned from `init` or `update`. Resolve with a follow-up
 * message or with nothing. The `never` error channel forces every expected
 * failure into a message; defects are logged and the island keeps running.
 */
export type Cmd<Message, R = never> = Effect.Effect<
  // oxlint-disable-next-line typescript/no-invalid-void-type -- `void` is the resolved value of an effect that reports nothing.
  Message | void,
  never,
  R | AtomRegistry
>;

/**
 * What `init` and `update` return: the next model plus optional one-shot
 * work. Several commands run concurrently with each other.
 */
export interface UpdateResult<Model, Message, R = never> {
  readonly model: Model;
  readonly cmd?: Cmd<Message, R> | readonly Cmd<Message, R>[] | undefined;
}

/**
 * Ongoing work whose lifetime follows `deps(model)`. Build entries with
 * {@link subscription} so each one keeps its own `Deps` type.
 */
export interface Subscription<Model, Message, Deps, R = never> {
  /** Values controlling the lifetime; the stream restarts when they change. */
  readonly deps: (model: Model) => Deps;
  /** Stream of messages for the current deps. Restarted when deps change. */
  readonly stream: (
    deps: Deps
  ) => Stream.Stream<Message, never, R | AtomRegistry>;
}

/**
 * Name one subscription. Each entry infers its own `Deps` from its `deps`
 * function, so `stream` receives the exact type its deps return. Annotate
 * the model parameter; everything else infers.
 */
export const subscription = <Model, Message, Deps, R = never>(
  sub: Subscription<Model, Message, Deps, R>
): Subscription<Model, Message, Deps, R> => sub;

/** Options for {@link defineApp}. */
export interface AppOptions<Model, Message, R = never, E = never> {
  /** Component name shown in `ilha/debug` trees. Default `"ModelApp"`. */
  readonly name?: string | undefined;
  /**
   * Build the first model, plus an optional start-up command. Must be pure.
   * Runs once per instance; the command runs once per client mount, never
   * during server rendering.
   */
  readonly init: () => UpdateResult<Model, Message, R>;
  /** The only place state changes. Must be pure. */
  readonly update: (
    model: Model,
    message: Message
  ) => UpdateResult<Model, Message, R>;
  /** Render the model. Must be pure; report facts with `dispatch`. */
  readonly view: (model: Model, dispatch: Dispatch<Message>) => View;
  /** Ongoing work gated by slices of the model. */
  readonly subscriptions?:
    // oxlint-disable-next-line typescript/no-explicit-any -- each entry keeps its own Deps via `subscription()`; the array only checks Model, Message, and R.
    readonly Subscription<Model, Message, any, R>[] | undefined;
  /** Services available to commands and subscriptions. */
  readonly layer?: Layer.Layer<R, E> | undefined;
  /**
   * Codec for the model snapshot. Without it the model must be JSON-safe;
   * with it, values like `Date` survive server rendering into hydration.
   */
  readonly schema?: Schema.ConstraintCodec<Model, unknown> | undefined;
}

/** An Elm-style app: mount `component` like any Ilha component. */
export interface ModelApp<Model, Message, R = never, E = never> {
  readonly component: Component;
  readonly options: AppOptions<Model, Message, R, E>;
}

/**
 * Split one or many commands. Internal: shared with `submodel`, not part of
 * the package surface. `Effect.isEffect` narrows the union where
 * `Array.isArray` cannot, so no assertion is needed.
 */
export const eachCmd = <Message, R>(
  cmd: Cmd<Message, R> | readonly Cmd<Message, R>[]
): readonly Cmd<Message, R>[] => (Effect.isEffect(cmd) ? [cmd] : cmd);

/**
 * Per-instance keyed-command scope. The runner provides it around every
 * command; `keyed` reads it back without adding a service requirement.
 */
const KeyedScope = Context.Service<FiberMap.FiberMap<string, unknown, unknown>>(
  "ilha/model/KeyedScope"
);

/**
 * Latest-wins command: starting one interrupts the running command with the
 * same key, so only the latest result dispatches. Different keys run
 * independently. Keys are per app instance: two mounted instances never
 * share them.
 */
export const keyed = <Message, R>(
  key: string,
  cmd: Cmd<Message, R>
): Cmd<Message, R> =>
  Effect.flatMap(Effect.serviceOption(KeyedScope), (scope) =>
    scope._tag === "None"
      ? cmd
      : Effect.flatMap(FiberMap.run(scope.value, key, cmd), (fiber) =>
          Fiber.join(fiber)
        )
  );

/**
 * Report an unexpected cause through the Effect logger. Interruption
 * (unmount, keyed supersede, subscription restart) is silent; anything else
 * is a defect worth logging.
 */
const reportCause = (cause: Cause.Cause<never>): Effect.Effect<void> =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.void
    : Effect.logError(Cause.pretty(cause));

/** Per-instance command machinery, created once in a lazy slot. */
interface InstanceCells<Message, R> {
  /** Set once commands and subscriptions start on the client. */
  started: boolean;
  /** Cleared on unmount; `dispatch` checks it before touching the registry. */
  alive: boolean;
  /** Latest-wins scopes for {@link keyed}, closed on unmount. */
  readonly keyedMap: FiberMap.FiberMap<string, unknown, unknown>;
  readonly keyedScope: Scope.Closeable;
  /**
   * Every command flows through here, so nothing is lost while the layer
   * still builds.
   */
  readonly queue: Queue.Queue<Cmd<Message, R>>;
}

const makeInstanceCells = <Message, R>(): InstanceCells<Message, R> => {
  const keyedScope = Effect.runSync(Scope.make());
  const keyedMap = Effect.runSync(
    Effect.provideService(FiberMap.make<string>(), Scope.Scope, keyedScope)
  );
  const queue = Effect.runSync(Queue.unbounded<Cmd<Message, R>>());
  return { alive: true, keyedMap, keyedScope, queue, started: false };
};

/**
 * Log a defect and end the stream quietly. Interruption passes through so
 * restarts and unmount stay silent.
 */
const quietOnDefect = <Message>(
  cause: Cause.Cause<never>
): Stream.Stream<Message> =>
  Cause.hasInterruptsOnly(cause)
    ? Stream.failCause(cause)
    : Stream.unwrap(
        Effect.as(Effect.logError(Cause.pretty(cause)), Stream.empty)
      );

/**
 * One subscription's restartable stream: the model feeds `deps`, equal deps
 * keep the stream alive, changed deps restart it. A defect in the stream for
 * the current deps is logged and silences only that stream, so the next
 * deps change starts a fresh one. A defect in `deps` itself is logged and
 * ends the subscription.
 */
const watchOne = <Model, Message, R>(
  stateAtom: Atom.Atom<Model>,
  // oxlint-disable-next-line typescript/no-explicit-any -- each entry keeps its own Deps via `subscription()`; the runner only feeds deps back into the same entry's stream.
  sub: Subscription<Model, Message, any, R>
): Stream.Stream<Message, never, R | AtomRegistry> =>
  Atom.toStream(stateAtom).pipe(
    Stream.map((model) => sub.deps(model)),
    Stream.changesWith(Equal.equals),
    Stream.switchMap((deps) =>
      Stream.suspend(() => sub.stream(deps)).pipe(
        Stream.catchCause(quietOnDefect<Message>)
      )
    ),
    Stream.catchCause(quietOnDefect<Message>)
  );

/**
 * Merge every subscription into one stream, built once per app instance.
 * Each entry restarts only on its own deps; entries never disturb each
 * other.
 */
const mergeSubscriptions = <Model, Message, R>(
  stateAtom: Atom.Atom<Model>,
  // oxlint-disable-next-line typescript/no-explicit-any -- each entry keeps its own Deps via `subscription()`; the merge only runs the streams.
  subscriptions: readonly Subscription<Model, Message, any, R>[]
): Stream.Stream<Message, never, R | AtomRegistry> =>
  Stream.mergeAll(
    subscriptions.map((sub) => watchOne(stateAtom, sub)),
    { concurrency: "unbounded" }
  );

/** Services an effect still requires. */
type EffectNeeds<T> =
  T extends Effect.Effect<unknown, unknown, infer R> ? R : never;

/** Services one command, or one command list, still requires. */
type CmdNeeds<T> = T extends readonly (infer Each)[]
  ? EffectNeeds<Each>
  : EffectNeeds<T>;

/** Services an `init` or `update` result still requires. */
type UpdateNeeds<T> = T extends { cmd?: infer C }
  ? CmdNeeds<Exclude<C, undefined>>
  : never;

/** Services one subscription entry still requires. */
type SubNeeds<T> = T extends {
  stream: (...args: never[]) => Stream.Stream<unknown, unknown, infer R>;
}
  ? R
  : never;

/** Every service the app's commands and subscriptions still require. */
type OptionsNeeds<O> =
  | (O extends { init: (...args: never[]) => infer Ret }
      ? UpdateNeeds<Ret>
      : never)
  | (O extends { update: (...args: never[]) => infer Ret }
      ? UpdateNeeds<Ret>
      : never)
  | (O extends { subscriptions?: infer S }
      ? S extends readonly (infer Each)[]
        ? SubNeeds<Each>
        : never
      : never);

/**
 * Reject commands and subscriptions that need services outside the layer.
 * The runtime always provides `AtomRegistry`; anything else must come from
 * `layer`. Evaluated after `O` and `L` are fixed, so inference never sees
 * the layer's services through this check.
 */
type CheckServices<O, L extends Layer.Any> =
  OptionsNeeds<O> extends infer Needs
    ? [Needs] extends [Layer.Success<L> | AtomRegistry]
      ? unknown
      : {
          "services missing from layer": Exclude<
            Needs,
            Layer.Success<L> | AtomRegistry
          >;
        }
    : never;

/**
 * What `defineApp` infers `Model` and `Message` from. Command and stream
 * requirements stay permissive here so inference never forces the layer
 * type early; `CheckServices` validates coverage after, and the layer
 * itself is captured by `{ layer?: L }`.
 */
type LooseOptions<Model, Message> = Omit<
  // oxlint-disable-next-line typescript/no-explicit-any -- permissive requirements; CheckServices validates coverage after inference.
  AppOptions<Model, Message, any, any>,
  "layer"
>;

/**
 * Define an Elm-style app. One atom holds the whole model; `dispatch` runs
 * `update` and rerenders; commands run concurrently inside the app runtime;
 * each subscription restarts only when its own deps change and stops on
 * unmount.
 */
export const defineApp = <
  Model,
  Message,
  L extends Layer.Any = Layer.Layer<never, never>,
  O extends LooseOptions<Model, Message> = LooseOptions<Model, Message>,
>(
  options: LooseOptions<Model, Message> &
    O & { layer?: L | undefined } & CheckServices<O, L>
): ModelApp<Model, Message, Layer.Success<L>, Layer.Error<L>> => {
  type R = Layer.Success<L>;
  const { init, update, view } = options;
  const subscriptions = options.subscriptions ?? [];
  const provided: Layer.Any = options.layer ?? Layer.empty;
  // SAFETY: R and E are computed from the layer type, so an absent layer
  // means both are `never` and `Layer.empty` is exactly `Layer<R, E>`; a
  // present layer already has that type. The assertion bridges only the
  // generic `L`, which never narrows back to `Layer<R, E>` on its own.
  const runtime = Atom.runtime<Layer.Success<L>, Layer.Error<L>>(
    provided as Layer.Layer<Layer.Success<L>, Layer.Error<L>>
  );

  const component: Component = () => {
    const initResult = atom.lazy(() => init(), { snapshot: false });
    const state = atom.lazy(() => untrack(() => initResult()).model, {
      schema: options.schema,
    });
    const cells = atom.lazy(() => makeInstanceCells<Message, R>(), {
      snapshot: false,
    });
    // Wrapped in a plain object: `Atom.make` runs a top-level stream as an
    // async atom instead of holding it still.
    const merged = atom.lazy(
      () => ({ stream: mergeSubscriptions(state.atom, subscriptions) }),
      { snapshot: false }
    );

    // The registry is disposed on unmount, so a command that finishes in the
    // gap reads a dead registry; that means unmounted, not broken.
    const isAlive = (): boolean => {
      try {
        return untrack(() => cells()).alive;
      } catch {
        return false;
      }
    };

    const dispatch: Dispatch<Message> = (message) => {
      if (!isAlive()) {
        return;
      }
      const result = update(
        untrack(() => state()),
        message
      );
      state.set(result.model);
      if (result.cmd !== undefined) {
        const { queue } = untrack(() => cells());
        for (const cmd of eachCmd(result.cmd)) {
          Queue.offerUnsafe(queue, cmd);
        }
      }
    };

    // Read once per render: the registry is live while rendering, and the
    // map never changes, so commands never touch the registry for it.
    const { keyedMap } = untrack(() => cells());
    const runOne = (
      cmd: Cmd<Message, R>
    ): Effect.Effect<void, never, R | AtomRegistry> =>
      Effect.provideService(
        Effect.catchCause(
          cmd.pipe(
            Effect.flatMap((out) =>
              out === undefined ? Effect.void : Effect.sync(() => dispatch(out))
            )
          ),
          reportCause
        ),
        KeyedScope,
        keyedMap
      );

    // One drain runs every queued command in its own fiber. It is a plain
    // `Atom.fn` that reads the app runtime only once it runs: `runtime.fn`
    // would read the runtime atom on every render, building the layer during
    // server rendering too. The client starts the drain with one write; the
    // queue holds commands until the layer is ready.
    const runner = atom(
      Atom.fn((queue: Queue.Queue<Cmd<Message, R>>, get) =>
        Effect.flatMap(get.result(runtime), (services) =>
          Effect.provideContext(
            Effect.forever(
              Effect.flatMap(Queue.take(queue), (cmd) =>
                Effect.forkChild(runOne(cmd))
              )
            ),
            services
          )
        )
      )
    );
    // The drain loops forever, so it only settles on a layer failure or a
    // defect.
    const runnerFailure = atom(
      runner.atom.pipe(
        Atom.map((result) =>
          result._tag === "Failure" && !Cause.hasInterruptsOnly(result.cause)
            ? Cause.pretty(result.cause)
            : ""
        )
      )
    );

    // The render subscribes to the runner so the drain survives: an atom
    // nothing subscribes to is garbage-collected, which would interrupt
    // long-running commands and subscriptions.
    void runner();
    watch(runnerFailure, (failure) => {
      if (failure !== "") {
        Effect.runSync(Effect.logError(failure));
      }
    });
    watch.once(({ ssr }) => {
      const helpers = untrack(() => cells());
      // `watch.once` also runs during server rendering; commands,
      // subscriptions, and the layer are client work.
      if (!ssr && !helpers.started) {
        helpers.started = true;
        const begin = untrack(() => initResult()).cmd;
        if (begin !== undefined) {
          for (const cmd of eachCmd(begin)) {
            Queue.offerUnsafe(helpers.queue, cmd);
          }
        }
        if (subscriptions.length > 0) {
          Queue.offerUnsafe(
            helpers.queue,
            Stream.runForEach(untrack(() => merged()).stream, (message) =>
              Effect.catchCause(
                Effect.sync(() => dispatch(message)),
                reportCause
              )
            )
          );
        }
        runner.set(helpers.queue);
      }
      return () => {
        helpers.alive = false;
        Effect.runFork(Scope.close(helpers.keyedScope, Exit.void));
      };
    });
    return view(state(), dispatch);
  };
  Object.defineProperty(component, "name", {
    value: options.name ?? "ModelApp",
  });
  // SAFETY: `options` satisfies `AppOptions` with the computed R and E by
  // construction (CheckServices validated coverage at the call site); only
  // the generic `L` cannot be related back to `Layer<R, E>` here.
  return {
    component,
    options: options as AppOptions<
      Model,
      Message,
      Layer.Success<L>,
      Layer.Error<L>
    >,
  };
};
