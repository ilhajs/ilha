import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Atom from "effect/reactivity/Atom";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { atom, h, untrack, watch } from "ilha";
import type { View } from "ilha";

import type { Issued } from "./command";
import type { InitDollar, Step, UpdateDollar } from "./internal";
import {
  createStep,
  initDollar,
  isStepValue,
  quietStream,
  reportCause,
  updateDollar,
} from "./internal";
import { isRecording, recordDispatch } from "./log";
import type { Subscription } from "./subscription";

export type { Step } from "./internal";

/** Shallow patch: each field is a value, or an updater from the previous. */
export type { EvolvePatch } from "./internal";

/** Exhaustive record: one handler per message tag. */
type UpdateHandlers<
  Model,
  Msg extends { readonly _tag: string },
  Props,
  Events,
> = {
  readonly [Tag in Msg["_tag"]]: (
    dollar: UpdateDollar<Model, Msg, Props, Events>,
    message: Extract<Msg, { readonly _tag: Tag }>
    // oxlint-disable-next-line typescript/no-explicit-any -- permissive requirements; the literal type keeps them concrete for CheckServices (mirrors main).
  ) => Model | Step<Model, Msg, any, Events>;
};

/** `h` in `view`: Ilha's `h`, plus the component's props and helpers. */
type Helper<Props, Msg> = typeof h & {
  readonly props: Props;
  readonly send: {
    /** Send a fixed message; the argument is ignored. */
    (message: Msg): () => void;
    /** Map an argument to a message; `undefined` sends nothing. */
    <A>(fromArg: (arg: A) => Msg | undefined): (arg?: A) => void;
  };
  /** Whether the command has a running issue in this instance. Reactive. */
  readonly isRunning: (command: { readonly name: string }) => boolean;
};

type SendMapper<Msg> = (arg?: never) => Msg | undefined;

const isSendMapper = <Msg>(
  value: Msg | SendMapper<Msg>
): value is SendMapper<Msg> => typeof value === "function";
interface CallOptions<Props, Events> {
  readonly props: Props;
  readonly onEmit?: ((event: Events) => void) | undefined;
  readonly key?: string | number | undefined;
}

type RenderOptions<Props, Events> =
  Record<never, never> extends Props
    ? {
        readonly props?: Props | undefined;
        readonly onEmit?: ((event: Events) => void) | undefined;
        readonly key?: string | number | undefined;
      }
    : CallOptions<Props, Events>;

/**
 * A component built by `defineComponent(...).make(...)`: an ordinary Ilha
 * typed-props component taking `{ props, onEmit? }` (`props` required iff
 * a props schema was given; `key` is Ilha's). Each mounted instance owns
 * its own model atom; a child re-renders without re-running its parent.
 * The definition and impl travel on the component for `Story`.
 */
export interface ModelComponent<
  Props = Record<never, never>,
  Events = never,
  Model = unknown,
  Msg = unknown,
> {
  (options: RenderOptions<Props, Events>): View;
  /** Definition and impl travel on the component for `Story`. */
  readonly definition: Definition<Props, Model, Msg, Events>;
  readonly impl: unknown;
}

interface Definition<Props, Model, Msg, Events> {
  readonly name: string;
  readonly props: Schema.ConstraintDecoder<Props>;
  readonly model: Schema.ConstraintCodec<Model, unknown>;
  readonly message: Schema.Schema<Msg>;
  readonly events: Schema.Schema<Events>;
}

interface MakeImpl<
  Model,
  Msg extends { readonly _tag: string },
  Props,
  Events,
> {
  readonly init: (
    dollar: InitDollar<Model, Msg, Props, Events>,
    props: Props
    // oxlint-disable-next-line typescript/no-explicit-any -- permissive requirements; see UpdateHandlers.
  ) => Model | Step<Model, Msg, any, Events>;
  readonly update: UpdateHandlers<Model, Msg, Props, Events>;
  readonly view: (h: Helper<Props, Msg>, model: Model) => View;
  readonly subscriptions?:
    | ((
        model: Model,
        props: Props
        // oxlint-disable-next-line typescript/no-explicit-any -- each entry keeps its own Deps and requirements via Subscription.make; the literal type keeps them concrete for CheckServices (mirrors main).
      ) => readonly Subscription<Model, Props, Msg, any, any>[])
    | undefined;
}

/** Services an `init` or `update` return still requires. */
type StepServices<S> = S extends {
  readonly commands: readonly Issued<unknown, infer R>[];
}
  ? R
  : never;

