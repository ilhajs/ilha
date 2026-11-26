/**
 * Command target matching and descriptions for the test engine. Moved out
 * of `test/engine.ts` so `test/queries.ts` can use them without importing
 * the engine (which imports the query slice back).
 *
 * @internal
 */
import * as Equal from "effect/Equal";

import * as Command from "../command.ts";
import { isDefinition, nameOf } from "../command.ts";
import type { Target } from "./steps.ts";

/** A readable name for a pending Command, as failure items show it. */
export const describeCommand = (
  command: Command.Issued<unknown, never>
): string => `${command.name}(${JSON.stringify(command.args)})`;

/** Whether an issued Command matches a `resolve`/`fail`/`next`/`end` target. */
export const matchesTarget = (
  command: Command.Issued<unknown, never>,
  target: Target
): boolean => {
  if (isDefinition(target)) {
    return command.name === nameOf(target);
  }
  if (!Command.isCommand(target)) {
    return false;
  }
  // SAFETY: isCommand narrows target past definitions; the _tag check below rejects non-issued variants before use.
  const issued = target as Command.Issued<unknown, never>;
  // `Interrupt` is not a static member of `Target`, but a runtime value can
  // still carry its tag; it never matches an issued run.
  if (issued._tag !== "Effect" && issued._tag !== "Stream") {
    return false;
  }
  return (
    command.name === issued.name && Equal.equals(command.args, issued.args)
  );
};

/** Describe a `Target` in an error. */
export const describeTarget = (target: Target): string => {
  if (isDefinition(target)) {
    return nameOf(target);
  }
  if (Command.isCommand(target)) {
    // SAFETY: isCommand narrows target past definitions; the _tag check below rejects non-issued variants before use.
    const issued = target as Command.Issued<unknown, never>;
    if (issued._tag === "Effect" || issued._tag === "Stream") {
      return describeCommand(issued);
    }
  }
  return "an interrupt";
};
