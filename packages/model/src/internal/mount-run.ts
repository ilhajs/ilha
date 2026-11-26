import type * as Arr from "effect/Array";
/**
 * The runtime behind `h.mount`: one running mount per element, started after
 * commit in a Scope that lives with the element.
 *
 * Each `h.mount(issued)` call returns an Ilha `ref` prop. The ref remembers
 * the element it attached to; a repaint disposes the old ref and attaches a
 * new one in the same commit, so attach-then-detach churn never restarts a
 * mount: the same element with the same mount name publishes new args to
 * `changes`, a different name stops the running mount and starts the new
 * one, and a render without the mount (or the element going away) schedules
 * a stop that a re-attach in the same commit cancels. A defect fails the
 * instance. Nothing runs or logs on the server.
 *
 * The `changes` Stream is conflating: a reader that falls behind keeps only
 * the newest unread args, and waiting readers are woken in the order they
 * began to wait. On close, readers end newest first and unread args drop.
 *
 * Ported from Effect UI's `internal/mount-run.ts` and `mountArgs.ts`.
 *
 * @internal
 */
import * as Cause from "effect/Cause";
import * as Channel from "effect/Channel";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Mount from "../mount.ts";
import type { InstanceRecord } from "./kernel.ts";
import type * as Kernel from "./kernel.ts";
import { isNoop } from "./noop.ts";

// Set once by the kernel module, which owns dispatch and the environment.
let dispatch: typeof Kernel.dispatch = () => {
  throw new Error("mount-run used before the kernel bound dispatch");
};
let failOutside: typeof Kernel.failOutside = () => {
  throw new Error("mount-run used before the kernel bound failOutside");
};
let logDraft: typeof Kernel.logDraft = () => undefined; // oxlint-disable-line unicorn/no-useless-undefined -- mounts log nothing until the kernel binds its draft recorder; undefined means no seq.
let resolveEnv: typeof Kernel.resolveEnv = () => {
  throw new Error("mount-run used before the kernel bound resolveEnv");
};

/**
 * Give mounts the kernel's dispatch and environment. Called once by the
 * kernel module.
 *
 * @internal
 */
export const bindMountRunKernel = (hooks: {
  readonly dispatch: typeof Kernel.dispatch;
  readonly failOutside: typeof Kernel.failOutside;
  readonly logDraft: typeof Kernel.logDraft;
  readonly resolveEnv: typeof Kernel.resolveEnv;
}): void => {
  ({ dispatch, failOutside, logDraft, resolveEnv } = hooks);
};

/** @internal */
export interface MountArgs {
  /** The args published last. */
  latest: unknown;
  /** Ends every reader, newest first, when the mount stops. */
  closed: boolean;
  /** How many args have been published. */
  published: number;
  readonly readers: Set<MountReader>;
  /** The order waiting readers are woken in. */
  readonly order: Set<MountReader>;
}

interface MountReader {
  /** The args published last when the reader started, then the newest published since. */
  unread: unknown[];
  /** Whether `unread` ends with args published since the reader started or last read. */
  behind: boolean;
  /** While the reader waits with nothing unread: takes the next args, or `done` at the close. */
  resume: ((next: Effect.Effect<unknown, Cause.Done>) => void) | undefined;
  /** How many args had been published when the reader began to wait. */
  since: number;
}

/** @internal */
export const makeArgs = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- mount args are author-defined; the mount body decodes them.
  args: unknown
): MountArgs => ({
  closed: false,
  latest: args,
  order: new Set(),
  published: 0,
  readers: new Set(),
});

/** @internal */
export const publishArgs = (
  self: MountArgs,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- mount args are author-defined; readers receive them unchecked.
  args: unknown
): void => {
  self.latest = args;
  self.published += 1;
  const { published } = self;
  for (const reader of self.readers) {
    if (reader.resume !== undefined) {
      continue;
    }
    self.order.delete(reader);
    if (reader.behind) {
      reader.unread[reader.unread.length - 1] = args;
    } else {
      reader.behind = true;
      reader.unread.push(args);
    }
  }
  // A resumed reader runs at once, and can start a reader, wait again or
  // publish. A reader that began to wait during this publish has these args
  // already, or newer ones.
  for (const reader of self.order) {
    const { resume } = reader;
    if (resume === undefined || reader.since >= published) {
      continue;
    }
    reader.resume = undefined;
    resume(Effect.succeed(args));
  }
};

const argsDone = Cause.done();

/**
 * Ends every reader, the newest first: what they haven't read is dropped.
 *
 * @internal
 */
export const closeArgs = (self: MountArgs): void => {
  self.closed = true;
  for (const reader of [...self.readers].toReversed()) {
    reader.resume?.(argsDone);
  }
  self.readers.clear();
  self.order.clear();
};

