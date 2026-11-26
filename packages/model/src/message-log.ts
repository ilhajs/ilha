/**
 * The message log: a development and test hook the runtime calls once per
 * `update` and at every lifecycle step of every instance.
 *
 * It's off by default. The `MessageLog` service defaults to a no-op whose
 * `enabled` flag is `false`, and the runtime checks the flag before it builds
 * an entry, so an app that doesn't provide a log pays nothing for it. Provide
 * `memory` for a ring buffer, `socket` to stream entries to a devtools
 * process, or `fanout` for several sinks. Production observability goes
 * through Effect's tracer, logger and metrics instead.
 *
 * Entries hold decoded values and references, never copies. They're encoded
 * through the component's Schemas only when they're sent somewhere, as the
 * versioned `Wire`.
 *
 * **Example** (Keeping the last 1,000 entries)
 *
 * ```ts
 * import { MessageLog } from "@ilha/model"
 *
 * const DevLog = MessageLog.memory({ size: 1_000 })
 * ```
 *
 * @since 0.1.0
 */
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { memoize } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import type * as Scope from "effect/Scope";
import * as Socket from "effect/socket/Socket";

import * as messageLog from "./internal/message-log.ts";
import { holdsRedacted, redactAST } from "./internal/schema-redact.ts";
import { canonical, getIndexSignatureKeys } from "./internal/wire-ast.ts";

/**
 * The service the runtime records entries to.
 *
 * **Details**
 *
 * `record` is called synchronously from the runtime and must not throw. The
 * runtime checks `enabled` before it builds an entry, and assigns `seq`
 * itself, so every sink numbers entries the same way. It's runtime input
 * only: it's never part of a component's requirements, and app code can't
 * write entries.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
export interface MessageLog {
  readonly enabled: boolean;
  readonly record: (entry: Entry) => void;
}

/**
 * The no-op log: `enabled` is `false` and nothing is recorded.
 *
 * @since 0.1.0
 */
export const noop: MessageLog = messageLog.noop;

/**
 * The `MessageLog` service. It defaults to `noop`, so it never has to be
 * provided.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
export const MessageLog: Context.Reference<MessageLog> = messageLog.MessageLog;

/**
 * Attach a page-global log (the devtools panel uses this). While attached,
 * every kernel — existing and future, in every island — records into it in
 * addition to any per-registry log set with `setLog`. Each kernel emits a
 * `SessionStarted` entry per root when it first records. Returns a detach
 * function. Detached, the cost is zero (a single `undefined` check per
 * entry draft, guarded by the same `enabled` gate as the registry log).
 *
 * @since 0.1.0
 */
export const attach = (log: MessageLog): (() => void) =>
  messageLog.attachGlobal(log);

/**
 * The Schema of an instance's query results for the log: a field per query,
 * by name. The component runtime's query binding carries one; the log reads
 * it through the component's `"~queries"` slot.
 *
 * @since 0.1.0
 */
export type ResultsLogSchema = Schema.Struct<
  Readonly<Record<string, Schema.Codec<unknown, unknown>>>
>;

/**
 * A share read the log encodes an `Update`'s shared values through: the
 * local name the reader reads the owner under, and the owner component.
 *
 * @since 0.1.0
 */
export interface LoggedRead {
  readonly name: string;
  readonly owner: LoggedComponent;
}

/**
 * The definition fields the log encodes entries through. A structural view
 * of a component definition: the component runtime builds one when it
 * records, so the log never depends on the component module.
 *
 * @since 0.1.0
 */
export interface LoggedDefinition {
  /** The component's name, sent as-is on the Wire. */
  readonly name: string;
  readonly props: Schema.Top;
  readonly model: Schema.Top;
  readonly message: Schema.Top;
  /** The Schema of the events the component emits. */
  readonly events: Schema.Top;
  /** The Schema of the messages the component receives as an owner. */
  readonly receives: Schema.Top;
  /** The Schema of what the component shares as an owner, when it shares any. */
  readonly sharesSchema?: Schema.Top | undefined;
  /** The resolved share reads, by local name. Absent when the component reads none. */
  readonly reads?: readonly LoggedRead[] | undefined;
}

/**
 * The component the log encodes an entry through: its definition Schemas,
 * plus the query results Schema when the component has queries.
 *
 * @since 0.1.0
 */
export interface LoggedComponent {
  readonly definition: LoggedDefinition;
  readonly "~queries"?: { readonly logSchema: ResultsLogSchema } | undefined;
}

/**
 * A Command run the log encodes: its kind, name, decoded args, group key
 * and args Schema, with the redacting group source when it has one. A
 * structural view of an issued Command: the component runtime builds one
 * when it records, so the log never depends on the command module.
 *
 * @since 0.1.0
 */
export interface LoggedCommand {
  readonly _tag: "Effect" | "Stream" | "Interrupt";
  /** The Command's name: the factory's name or the service's key. */
  readonly name: string;
  /** The decoded args struct the Command was issued with. */
  readonly args: unknown;
  /** The group key: canonical JSON of the encoded `group` fields, or `undefined` without `group`. */
  readonly groupKey: string | undefined;
  /** The args Schema, which the log encodes args through. */
  readonly argsSchema: Schema.Top;
  /** The `group` fields, so the log encodes them redacted instead of logging the key. */
  readonly "~group"?: LoggedGroupSource | undefined;
}

/**
 * A Command's group: its key, and the `group` fields it was made from, so
 * the message log encodes them with redaction instead of logging the key.
 *
 * @since 0.1.0
 */
export interface LoggedGroupSource {
  /** Canonical JSON of the encoded `group` fields. */
  readonly key: string;
  /** A struct of the `group` fields. */
  readonly schema: Schema.Top;
  /** The `group` fields picked from the args. */
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- group fields are keyed by field name; the args Schema owns each value's contract.
  readonly picked: Record<string, unknown>;
}

/**
 * A `$.send(Owner, message)` an `update` issued: the owner component, whose
 * nearest instance above the sender gets the message, and the message.
 *
 * @since 0.1.0
 */
export interface Send {
  readonly owner: LoggedComponent;
  readonly message: unknown;
}

/**
 * A `$.loadMore` or `$.reset` call in an `update`, in order.
 *
 * @since 0.1.0
 */
export interface ListIssue {
  readonly name: string;
  readonly op: "loadMore" | "reset";
}

/**
 * An instance's query results, by query name. Opaque: only the runtime and
 * replays build and read them.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- query results are keyed by query name with each query's own Schema type; the log only carries them.
export type Results = Readonly<Record<string, unknown>>;

/**
 * An instance's shared values, by the local name its `reads` lists each
 * owner under. Opaque: only the runtime and replays build and read them.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- shared values are keyed by local read name with each owner's own Schema type; the log only carries them.
export type SharedRecord = Readonly<Record<string, unknown>>;

/**
 * A Subscription key's dep: what `Subscription.make` built the key from,
 * beside the key itself.
 *
 * @since 0.1.0
 */
export type SubscriptionDep = string | number | boolean | null;

/**
 * What started a query cache fetch, as `FetchStarted` reports it.
 *
 * @since 0.1.0
 */
export type FetchTrigger =
  | "watch"
  | "get"
  | "prefetch"
  | "visibility"
  | "connectivity"
  | "interval"
  | "invalidation"
  | "loadMore"
  | "reset";

/**
 * Where a failure happened: the code that threw or failed.
 *
 * @since 0.1.0
 */
export type FailedIn =
  | "init"
  | "update"
  | "view"
  | "content"
  | "domEvent"
  | "mount"
  | "command"
  | "subscription"
  | "layer"
  | "fallback"
  | "onEmit"
  | "onFailure"
  | "send"
  | "shares"
  | "shared";

/**
 * Which Command run an entry is about: the `seq` of the entry that issued it
 * (an `Update` or `Mounted`) and the index into its `commands` in issue
 * order.
 *
 * @since 0.1.0
 */
export interface Issued {
  readonly seq: number;
  readonly index: number;
}

/**
 * What sent the message an `update` handled.
 *
 * @since 0.1.0
 */
export type Source =
  | { readonly _tag: "DomEvent"; readonly name: string }
  | {
      readonly _tag: "Command";
      readonly name: string;
      readonly issued: Issued;
      readonly spanId: string | undefined;
      readonly traceId: string | undefined;
    }
  | {
      readonly _tag: "Subscription";
      readonly key: string;
      readonly name: string;
      readonly deps: readonly SubscriptionDep[] | undefined;
    }
  | { readonly _tag: "Query"; readonly name: string; readonly seq: number }
  | { readonly _tag: "Emit"; readonly path: string; readonly seq: number }
  | { readonly _tag: "Failure"; readonly path: string; readonly seq: number }
  | { readonly _tag: "Send"; readonly path: string; readonly seq: number }
  | {
      readonly _tag: "Shared";
      readonly name: string;
      readonly path: string;
      readonly seq: number;
    }
  | { readonly _tag: "Collected" }
  | {
      readonly _tag: "Mount";
      /** The `seq` of this mount's `MountStarted` entry. */
      readonly seq: number;
      readonly name: string;
      readonly args: unknown;
      /** The mount's args Schema, which the Wire encodes `args` through. */
      readonly argsSchema: Schema.Top;
    }
  | { readonly _tag: "Dispatch" }
  | { readonly _tag: "Devtools" };