type UpdateServices<U> =
  U extends Record<string, (dollar: never, message: never) => infer Ret>
    ? StepServices<Ret>
    : never;

type InitServices<F> = F extends (dollar: never, props: never) => infer Ret
  ? StepServices<Ret>
  : never;

type SubServices<S> = S extends (
  model: never,
  props: never
) => readonly (infer E)[]
  ? E extends {
      readonly run: (deps: never) => Stream.Stream<unknown, never, infer R>;
    }
    ? R
    : never
  : never;

/** Every service the component's commands and subscriptions still require. */
type ImplNeeds<I> = I extends {
  readonly update: infer U;
  readonly init: infer F;
}
  ?
      | UpdateServices<U>
      | InitServices<F>
      | (I extends { readonly subscriptions: infer S }
          ? SubServices<Exclude<S, undefined>>
          : never)
  : never;

/**
 * Reject commands and subscriptions that need services outside the layer.
 * The runtime always provides `AtomRegistry`; anything else must come
 * from `layer`.
 */
type CheckServices<Needs, L extends Layer.Any> = [Needs] extends [
  Layer.Success<L> | AtomRegistry,
]
  ? unknown
  : {
      "services missing from layer": Exclude<
        Needs,
        Layer.Success<L> | AtomRegistry
      >;
    };

interface Job<R> {
  readonly name: string;
  readonly mode: "concurrent" | "switch";
  readonly run: Effect.Effect<void, never, R | AtomRegistry>;
}

interface Cells<R> {
  alive: boolean;
  started: boolean;
  queue: Queue.Queue<Job<R>>;
  switches: Map<string, Fiber.Fiber<void, never>>;
  generations: Map<string, number>;
}

interface SwitchCell {
  current?: Fiber.Fiber<void, never> | undefined;
}

/**
 * What `defineComponent` returns: `make(impl)` builds the component.
 * `layer` defaults to empty; `CheckServices` proves the layer covers
 * every service `init`, Commands, and Subscriptions need.
 */
export interface ComponentMaker<
  Model,
  Msg extends { readonly _tag: string },
  Props,
  Events,
> {
  make: <
    L extends Layer.Any = Layer.Layer<never, never>,
    I extends MakeImpl<Model, Msg, Props, Events> = MakeImpl<
      Model,
      Msg,
      Props,
      Events
    >,
  >(
    impl: MakeImpl<Model, Msg, Props, Events> &
      I & {
        readonly layer?: L | undefined;
      } & CheckServices<ImplNeeds<I>, L>
  ) => ModelComponent<Props, Events, Model, Msg>;
}

/**
 * Define a component. `model` is also the SSR snapshot codec; `message`
 * is usually a `Schema.TaggedUnion`. Returns `{ make(impl) }`; `make`
 * returns a `ModelComponent` usable as an Ilha component or JSX tag.
 */
export const defineComponent = <
  const Name extends string,
  Props,
  Model,
  Msg extends { readonly _tag: string },
  Events = never,