/** Takes what `reader` hasn't read, after `first`: one of the two isn't empty. */
const readArgs = (
  reader: MountReader,
  first: unknown[]
): Arr.NonEmptyReadonlyArray<unknown> => {
  const out = [...first, ...reader.unread];
  reader.unread = [];
  reader.behind = false;
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: readArgs runs only when first or unread is non-empty, so out holds at least one args.
  return out as unknown as Arr.NonEmptyReadonlyArray<unknown>;
};

/** @internal */
export const argChanges = (self: MountArgs): Stream.Stream<unknown> =>
  Stream.fromChannel(
    Channel.fromTransform((_, scope) => {
      const reader: MountReader = {
        behind: false,
        resume: undefined,
        since: 0,
        unread: [self.latest],
      };
      if (!self.closed) {
        self.readers.add(reader);
      }
      const pull = Effect.suspend(() => {
        if (self.closed) {
          return argsDone;
        }
        if (reader.unread.length > 0) {
          return Effect.succeed(readArgs(reader, []));
        }
        return Effect.flatMap(
          Effect.callback<unknown, Cause.Done>((resume) => {
            reader.resume = resume;
            reader.since = self.published;
            self.order.add(reader);
            return Effect.sync(() => {
              reader.resume = undefined;
            });
          }),
          // The close can come between the publish and this reader's turn.
          (args) =>
            self.closed ? argsDone : Effect.succeed(readArgs(reader, [args]))
        );
      });
      return Effect.as(
        Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            self.readers.delete(reader);
            self.order.delete(reader);
          })
        ),
        pull
      );
    })
  );

interface Running {
  /** The mount's own Scope: outlives a completed body, closes on stop. */
  scope: Scope.Closeable;
  /** Interrupts the body fiber. */
  interrupt: () => void;
  /** The `MountStarted` seq mount-sourced messages carry. */
  started: number;
  /** True when at least one result arrived and every one was noop. */
  silent: boolean | undefined;
  /** Whether the mount stopped: late results and the fiber's exit log nothing more. */
  ended: boolean;
  args: MountArgs;
}

interface Slot {
  issued: Mount.Any;
  node: Element | undefined;
  running: Running | undefined;
  /** A removal's deferred stop, cancelled by a re-attach in the same commit. */
  stopTimer: StopTimer | undefined;
}

/** A deferred mount stop: a removal schedules one, a re-attach in the same commit cancels it. */
interface StopTimer {
  readonly cancel: () => void;
}

const deferStop = (f: () => void): StopTimer => {
  const id = setTimeout(f, 0);
  return { cancel: () => clearTimeout(id) };
};

const slotsOf = (rec: InstanceRecord): Map<Element, Slot> => {
  // SAFETY: the kernel stores mount slots under "mount"; slotsOf creates the map on first use.
  let slots = rec.extensions.get("mount") as Map<Element, Slot> | undefined;
  if (slots === undefined) {
    slots = new Map();
    rec.extensions.set("mount", slots);
  }
  return slots;
};

const endRunning = (
  rec: InstanceRecord,
  issued: Mount.Any,
  running: Running,
  reason: "completed" | "closed" | "failed"
): void => {
  if (running.ended) {
    return;
  }
  running.ended = true;
  logDraft(rec, {
    _tag: "MountEnded",
    name: issued.name,
    reason,
    silent: running.silent === true,
    started: running.started,
  });
};
const sendResult = (
  rec: InstanceRecord,
  slot: Slot,
  running: Running,
  result: unknown // oxlint-disable-line anti-slop/no-unknown-parameters -- mount results are body-defined; resolve decodes them.
): void => {
  const latest = slot.issued;
  let message: unknown;
  try {
    // SAFETY: resolve decodes the body's result into a message or throws; the catch below reports it.
    message = latest.resolve(result as never);
  } catch (error) {
    endRunning(rec, latest, running, "failed");
    failOutside(rec, "mount", error, { name: latest.name });
    return;
  }
  const noop = isNoop(message);
  running.silent = noop && running.silent !== false;
  if (noop || running.ended) {
    return;
  }
  dispatch(
    rec,
    {
      _tag: "Mount",
      args: latest.args,
      argsSchema: latest.argsSchema,
      name: latest.name,
      seq: running.started,
    },
    message
  );
};