/**
 * Fields every entry has: its number, its time from `Clock`, the session it
 * belongs to, and the entry it follows from.
 *
 * **Details**
 *
 * An entry without `causedBy` is a fact: something that reached the tree
 * from outside it. The session starting is one. So is an `Update` whose
 * message came from a DOM event, a Command's result, a Subscription, a mount
 * or `root.send`, a `QueryChanged`, a Layer build, Command run or mount body ending,
 * and a `FetchStarted` a timer, a host signal or a Command's own work
 * started.
 *
 * An entry with `causedBy` is a consequence. The field is the `seq` of the
 * fact it follows from, however many steps lie between them: a child's
 * `Update` for a parent's `$.send` names the fact the parent's `update`
 * handled, not the parent's entry. The entries of a render name the fact
 * that last made the rendered instance dirty, so when one flush renders
 * what two messages changed, an instance both changed names the later one.
 * `CommandInterrupted` names the fact whose handling stopped the run, where
 * `issued` names the entry that started it. When a render stops a mount,
 * `MountEnded.causedBy` names the fact whose render stopped it, and
 * `started` names its `MountStarted` entry. A `FetchStarted` with trigger
 * `"watch"` names the fact whose render declared the query's args. A
 * reader's shared `onChange` `Update` names the fact that changed the
 * owner's value, and an owner's `collects.onChange` `Update` the fact that
 * last changed a report.
 *
 * The `seq` it holds may be of an entry a ring buffer has dropped.
 *
 * @since 0.1.0
 */
export interface Base {
  readonly seq: number;
  readonly at: number;
  readonly session: string;
  readonly causedBy?: number;
}

/**
 * Fields every entry about an instance has: its path, its number and its
 * component.
 *
 * **Details**
 *
 * `instance` tells two instances at one path apart. A path names a place in
 * the tree, and a child can mount there again before the instance that was
 * there has logged `Unmounted`. The number is unique in the session, and
 * later instances have higher ones.
 *
 * `component` is on every entry, so an entry still names its component
 * when the instance's first entry has left a ring buffer. Its Schemas encode
 * the entry's values for the Wire.
 *
 * @since 0.1.0
 */
export interface InstanceBase extends Base {
  readonly path: string;
  readonly instance: number;
  readonly component: LoggedComponent;
}

/**
 * One `update` call: the message, what sent it, the props and query results
 * it saw, the Model after it, and the Commands, events, load mores, resets
 * and sends it returned.
 *
 * **Details**
 *
 * It holds the instance's whole state, so a replay can start from any
 * `Update` a ring buffer still has.
 *
 * @since 0.1.0
 */
export interface Update extends InstanceBase {
  readonly _tag: "Update";
  readonly source: Source;
  readonly message: unknown;
  readonly props: unknown;
  readonly model: unknown;
  readonly commands: readonly LoggedCommand[];
  readonly events: readonly unknown[];
  /** The `$.loadMore` and `$.reset` calls, in order. */
  readonly lists: readonly ListIssue[];
  /** The `$.send` calls, in order. */
  readonly sends: readonly Send[];
  /** The types of the `$.viewTransition` request, when `update` made one. */
  readonly viewTransition?: readonly string[] | undefined;
  /**
   * The query results `update` read as `$.queries`, by query name: what
   * a replay gives it back, as it gives back `props`. Only a
   * component with queries has them.
   */
  readonly queries?: Results | undefined;
  /**
   * The shared values `update` read as `$.reads`, by the local name its
   * `reads` lists each owner under: what a replay gives it back.
   * Only a component that reads shared state has them.
   */
  readonly shared?: SharedRecord | undefined;
  /**
   * The `instance` of the provider whose Layer entries this instance's
   * feature slots read: itself for a component with a provided Layer, or the
   * one above whose services it renders with. Absent when the services it
   * renders with are always ready.
   */
  readonly boundary?: number | undefined;
}

/**
 * An instance mounted: its props, the Model from `init` (or adopted from the
 * server), its query results, and the Commands `init`
 * returned.
 *
 * **Details**
 *
 * `queries` is what the instance starts with: the server's
 * results when it adopted them, and every query empty otherwise. Only a
 * component with queries has it. The first values of its watches come later,
 * as `QueryChanged` entries.
 *
 * @since 0.1.0
 */
export interface Mounted extends InstanceBase {
  readonly _tag: "Mounted";
  readonly props: unknown;
  readonly model: unknown;
  readonly queries?: Results | undefined;
  readonly commands: readonly LoggedCommand[];
  readonly events: readonly unknown[];
  readonly adopted: boolean;
  /**
   * The `instance` of the provider whose Layer entries this instance's
   * feature slots read: itself for a component with a provided Layer, or the
   * one above whose services it renders with. Absent when the services it
   * renders with are always ready.
   */
  readonly boundary?: number | undefined;
}

/**
 * A mounted instance got new props from its parent, without a re-key. Its
 * queries' args can read them, so a replay applies it to reach the
 * state the instance ended with.
 *
 * **Details**
 *
 * It's logged before the result writes the new props cause. Props equal to the
 * current ones log nothing.
 *
 * @since 0.1.0
 */
export interface PropsChanged extends InstanceBase {
  readonly _tag: "PropsChanged";
  readonly props: unknown;
}

/**
 * A query's result changed: the runtime wrote what the query last
 * returned at its args. `result` is opaque. A replay applies it to
 * reach the results the instance ended with.
 *
 * **Details**
 *
 * A query with `onChange` logs this entry before the `Update` of the
 * message it returns, whose source points at it.
 *
 * @since 0.1.0
 */
export interface QueryChanged extends InstanceBase {
  readonly _tag: "QueryChanged";
  /** The query's name in `queries`. */
  readonly name: string;
  readonly result: unknown;
}

/**
 * A hydrating instance is waiting for its provided Layer: it shows the nodes
 * the server rendered, inert, and has no Model of its own yet.
 *
 * **Details**
 *
 * It's the instance's first entry, logged when the instance is created, with
 * the props it was given and the Model and query results the server rendered
 * the path with. Its Layer entries follow. When the Layer is ready the
 * instance logs `Mounted`, adopting that state. When the Layer fails and the
 * component handles the failure, it logs `Mounted` with a Model from `init`.
 * An instance removed while it waits logs `Unmounted` and never `Mounted`.
 *
 * @since 0.1.0
 */
export interface Waiting extends InstanceBase {
  readonly _tag: "Waiting";
  readonly props: unknown;
  /** The Model the server rendered the path with, which the nodes on screen show. */
  readonly model: unknown;
  /** The query results the server rendered the path with. Only a component with queries has them. */
  readonly queries?: Results | undefined;
  /**
   * The `instance` of the provider whose Layer entries this instance's
   * feature slots read: itself for a component with a provided Layer, or the
   * one above whose services it renders with. Absent when the services it
   * renders with are always ready.
   */
  readonly boundary?: number | undefined;
}

/**
 * An instance left the tree: from then on it takes no message, props or
 * query results, and its path is free.
 *
 * **Details**
 *
 * An instance removed with its parent logs its own entry before its
 * parent's. Its Scope closes after, and its Commands log their ends as they
 * exit, which can be later than this entry.
 *
 * It also ends the instance's Subscriptions and any Layer still pending:
 * neither logs an end entry when its instance goes, so a reader closes them
 * at this entry. Mounts log their own `MountEnded`, and Command runs their
 * own `CommandEnded` or `CommandInterrupted`.
 *
 * @since 0.1.0
 */
export interface Unmounted extends InstanceBase {
  readonly _tag: "Unmounted";
}

/**
 * A keep-alive child that no view writes now, and that its predicate keeps, took
 * its nodes out of the document. It stays mounted: it takes messages and
 * query results, and its Commands and Subscriptions go on.
 *
 * **Details**
 *
 * A kept child shows nothing and contributes no reports,
 * and its element mounts are stopped. A ref lookup inside it finds no node.
 * A child moved from one place to another in one render logs nothing.
 * `Drawn` ends the interval.
 *
 * @since 0.1.0
 */
export interface Kept extends InstanceBase {
  readonly _tag: "Kept";
}

/**
 * A kept child was written again, put its nodes back in the document, and
 * started its element mounts again.
 *
 * @since 0.1.0
 */
export interface Drawn extends InstanceBase {
  readonly _tag: "Drawn";
}

/**
 * An instance's provided Layer is still building once the instance is
 * created, or once a keyed provide selected again. Its Commands,
 * Subscriptions and mounts, and its descendants', wait for it.
 *
 * **Details**
 *
 * `status` is what the instance's feature slots record until the Layer
 * settles: `Pending` at mount, `Rebuilding` after a keyed provide selected
 * again, and `Awaiting` for an instance the server rendered with its services
 * that waits for the client's build. A Wire frame without it, from an older
 * log, is `Pending`.
 *
 * @since 0.1.0
 */
export interface LayerPending extends InstanceBase {
  readonly _tag: "LayerPending";
  readonly status: "Pending" | "Rebuilding" | "Awaiting";
}

/**
 * The Layer an earlier `LayerPending` waited for is built.
 *
 * @since 0.1.0
 */
export interface LayerReady extends InstanceBase {
  readonly _tag: "LayerReady";
}

/**
 * A provided Layer failed to build.
 *
 * **Details**
 *
 * `redacted` is `true` when the feature slots below got a cause that says
 * a provided Layer failed on the server: for a handled failure on the
 * server, whose `cause` is the one its handler got, and on a client that
 * adopted that failure. A replay passes the slots that substitute, not
 * `cause`.
 *
 * @since 0.1.0
 */
export interface LayerFailed extends InstanceBase {
  readonly _tag: "LayerFailed";
  readonly cause: Cause.Cause<unknown>;
  readonly redacted?: boolean | undefined;
}

/**
 * A Subscription's key started. A query's watch isn't a Subscription here:
 * its fetches are `FetchStarted` entries and its values are `QueryChanged`.
 *
 * **Details**
 *
 * `key` is the Subscription's identity, and what its `SubscriptionStopped`
 * and the `Update` entries it sends carry too. `name` and `deps` are what
 * the Subscription was built from: a Subscription named `"room"` with dep
 * `"42"` logs `name: "room"`, `deps: ["42"]` and `key: 'room:"42"'`. Group
 * and label by `name`, and never by parsing `key`. `deps` is `undefined`
 * for a Subscription with no deps.
 *
 * @since 0.1.0
 */
export interface SubscriptionStarted extends InstanceBase {
  readonly _tag: "SubscriptionStarted";
  readonly key: string;
  readonly name: string;
  readonly deps: readonly SubscriptionDep[] | undefined;
}

