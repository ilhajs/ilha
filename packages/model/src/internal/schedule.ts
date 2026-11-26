/**
 * The one pure scheduling rule for Command modes and interrupts, shared by
 * the runtime and Story so the two can't drift apart. Ported from Effect
 * UI's `internal/schedule.ts`.
 *
 * @internal
 */
import type * as Command from "../command.ts";

/**
 * A run the scheduler knows about: a Command that is running, waiting to run,
 * awaiting (its fiber has exited and its result hasn't been delivered), or
 * stopping (it was stopped and its fiber hasn't exited). A result of
 * `Component.noop` is delivered as nothing, but awaits all the same.
 *
 * @internal
 */
export interface Entry<A> {
  readonly name: string;
  /** The group key, or `undefined` for a Command without `group`. */
  readonly key: string | undefined;
  readonly mode: Command.Mode;
  readonly status: Status;
  readonly value: A;
}

/**
 * Where a run is: `running`, `queued` behind a running or stopping run of its
 * group, `awaiting`: its fiber exited and its result (a message or
 * `Component.noop`) waits, on its own `Command.afterRefetch` wait or, under
 * `queue`, behind an earlier result of its group, or `stopping`: it was
 * stopped and its fiber, cleanup included, hasn't exited. A run is over when
 * its fiber exits, so a stopping run still holds its group.
 *
 * @internal
 */
export type Status = "running" | "queued" | "awaiting" | "stopping";

/**
 * What to do with an issued Command, and which in-flight entries it interrupts.
 *
 * @internal
 */
export interface Decision<A> {
  readonly action: "start" | "queue" | "none";
  readonly interrupt: readonly Entry<A>[];
}

const sameGroup = <A>(
  entry: Entry<A>,
  name: string,
  key: string | undefined
): boolean => entry.name === name && entry.key === key;

/** Whether a run holds its group: its fiber hasn't exited. */
const holds = <A>(entry: Entry<A>): boolean =>
  entry.status === "running" || entry.status === "stopping";

/**
 * Decides how an issued Command relates to the in-flight runs of its instance.
 *
 * Concurrency is grouped by Command name plus the group key of its `group`
 * fields. `concurrent` always starts. `switch` interrupts the group's
 * running, queued and awaiting runs, and waits until every fiber it cut has
 * exited. `queue` waits while the group has a running or stopping run: an
 * awaiting one doesn't hold it. An `Interrupt` starts nothing and interrupts
 * every run with its name, or only those with its group key when it has one.
 * A stopping run is never interrupted again.
 *
 * A run that waits is queued. The caller stops the interrupted runs and
 * starts the queued run with `next` once nothing holds the group, at once
 * when no run it cut had a fiber.
 *
 * @internal
 */
export const schedule = <A>(
  inFlight: readonly Entry<A>[],
  command: Command.Command<unknown, unknown>
): Decision<A> => {
  const live = inFlight.filter((entry) => entry.status !== "stopping");
  if (command._tag === "Interrupt") {
    return {
      action: "none",
      interrupt: live.filter(
        (entry) =>
          entry.name === command.name &&
          (command.groupKey === undefined || entry.key === command.groupKey)
      ),
    };
  }
  const group = inFlight.filter((entry) =>
    sameGroup(entry, command.name, command.groupKey)
  );
  if (command.mode === "concurrent") {
    return { action: "start", interrupt: [] };
  }
  if (command.mode === "switch") {
    return {
      action: group.some(holds) ? "queue" : "start",
      interrupt: group.filter((entry) => entry.status !== "stopping"),
    };
  }
  return { action: group.some(holds) ? "queue" : "start", interrupt: [] };
};

/**
 * The run that starts now in `run`'s group: the oldest queued one, once
 * `inFlight` has no running or stopping run in the group. An awaiting run
 * doesn't hold the queue.
 *
 * @internal
 */
export const next = <A>(
  inFlight: readonly Entry<A>[],
  run: Entry<A>
): Entry<A> | undefined => {
  const group = inFlight.filter((entry) => sameGroup(entry, run.name, run.key));
  if (group.some(holds)) {
    return undefined;
  }
  return group.find((entry) => entry.status === "queued");
};

/**
 * Returns the next awaiting run whose result is ready to deliver. Under
 * `queue`, selects the group's oldest awaiting run to preserve issue order;
 * otherwise selects `entry`. Returns nothing until the selected run's own
 * wait has ended (`ready`).
 *
 * @internal
 */
export const deliverable = <A>(
  inFlight: readonly Entry<A>[],
  entry: Entry<A>,
  ready: (value: A) => boolean
): Entry<A> | undefined => {
  const found =
    entry.mode === "queue"
      ? inFlight.find(
          (other) =>
            sameGroup(other, entry.name, entry.key) &&
            other.status === "awaiting"
        )
      : inFlight.find(
          (other) => other.value === entry.value && other.status === "awaiting"
        );
  return found !== undefined && ready(found.value) ? found : undefined;
};
