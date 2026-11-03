import * as Effect from "effect/Effect";

import type { Cmd, Slice, UpdateResult } from "./app";

/**
 * Split one or many commands. `Array.isArray` cannot narrow a generic
 * union, so the assertion lives here instead of at every call site.
 */
const eachCmd = <Message extends Slice>(
  cmd: Cmd<Message> | readonly Cmd<Message>[]
): readonly Cmd<Message>[] =>
  // SAFETY: `Array.isArray` already split the union at runtime; the
  // assertion only recovers what generic narrowing cannot express.
  (Array.isArray(cmd) ? cmd : [cmd]) as readonly Cmd<Message>[];

/**
 * One transform over a model, used with {@link combine}. A child fold
 * returns a step; inline lambdas receive the model the previous step wrote.
 */
export type Step<Model, Message extends Slice> = (
  model: Model
) => UpdateResult<Model, Message>;

/**
 * Run steps in order, threading each model into the next. Commands run
 * sequentially in step order and their messages concatenate.
 */
export const combine = <Model, Message extends Slice>(
  model: Model,
  steps: readonly Step<Model, Message>[]
): UpdateResult<Model, Message> => {
  let current = model;
  const cmds: Cmd<Message>[] = [];
  for (const step of steps) {
    const result = step(current);
    current = result.model;
    if (result.cmd !== undefined) {
      cmds.push(...eachCmd(result.cmd));
    }
  }
  if (cmds.length === 0) {
    return { model: current };
  }
  return { cmd: cmds.length === 1 ? cmds[0] : cmds, model: current };
};

/** Options for {@link foldChild}. */
export interface FoldChildOptions<
  ParentModel,
  ParentMessage extends Slice,
  ChildModel,
  ChildMessage extends Slice,
> {
  /** The child's own update. The parent never touches the child model. */
  readonly update: (
    model: ChildModel,
    message: ChildMessage
  ) => UpdateResult<ChildModel, ChildMessage>;
  /** Read the child slice. `undefined` leaves the parent unchanged. */
  readonly read: (model: ParentModel) => ChildModel | undefined;
  /** Write the child slice back. */
  readonly write: (model: ParentModel, child: ChildModel) => ParentModel;
  /** Lift child messages, usually into a `Got*` wrapper. */
  readonly toParentMessage: (message: ChildMessage) => ParentMessage;
}

/**
 * Embed a child update in a parent. Runs the child, writes its model back,
 * and lifts its commands so results arrive wrapped for the parent.
 */
export const foldChild = <
  ParentModel,
  ParentMessage extends Slice,
  ChildModel,
  ChildMessage extends Slice,
>(
  options: FoldChildOptions<
    ParentModel,
    ParentMessage,
    ChildModel,
    ChildMessage
  >
): ((
  model: ParentModel,
  message: ChildMessage
) => UpdateResult<ParentModel, ParentMessage>) => {
  const { read, toParentMessage, update, write } = options;
  return (model, message) => {
    const child = read(model);
    if (child === undefined) {
      return { model };
    }
    const result = update(child, message);
    const next = write(model, result.model);
    if (result.cmd === undefined) {
      return { model: next };
    }
    const lifted = eachCmd(result.cmd).map((cmd) =>
      cmd.pipe(
        Effect.map((out) =>
          out === undefined ? undefined : toParentMessage(out)
        )
      )
    );
    return { cmd: lifted, model: next };
  };
};