/**
 * A Subscription's key stopped. `name` and `deps` are those of the
 * `SubscriptionStarted` entry with the same `key`.
 *
 * @since 0.1.0
 */
export interface SubscriptionStopped extends InstanceBase {
  readonly _tag: "SubscriptionStopped";
  readonly key: string;
  readonly name: string;
  readonly deps: readonly SubscriptionDep[] | undefined;
}

/**
 * An element's mount body started after commit, with these args.
 *
 * @since 0.1.0
 */
export interface MountStarted extends InstanceBase {
  readonly _tag: "MountStarted";
  readonly name: string;
  readonly args: unknown;
  /** The mount's args Schema, which the Wire encodes `args` through. */
  readonly argsSchema: Schema.Top;
}

/**
 * The mount body returned, its Scope closed first, or the body failed.
 *
 * **Details**
 *
 * A completed body's Scope outlives it. Releasing that Scope when the
 * element goes writes no further entry. New args published to a running
 * mount write no entry either: each mount-sourced `Update` carries the
 * args its element last rendered with. Hosts that don't run mounts (the
 * server and static tests) log neither mount starts nor ends.
 *
 * @since 0.1.0
 */
export interface MountEnded extends InstanceBase {
  readonly _tag: "MountEnded";
  readonly name: string;
  /** The `seq` of this mount's `MountStarted` entry. */
  readonly started: number;
  readonly reason: "completed" | "closed" | "failed";
  /** True when the body gave at least one result and every result mapped to a noop, so it ended without a message by design. */
  readonly silent: boolean;
}

/**
 * A Command run's fiber started its work, in the run's span.
 *
 * **Details**
 *
 * From here until its end entry the run is running: `CommandEnded`,
 * `CommandInterrupted`, or a `Failed` with its `issued`. A run with an end
 * entry and no `CommandStarted` never began: it was stopped while queued in
 * its group or while it waited for its instance's Layer. `causedBy` names the fact of the step that started it:
 * the one that issued it, the one that freed its group for a queued run, or
 * the Layer build that ended for a run that waited for it.
 *
 * @since 0.1.0
 */
export interface CommandStarted extends InstanceBase {
  readonly _tag: "CommandStarted";
  readonly name: string;
  readonly issued: Issued;
  readonly spanId: string;
  readonly traceId: string;
}

/**
 * A Command run ended with a result.
 *
 * **Details**
 *
 * `spanId` and `traceId` are the run's span, `undefined` when its span never
 * began. They're here because a run that sends no message has no `Update`
 * entry whose source would carry them.
 *
 * @since 0.1.0
 */
export interface CommandEnded extends InstanceBase {
  readonly _tag: "CommandEnded";
  readonly name: string;
  readonly issued: Issued;
  /** The run's span id, or `undefined` when its span never began. */
  readonly spanId: string | undefined;
  /** The run's trace id, or `undefined` when its span never began. */
  readonly traceId: string | undefined;
  /**
   * `true` when the run had at least one result (its Effect's result, each
   * Stream element, a typed failure `onFailure` mapped) and every one was
   * a noop, so it ended without a message by design. `false` when it
   * sent any message, when a Stream ended with no elements, and when it
   * ended while its instance was closing, since its result wasn't mapped.
   */
  readonly silent: boolean;
  /**
   * For a run issued with an after-refetch wait that succeeded, how its wait
   * ended: `"settled"` when every awaited entry refetched, `"nothing"` when
   * the awaited set was empty, `"budget"` when the budget ran out,
   * `"switch"` or `"interrupt"` when the run was cut, which delivered its
   * message at once, and `"closed"` when the instance closed and the message
   * was dropped. Absent for any other run.
   */
  readonly waitEnded?: WaitEnded | undefined;
  /** With `waitEnded`: the awaited entries still refetching when the wait was cut. */
  readonly outstanding?: readonly AwaitedEntry[] | undefined;
}

/**
 * A Command run was interrupted and dispatched nothing. `reason` says what
 * stopped it (see `InterruptReason`).
 *
 * **Details**
 *
 * It's logged when the run's fiber has exited, which is when `isRunning`
 * stops counting it and a run queued behind it in its group starts: a run
 * whose cleanup is still going has no entry yet. A run that never got a
 * fiber logs it when it's stopped.
 *
 * @since 0.1.0
 */
export interface CommandInterrupted extends InstanceBase {
  readonly _tag: "CommandInterrupted";
  readonly name: string;
  readonly issued: Issued;
  /** The run's span id, or `undefined` when its span never began. */
  readonly spanId: string | undefined;
  /** The run's trace id, or `undefined` when its span never began. */
  readonly traceId: string | undefined;
  readonly reason: InterruptReason;
}

/**
 * What stopped a Command run, as `CommandInterrupted` reports it.
 *
 * **Details**
 *
 * - `"interrupt"`: an `update` interrupted its group.
 * - `"switch"`: an `update` issued a later run of its `switch` group.
 * - `"unmount"`: its instance was removed, or the app was disposed.
 * - `"layer"`: its instance's provided Layer failed before the run could
 *   start, or a keyed provide selected again and dropped the runs issued
 *   before it.
 * - `"self"`: its own work was interrupted, and nothing in the tree asked it
 *   to stop.
 *
 * `causedBy` names the fact whose handling stopped it, for every reason but
 * `"self"`.
 *
 * @since 0.1.0
 */
export type InterruptReason =
  | "interrupt"
  | "switch"
  | "unmount"
  | "layer"
  | "self";

/**
 * How an after-refetch wait ended.
 *
 * @since 0.1.0
 */
export type WaitEnded =
  | "settled"
  | "nothing"
  | "budget"
  | "switch"
  | "interrupt"
  | "closed";

/**
 * An entry an after-refetch run waits for: the query's name and the
 * entry's log key.
 *
 * @since 0.1.0
 */
export interface AwaitedEntry {
  readonly query: string;
  readonly logKey: string;
}

/**
 * A run issued with an after-refetch wait succeeded and waits for the
 * refetches its invalidation started, written at its fiber's exit after
 * the batch's fetch entries. `entries` is the awaited set, which isn't empty:
 * an empty one logs no entry, and `CommandEnded` has `waitEnded: "nothing"`.
 *
 * @since 0.1.0
 */
export interface CommandAwaiting extends InstanceBase {
  readonly _tag: "CommandAwaiting";
  readonly name: string;
  readonly issued: Issued;
  readonly entries: readonly AwaitedEntry[];
}

/**
 * A Command that never ran: dropped by the server, where no Command runs, or
 * on a closed fiber, where nothing runs anymore. Only a Command from `update`
 * is logged; `init`'s are dropped silently, since the client runs them when
 * it adopts.
 *
 * @since 0.1.0
 */
export interface CommandDropped extends InstanceBase {
  readonly _tag: "CommandDropped";
  readonly name: string;
  readonly issued: Issued;
  readonly reason: "server" | "closed";
}

/**
 * A `$.send` that reached no owner: the sender's `reads` lists the owner
 * as `optional`, and no instance of it is above the sender. `path` is the
 * sender's, `owner` the name of the owner, and `issued` the sender's
 * `Update` entry and the send's index in its `sends`.
 *
 * @since 0.1.0
 */
export interface SendDropped extends InstanceBase {
  readonly _tag: "SendDropped";
  readonly owner: string;
  readonly issued: Issued;
}

/**
 * An instance failed, with the real Cause and where it happened.
 *
 * **Details**
 *
 * `props` are the instance's, as of the failure. An instance that fails in
 * `init`, or whose Layer fails before it mounts, has no `Mounted` entry, so
 * this is the only entry that says what was there.
 *
 * A failed root is the instance with no parent: its `Failed` entry is
 * followed by its `Unmounted`. When the root `fallback` given to `mount`
 * throws, the root logs a second `Failed` after that, `in` `"fallback"`.
 *
 * @since 0.1.0
 */
export interface Failed extends InstanceBase {
  readonly _tag: "Failed";
  readonly props: unknown;
  readonly in: FailedIn;
  readonly name: string | undefined;
  readonly cause: Cause.Cause<unknown>;
  /**
   * When `update` threw: the message it was given and what sent it. A
   * message whose `update` throws has no `Update` entry, so this is its
   * only record.
   */
  readonly update?:
    | { readonly message: unknown; readonly source: Source }
    | undefined;
  /**
   * The run that failed the instance, when `in` is `"command"`. This entry
   * is that run's end: it has no `CommandEnded` or `CommandInterrupted`.
   */
  readonly issued?: Issued | undefined;
}

/**
 * A `mount` or a server render started.
 *
 * @since 0.1.0
 */
export interface SessionStarted extends Base {
  readonly _tag: "SessionStarted";
  readonly app: string;
}

/**
 * The query cache started a fetch.
 *
 * **Details**
 *
 * `logKey` is the entry's args key with every `Schema.Redacted` argument
 * redacted, so two entries that differ only in a secret share it.
 * `restart` marks a fetch that replaced an interrupted one, under the same
 * trigger. `inWindow` marks a fetch of a hydrated entry while the
 * fetch-free window is open. `stored: false` marks a fetcher call whose
 * result goes to `get` callers only. A caller that joins a fetch in flight
 * logs nothing.
 *
 * An infinite query logs each page it requests as its own entry: `page` is the
 * page's index, from 0, and `cursor` the cursor encoded by the list's
 * `cursor` Schema, absent for the first page. A query that isn't a list has
 * neither.
 *
 * @since 0.1.0
 */
export interface FetchStarted extends Base {
  readonly _tag: "FetchStarted";
  readonly query: string;
  readonly logKey: string;
  readonly trigger: FetchTrigger;
  readonly restart: boolean;
  readonly inWindow: boolean;
  readonly stored: boolean;
  readonly page?: number;
  readonly cursor?: Schema.Json;
}

/**
 * Any entry about one instance.
 *
 * @since 0.1.0
 */
