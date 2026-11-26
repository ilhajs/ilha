import * as Schema from "effect/Schema";

import type { ModelComponent } from "./component";
import type { InitDollar, Step, UpdateDollar } from "./internal";
import { createStep, initDollar, isStepValue, updateDollar } from "./internal";

/**
 * Synchronous, pure component tests: no Effect, no DOM. Runs `init`
 * (commands are recorded, never executed), then `send` feeds messages
 * through `update`. Step commands accumulate as pending issues;
 * `resolve` drops one and optionally feeds a message back.
 */
export interface StoryHandle<Model, Msg, Events> {
  /** The current model. */
  readonly model: Model;
  /** Emitted events, in order. */
  readonly emitted: readonly Events[];
  /** Pending command issues, in order, as `{ name, args }`. */
  readonly commands: readonly {
    readonly name: string;
    readonly args: unknown;
  }[];
  /** Run one message through `update`. Throws on an unknown tag. */
  readonly send: (message: Msg) => void;
  /**
   * Drop the oldest pending issue of `command`, then send `message` when
   * given (as if that issue resolved with it).
   */
  readonly resolve: (command: { readonly name: string }, message?: Msg) => void;
}

interface StoryImpl<
  Model,
  Msg extends { readonly _tag: string },
  Props,
  Events,
> {
  readonly init: (
    dollar: InitDollar<Model, Msg, Props, Events>,
    props: Props
  ) => Model | Step<Model, Msg, never, Events>;
  readonly update: Record<
    string,
    (
      dollar: UpdateDollar<Model, Msg, Props, Events>,
      message: Msg
    ) => Model | Step<Model, Msg, never, Events>
  >;
}

export const Story = {
  make<Props, Events, Model, Msg extends { readonly _tag: string }>(
    component: ModelComponent<Props, Events, Model, Msg>,
    ...args: Record<never, never> extends Props
      ? [props?: Props]
      : [props: Props]
  ): StoryHandle<Model, Msg, Events> {
    const { definition } = component;
    // SAFETY: Story drives the exact impl the component was built with.
    const impl = component.impl as StoryImpl<Model, Msg, Props, Events>;
    const decoded = Schema.decodeSync(definition.props)(args[0] ?? {});
    let pending: { readonly name: string; readonly args: unknown }[] = [];
    const emitted: unknown[] = [];
    const commitInit = (): Model => {
      const out: unknown = impl.init(
        initDollar<Model, Msg, Props, Events>(decoded),
        decoded
      );
      const step = isStepValue(out) ? out : createStep(out);
      pending = step.commands.map(({ args: commandArgs, name }) => ({
        args: commandArgs,
        name,
      }));
      for (const event of step.events) {
        emitted.push(event);
      }
      // SAFETY: the step carries this component's own model type through.
      return step.model as Model;
    };
    let model: Model = commitInit();

    const send = (message: Msg): void => {
      const { _tag: tag } = message;
      const handler = impl.update[tag];
      if (handler === undefined) {
        throw new Error(`${definition.name}: no update for "${tag}"`);
      }
      const out: unknown = handler(
        updateDollar<Model, Msg, Props, Events>(model, decoded),
        message
      );
      const step = isStepValue(out) ? out : createStep(out);
      const { model: next } = step;
      // SAFETY: the step carries this component's own model type through.
      model = next as Model;
      for (const { args: commandArgs, name } of step.commands) {
        pending.push({ args: commandArgs, name });
      }
      for (const event of step.events) {
        emitted.push(event);
      }
    };

    return {
      get commands() {
        return [...pending];
      },
      get emitted() {
        // SAFETY: only this component's events are ever pushed above.
        return [...(emitted as Events[])];
      },
      get model() {
        return model;
      },
      resolve(command: { readonly name: string }, message?: Msg): void {
        const at = pending.findIndex((issue) => issue.name === command.name);
        if (at !== -1) {
          pending.splice(at, 1);
        }
        if (message !== undefined) {
          send(message);
        }
      },
      send,
    };
  },
};
