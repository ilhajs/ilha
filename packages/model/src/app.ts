import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Atom from "effect/reactivity/Atom";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import * as Stream from "effect/Stream";
import { atom, untrack, watch } from "ilha";
import type { Component, View } from "ilha";

/**
 * A message sent into the app loop. Messages are serializable data describing
 * facts, never callbacks or class instances, so every transition stays
 * replayable and testable.
 */
export type Slice =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | readonly Slice[]
  | SliceRecord;

/** A JSON-shaped record. An interface so {@link Slice} can recurse. */
export interface SliceRecord {
  readonly [key: string]: Slice | undefined;
}

/** Send a message into the app loop. */
export type Dispatch<Message extends Slice> = (message: Message) => void;

/**
 * One-shot work returned from `update`. Resolve with a follow-up message or
 * with nothing. Provide any extra services with `Effect.provide`; map every
 * failure into a message, since anything that escapes is only logged.
 */
export type Cmd<Message extends Slice> = Effect.Effect<
  // oxlint-disable-next-line typescript/no-invalid-void-type -- `void` is the resolved value of an effect that reports nothing.
  Message | void,
  unknown,
  AtomRegistry
>;

/**
 * What `update` returns: the next model plus optional one-shot work. Several
 * commands run independently of each other.
 */
export interface UpdateResult<Model, Message extends Slice> {
  readonly model: Model;
  readonly cmd?: Cmd<Message> | readonly Cmd<Message>[] | undefined;
}

/** Ongoing work whose lifetime follows `deps(model)`. */
export interface Subscription<Model, Message extends Slice> {
  /** Small JSON-shaped values controlling the lifetime. */
  readonly deps: (model: Model) => Slice;
  /** Stream of messages for the current deps. Restarted when deps change. */
  readonly stream: (
    deps: Slice
  ) => Stream.Stream<Message, unknown, AtomRegistry>;
}

/** Options for {@link defineApp}. */
export interface AppOptions<Model, Message extends Slice, Flags = void> {
  /** Component name shown in `ilha/debug` trees. Default `"ModelApp"`. */
  readonly name?: string | undefined;
  /** Startup input passed to `init`. */
  readonly flags?: Flags | undefined;
  /** Build the first model from flags. Must be pure. */
  readonly init: (flags: Flags) => Model;
  /** The only place state changes. Must be pure. */
  readonly update: (
    model: Model,
    message: Message
  ) => UpdateResult<Model, Message>;
  /** Render the model. Must be pure; report facts with `dispatch`. */
  readonly view: (model: Model, dispatch: Dispatch<Message>) => View;
  /** Ongoing work gated by slices of the model. */
  readonly subscriptions?: readonly Subscription<Model, Message>[] | undefined;
}

/** An Elm-style app: mount `component` like any Ilha component. */
export interface ModelApp<Model, Message extends Slice, Flags = void> {
  readonly component: Component;
  readonly options: AppOptions<Model, Message, Flags>;
}

/**
 * A server has no browser event sources, so subscriptions stay empty there.
 * One shared stream keeps the watch slot key stable across server renders.
 */
const serverStream: Stream.Stream<Slice, unknown, AtomRegistry> = Stream.empty;

interface ComboEntry {
  deps: readonly Slice[];
  stream: Stream.Stream<Slice, unknown, AtomRegistry>;
}

type StateKey<Model> = Atom.Atom<Model>;

/**
 * Combined subscription streams by state atom. A plain cache, not a slot:
 * the stream object must keep its identity while deps are equal so `watch`
 * does not resubscribe, and registry GC must not reset it between renders.
 */
const combos = new WeakMap<object, ComboEntry>();

const comboStream = <Model, Message extends Slice>(
  key: StateKey<Model>,
  subscriptions: readonly Subscription<Model, Message>[],
  model: Model
): Stream.Stream<Slice, unknown, AtomRegistry> => {
  if (typeof window === "undefined") {
    return serverStream;
  }
  const deps = subscriptions.map((sub) => sub.deps(model));
  const prev = combos.get(key);
  if (prev !== undefined && Equal.equals(prev.deps, deps)) {
    return prev.stream;
  }
  const stream = Stream.mergeAll(
    subscriptions.map((sub, index) => sub.stream(deps[index])),
    { concurrency: "unbounded" }
  );
  combos.set(key, { deps, stream });
  return stream;
};

/**
 * Define an Elm-style app. One atom holds the whole model; `dispatch` runs
 * `update` and rerenders; commands run as effects; subscription streams
 * restart when their deps change and stop on unmount.
 */
export const defineApp = <Model, Message extends Slice, Flags = void>(
  options: AppOptions<Model, Message, Flags>
): ModelApp<Model, Message, Flags> => {
  const { init, update, view } = options;
  const subscriptions = options.subscriptions ?? [];
  // SAFETY: flags default to `undefined`, which is the only value of the
  // default `void` Flags; an app that declares flags must pass them.
  const flags = options.flags as Flags;

  const component: Component = () => {
    const state = atom<Model>(init(flags));
    // Command runner: writing an effect starts it. Concurrent commands run
    // independently; each result feeds back into `dispatch`.
    const tasks = atom(
      Atom.fn(
        (cmd: Cmd<Message>) =>
          cmd.pipe(
            Effect.flatMap((out) =>
              Effect.sync(() => {
                if (out !== undefined) {
                  // oxlint-disable-next-line eslint/no-use-before-define -- tasks and dispatch close over each other; the call only runs on writes, after both exist.
                  dispatch(out);
                }
              })
            ),
            Effect.tapCause((cause) =>
              Effect.sync(() => {
                console.error(cause);
              })
            )
          ),
        { concurrent: true }
      )
    );
    // Ilha handles type `set` for plain values; the function-atom argument
    // needs one widening step.
    const setter: unknown = tasks.set;
    const dispatch: Dispatch<Message> = (message) => {
      const result = update(
        untrack(() => state()),
        message
      );
      state.set(result.model);
      if (result.cmd !== undefined) {
        const cmds = Array.isArray(result.cmd) ? result.cmd : [result.cmd];
        for (const cmd of cmds) {
          // SAFETY: the registry writes `Writable<R, W>` with the write
          // input `W`; this recovers the function-atom argument.
          (setter as (cmd: Cmd<Message>) => void)(cmd);
        }
      }
    };
    watch(comboStream(state.atom, subscriptions, state()), (message) => {
      // SAFETY: the combo only carries this app's messages; storage widens
      // them to `Slice` so one cache serves every app.
      dispatch(message as Message);
    });
    // Subscribe the render to the task runner. Function atoms only recompute
    // while something subscribes, so without this read command writes would
    // sit stale and never execute.
    void tasks();
    return view(state(), dispatch);
  };
  Object.defineProperty(component, "name", {
    value: options.name ?? "ModelApp",
  });
  return { component, options };
};