export type InstanceEntry =
  | Waiting
  | Mounted
  | Update
  | PropsChanged
  | QueryChanged
  | LayerPending
  | LayerReady
  | LayerFailed
  | Failed
  | Unmounted
  | Kept
  | Drawn
  | MountStarted
  | MountEnded
  | CommandStarted
  | CommandAwaiting
  | CommandEnded
  | CommandInterrupted
  | CommandDropped
  | SendDropped
  | SubscriptionStarted
  | SubscriptionStopped;

/**
 * Any log entry: one about the tree, or one about an instance.
 *
 * @since 0.1.0
 */
export type Entry = SessionStarted | FetchStarted | InstanceEntry;

/**
 * A ring buffer log whose entries can be read back.
 *
 * @since 0.1.0
 */
export interface Memory extends MessageLog {
  /** The surviving entries, oldest first. */
  readonly entries: () => readonly Entry[];
}

/**
 * Makes a ring buffer log holding the last `size` entries (1,000 by default).
 *
 * @since 0.1.0
 */
export const makeMemory = (options?: {
  readonly size?: number | undefined;
}): Memory => {
  const size = Math.max(1, options?.size ?? 1000);
  const buffer: Entry[] = [];
  let start = 0;
  return {
    enabled: true,
    entries: () =>
      buffer.length < size
        ? buffer.slice()
        : [...buffer.slice(start), ...buffer.slice(0, start)],
    record(entry) {
      if (buffer.length < size) {
        buffer.push(entry);
      } else {
        buffer[start] = entry;
        start = (start + 1) % size;
      }
    },
  };
};

/**
 * One ring buffer shared by every instance, 1,000 entries by default.
 *
 * @since 0.1.0
 */
export const memory = (options?: {
  readonly size?: number | undefined;
}): Layer.Layer<never> => Layer.succeed(MessageLog, makeMemory(options));

/**
 * Sends every entry to several logs. Enabled when any of them is.
 *
 * **Details**
 *
 * Two Layers of one service can't compose, so this is how a memory buffer and
 * a socket run together.
 *
 * @since 0.1.0
 */
export const fanoutAll = (logs: readonly MessageLog[]): MessageLog => {
  const enabled = logs.filter((log) => log.enabled);
  return enabled.length === 0
    ? noop
    : {
        enabled: true,
        record: (entry) => {
          for (const log of enabled) {
            log.record(entry);
          }
        },
      };
};

/**
 * A Layer that sends entries to every log the given Layers provide.
 *
 * **Details**
 *
 * The other services the Layers provide are kept. When two Layers
 * provide the same one, the later Layer's wins.
 *
 * @since 0.1.0
 */
// SAFETY: the Layers' provided services are kept as-is at runtime; the cast only names the merged-services contract the signature above states.
export const fanout = <
  // oxlint-disable-next-line typescript/no-explicit-any -- the `Layers` constraint must accept any Layer services; the `fanout` signature keeps them precise.
  const Layers extends readonly Layer.Layer<never, any, any>[],
>(
  layers: Layers
): Layer.Layer<
  never,
  Layer.Error<Layers[number]>,
  Layer.Services<Layers[number]>
> =>
  Layer.effectContext(
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument -- `Effect.forEach` runs an Effect per layer; the second argument is the mapping function, not a `thisArg`.
    Effect.forEach(layers, (layer) => Layer.build(layer)).pipe(
      Effect.map((built) =>
        Context.add(
          Context.mergeAll(...built),
          MessageLog,
          fanoutAll(built.map(Context.get(MessageLog)))
        )
      )
    )
    // oxlint-disable-next-line typescript/no-explicit-any -- the merged Layers' services don't unify as a Layer type; the signature above states the contract.
  ) as any;

// ---------------------------------------------------------------------------
// Wire
// ---------------------------------------------------------------------------

/**
 * The Wire format's version, sent in every `Hello` frame.
 *
 * @since 0.1.0
 */
export const wireVersion = 1;

/**
 * Where a log comes from, as `Hello` reports it.
 *
 * @since 0.1.0
 */
export type WireHost = "browser" | "server" | "terminal" | "test";

const BaseWire = {
  at: Schema.Number,
  causedBy: Schema.optionalKey(Schema.Number),
  seq: Schema.Number,
  session: Schema.String,
};
const InstanceWire = {
  ...BaseWire,
  component: Schema.String,
  instance: Schema.Number,
  path: Schema.String,
};
const IssuedWire = Schema.Struct({ index: Schema.Number, seq: Schema.Number });
const CommandWire = Schema.Struct({
  _tag: Schema.Literals(["Effect", "Stream", "Interrupt"]),
  args: Schema.Json,
  group: Schema.NullOr(Schema.String),
  name: Schema.String,
});
const AwaitedEntryWire = Schema.Struct({
  logKey: Schema.String,
  query: Schema.String,
});
const CauseWire = Schema.Struct({
  pretty: Schema.String,
  reasons: Schema.Array(Schema.Json),
});
// Deps are JSON values, not primitives, so a dep that is a struct wouldn't be a new Wire version.
const SubscriptionWire = {
  deps: Schema.NullOr(Schema.Array(Schema.Json)),
  key: Schema.String,
  name: Schema.String,
};
const SourceWire = Schema.Union([
  Schema.TaggedStruct("DomEvent", { name: Schema.String }),
  Schema.TaggedStruct("Command", {
    issued: IssuedWire,
    name: Schema.String,
    spanId: Schema.NullOr(Schema.String),
    traceId: Schema.NullOr(Schema.String),
  }),
  Schema.TaggedStruct("Subscription", SubscriptionWire),
  Schema.TaggedStruct("Query", { name: Schema.String, seq: Schema.Number }),
  Schema.TaggedStruct("Emit", { path: Schema.String, seq: Schema.Number }),
  Schema.TaggedStruct("Failure", { path: Schema.String, seq: Schema.Number }),
  Schema.TaggedStruct("Send", { path: Schema.String, seq: Schema.Number }),
  Schema.TaggedStruct("Shared", {
    name: Schema.String,
    path: Schema.String,
    seq: Schema.Number,
  }),
  Schema.TaggedStruct("Collected", {}),
  Schema.TaggedStruct("Mount", {
    args: Schema.Json,
    name: Schema.String,
    seq: Schema.Number,
  }),
  Schema.TaggedStruct("Dispatch", {}),
  Schema.TaggedStruct("Devtools", {}),
]);
const RunWire = {
  ...InstanceWire,
  issued: IssuedWire,
  name: Schema.String,
  spanId: Schema.NullOr(Schema.String),
  traceId: Schema.NullOr(Schema.String),
};

