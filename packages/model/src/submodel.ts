import * as Effect from "effect/Effect";

import type { Cmd, UpdateResult } from "./app";
import { eachCmd } from "./app";

/**
 * One transform over a model, used with {@link combine}. A child fold
 * returns a step; inline lambdas receive the model the previous step wrote.
 */
export type Step<Model, Message, R = never> = (
  model: Model
) => UpdateResult<Model, Message, R>;

/**
 * Run steps in order, threading each model into the next. The steps run in
 * order, but the commands from all steps run concurrently, like any command
 * list.
 */
export const combine = <Model, Message, R = never>(
  model: Model,
  steps: readonly Step<Model, Message, R>[]
): UpdateResult<Model, Message, R> => {
  let current = model;
  const cmds: Cmd<Message, R>[] = [];
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
  ParentMessage,
  ChildModel,
  ChildMessage,
  R = never,
> {
  /** The child's own update. The parent never touches the child model. */
  readonly update: (
    model: ChildModel,
    message: ChildMessage
  ) => UpdateResult<ChildModel, ChildMessage, R>;
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
  ParentMessage,
  ChildModel,
  ChildMessage,
  R = never,
>(
  options: FoldChildOptions<
    ParentModel,
    ParentMessage,
    ChildModel,
    ChildMessage,
    R
  >
): ((
  model: ParentModel,
  message: ChildMessage
) => UpdateResult<ParentModel, ParentMessage, R>) => {
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
