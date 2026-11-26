/** Wire frame types for `@ilha/model` logs, restated so this package loads without it. */
import type * as Schema from "effect/Schema";

/** Where a log comes from, as `Hello` reports it. */
export type WireHost = "browser" | "server" | "terminal" | "test";

/** Which Command run an entry is about: the `seq` of the entry that issued it and its index. */
export interface Issued {
  readonly seq: number;
  readonly index: number;
}

/** What stopped a Command run, as `CommandInterrupted` reports it. */
export type InterruptReason =
  | "interrupt"
  | "switch"
  | "unmount"
  | "layer"
  | "self";

/** How a `Command.afterRefetch` wait ended. */
export type WaitEnded =
  | "settled"
  | "nothing"
  | "budget"
  | "switch"
  | "interrupt"
  | "closed";

/** An entry a `Command.afterRefetch` run waits for: the query's name and the entry's log key. */
export interface AwaitedEntry {
  readonly query: string;
  readonly logKey: string;
}

/** A Command as an issuing entry carries it: its definition tag, name, group and encoded args. */
export interface WireCommand {
  readonly _tag: "Effect" | "Stream" | "Interrupt";
  readonly name: string;
  readonly group: string | null;
  readonly args: Schema.Json;
}

/** What sent the message an `update` handled. */
export type WireSource =
  | { readonly _tag: "DomEvent"; readonly name: string }
  | {
      readonly _tag: "Command";
      readonly name: string;
      readonly issued: Issued;
      readonly spanId: string | null;
      readonly traceId: string | null;
    }
  | {
      readonly _tag: "Subscription";
      readonly key: string;
      readonly name: string;
      readonly deps: readonly Schema.Json[] | null;
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
      readonly name: string;
      readonly seq: number;
      readonly args: Schema.Json;
    }
  | { readonly _tag: "Dispatch" };

/** A Cause as the Wire sends it: pretty text plus best-effort reasons. */
export interface WireCause {
  readonly pretty: string;
  readonly reasons: readonly Schema.Json[];
}

/** A value the encoder sent in place of one it couldn't or mustn't send. */
export type Placeholder =
  | { readonly "~unserialisable": string }
  | { readonly "~redacted": true }
  | { readonly "~truncated": number };

/** Whether a JSON value from a Wire frame is a `Placeholder`. */
export const isPlaceholder = (value: unknown): value is Placeholder => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  // SAFETY: members are JSON values; each is narrowed by the key check below.
  const entries = Object.entries(value) as [string, unknown][];
  if (entries.length !== 1) {
    return false;
  }
  const [first] = entries;
  if (first === undefined) {
    return false;
  }
  const [key, member] = first;
  switch (key) {
    case "~unserialisable": {
      return typeof member === "string";
    }
    case "~redacted": {
      return member === true;
    }
    case "~truncated": {
      return typeof member === "number";
    }
    default: {
      return false;
    }
  }
};

/** Fields every entry has: its number, its time, its session, and the entry it follows from. */
export interface WireBase {
  readonly seq: number;
  readonly at: number;
  readonly session: string;
  readonly causedBy?: number | undefined;
}

/** Fields every entry about an instance has: its path, its number and its component name. */
export interface WireInstance extends WireBase {
  readonly path: string;
  readonly instance: number;
  readonly component: string;
}

/** A `mount` or a server render started. */
export interface WireSessionStarted extends WireBase {
  readonly _tag: "SessionStarted";
  readonly app: string;
}

/** The query cache started a fetch. */
export interface WireFetchStarted extends WireBase {
  readonly _tag: "FetchStarted";
  readonly query: string;
  readonly logKey: string;
  readonly trigger:
    | "watch"
    | "get"
    | "prefetch"
    | "visibility"
    | "connectivity"
    | "interval"
    | "invalidation"
    | "loadMore"
    | "reset";
  readonly restart: boolean;
  readonly inWindow: boolean;
  readonly stored: boolean;
  readonly page?: number | undefined;
  readonly cursor?: Schema.Json | undefined;
}

/** A hydrating instance waiting for its provided Layer. */
export interface WireWaiting extends WireInstance {
  readonly _tag: "Waiting";
  readonly props: Schema.Json;
  readonly model: Schema.Json;
  readonly queries?: Schema.Json | undefined;
  readonly boundary?: number | undefined;
}

/** An instance mounted: its props, its Model, its query results, and the Commands `init` returned. */
export interface WireMounted extends WireInstance {
  readonly _tag: "Mounted";
  readonly props: Schema.Json;
  readonly model: Schema.Json;
  readonly queries?: Schema.Json | undefined;
  readonly commands: readonly WireCommand[];
  readonly events: readonly Schema.Json[];
  readonly adopted: boolean;
  readonly boundary?: number | undefined;
}

/** One `update` call: the message, what sent it, and the instance's whole state after it. */
export interface WireUpdate extends WireInstance {
  readonly _tag: "Update";
  readonly source: WireSource;
  readonly message: Schema.Json;
  readonly props: Schema.Json;
  readonly model: Schema.Json;
  readonly queries?: Schema.Json | undefined;
  readonly shared?: Schema.Json | undefined;
  readonly commands: readonly WireCommand[];
  readonly events: readonly Schema.Json[];
  readonly lists: readonly {
    readonly name: string;
    readonly op: "loadMore" | "reset";
  }[];
  readonly sends: readonly {
    readonly owner: string;
    readonly message: Schema.Json;
  }[];
  readonly viewTransition?: readonly string[] | undefined;
  readonly boundary?: number | undefined;
}