/**
 * The versioned, one-way Schema of what a log sends: a `Hello` once per
 * connection, then entries with their values already encoded.
 *
 * **Details**
 *
 * Models, messages, props and events are encoded through the component's
 * Schemas, and a send's message through its owner's `receives`.
 * A shared value a reader's `Update` holds is encoded through the
 * `sharesSchema` of its owner's definition, or structurally without one. Command
 * args and a mount's args are encoded through the definition's `args`
 * Schema, field by field, and a field that doesn't encode falls back to a structural
 * encoding, best effort: a value with no JSON form becomes
 * `{ "~unserialisable": "<kind>" }`, a `Redacted` becomes
 * `{ "~redacted": true }`, and a Model or message over `maxEntryBytes` becomes
 * `{ "~truncated": bytes }`. A Cause is sent as `Cause.pretty` plus its
 * reasons, best effort. An entry's `component` is sent as its name.
 *
 * A Subscription's `deps` are sent as an array of JSON values, or `null` for
 * a Subscription with none. They're there to be read: `NaN`, `Infinity` and
 * `-Infinity` are sent as `{ "~unserialisable": "number" }` and `-0` as
 * `0`. The `key` beside them still tells those deps apart.
 *
 * Every `Schema.Redacted` in props, Models, messages, events, Command and
 * mount args, sends and shared values is sent as the placeholder. Two values
 * have no Schema to mark them, and are sent in clear: a Subscription's
 * `key` and `deps`, and the message text of an error in a Cause. Build a
 * Subscription's key from an id that isn't secret, and keep secrets out of
 * error messages.
 *
 * A reader treats each placeholder (see `isPlaceholder`) as a leaf whose
 * value is unknown: two placeholders aren't known to be equal, and a value
 * that is one isn't known to have changed.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
export const Wire = Schema.Union([
  Schema.TaggedStruct("Hello", {
    host: Schema.Literals(["browser", "server", "terminal", "test"]),
    version: Schema.Number,
  }),
  Schema.TaggedStruct("SessionStarted", { ...BaseWire, app: Schema.String }),
  Schema.TaggedStruct("FetchStarted", {
    ...BaseWire,
    cursor: Schema.optionalKey(Schema.Json),
    inWindow: Schema.Boolean,
    logKey: Schema.String,
    page: Schema.optionalKey(Schema.Number),
    query: Schema.String,
    restart: Schema.Boolean,
    stored: Schema.Boolean,
    trigger: Schema.Literals([
      "watch",
      "get",
      "prefetch",
      "visibility",
      "connectivity",
      "interval",
      "invalidation",
      "loadMore",
      "reset",
    ]),
  }),
  Schema.TaggedStruct("Waiting", {
    ...InstanceWire,
    boundary: Schema.optionalKey(Schema.Number),
    model: Schema.Json,
    props: Schema.Json,
    queries: Schema.optionalKey(Schema.Json),
  }),
  Schema.TaggedStruct("Mounted", {
    ...InstanceWire,
    adopted: Schema.Boolean,
    boundary: Schema.optionalKey(Schema.Number),
    commands: Schema.Array(CommandWire),
    events: Schema.Array(Schema.Json),
    model: Schema.Json,
    props: Schema.Json,
    queries: Schema.optionalKey(Schema.Json),
  }),
  Schema.TaggedStruct("Update", {
    ...InstanceWire,
    boundary: Schema.optionalKey(Schema.Number),
    commands: Schema.Array(CommandWire),
    events: Schema.Array(Schema.Json),
    lists: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        op: Schema.Literals(["loadMore", "reset"]),
      })
    ),
    message: Schema.Json,
    model: Schema.Json,
    props: Schema.Json,
    queries: Schema.optionalKey(Schema.Json),
    sends: Schema.Array(
      Schema.Struct({ message: Schema.Json, owner: Schema.String })
    ),
    shared: Schema.optionalKey(Schema.Json),
    source: SourceWire,
    viewTransition: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Schema.TaggedStruct("PropsChanged", { ...InstanceWire, props: Schema.Json }),
  Schema.TaggedStruct("QueryChanged", {
    ...InstanceWire,
    name: Schema.String,
    result: Schema.Json,
  }),
  Schema.TaggedStruct("LayerPending", {
    ...InstanceWire,
    status: Schema.optionalKey(
      Schema.Literals(["Pending", "Rebuilding", "Awaiting"])
    ),
  }),
  Schema.TaggedStruct("LayerReady", InstanceWire),
  Schema.TaggedStruct("LayerFailed", {
    ...InstanceWire,
    cause: CauseWire,
    redacted: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.TaggedStruct("Failed", {
    ...InstanceWire,
    cause: CauseWire,
    in: Schema.String,
    issued: Schema.optionalKey(IssuedWire),
    name: Schema.NullOr(Schema.String),
    props: Schema.Json,
    update: Schema.optionalKey(
      Schema.Struct({ message: Schema.Json, source: SourceWire })
    ),
  }),
  Schema.TaggedStruct("Unmounted", InstanceWire),
  Schema.TaggedStruct("Kept", InstanceWire),
  Schema.TaggedStruct("Drawn", InstanceWire),
  Schema.TaggedStruct("MountStarted", {
    ...InstanceWire,
    args: Schema.Json,
    name: Schema.String,
  }),
  Schema.TaggedStruct("MountEnded", {
    ...InstanceWire,
    name: Schema.String,
    reason: Schema.Literals(["completed", "closed", "failed"]),
    silent: Schema.Boolean,
    started: Schema.Number,
  }),
  Schema.TaggedStruct("CommandStarted", {
    ...InstanceWire,
    issued: IssuedWire,
    name: Schema.String,
    spanId: Schema.String,
    traceId: Schema.String,
  }),
  Schema.TaggedStruct("CommandAwaiting", {
    ...InstanceWire,
    entries: Schema.Array(AwaitedEntryWire),
    issued: IssuedWire,
    name: Schema.String,
  }),
  Schema.TaggedStruct("CommandEnded", {
    ...RunWire,
    outstanding: Schema.optionalKey(Schema.Array(AwaitedEntryWire)),
    silent: Schema.Boolean,
    waitEnded: Schema.optionalKey(
      Schema.Literals([
        "settled",
        "nothing",
        "budget",
        "switch",
        "interrupt",
        "closed",
      ])
    ),
  }),
  Schema.TaggedStruct("CommandInterrupted", {
    ...RunWire,
    reason: Schema.Literals([
      "interrupt",
      "switch",
      "unmount",
      "layer",
      "self",
    ]),
  }),
  Schema.TaggedStruct("CommandDropped", {
    ...InstanceWire,
    issued: IssuedWire,
    name: Schema.String,
    reason: Schema.Literals(["server", "closed"]),
  }),
  Schema.TaggedStruct("SendDropped", {
    ...InstanceWire,
    issued: IssuedWire,
    owner: Schema.String,
  }),
  Schema.TaggedStruct("SubscriptionStarted", {
    ...InstanceWire,
    ...SubscriptionWire,
  }),
  Schema.TaggedStruct("SubscriptionStopped", {
    ...InstanceWire,
    ...SubscriptionWire,
  }),
]);

/**
 * One frame of the Wire.
 *
 * @since 0.1.0
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair
export type Wire = typeof Wire.Type;

/**
 * The Wire's form of an entry, without the `Hello` frame.
 *
 * @since 0.1.0
 */
export type WireEntry = Exclude<Wire, { readonly _tag: "Hello" }>;

/**
 * A value the encoder sent in place of one it couldn't or mustn't send.
 *
 * @since 0.1.0
 */
export type Placeholder =
  | { readonly "~unserialisable": string }
  | { readonly "~redacted": true }
  | { readonly "~truncated": number };

const placeholderChecks = {
  "~redacted": (value) => value === true,
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the check table dispatches on the JSON representation of each placeholder value.
  "~truncated": (value) => typeof value === "number",
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the check table dispatches on the JSON representation of each placeholder value.
  "~unserialisable": (value) => typeof value === "string",
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- each check narrows the unknown JSON value it validates.
} satisfies Record<string, (value: unknown) => boolean>;

/**
 * Whether a JSON value from a Wire frame is a `Placeholder`: an object with
 * one key, `"~unserialisable"` with a string, `"~redacted"` with `true`,
 * or `"~truncated"` with a number.
 *
 * @since 0.1.0
 */
export const isPlaceholder = (value: unknown): value is Placeholder => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    return false;
  }
  const [only] = keys;
  if (only === undefined || !Object.hasOwn(placeholderChecks, only)) {
    return false;
  }
  // SAFETY: `value` is a non-array object with exactly one own key (checked above), so reading it as a record is sound.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the single-key object maps its key to an unknown JSON value, validated by the check table below.
  const record = value as Record<string, unknown>;
  // SAFETY: `hasOwn` just proved `only` is one of the table's keys, so narrowing it to the key union is sound.
  const check = placeholderChecks[only as keyof typeof placeholderChecks];
  return check(record[only]);
};

/**
 * Turns entries into Wire frames.
 *
 * @since 0.1.0
 */
export interface Encoder {
  readonly encode: (entry: Entry) => WireEntry;
}

const base = (entry: Base) => ({
  at: entry.at,
  seq: entry.seq,
  session: entry.session,
  ...(entry.causedBy === undefined ? undefined : { causedBy: entry.causedBy }),
});
const boundaryOf = (entry: { readonly boundary?: number | undefined }) =>
  entry.boundary === undefined ? undefined : { boundary: entry.boundary };

const instanceBase = (entry: InstanceBase) => ({
  ...base(entry),
  component: entry.component.definition.name,
  instance: entry.instance,
  path: entry.path,
});
const run = (entry: CommandEnded | CommandInterrupted) => ({
  ...instanceBase(entry),
  issued: entry.issued,
  name: entry.name,
  spanId: entry.spanId ?? null,
  traceId: entry.traceId ?? null,
});

/**
 * Encodes any value as JSON, best effort, with the Wire's placeholders for
 * what has no JSON form.
 *
 * @since 0.1.0
 */