const startRunning = (
  rec: InstanceRecord,
  slot: Slot,
  issued: Mount.Any,
  node: Element
): void => {
  const args = makeArgs(issued.args);
  const scope = Scope.forkUnsafe(rec.fiber.scope);
  const started =
    logDraft(rec, {
      _tag: "MountStarted",
      args: issued.args,
      argsSchema: issued.argsSchema,
      name: issued.name,
    }) ?? -1;
  const running: Running = {
    args,
    ended: false,
    interrupt: () => {
      // No interruptible work exists before the body fiber starts.
    },
    scope,
    silent: undefined,
    started,
  };
  slot.running = running;
  const send = (result: never): Effect.Effect<void> =>
    Effect.sync(() => {
      if (!running.ended) {
        sendResult(rec, slot, running, result);
      }
    });
  const changes = Stream.suspend((): Stream.Stream<never> => {
    Effect.runSync(
      Scope.addFinalizer(
        scope,
        Effect.sync(() => closeArgs(args))
      )
    );
    // SAFETY: argChanges emits NonEmptyReadonlyArray values; never is its empty element type.
    return argChanges(args) as Stream.Stream<never>;
  });
  // SAFETY: run takes the element, args and changes in body order; never is each contravariant parameter.
  const body = Effect.suspend(() =>
    issued.run(node as never, issued.args as never, changes, send)
  );
  const tracked = Effect.provide(
    Effect.provideService(body, Scope.Scope, scope),
    resolveEnv(rec)
  );
  // The exit lands here instead of `fiber.run`'s `onOk`: an `onOk` holds the
  // island's pending count (and every `settled()`) for the mount's whole
  // life. A stopped mount already ended through `stopRunning`.
  const handled = Effect.onExit(tracked, (exit) =>
    Effect.sync(() => {
      if (running.ended) {
        return;
      }
      if (Exit.isSuccess(exit)) {
        // The body completed: its Scope outlives it, releasing only when the
        // element goes.
        endRunning(rec, issued, running, "completed");
        return;
      }
      if (Cause.hasInterruptsOnly(exit.cause)) {
        endRunning(rec, issued, running, "closed");
        return;
      }
      endRunning(rec, issued, running, "failed");
      failOutside(rec, "mount", exit.cause, { name: issued.name });
    })
  );
  running.interrupt = rec.fiber.run(handled);
};

const stopRunning = (
  rec: InstanceRecord,
  slot: Slot,
  reason: "closed"
): void => {
  const { running } = slot;
  slot.running = undefined;
  if (running === undefined) {
    return;
  }
  running.interrupt();
  closeArgs(running.args);
  endRunning(rec, slot.issued, running, reason);
  Effect.runFork(Scope.close(running.scope, Exit.void));
};

/** Stop every mount of a closing instance. Runs from the record's `onClose` hooks and on failure. */
export const stopAll = (rec: InstanceRecord): void => {
  // SAFETY: the kernel stores mount slots under "mount"; missing slots mean no mounts ran.
  const slots = rec.extensions.get("mount") as Map<Element, Slot> | undefined;
  if (slots === undefined) {
    return;
  }
  for (const slot of slots.values()) {
    slot.stopTimer?.cancel();
    slot.stopTimer = undefined;
    stopRunning(rec, slot, "closed");
  }
  slots.clear();
};

const attach = (
  rec: InstanceRecord,
  slot: Slot,
  issued: Mount.Any,
  node: Element
): void => {
  slot.stopTimer?.cancel();
  slot.stopTimer = undefined;
  const previous = slot.issued;
  slot.issued = issued;
  slot.node = node;
  const { running } = slot;
  if (running !== undefined && previous.name === issued.name) {
    if (!Mount.sameArgs(previous, issued)) {
      publishArgs(running.args, issued.args);
    }
    return;
  }
  if (running !== undefined) {
    stopRunning(rec, slot, "closed");
  }
  startRunning(rec, slot, issued, node);
};

const detach = (
  rec: InstanceRecord,
  slot: Slot,
  el: Element,
  slots: Map<Element, Slot>
): void => {
  if (slot.stopTimer !== undefined || slot.node === undefined) {
    return;
  }
  slot.node = undefined;
  // The stop waits a turn: a repaint disposes this ref just before it
  // attaches the next one in the same commit, and that attach cancels this.
  slot.stopTimer = deferStop(() => {
    slot.stopTimer = undefined;
    if (slot.node !== undefined) {
      return;
    }
    slots.delete(el);
    stopRunning(rec, slot, "closed");
  });
};

/**
 * The Ilha `ref` prop `h.mount(issued)` returns: attaches `issued` to the
 * element after commit, publishes later renders' args to `changes`, and
 * stops the mount when a render drops it or the element goes.
 *
 * @internal
 */
export const mountRef = (
  rec: InstanceRecord,
  issued: Mount.Any
): ((node: Element | null) => void) => {
  let current: Element | undefined;
  if (rec.extensions.get("mount:close") === undefined) {
    rec.extensions.set("mount:close", true);
    rec.onClose.push(() => stopAll(rec));
  }
  return (node) => {
    if (rec.fiber.runtime.ssr || rec.status !== "live" || rec.fiber.closed) {
      return;
    }
    if (node === null || node === undefined) {
      const el = current;
      current = undefined;
      if (el === undefined) {
        return;
      }
      const slots = slotsOf(rec);
      const slot = slots.get(el);
      if (slot !== undefined) {
        detach(rec, slot, el, slots);
      }
      return;
    }
    const el = node;
    current = el;
    const slots = slotsOf(rec);
    let slot = slots.get(el);
    if (slot === undefined) {
      slot = {
        issued,
        node: undefined,
        running: undefined,
        stopTimer: undefined,
      };
      slots.set(el, slot);
    }
    attach(rec, slot, issued, el);
  };
};
