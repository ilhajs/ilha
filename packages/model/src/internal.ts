import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type * as FiberMap from "effect/FiberMap";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import * as Ref from "effect/Ref";

import type { Cmd } from "./app";

/**
 * Split one or many commands. Internal: shared by the runtime, `submodel`,
 * and the test helpers, not part of the package surface. `Effect.isEffect`
 * narrows the union where `Array.isArray` cannot, so no assertion is needed.
 */
export const eachCmd = <Message, R>(
  cmd: Cmd<Message, R> | readonly Cmd<Message, R>[]
): readonly Cmd<Message, R>[] => (Effect.isEffect(cmd) ? [cmd] : cmd);

/**
 * Per-instance keyed-command scope. The runner provides it around every
 * command; `keyed` reads it back without adding a service requirement.
 */
export const KeyedScope = Context.Service<
  FiberMap.FiberMap<string, unknown, unknown>
>("ilha/model/KeyedScope");

/**
 * Report an unexpected cause through the Effect logger. Interruption
 * (unmount, keyed supersede, subscription restart) is silent; anything else
 * is a defect worth logging.
 */
export const reportCause = (cause: Cause.Cause<never>): Effect.Effect<void> =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.void
    : Effect.logError(Cause.pretty(cause));

/**
 * Run one command, delivering its message when it resolves to one. Shared
 * by the app runtime and the test helpers: a `void` result delivers
 * nothing, defects are logged, and interruption stays silent.
 */
export const runCommand = <Message, R>(
  cmd: Cmd<Message, R>,
  deliver: (message: Message) => Effect.Effect<void>,
  keyedMap: FiberMap.FiberMap<string, unknown, unknown>
): Effect.Effect<void, never, R | AtomRegistry> =>
  Effect.provideService(
    Effect.catchCause(
      cmd.pipe(
        Effect.flatMap((out) =>
          out === undefined ? Effect.void : deliver(out)
        )
      ),
      reportCause
    ),
    KeyedScope,
    keyedMap
  );

/**
 * Run commands concurrently like the app runtime, collecting delivered
 * messages in completion order. Commands fork in array order and each
 * `keyed` registration is synchronous, so same-key commands supersede
 * deterministically with the latest winning.
 */
export const drainCommands = <Message, R>(
  cmds: readonly Cmd<Message, R>[],
  keyedMap: FiberMap.FiberMap<string, unknown, unknown>
): Effect.Effect<readonly Message[], never, R | AtomRegistry> =>
  Effect.gen(function* drain() {
    const outbox = yield* Ref.make<readonly Message[]>([]);
    // Forked one by one from this fiber: each child stays supervised here
    // until joined, and array order fixes the keyed supersede order.
    const fibers: Fiber.Fiber<void, never>[] = [];
    for (const cmd of cmds) {
      fibers.push(
        yield* Effect.forkChild(
          runCommand(
            cmd,
            (message) => Ref.update(outbox, (seen) => [...seen, message]),
            keyedMap
          )
        )
      );
    }
    for (const fiber of fibers) {
      yield* Fiber.join(fiber);
    }
    return yield* Ref.get(outbox);
  });