export const structural = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- `structural` walks any value a Schema or the runtime hands it; each Schema owns its input contract.
  value: unknown,
  seen = new Set<unknown>()
): Schema.Json => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the Wire dispatches on the JSON representation of each value.
  switch (typeof value) {
    case "string":
    case "boolean": {
      return value;
    }
    case "number": {
      return Number.isFinite(value) ? value : { "~unserialisable": "number" };
    }
    case "undefined": {
      return null;
    }
    case "bigint":
    case "symbol":
    case "function": {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the Wire dispatches on the JSON representation of each value.
      return { "~unserialisable": typeof value };
    }
    default: {
      break;
    }
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the Wire dispatches on the JSON representation of each value.
  if (value === null) {
    return null;
  }
  if (Redacted.isRedacted(value)) {
    return { "~redacted": true };
  }
  if (seen.has(value)) {
    return { "~unserialisable": "cycle" };
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? { "~unserialisable": "Date" }
      : value.toISOString();
  }
  if (value instanceof Error) {
    return { message: value.message, name: value.name };
  }
  // oxlint-disable-next-line eslint/no-use-before-define -- `structural` and `structuralObject` recurse into each other by design; one direction must read first.
  return structuralObject(value, seen);
};
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `structuralObject` walks the remainder the `switch` did not return; each Schema owns its input contract.
const structuralObject = (value: unknown, seen: Set<unknown>): Schema.Json => {
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => structural(item, seen));
    }
    // SAFETY: only a non-plain object reaches here, so reading its prototype is sound.
    const proto = Object.getPrototypeOf(value as object);
    if (proto !== Object.prototype && proto !== null) {
      // SAFETY: only a non-plain object reaches here, so reading its optional `toJSON` is sound.
      const withJson = value as { readonly toJSON?: unknown };
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- `toJSON` is an instance method or absent; `typeof` selects the callable case.
      if (typeof withJson.toJSON === "function") {
        // SAFETY: a class instance's `toJSON` is called with no arguments and must return JSON-serializable data; the result goes back through `structural`.
        // oxlint-disable-next-line anti-slop/no-unknown-returns -- `toJSON` is an instance method the value provides; `structural` validates its result.
        return structural((withJson.toJSON as () => unknown)(), seen);
      }
      if (
        value instanceof Map ||
        value instanceof Set ||
        ArrayBuffer.isView(value)
      ) {
        // SAFETY: only a non-plain object reaches here, so it has a constructor.
        return { "~unserialisable": (value as object).constructor.name };
      }
    }
    const out: Record<string, Schema.Json> = {};
    // SAFETY: the value is a plain record here (checked above), so its keys are strings.
    for (const key of Object.keys(value as object)) {
      // SAFETY: the value is a plain record here (checked above), so reading it by key is sound.
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the record's keys hold JSON values; each key was read from the value itself.
      const record = value as Record<string, unknown>;
      out[key] = structural(record[key], seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
};

// JSON has no `-0`, and `structural` has the placeholder for a number that isn't finite.
const encodeSubscription = (subscription: {
  readonly key: string;
  readonly name: string;
  readonly deps: readonly SubscriptionDep[] | undefined;
}) => ({
  deps:
    subscription.deps === undefined
      ? null
      : subscription.deps.map((dep) => (dep === 0 ? 0 : structural(dep))),
  key: subscription.key,
  name: subscription.name,
});

/** The redacting codec of `ast`, or `null` when it has none. */
const encoderOf = memoize(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- each codec owns its input and output contract; `encoderOf` only caches the codec per AST.
  (ast: SchemaAST.AST): ((value: unknown) => unknown) | null => {
    try {
      return Schema.encodeUnknownSync(
        Schema.toCodecJson(
          Schema.make<Schema.Codec<unknown, unknown>>(redactAST(ast))
        )
      );
    } catch {
      return null;
    }
  }
);
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- each AST owns the values its guard tests; the guard only reports membership.
const guardOf = memoize((ast: SchemaAST.AST): ((value: unknown) => boolean) => {
  const is = Schema.is(Schema.make<Schema.Top>(ast));
  return (value) => {
    try {
      return is(value);
    } catch {
      return false;
    }
  };
});
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the predicate tests plain records generically; every caller narrows through its own Schema.
const isPlainRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !Redacted.isRedacted(value);

/**
 * Detects objects anywhere in `ast` with a redacted index signature beside
 * another named or indexed signature. Each matching signature parses a key,
 * but the codec keeps only the named property's output or the last index
 * signature's. This can discard another signature's redaction, so these
 * Schemas bypass the whole codec.
 */
const holdsRedactedOverlap = memoize((ast: SchemaAST.AST): boolean => {
  const seen = new Set<SchemaAST.AST>();
  const visit = (node: SchemaAST.AST): boolean => {
    if (seen.has(node)) {
      return false;
    }
    seen.add(node);
    if (
      node.encoding !== undefined &&
      node.encoding.some((link) => visit(link.to))
    ) {
      return true;
    }
    switch (node._tag) {
      case "Objects": {
        return (
          (node.indexSignatures.length + node.propertySignatures.length > 1 &&
            node.indexSignatures.some((index) => holdsRedacted(index.type))) ||
          node.propertySignatures.some((property) => visit(property.type)) ||
          node.indexSignatures.some((index) => visit(index.type))
        );
      }
      case "Arrays": {
        return node.elements.some(visit) || node.rest.some(visit);
      }
      case "Union": {
        return node.types.some(visit);
      }
      case "Suspend": {
        return visit(node.thunk());
      }
      case "Declaration": {
        return node.typeParameters.some(visit);
      }
      default: {
        return false;
      }
    }
  };
  return visit(ast);
});

const redacted: Schema.Json = { "~redacted": true };
const failed: Schema.Json = { "~unserialisable": "encode" };
/** Reading a value can throw, from a getter. The log gets a placeholder for it instead. */
const guarded = (f: () => Schema.Json): Schema.Json => {
  try {
    return f();
  } catch {
    return failed;
  }
};
interface Walk {
  readonly path: Set<object>;
  readonly strict: boolean;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- each walk leaf Schema owns its value contract; the walk only routes values to it.
  readonly leaf: (ast: SchemaAST.AST, value: unknown) => Schema.Json;
}
// oxlint-disable-next-line anti-slop/no-object-parameters -- the path tracks object identity for cycle detection, never reads the value.
const within = <A>(path: Set<object>, value: object, f: () => A): A => {
  path.add(value);
  try {
    return f();
  } finally {
    path.delete(value);
  }
};
/**
 * Encodes `value` through `ast`. When the whole fails, a struct, record,
 * tuple or array is encoded part by part, and a union through the member the
 * value belongs to, so only the leaf that fails falls back. A failing leaf
 * whose Schema declares a `Schema.Redacted` anywhere is a placeholder, since
 * `structural` can't tell which of its values is secret.
 *
 * Nothing is read that the codec wouldn't read, until a leaf falls back. A
 * cyclic value makes the codec overflow the stack, which is a failure like
 * any other: the walk goes on part by part, and the repeat is a placeholder.
 */
const encodeAt = (
  ast: SchemaAST.AST,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- `encodeAt` walks any value the AST describes; each AST node owns its input contract.
  value: unknown,
  walk: Walk
): Schema.Json => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- cycle detection compares object identity, not parsed input.
  if (typeof value === "object" && value !== null && walk.path.has(value)) {
    return { "~unserialisable": "cycle" };
  }
  const overlap = holdsRedactedOverlap(ast);
  const encode = overlap ? null : encoderOf(ast);
  if (encode !== null) {
    try {
      // A Schema such as `Schema.Any` passes a value through, so the result goes through `structural` too.
      return structural(encode(value));
    } catch {
      // Encoded part by part below.
    }
  }
  if (
    walk.strict &&
    (!overlap || (ast.checks !== undefined && !guardOf(ast)(value)))
  ) {
    return walk.leaf(ast, value);
  }
  if (ast.encoding === undefined) {
    switch (ast._tag) {
      case "Suspend": {
        return encodeAt(ast.thunk(), value, walk);
      }
      case "Objects": {
        if (isPlainRecord(value)) {
          // oxlint-disable-next-line eslint/no-use-before-define -- `encodeAt` and `encodeObject` recurse into each other by design; one direction must read first.
          return within(walk.path, value, () => encodeObject(ast, value, walk));
        }
        break;
      }
      case "Arrays": {
        if (Array.isArray(value)) {
          // oxlint-disable-next-line eslint/no-use-before-define -- `encodeAt` and `encodeArray` recurse into each other by design; one direction must read first.
          return within(walk.path, value, () => encodeArray(ast, value, walk));
        }
        break;
      }
      case "Union": {
        const member = ast.types.find((type) => guardOf(type)(value));
        if (member !== undefined) {
          return encodeAt(member, value, walk);
        }
        break;
      }
      default: {
        break;
      }
    }
  }
  return walk.leaf(ast, value);
};
/**
 * The keys the parser outputs, each with every Schema that applies to it: its
 * property signature, if it has one, and every index signature it matches. The
 * parser runs all of them, even when it keeps only one output, so each one's
 * redaction counts. A key that matches nothing is left out. Only keys are read
 * here, never values.
 */
const encodeObject = (
  ast: SchemaAST.Objects,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the value is a struct or record being walked; each key keeps its own Schema from the AST.
  value: Record<PropertyKey, unknown>,
  walk: Walk
): Schema.Json => {
  const applies = new Map<string, SchemaAST.AST[]>();
  for (const property of ast.propertySignatures) {
    if (
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- property names are strings or symbols; `typeof` selects the named properties the parser outputs.
      typeof property.name === "string" &&
      Object.hasOwn(value, property.name)
    ) {
      applies.set(property.name, [property.type]);
    }
  }
  const properties = new Set(applies.keys());
  for (const index of ast.indexSignatures) {
    for (const key of getIndexSignatureKeys(value, index.parameter)) {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- index-signature keys are strings or symbols; `typeof` selects the string keys the parser outputs.
      if (typeof key !== "string") {
        continue;
      }
      const types = applies.get(key);
      if (types === undefined) {
        applies.set(key, [index.type]);
      } else if (!types.includes(index.type)) {
        types.push(index.type);
      }
    }
  }
  const out: Record<string, Schema.Json> = {};
  for (const [key, types] of applies) {
    // Under two Schemas, either one's redaction could apply, so it's a placeholder. Otherwise the
    // parser's output is kept: the property's, or else the last index signature's.
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the key is present in `applies`, so its list holds at least the type it was set with; `.at(-1)` only reads it back.
    const type = properties.has(key) ? types[0]! : types.at(-1)!;
    out[key] =
      types.length > 1 && types.some(holdsRedacted)
        ? redacted
        : guarded(() => encodeAt(type, value[key], walk));
  }
  return out;
};
/** Elements, then the rest, then the trailing elements, which take the last positions. */
const encodeArray = (
  ast: SchemaAST.Arrays,
  value: readonly unknown[],
  walk: Walk
): Schema.Json => {
  const [rest, ...tail] = ast.rest;
  const tailStart = Math.max(ast.elements.length, value.length - tail.length);
  return value.map((item, i) => {
    let element: SchemaAST.AST | undefined;
    if (i < ast.elements.length) {
      element = ast.elements[i];
    } else if (rest !== undefined && i >= tailStart) {
      element = tail[i - tailStart];
    } else {
      element = rest;
    }
    return element === undefined
      ? walk.leaf(ast, item)
      : encodeAt(element, item, walk);
  });
};
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the fallback walks whatever the codec rejected; the leaf Schema owns the value's contract.
const fallback = (ast: SchemaAST.AST, value: unknown): Schema.Json =>
  holdsRedacted(ast) ? redacted : guarded(() => structural(value));

/**
 * Encodes a value through a Schema with every `Schema.Redacted` redacted. A
 * leaf that fails to encode, such as a `File` under `Schema.instanceOf`,
 * falls back to `structural` on its own, and its siblings keep their codecs.
 * It never throws: a value that can't be read is a placeholder.
 *
 * @internal
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `encodeArgs` walks the value its Schema describes; the Schema owns each leaf's contract.
export const encodeArgs = (schema: Schema.Top, value: unknown): Schema.Json => {
  const walk: Walk = { leaf: fallback, path: new Set(), strict: false };
  // A struct or a class is encoded field by field.
  // SAFETY: the struct-or-class fast path reads declared fields; the cast only names the optional fields record the Schema may carry.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the Schema type cannot name the optional fields record; the unknown hop is the only sound cast.
  const { fields } = schema as unknown as {
    readonly fields?: Schema.Struct.Fields;
  };
  if (fields !== undefined && isPlainRecord(value)) {
    return within(walk.path, value, () => {
      const out: Record<string, Schema.Json> = {};
      for (const key of Object.keys(fields)) {
        if (!Object.hasOwn(value, key)) {
          continue;
        }
        out[key] = guarded(() =>
          // SAFETY: the field exists in the struct, so reading its Schema is sound.
          encodeAt((fields[key] as Schema.Top).ast, value[key], walk)
        );
      }
      return out;
    });
  }
  return guarded(() => encodeAt(schema.ast, value, walk));
};

const encodeSource = (source: Source): typeof SourceWire.Type => {
  switch (source._tag) {
    case "Command": {
      return {
        ...source,
        spanId: source.spanId ?? null,
        traceId: source.traceId ?? null,
      };
    }
    case "Mount": {
      return {
        _tag: "Mount",
        args: encodeArgs(source.argsSchema, source.args),
        name: source.name,
        seq: source.seq,
      };
    }
    case "Subscription": {
      return { _tag: "Subscription", ...encodeSubscription(source) };
    }
    default: {
      return source;
    }
  }
};

// The scheduling key holds the group fields' real encoding, so the log re-encodes them redacted.
const encodeGroup = (command: LoggedCommand): string | null => {
  if (command.groupKey === undefined) {
    return null;
  }
  const source = command["~group"];
  return source === undefined
    ? JSON.stringify({ "~redacted": true })
    : canonical(encodeArgs(source.schema, source.picked));
};
/**
 * Encodes a Command by name, group and args. Args and group fields use the
 * Command's `args` Schema, replacing every `Schema.Redacted` with a
 * placeholder. A leaf that fails to encode falls back to structural encoding.
 * An `Interrupt` has `null` args.
 *
 * @since 0.1.0
 */