/** A mounted instance got new props from its parent, without a re-key. */
export interface WirePropsChanged extends WireInstance {
  readonly _tag: "PropsChanged";
  readonly props: Schema.Json;
}

/** A query's result changed: the runtime wrote what the query last returned at its args. */
export interface WireQueryChanged extends WireInstance {
  readonly _tag: "QueryChanged";
  readonly name: string;
  readonly result: Schema.Json;
}

/** An instance's provided Layer is still building. */
export interface WireLayerPending extends WireInstance {
  readonly _tag: "LayerPending";
  readonly status?: "Pending" | "Rebuilding" | "Awaiting" | undefined;
}

/** The Layer an earlier `LayerPending` waited for is built. */
export interface WireLayerReady extends WireInstance {
  readonly _tag: "LayerReady";
}

/** A provided Layer failed to build. */
export interface WireLayerFailed extends WireInstance {
  readonly _tag: "LayerFailed";
  readonly cause: WireCause;
  readonly redacted?: boolean | undefined;
}

/** An instance failed, with the Cause and where it happened. */
export interface WireFailed extends WireInstance {
  readonly _tag: "Failed";
  readonly props: Schema.Json;
  readonly in: string;
  readonly name: string | null;
  readonly cause: WireCause;
  readonly update?:
    | { readonly message: Schema.Json; readonly source: WireSource }
    | undefined;
  readonly issued?: Issued | undefined;
}

/** An instance left the tree. */
export interface WireUnmounted extends WireInstance {
  readonly _tag: "Unmounted";
}

/** A kept-alive child that no view writes now took its nodes out of the document. */
export interface WireKept extends WireInstance {
  readonly _tag: "Kept";
}

/** A kept child was written again and put its nodes back in the document. */
export interface WireDrawn extends WireInstance {
  readonly _tag: "Drawn";
}

/** An element's mount body started after commit, with these args. */
export interface WireMountStarted extends WireInstance {
  readonly _tag: "MountStarted";
  readonly name: string;
  readonly args: Schema.Json;
}

/** The mount body returned, its Scope closed first, or the body failed. */
export interface WireMountEnded extends WireInstance {
  readonly _tag: "MountEnded";
  readonly name: string;
  readonly started: number;
  readonly reason: "completed" | "closed" | "failed";
  readonly silent: boolean;
}

/** A Command run's fiber started its work, in the run's span. */
export interface WireCommandStarted extends WireInstance {
  readonly _tag: "CommandStarted";
  readonly name: string;
  readonly issued: Issued;
  readonly spanId: string;
  readonly traceId: string;
}

/** A run issued with `Command.afterRefetch` succeeded and waits for the refetches. */
export interface WireCommandAwaiting extends WireInstance {
  readonly _tag: "CommandAwaiting";
  readonly name: string;
  readonly issued: Issued;
  readonly entries: readonly AwaitedEntry[];
}

/** A Command run ended with a result. */
export interface WireCommandEnded extends WireInstance {
  readonly _tag: "CommandEnded";
  readonly name: string;
  readonly issued: Issued;
  readonly spanId: string | null;
  readonly traceId: string | null;
  readonly silent: boolean;
  readonly waitEnded?: WaitEnded | undefined;
  readonly outstanding?: readonly AwaitedEntry[] | undefined;
}

/** A Command run was interrupted and dispatched nothing. */
export interface WireCommandInterrupted extends WireInstance {
  readonly _tag: "CommandInterrupted";
  readonly name: string;
  readonly issued: Issued;
  readonly spanId: string | null;
  readonly traceId: string | null;
  readonly reason: InterruptReason;
}

/** A Command that never ran: dropped by the server, where no Command runs. */
export interface WireCommandDropped extends WireInstance {
  readonly _tag: "CommandDropped";
  readonly name: string;
  readonly issued: Issued;
  readonly reason: "server";
}

/** A `$.send` that reached no owner. */
export interface WireSendDropped extends WireInstance {
  readonly _tag: "SendDropped";
  readonly owner: string;
  readonly issued: Issued;
}

/** A Subscription's key started. */
export interface WireSubscriptionStarted extends WireInstance {
  readonly _tag: "SubscriptionStarted";
  readonly key: string;
  readonly name: string;
  readonly deps: readonly Schema.Json[] | null;
}

/** A Subscription's key stopped. */
export interface WireSubscriptionStopped extends WireInstance {
  readonly _tag: "SubscriptionStopped";
  readonly key: string;
  readonly name: string;
  readonly deps: readonly Schema.Json[] | null;
}

/** The Wire's form of an entry, without the `Hello` frame. */
export type WireEntry =
  | WireSessionStarted
  | WireFetchStarted
  | WireWaiting
  | WireMounted
  | WireUpdate
  | WirePropsChanged
  | WireQueryChanged
  | WireLayerPending
  | WireLayerReady
  | WireLayerFailed
  | WireFailed
  | WireUnmounted
  | WireKept
  | WireDrawn
  | WireMountStarted
  | WireMountEnded
  | WireCommandStarted
  | WireCommandAwaiting
  | WireCommandEnded
  | WireCommandInterrupted
  | WireCommandDropped
  | WireSendDropped
  | WireSubscriptionStarted
  | WireSubscriptionStopped;

/** One frame of the Wire: a `Hello` once per connection, then entries with encoded values. */
export type WireFrame =
  | {
      readonly _tag: "Hello";
      readonly version: number;
      readonly host: WireHost;
    }
  | WireEntry;