>(
  options: {
    readonly name: Name;
    readonly model: Schema.ConstraintCodec<Model, unknown>;
    readonly message: Schema.Schema<Msg>;
    readonly events?: Schema.Schema<Events> | undefined;
  } & (Record<never, never> extends Props
    ? { readonly props?: Schema.ConstraintDecoder<Props> | undefined }
    : { readonly props: Schema.ConstraintDecoder<Props> })
): ComponentMaker<Model, Msg, Props, Events> => {
  // SAFETY: `props` is present exactly when Props is non-empty (see the
  // options type above); the cast recovers the optional view.
  const withProps = options as {
    readonly props?: Schema.ConstraintDecoder<Props> | undefined;
  };
  // SAFETY: without a props schema, Props is `{}`; the empty struct
  // decodes it.
  const emptyProps = Schema.Struct({}) as unknown;
  // SAFETY: withProps carries a Props decoder, or emptyProps stands in.
  const propsSchema =
    withProps.props ?? (emptyProps as Schema.ConstraintDecoder<Props>);
  const definition: Definition<Props, Model, Msg, Events> = {
    events: options.events ?? Schema.Never,
    message: options.message,
    model: options.model,
    name: options.name,
    props: propsSchema,
  };

  const make = <
    L extends Layer.Any,
    I extends MakeImpl<Model, Msg, Props, Events>,
  >(
    impl: MakeImpl<Model, Msg, Props, Events> &
      I & { readonly layer?: L | undefined }
  ): ModelComponent<Props, Events, Model, Msg> => {
    type E = Layer.Error<L>;
    const modelSchema = definition.model;
    // SAFETY: an absent layer means `L` is `Layer<never, never>` and
    // `Layer.empty` provides exactly that; a present layer already fits
    // after CheckServices validated its coverage (mirrors main).
    const provided: Layer.Any = impl.layer ?? Layer.empty;
    const runtime = Atom.runtime<Layer.Success<L>, E>(
      // SAFETY: `provided` is the layer above, typed for the runtime (mirrors main).
      provided as Layer.Layer<Layer.Success<L>, E>
    );

    const render = (
      callOptions?: RenderOptions<Props, Events> | null
    ): View => {
      const rawProps = { ...callOptions?.props };
      const onEmit = callOptions?.onEmit;

      const propsState = atom.lazy(
        () => ({
          onEmit,
          props: Schema.decodeSync(propsSchema)(rawProps),
          raw: rawProps,
        }),
        { snapshot: false }
      );
      const known = untrack(() => propsState());
      // The spread above is always a fresh object; skip decoding when the
      // parent passed an equal props bag.
      if (known.onEmit !== onEmit || !Equal.equals(known.raw, rawProps)) {
        propsState.set({
          onEmit,
          props: Schema.decodeSync(propsSchema)(rawProps),
          raw: rawProps,
        });
      }

      const initResult = atom.lazy(
        () => {
          const { props } = untrack(() => propsState());
          const dollar = initDollar<Model, Msg, Props, Events>(props);
          const out = impl.init(dollar, props);
          // SAFETY: a non-step return is the bare model; the init type guarantees it.
          return isStepValue(out)
            ? out
            : createStep<Model, Msg, never, Events>(out as Model);
        },
        { snapshot: false }
      );

      const state = atom.lazy<Model>(() => untrack(() => initResult()).model, {
        schema: modelSchema,
      });

      const cells = atom.lazy<Cells<Layer.Success<L>>>(
        () => ({
          alive: true,
          generations: new Map<string, number>(),
          queue: Effect.runSync(Queue.unbounded<Job<Layer.Success<L>>>()),
          started: false,
          switches: new Map<string, Fiber.Fiber<void, never>>(),
        }),
        { snapshot: false }
      );

      const counts = atom.lazy<Record<string, number>>(() => ({}), {
        snapshot: false,
      });

      // The combo's lazy init re-reads the current model and props, so a
      // drain that starts before the first `combo.set` below still sees a
      // consistent value; every render refreshes it after client start-up.
      const combo = atom.lazy(
        () => {
          const live = untrack(() => state());
          const { props: liveProps } = untrack(() => propsState());
          return {
            model: live,
            props: liveProps,
            subs: impl.subscriptions?.(live, liveProps) ?? [],
          };
        },
        { snapshot: false }
      );

      // Subscription fibers by name. `manageEntries` keeps them matching
      // the latest list, so an entry restarts only when its own deps change
      // (compared with `Equal.equals`) and stops only when removed.
      const activeSubs = new Map<
        string,
        { readonly deps: unknown; readonly fiber: Fiber.Fiber<void, never> }
      >();
      const manageEntries = (
        latest: {
          readonly model: Model;
          readonly props: Props;
          // oxlint-disable-next-line typescript/no-explicit-any -- each entry keeps its own Deps via Subscription.make; the manager only feeds deps back into the same entry (mirrors main).
          readonly subs: readonly Subscription<Model, Props, Msg, any, any>[];
        },
        outbox: Queue.Queue<Msg>
      ): Effect.Effect<
        void,
        never,
        Layer.Success<L> | AtomRegistry | Scope.Scope
      > =>
        Effect.gen(function* manage() {
          const seen = new Set<string>();
          for (const entry of latest.subs) {
            seen.add(entry.name);
            const deps = entry.depsOf(latest.model, latest.props);
            const current = activeSubs.get(entry.name);
            if (current !== undefined && Equal.equals(current.deps, deps)) {
              continue;
            }
            if (current !== undefined) {
              yield* Fiber.interrupt(current.fiber);
            }
            const fiber = yield* Effect.forkScoped(
              Stream.runForEach(
                Stream.suspend(() => entry.run(deps)).pipe(
                  Stream.catchCause(quietStream<Msg>)
                ),
                (message) => Queue.offer(outbox, message)
              )
            );
            activeSubs.set(entry.name, { deps, fiber });
          }
          for (const [name, current] of activeSubs) {
            if (!seen.has(name)) {
              yield* Fiber.interrupt(current.fiber);
              activeSubs.delete(name);
            }
          }
        });

      // The registry is disposed on unmount, so a command that finishes in
      // the gap reads a dead registry; that means unmounted, not broken.
      const isAlive = (): boolean => {
        try {
          return untrack(() => cells()).alive;
        } catch {
          return false;
        }
      };

      const toJob = <R2>(
        issued: Issued<Msg, R2>,
        deliver: (message: Msg) => void
      ): Job<Layer.Success<L>> => {
        // A switch issue supersedes synchronously at dispatch: bump the
        // command's generation now, so an older issue resolving later finds
        // a stale generation and its message is dropped.
        let guarded = deliver;
        if (issued.mode === "switch") {
          const { generations } = untrack(() => cells());
          const generation = (generations.get(issued.name) ?? 0) + 1;
          generations.set(issued.name, generation);
          guarded = (message) => {
            if (
              untrack(() => cells()).generations.get(issued.name) === generation
            ) {
              deliver(message);
            }
          };
        }
        // SAFETY: CheckServices proved every command's requirements are in
        // the layer; the runner provides them plus the AtomRegistry.
        const run = Effect.catchCause(
          Effect.flatMap(issued.body(), (outcome) =>
            outcome === undefined
              ? Effect.void
              : Effect.sync(() => guarded(outcome))
          ),
          reportCause
        ) as Effect.Effect<void, never, Layer.Success<L> | AtomRegistry>;
        return { mode: issued.mode, name: issued.name, run };
      };

      const dispatch = (message: Msg): void => {
        if (!isAlive()) {
          return;
        }
        const { props: liveProps } = untrack(() => propsState());
        const before = untrack(() => state());
        // SAFETY: `update` is an exhaustive per-tag record; a missing tag is
        // a type error at `make`, so the string lookup always finds a handler.
        const handlers: Record<
          string,
          (
            dollar: never,
            message: never
          ) => Model | Step<Model, Msg, unknown, Events>
        > = impl.update;
        const handler = handlers[message._tag];
        if (handler === undefined) {
          throw new Error(
            `${definition.name}: no update for "${message._tag}"`
          );
        }
        const dollar = updateDollar<Model, Msg, Props, Events>(
          before,
          liveProps
        );
        let out: Model | Step<Model, Msg, unknown, Events>;
        try {
          // SAFETY: the tag-selected handler receives exactly its variant message.
          out = handler(dollar as never, message as never);
        } catch (error) {
          // An update throw is a defect like a command failure: log it and
          // keep the last model, so the instance stays interactive.
          Effect.runSync(Effect.logError(Cause.pretty(Cause.die(error))));
          return;
        }
        // SAFETY: a non-step return is the bare model; the handler type guarantees it.
        const step = isStepValue(out)
          ? out
          : createStep<Model, Msg, never, Events>(out as Model);
        state.set(step.model);
        let started = 0;
        if (step.commands.length > 0) {
          const { queue } = untrack(() => cells());
          for (const issued of step.commands) {
            Queue.offerUnsafe(queue, toJob(issued, dispatch));
          }
          started = step.commands.length;
        }
        // One size check when no recorder is attached: no record, nothing
        // allocated, the message and both models untouched. (mirrors main)
        if (isRecording()) {
          recordDispatch({
            after: step.model,
            before,
            commands: started,
            instance: state.atom,
            message,
          });
        }
        if (step.events.length > 0) {
          const emit = untrack(() => propsState()).onEmit;
          if (emit !== undefined) {
            for (const event of step.events) {
              emit(event);
            }
          }
        }
      };

      const bump = (name: string, delta: number): void => {
        counts.update((previous) => ({
          ...previous,
          [name]: (previous[name] ?? 0) + delta,
        }));
      };

      // Every job runs as a scope-owned fiber: it outlives the drain
      // iteration that started it and dies on unmount with the rest.
      // `switch` interrupts the instance's running issue of the same
      // command; `concurrent` lets every issue run.
      const runJob = (
        job: Job<Layer.Success<L>>
      ): Effect.Effect<
        void,
        never,
        Layer.Success<L> | AtomRegistry | Scope.Scope
      > =>
        job.mode === "switch"
          ? Effect.gen(function* runSwitch() {
              const { switches } = untrack(() => cells());
              const previous = switches.get(job.name);
              if (previous !== undefined) {
                yield* Fiber.interrupt(previous);
              }
              bump(job.name, 1);
              const cell: SwitchCell = {};
              const fiber = yield* Effect.forkScoped(
                Effect.ensuring(
                  job.run,
                  Effect.sync(() => {
                    bump(job.name, -1);
                    if (switches.get(job.name) === cell.current) {
                      switches.delete(job.name);
                    }
                  })
                )
              );
              cell.current = fiber;
              switches.set(job.name, fiber);
            })
          : Effect.flatMap(
              Effect.sync(() => bump(job.name, 1)),
              () =>
                Effect.forkScoped(
                  Effect.ensuring(
                    job.run,
                    Effect.sync(() => bump(job.name, -1))
                  )
                )
            );

      const subEffect: Effect.Effect<
        void,
        never,
        Layer.Success<L> | AtomRegistry | Scope.Scope
      > = Effect.flatMap(Queue.unbounded<Msg>(), (outbox) =>
        Stream.runForEach(
          Stream.mergeAll(
            [
              Stream.fromQueue(outbox),
              Atom.toStream(combo.atom).pipe(
                Stream.tap((latest) => manageEntries(latest, outbox)),
                Stream.flatMap(() => Stream.empty)
              ),
            ],
            { concurrency: "unbounded" }
          ),
          (message) =>
            Effect.catchCause(
              Effect.sync(() => dispatch(message)),
              reportCause
            )
        )
      );

      // One drain runs every queued command in its own fiber, alongside
      // the subscription stream. Plain `Atom.fn` reads the app runtime
      // only once it runs: `runtime.fn` would read the runtime atom on
      // every render, building the layer during server rendering too.
      // (mirrors main)
      const runner = atom(
        Atom.fn((queue: Queue.Queue<Job<Layer.Success<L>>>, get) =>
          Effect.flatMap(get.result(runtime), (services) =>
            Effect.provideContext(
              Effect.scoped(
                Effect.flatMap(Effect.forkScoped(subEffect), () =>
                  Effect.forever(Effect.flatMap(Queue.take(queue), runJob))
                )
              ),
              services
            )
          )
        )
      );
      // The drain loops forever, so it only settles on a layer failure or
      // a defect.
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
          const begun = untrack(() => initResult());
          for (const issued of begun.commands) {
            Queue.offerUnsafe(helpers.queue, toJob(issued, dispatch));
          }
          if (begun.events.length > 0) {
            const emit = untrack(() => propsState()).onEmit;
            if (emit !== undefined) {
              for (const event of begun.events) {
                emit(event);
              }
            }
          }
          runner.set(helpers.queue);
        }
        return () => {
          helpers.alive = false;
        };
      });

      // Read the model after client start-up: a synchronously resolving
      // init command dispatches before render deps subscribe, so reading
      // here paints the post-command model (mirrors main's
      // `view(state(), dispatch)` after `watch.once`).
      const model = state();
      const { props } = untrack(() => propsState());
      const subs = impl.subscriptions?.(model, props) ?? [];
      const seen = new Set<string>();
      for (const sub of subs) {
        if (seen.has(sub.name)) {
          throw new Error(
            `${definition.name}: duplicate subscription "${sub.name}"`
          );
        }
        seen.add(sub.name);
      }
      combo.set({ model, props, subs });

      // SAFETY: the implementation covers both `send` overloads; the cast restores them for views.
      const send = ((input: Msg | SendMapper<Msg>): ((arg?: never) => void) => {
        if (isSendMapper(input)) {
          return (arg?: never): void => {
            const resolved = input(arg);
            if (resolved !== undefined) {
              dispatch(resolved);
            }
          };
        }
        return (): void => {
          dispatch(input);
        };
      }) as Helper<Props, Msg>["send"];

      const isRunning = (command: { readonly name: string }): boolean =>
        (counts()[command.name] ?? 0) > 0;

      // A fresh callable with Ilha's overloads, delegating to the real
      // `h`: mutating the shared `h` would leak props between instances.
      // SAFETY: `never` params accept every call the overloads accept; the
      // wrapper delegates to the real `h`, and the cast restores its
      // overloads for views.
      const callH = ((node: never, attrs: never, ...rest: View[]): View =>
        h(node, attrs, ...rest)) as typeof h;
      const viewH = Object.assign(callH, { isRunning, props, send });
      return impl.view(viewH, model);
    };

    const component = render;
    Object.defineProperty(component, "name", { value: definition.name });
    return Object.assign(component, { definition, impl });
  };

  return { make };
};