export const encodeCommand = (
  command: LoggedCommand
): typeof CommandWire.Type => ({
  _tag: command._tag,
  args:
    command._tag === "Interrupt"
      ? null
      : encodeArgs(command.argsSchema, command.args),
  group: encodeGroup(command),
  name: command.name,
});

/**
 * Encodes a `$.send` as the owner's definition name and the message. The
 * message goes through the owner's `receives` Schema the way `encodeArgs`
 * encodes Command args: redacted, with a structural fallback for what doesn't
 * encode.
 *
 * @since 0.1.0
 */
export const encodeSend = (
  send: Send
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the annotation states the public Wire shape of a send; inference would inline it into the signature.
): { readonly owner: string; readonly message: Schema.Json } => ({
  message: encodeArgs(send.owner.definition.receives, send.message),
  owner: send.owner.definition.name,
});

const encodeCause = (cause: Cause.Cause<unknown>): typeof CauseWire.Type => ({
  pretty: Cause.pretty(cause),
  reasons: cause.reasons.map((reason): Schema.Json => {
    if (Cause.isFailReason(reason)) {
      return { _tag: "Fail", error: structural(reason.error) };
    }
    if (Cause.isDieReason(reason)) {
      return { _tag: "Die", defect: structural(reason.defect) };
    }
    return { _tag: "Interrupt", fiberId: reason.fiberId ?? null };
  }),
});

const utf8Length = (text: string): number => {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    // oxlint-disable-next-line unicorn/prefer-code-point -- byte counting walks UTF-16 units on purpose; a code point would skip the trailing surrogate the loop already counts.
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x8_00) {
      bytes += 2;
    } else if (code >= 0xd8_00 && code < 0xdc_00) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
};
/**
 * Makes an encoder. `onWarning` is called once per component and field the
 * first time its Schema fails to encode a value, which is sent as a
 * placeholder instead.
 *
 * @since 0.1.0
 */
export const makeEncoder = (options?: {
  readonly maxEntryBytes?: number | undefined;
  readonly onWarning?: ((message: string) => void) | undefined;
}): Encoder => {
  const maxEntryBytes = options?.maxEntryBytes ?? Infinity;
  const warned = new Set<string>();
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the cache holds one redacting codec per Schema; each codec owns its input and output contract.
  const encoders = new WeakMap<Schema.Top, (value: unknown) => unknown>();
  const warn = (id: string, error: string) => {
    if (warned.has(id)) {
      return;
    }
    warned.add(id);
    options?.onWarning?.(
      `MessageLog: ${id} failed to encode, so it's sent as a placeholder: ${error}`
    );
  };
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- `encodeWith` forwards the value to the field Schema, which owns its contract; failures become placeholders.
  const encodeWith = (schema: Schema.Top, id: string, value: unknown) => {
    if (holdsRedactedOverlap(schema.ast)) {
      let rejected = false;
      const out = guarded(() =>
        encodeAt(schema.ast, value, {
          leaf: () => {
            rejected = true;
            return failed;
          },
          path: new Set(),
          strict: true,
        })
      );
      if (rejected) {
        warn(id, "a part of it didn't match its Schema");
      }
      return out;
    }
    let encode = encoders.get(schema);
    if (encode === undefined) {
      encode = Schema.encodeUnknownSync(
        Schema.toCodecJson(
          Schema.make<Schema.Codec<unknown, unknown>>(redactAST(schema.ast))
        )
      );
      encoders.set(schema, encode);
    }
    try {
      // SAFETY: the codec either encodes the value or throws (handled as a placeholder below), so a successful result is JSON.
      return encode(value) as Schema.Json;
    } catch (error) {
      warn(id, String(error));
      return failed;
    }
  };
  const through = (
    component: LoggedComponent,
    field: "props" | "model" | "message" | "events",
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- `through` forwards the Model, message, props or events value to the field Schema below, which owns its contract.
    value: unknown
  ) =>
    // SAFETY: the field Schema encodes the component's value, so the frame holds JSON.
    encodeWith(
      component.definition[field] as Schema.Top,
      `${component.definition.name}.${field}`,
      value
    );
  const cap = (encoded: Schema.Json): Schema.Json => {
    if (maxEntryBytes === Infinity) {
      return encoded;
    }
    const bytes = utf8Length(JSON.stringify(encoded));
    return bytes > maxEntryBytes ? { "~truncated": bytes } : encoded;
  };
  const encodeQueries = (
    component: LoggedComponent,
    results: Results | undefined
  ) => {
    if (results === undefined) {
      return {};
    }
    const schema = component["~queries"]?.logSchema;
    // SAFETY: the query Schema encodes a present result, so the frame holds JSON.
    return {
      queries:
        schema === undefined
          ? { "~unserialisable": "encode" }
          : cap(
              encodeWith(
                schema,
                `${component.definition.name}.queries`,
                results
              ) as Schema.Json
            ),
    };
  };
  const encodeShared = (
    component: LoggedComponent,
    shared: SharedRecord | undefined
  ) => {
    if (shared === undefined) {
      return {};
    }
    const out: Record<string, Schema.Json> = {};
    for (const read of component.definition.reads ?? []) {
      const value = shared[read.name];
      if (value === undefined) {
        continue;
      }
      const schema = read.owner.definition.sharesSchema;
      // SAFETY: the field Schema encodes a present shared value, so the frame holds JSON.
      out[read.name] =
        schema === undefined
          ? structural(value)
          : (encodeWith(
              schema,
              `${read.owner.definition.name}.shares`,
              value
            ) as Schema.Json);
    }
    return { shared: cap(out) };
  };
  // A message can carry a query's whole result, so messages are capped like Models and query results.
  // SAFETY: the entry carries a `model` or `message`, so encoding it through the field Schema yields a frame.
  const capped = (
    component: LoggedComponent,
    field: "model" | "message",
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- `capped` forwards the Model or message value to the field Schema, which owns its contract.
    value: unknown
  ): Schema.Json => cap(through(component, field, value) as Schema.Json);
  // SAFETY: the entry carries `props`, so encoding them yields a frame.
  const props = (entry: {
    readonly component: LoggedComponent;
    readonly props: unknown;
  }) => through(entry.component, "props", entry.props) as Schema.Json;
  // SAFETY: the entry carries `events`, so encoding them yields frames.
  const events = (entry: {
    readonly component: LoggedComponent;
    readonly events: readonly unknown[];
  }) =>
    entry.events.map(
      (emitted) => through(entry.component, "events", emitted) as Schema.Json
    );
  const encodeTable: {
    readonly [K in Entry["_tag"]]: (
      entry: Extract<Entry, { readonly _tag: K }>
    ) => WireEntry;
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- the table must stay total over every entry tag; inference would inline all twenty-four encoders into the signature.
  } = {
    CommandAwaiting: (entry: CommandAwaiting) => ({
      _tag: "CommandAwaiting",
      ...instanceBase(entry),
      entries: entry.entries,
      issued: entry.issued,
      name: entry.name,
    }),
    CommandDropped: (entry: CommandDropped) => ({
      _tag: "CommandDropped",
      ...instanceBase(entry),
      issued: entry.issued,
      name: entry.name,
      reason: entry.reason,
    }),
    CommandEnded: (entry: CommandEnded) => ({
      _tag: "CommandEnded",
      ...run(entry),
      silent: entry.silent,
      ...(entry.waitEnded === undefined
        ? undefined
        : { waitEnded: entry.waitEnded }),
      ...(entry.outstanding === undefined
        ? undefined
        : { outstanding: entry.outstanding }),
    }),
    CommandInterrupted: (entry: CommandInterrupted) => ({
      _tag: "CommandInterrupted",
      ...run(entry),
      reason: entry.reason,
    }),
    CommandStarted: (entry: CommandStarted) => ({
      _tag: "CommandStarted",
      ...instanceBase(entry),
      issued: entry.issued,
      name: entry.name,
      spanId: entry.spanId,
      traceId: entry.traceId,
    }),
    Drawn: (entry: Drawn) => ({ _tag: entry._tag, ...instanceBase(entry) }),
    Failed: (entry: Failed) => ({
      _tag: "Failed",
      ...instanceBase(entry),
      cause: encodeCause(entry.cause),
      in: entry.in,
      name: entry.name ?? null,
      props: props(entry),
      ...(entry.update === undefined
        ? undefined
        : {
            update: {
              message: capped(entry.component, "message", entry.update.message),
              source: encodeSource(entry.update.source),
            },
          }),
      ...(entry.issued === undefined ? undefined : { issued: entry.issued }),
    }),
    FetchStarted: (entry: FetchStarted) => ({
      _tag: "FetchStarted",
      ...base(entry),
      inWindow: entry.inWindow,
      logKey: entry.logKey,
      query: entry.query,
      restart: entry.restart,
      stored: entry.stored,
      trigger: entry.trigger,
      ...(entry.page === undefined ? undefined : { page: entry.page }),
      ...(entry.cursor === undefined ? undefined : { cursor: entry.cursor }),
    }),
    Kept: (entry: Kept) => ({ _tag: entry._tag, ...instanceBase(entry) }),
    LayerFailed: (entry: LayerFailed) => ({
      _tag: "LayerFailed",
      ...instanceBase(entry),
      cause: encodeCause(entry.cause),
      ...(entry.redacted === true ? { redacted: true } : undefined),
    }),
    LayerPending: (entry: LayerPending) => ({
      _tag: "LayerPending",
      ...instanceBase(entry),
      status: entry.status,
    }),
    LayerReady: (entry: LayerReady) => ({
      _tag: entry._tag,
      ...instanceBase(entry),
    }),
    MountEnded: (entry: MountEnded) => ({
      _tag: "MountEnded",
      ...instanceBase(entry),
      name: entry.name,
      reason: entry.reason,
      silent: entry.silent,
      started: entry.started,
    }),
    MountStarted: (entry: MountStarted) => ({
      _tag: "MountStarted",
      ...instanceBase(entry),
      args: encodeArgs(entry.argsSchema, entry.args),
      name: entry.name,
    }),
    Mounted: (entry: Mounted) => ({
      _tag: "Mounted",
      ...instanceBase(entry),
      adopted: entry.adopted,
      commands: entry.commands.map(encodeCommand),
      events: events(entry),
      model: capped(entry.component, "model", entry.model),
      props: props(entry),
      ...encodeQueries(entry.component, entry.queries),
      ...boundaryOf(entry),
    }),
    PropsChanged: (entry: PropsChanged) => ({
      _tag: "PropsChanged",
      ...instanceBase(entry),
      props: props(entry),
    }),
    QueryChanged: (entry: QueryChanged) => {
      const schema = entry.component["~queries"]?.logSchema.fields[entry.name];
      // SAFETY: the query Schema encodes a present result, so the frame holds JSON.
      return {
        _tag: "QueryChanged",
        ...instanceBase(entry),
        name: entry.name,
        result:
          schema === undefined
            ? { "~unserialisable": "encode" }
            : cap(
                encodeWith(
                  schema,
                  `${entry.component.definition.name}.queries.${entry.name}`,
                  entry.result
                ) as Schema.Json
              ),
      };
    },
    SendDropped: (entry: SendDropped) => ({
      _tag: "SendDropped",
      ...instanceBase(entry),
      issued: entry.issued,
      owner: entry.owner,
    }),
    SessionStarted: (entry: SessionStarted) => ({
      _tag: "SessionStarted",
      ...base(entry),
      app: entry.app,
    }),
    SubscriptionStarted: (entry: SubscriptionStarted) => ({
      _tag: entry._tag,
      ...instanceBase(entry),
      ...encodeSubscription(entry),
    }),
    SubscriptionStopped: (entry: SubscriptionStopped) => ({
      _tag: entry._tag,
      ...instanceBase(entry),
      ...encodeSubscription(entry),
    }),
    Unmounted: (entry: Unmounted) => ({
      _tag: entry._tag,
      ...instanceBase(entry),
    }),
    Update: (entry: Update) => ({
      _tag: "Update",
      ...instanceBase(entry),
      message: capped(entry.component, "message", entry.message),
      model: capped(entry.component, "model", entry.model),
      props: props(entry),
      source: encodeSource(entry.source),
      ...encodeQueries(entry.component, entry.queries),
      ...encodeShared(entry.component, entry.shared),
      commands: entry.commands.map(encodeCommand),
      events: events(entry),
      lists: entry.lists,
      sends: entry.sends.map((send) => {
        const encoded = encodeSend(send);
        return { ...encoded, message: cap(encoded.message) };
      }),
      ...(entry.viewTransition === undefined
        ? undefined
        : { viewTransition: entry.viewTransition }),
      ...boundaryOf(entry),
    }),
    Waiting: (entry: Waiting) => ({
      _tag: "Waiting",
      ...instanceBase(entry),
      model: capped(entry.component, "model", entry.model),
      props: props(entry),
      ...encodeQueries(entry.component, entry.queries),
      ...boundaryOf(entry),
    }),
  };
  return {
    encode(entry) {
      const encodeEntry = encodeTable[entry._tag];
      // SAFETY: the table is total over `Entry["_tag"]`, so the tag always selects its own encoder; the cast only satisfies the uncorrelated call.
      return (encodeEntry as (entry: Entry) => WireEntry)(entry);
    },
  };
};

