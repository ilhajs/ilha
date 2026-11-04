import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { Cmd, ModelApp, UpdateResult } from "./app";
import { drainCommands, eachCmd } from "./internal";

/**
 * Normalize the `runCommands` input to a command list. Update results
 * without a command run nothing.
 */
const toCmds = <Message, R>(
  input:
    | Cmd<Message, R>
    | readonly Cmd<Message, R>[]
    | UpdateResult<unknown, Message, R>
): readonly Cmd<Message, R>[] => {
  if (Effect.isEffect(input)) {
    return [input];
  }
  if ("model" in input) {
    return input.cmd === undefined ? [] : eachCmd(input.cmd);
  }
  return input;
};

/**
 * Message a command resolves to, excluding `void` results that deliver
 * nothing.
 */
type CommandMessage<T> =
  T extends Effect.Effect<infer M, never, unknown> ? Exclude<M, void> : never;

/**
 * Services a command still requires, excluding the `AtomRegistry` the
 * helpers provide themselves.
 */
type CommandServices<T> =
  T extends Effect.Effect<unknown, never, infer R>
    ? Exclude<R, AtomRegistry.AtomRegistry>
    : never;

/**
 * Run one command without rendering and collect the message it resolves
 * to. Commands run with the app runtime's semantics: `keyed` supersedes
 * per key with the latest winning, defects are logged and dropped, and
 * `void` results produce no message. Provide services with
 * `Effect.provide` and time with `TestClock` from `effect/testing`.
 */
export function runCommands<Message, R>(
  input: Cmd<Message, R>
): Effect.Effect<
  readonly Exclude<Message, void>[],
  never,
  Exclude<R, AtomRegistry.AtomRegistry>
>;
/**
 * Run several commands concurrently, collecting their messages in
 * completion order.
 */
export function runCommands<
  const Cmds extends readonly Cmd<unknown, unknown>[],
>(
  input: Cmds
): Effect.Effect<
  readonly CommandMessage<Cmds[number]>[],
  never,
  CommandServices<Cmds[number]>
>;
/** Run the command of an update result, collecting its messages. */
export function runCommands<Model, Message, R>(
  input: UpdateResult<Model, Message, R>
): Effect.Effect<
  readonly Exclude<Message, void>[],
  never,
  Exclude<R, AtomRegistry.AtomRegistry>
>;
export function runCommands(
  input:
    | Cmd<unknown, unknown>
    | readonly Cmd<unknown, unknown>[]
    | UpdateResult<unknown, unknown, unknown>
): Effect.Effect<readonly unknown[], never, unknown> {
  return Effect.scoped(
    Effect.flatMap(FiberMap.make<string>(), (keyedMap) =>
      Effect.provide(drainCommands(toCmds(input), keyedMap), AtomRegistry.layer)
    )
  );
}

/** Result of {@link simulate}: the final model and every message seen. */
export interface SimulateResult<Model, Message> {
  /** Model after init and every message ran to quiet. */
  readonly model: Model;
  /** Every message `update` saw, in the order it saw them. */
  readonly messages: readonly Message[];
}

/** Options for {@link simulate}. */
export interface SimulateOptions<R, E2 = never> {
  /**
   * Replace the app's layer for this run, for example with test doubles.
   * Must provide the same services the app needs. Defaults to the app's
   * own layer.
   */
  readonly layer?: Layer.Layer<R, E2> | undefined;
}

/**
 * Run an app's loop without rendering: init and its command first, then
 * each input message through `update`, running every resulting command and
 * feeding produced messages back through `update` until quiet. Takes the
 * `ModelApp` from `defineApp` so the layer travels with `init` and
 * `update`. Subscriptions never run here; test them through `update` with
 * the messages their streams would emit. Commands that sleep run on the
 * ambient clock, so `TestClock` from `effect/testing` controls them.
 */
export const simulate = <Model, Message, R, E, E2 = never>(
  app: ModelApp<Model, Message, R, E>,
  inputs: readonly NoInfer<Message>[],
  options?: SimulateOptions<NoInfer<R>, E2> | undefined
): Effect.Effect<SimulateResult<Model, Message>, E | E2> =>
  Effect.scoped(
    Effect.flatMap(FiberMap.make<string>(), (keyedMap) => {
      // SAFETY: a missing layer means the app was defined without one, so R
      // is `never` and `Layer.empty` provides exactly it; a present layer
      // already provides R. The assertion bridges only the optionality,
      // which the type cannot relate back to R.
      const provided = (options?.layer ??
        app.options.layer ??
        Layer.empty) as Layer.Layer<R, E | E2>;
      const drain = (
        cmd: Cmd<Message, R> | readonly Cmd<Message, R>[] | undefined
      ): Effect.Effect<
        readonly Message[],
        never,
        R | AtomRegistry.AtomRegistry
      > =>
        cmd === undefined
          ? Effect.succeed([])
          : drainCommands(eachCmd(cmd), keyedMap);
      return Effect.provide(
        Effect.gen(function* runLoop() {
          const begun = app.options.init();
          const first = yield* drain(begun.cmd);
          let { model } = begun;
          const queue: Message[] = [...first, ...inputs];
          const seen: Message[] = [];
          while (true) {
            const message = queue.shift();
            if (message === undefined) {
              break;
            }
            seen.push(message);
            const { cmd: command, model: next } = app.options.update(
              model,
              message
            );
            model = next;
            const produced = yield* drain(command);
            queue.push(...produced);
          }
          return { messages: seen, model };
        }),
        Layer.merge(provided, AtomRegistry.layer)
      );
    })
  );
