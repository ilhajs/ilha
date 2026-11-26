import type * as Effect from "effect/Effect";

/**
 * One-shot work a component issues from `init` or `update`, started with
 * `$.run(...)`. Resolves with a follow-up message or with nothing. The
 * `never` error channel forces every expected failure into a message;
 * defects are logged and the instance keeps running.
 */

// oxlint-disable-next-line typescript/no-invalid-void-type -- `void` is the resolved value of an effect that reports nothing.
export type MaybeMessage<Msg> = Msg | void;

/** How the instance treats a new issue while one is still running. */
export type CommandMode = "concurrent" | "switch";

export interface CommandOptions {
  readonly mode?: CommandMode;
}

/** A pending issue: the command plus the args it was issued with. */
export interface Issued<Msg = never, R = never> {
  /** The command's name, for `isRunning`, `Story.commands`, and `Story.resolve`. */
  readonly name: string;
  /** The args the command was issued with (`undefined` for a zero-arg command). */
  readonly args: unknown;
  /** Runs the body with the issued args; the runtime delivers the message. */
  readonly body: () => Effect.Effect<MaybeMessage<Msg>, never, R>;
  /** How a re-issue treats the running one. */
  readonly mode: CommandMode;
}

/**
 * A command definition. Call it with its args to issue it from `$.run`
 * (zero-arg when its body takes none). Carries `.name` for `isRunning`.
 */
export interface Command<Msg = never, R = never, Args = never> {
  readonly name: string;
  (...args: [Args] extends [never] ? [] : [args: Args]): Issued<Msg, R>;
}

/** A command body: an effect resolving to a message or nothing. */
export type CommandBody<Msg, R, Args> = (
  args: Args
) => Effect.Effect<MaybeMessage<Msg>, never, R>;

/** Overloads for {@link make}: with or without command options. */
export interface MakeCommand {
  <Msg, R = never, Args = never>(
    name: string,
    body: CommandBody<Msg, R, Args>
  ): Command<Msg, R, Args>;
  <Msg, R = never, Args = never>(
    name: string,
    options: CommandOptions,
    body: CommandBody<Msg, R, Args>
  ): Command<Msg, R, Args>;
}

/** Build a command from a body; issues run concurrently unless switched. */
export const make: MakeCommand = <Msg, R, Args>(
  name: string,
  second: CommandOptions | CommandBody<Msg, R, Args>,
  third?: CommandBody<Msg, R, Args>
): Command<Msg, R, Args> => {
  const hasOptions = third !== undefined;
  // SAFETY: two arguments mean (name, options, body); one means (name, body).
  const options = (hasOptions ? second : {}) as CommandOptions;
  // SAFETY: the body is the last argument in both call shapes.
  const body = (hasOptions ? third : second) as CommandBody<Msg, R, Args>;

  const command: Command<Msg, R, Args> = (...args: readonly Args[]) => ({
    args: args[0],
    body: () => body(args[0]),
    mode: options.mode ?? "concurrent",
    name,
  });

  // Function `name` is readonly: assigning would throw, so define it.
  Object.defineProperty(command, "name", { value: name });

  return command;
};