/**
 * Makes a log that encodes entries off the runtime's path. `record` only
 * queues an entry. A fiber in the current Scope takes everything queued,
 * encodes it as Wire frames, and passes the batch to `onBatch`.
 *
 * **Details**
 *
 * The runtime calls `record` on every `update`, so a sink that sends frames
 * somewhere builds on this rather than encode inside `record`. A value whose
 * Schema fails to encode is sent as a placeholder, and a warning is logged
 * the first time per component and field. `maxEntryBytes` caps Models,
 * messages, query results and shared values, as in `makeEncoder`. A batch
 * whose `onBatch` dies is dropped, and an error is logged. Entries
 * recorded once the Scope has closed are dropped.
 *
 * **Example** (Keeping encoded frames in an array)
 *
 * ```ts
 * import { MessageLog } from "@ilha/model"
 * import { Effect, Layer } from "effect"
 *
 * const frames: Array<MessageLog.WireEntry> = []
 *
 * const FramesLog = Layer.effect(
 *   MessageLog.MessageLog,
 *   MessageLog.makeEncoded((batch) => Effect.sync(() => frames.push(...batch)))
 * )
 * ```
 *
 * @since 0.1.0
 */
export const makeEncoded = (
  onBatch: (batch: readonly WireEntry[]) => Effect.Effect<void>,
  options?: { readonly maxEntryBytes?: number | undefined }
): Effect.Effect<MessageLog, never, Scope.Scope> =>
  Effect.gen(function* makeEncodedInner() {
    const entries = yield* Queue.unbounded<Entry>();
    const warnings: string[] = [];
    const encoder = makeEncoder({
      maxEntryBytes: options?.maxEntryBytes,
      onWarning: (message) => warnings.push(message),
    });
    yield* Queue.takeAll(entries).pipe(
      Effect.flatMap((batch) =>
        Effect.suspend(() => {
          const frames = batch.map((entry) => encoder.encode(entry));
          const logged = warnings.splice(0);
          return Effect.andThen(
            Effect.catchCause(
              Effect.suspend(() => onBatch(frames)),
              (cause) =>
                Effect.logError(
                  "MessageLog: onBatch failed, and its batch was dropped",
                  cause
                )
            ),
            logged.length === 0
              ? Effect.void
              : // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument -- `Effect.forEach` logs each warning as an Effect; the second argument is the mapping function, not a `thisArg`.
                Effect.forEach(logged, (message) => Effect.logWarning(message))
          );
        })
      ),
      Effect.forever,
      Effect.ensuring(Queue.shutdown(entries)),
      Effect.forkScoped
    );
    return {
      enabled: true,
      record: (entry: Entry) => {
        Queue.offerUnsafe(entries, entry);
      },
    };
  });

/**
 * Streams entries to a devtools process over a WebSocket, as newline-free
 * JSON Wire frames, one per message.
 *
 * **Details**
 *
 * Entries are encoded by `makeEncoded`. The Layer keeps the last `buffer`
 * frames (1,000 by default), which every new connection receives after its
 * `Hello`, so devtools that connect late see the recent past. A lost
 * connection is retried with backoff, and one warning is logged.
 *
 * @since 0.1.0
 */
export const socket = (
  url: string,
  options?: {
    readonly buffer?: number | undefined;
    readonly maxEntryBytes?: number | undefined;
    readonly host?: WireHost | undefined;
  }
): Layer.Layer<never, never, Socket.WebSocketConstructor> =>
  Layer.effect(
    MessageLog,
    Effect.gen(function* socketInner() {
      const size = Math.max(1, options?.buffer ?? 1000);
      const outbox = yield* Queue.unbounded<string>();
      const replay: string[] = [];
      const hello = JSON.stringify({
        _tag: "Hello",
        host: options?.host ?? "browser",
        version: wireVersion,
      });

      const log = yield* makeEncoded(
        (batch) =>
          Effect.sync(() => {
            for (const encoded of batch) {
              const frame = JSON.stringify(encoded);
              replay.push(frame);
              if (replay.length > size) {
                replay.shift();
              }
              Queue.offerUnsafe(outbox, frame);
            }
          }),
        { maxEntryBytes: options?.maxEntryBytes }
      );

      const connection = Effect.gen(function* connection() {
        const ws = yield* Socket.makeWebSocket(url);
        const writer = yield* ws.writer;
        const reader = yield* ws.reader;
        // What's queued is already in the replay buffer, so it's sent from there.
        const backlog = yield* Effect.map(Queue.clear(outbox), () => [
          hello,
          ...replay,
        ]);
        // oxlint-disable-next-line unicorn/no-array-for-each -- `Effect.forEach` writes each buffered frame, it is not `Array#forEach`; no loop can run it.
        yield* Effect.forEach(backlog, (frame) => writer.write(frame), {
          discard: true,
        });
        return yield* Effect.raceFirst(
          Effect.forever(
            Effect.flatMap(Queue.take(outbox), (frame) => writer.write(frame))
          ),
          Effect.forever(reader.pull)
        );
      }).pipe(Effect.scoped);

      let warned = false;
      yield* connection.pipe(
        Effect.tapCause((cause) =>
          warned
            ? Effect.void
            : Effect.suspend(() => {
                warned = true;
                return Effect.logWarning(
                  `MessageLog: lost the connection to ${url}, retrying`,
                  cause
                );
              })
        ),
        Effect.retry(
          Schedule.min([
            Schedule.exponential("200 millis"),
            Schedule.spaced("10 seconds"),
          ])
        ),
        Effect.forever,
        Effect.forkScoped
      );

      return log;
    })
  );
