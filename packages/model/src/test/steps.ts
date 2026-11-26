import type * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Schema from "effect/Schema";

import type * as Command from "../command.ts";
import type { EngineInternals } from "./engine.ts";
/**
 * The steps every kind of test shares, and the data they work on. `Story`
 * and `Scene` drive the pure engine in `engine.ts`; `Play` drives the real
 * runtime and only reuses the locator and error vocabulary here.
 *
 * The acknowledgement rule (ported from Effect UI's `testing §1`):
 * message steps throw while a Command is pending (unless it is exempt: a
 * `switch` or `queue` Command, a stream Command, or anything named by
 * `keepPending`), while an enabled query has no result at its args, or while
 * a Scene mount isn't acknowledged. Every acting step throws while an
 * emitted event, a `$.send`, or an ignored interaction isn't acknowledged.
 * Pure assertions never trigger the checks. `make`'s end check additionally
 * fails on kept or exempt work; `start` cursors never run it.
 */
/**
 * Any model component a test cursor can drive, whatever its props, Model,
 * messages, requirements, events or queries. Structural on purpose: the
 * generic `ModelComponent` call options distribute into a signature no
 * concrete component satisfies, so the constraint names only the
 * definition Schemas it recovers. Never called; only extended.
 */
export interface AnyComponent {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- erased components return views of any shape; callers narrow through their own schemas.
  (options: never): unknown;
  readonly definitionName: string;
  readonly definition: {
    readonly props: Schema.Schema<unknown>;
    readonly model: Schema.Schema<unknown>;
    readonly message: Schema.Schema<unknown>;
    readonly events: Schema.Schema<unknown>;
  };
}

/** The props of a component under test. */
export type PropsOf<C extends AnyComponent> = C extends {
  readonly definition: { readonly props: Schema.Schema<infer P> };
}
  ? P
  : never;
/** The Model of a component under test. */
export type ModelOf<C extends AnyComponent> = C extends {
  readonly definition: { readonly model: Schema.Schema<infer M> };
}
  ? M
  : never;
/** The messages a component's `update` handles. */
export type MessageOf<C extends AnyComponent> = C extends {
  readonly definition: { readonly message: Schema.Schema<infer M> };
}
  ? M
  : never;
/** The events a component emits to its author's `onEmit`. */
export type EventsOf<C extends AnyComponent> = C extends {
  readonly definition: { readonly events: Schema.Schema<infer E> };
}
  ? E
  : never;

/**
 * A Command issued by the instance whose message hasn't been delivered.
 */
export interface Pending {
  /** The issued Command (or interrupt-free definition match) as issued. */
  readonly command: Command.Issued<unknown, never>;
  /** Where the run is: `running`, or `queued` behind its group. */
  readonly status: "running" | "queued" | "awaiting" | "stopping";
  /** The message a settled run will deliver, once an extension sets it. */
  readonly message?: unknown | undefined;
}

/**
 * A query an `afterRefetch` run waits on, by its name in the component. The
 * query runtime fills this in when a run settles while its queries reload.
 */
export interface AwaitedQuery {
  readonly name: string;
  readonly args: unknown;
}

/**
 * The state of one instance between steps that every kind of test records.
 * `sent` holds unacknowledged `$.send`s (nothing receives them in a test).
 * `interrupted` holds runs cut by `switch` or an interrupt; it needs no
 * acknowledgement. `reports` is what the component reports to each owner it
 * `reads` with `report` (the shared-state slice fills it in).
 */
// `_Model`/`_Msg` are unused by the shape but keep the four-parameter
// `Record<Props, Model, Msg, Events>` contract cursors share.
export interface Record<Props, _Model, _Msg, Events> {
  readonly component: AnyComponent;
  readonly props: Props;
  readonly pending: readonly Pending[];
  readonly emitted: readonly Events[];
  readonly sent: readonly {
    readonly owner: string;
    readonly message: unknown;
  }[];
  readonly interrupted: readonly Command.Issued<unknown, never>[];
  readonly loadingMore: readonly string[];
  /** The Subscription keys the current Model and props ask for, without query watches. */
  readonly subscriptions: () => readonly string[];
  /** Each of the component's queries, with its `Query`'s name and current args. */
  readonly queryInfo: readonly QueryInfo[];
  readonly reports: readonly {
    readonly owner: string;
    readonly report: unknown;
  }[];
  /** Slice state the core doesn't know: queries, mounts, shared values. */
  readonly slices: Readonly<globalThis.Record<string, unknown>>;
}

/**
 * One of a component's queries in a story: its local name, its `Query`'s
 * name, and the args it currently returns (`undefined` when disabled).
 */
export interface QueryInfo {
  readonly name: string;
  readonly query: string;
  readonly args: unknown;
}

/**
 * The query results `given` starts from, by query name: a Success value, an
 * infinite query's pages, or keyed entries for a `queryMany` query.
 */
export type Given = Readonly<globalThis.Record<string, unknown>>;

/**
 * One key of a `queryMany` query for `loadedMany`: its args plus a Success
 * value or a typed failure.
 */
export type KeyedLoad =
  | {
      readonly args: unknown;
      readonly value: unknown;
      readonly waiting?: boolean | undefined;
      readonly patched?: boolean | undefined;
    }
  | {
      readonly args: unknown;
      readonly error: unknown;
      readonly waiting?: boolean | undefined;
    };

/**
 * A pending Command's definition, or an issued Command to also match the
 * args with structural equality. Requirements and the message type are
 * irrelevant to matching (the engine compares name and args), so issued
 * and unmatched Commands of any message and requirement match.
 */
export type Target =
  | Command.Definition.Any
  // oxlint-disable-next-line typescript/no-explicit-any -- intentional erasure: matching compares name and args only, so any message and requirement matches.
  | Command.Issued<unknown, any>
  // oxlint-disable-next-line typescript/no-explicit-any -- intentional erasure: matching compares name and args only, so any message and requirement matches.
  | Command.Unmatched<unknown, any, any>;

/**
 * A stream Command's definition, or an issued stream Command: what `next`
 * and `end` take. Like `Target`, any message and requirement matches.
 */
export type StreamTarget =
  | Command.Definition.Any
  // oxlint-disable-next-line typescript/no-explicit-any -- intentional erasure: matching compares name and args only, so any message and requirement matches.
  | Command.Issued<unknown, any>
  // oxlint-disable-next-line typescript/no-explicit-any -- intentional erasure: matching compares name and args only, so any message and requirement matches.
  | Command.Unmatched<unknown, any, any>;

/**
 * The steps every kind of test shares. Each step runs as soon as it is
 * called, replaces the cursor's record, and returns the cursor, so steps
 * chain. Write helpers as `<S extends Steps.Any>(s: S) => S`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the namespace below holds Steps' helper types; interface/namespace merging is the documented pattern.
export interface Steps<C extends AnyComponent> {
  /** Delivers a message from an active Subscription key. A message step. */
  subscription: (key: string, message: MessageOf<C>) => this;
  /**
   * Delivers what the Env provider's `onFailure` maps `failure` to, or does
   * nothing without one. A message step. It maps the failure through the
   * component's `provide` `onFailure` handlers; without one it is a no-op.
   */
  layerFailed: (failure: AsyncResult.Failure<never, unknown>) => this;
  /** The record after the last step. */
  readonly current: Record<PropsOf<C>, ModelOf<C>, MessageOf<C>, EventsOf<C>>;
  /** Commands issued but not yet resolved, oldest first. */
  readonly pending: readonly Pending[];
  /** Commands interrupted by `switch` or an interrupt Command. */
  readonly interrupted: readonly Command.Issued<unknown, never>[];
  /** The infinite queries with a load more pending. */
  readonly loadingMore: readonly string[];
  /** The Subscription keys the current Model and props ask for. Throws on duplicate keys. */
  readonly subscriptions: readonly string[];
  /** Each of the component's queries, with its `Query`'s name and current args. */
  readonly queryInfo: readonly QueryInfo[];
  /**
   * Starts from any Model. Before any other acting step it replaces what
   * `init` produced (dropping its Commands, events and sends) and never runs
   * `update`. After one it throws rather than discard pending work,
   * unacknowledged outputs or mounts, or a query entry the new Model would
   * disable.
   */
  given: (
    model: ModelOf<C> | ((model: ModelOf<C>) => ModelOf<C>),
    queries?: Given,
    shared?: readonly (readonly [unknown, unknown])[]
  ) => this;
  /**
   * Sets the value an owner shares with the component.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- shared values are schema-erased until the component decodes them.
  shared: (owner: unknown, value: unknown) => this;
  /** Changes the props. A props change never reaches `update`. */
  props: (next: PropsOf<C> | ((props: PropsOf<C>) => PropsOf<C>)) => this;
  /** Resolves the oldest running Command matching `target` and sends its message. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- command results are schema-erased until the update decodes them.
  resolve: (target: Target, result: unknown) => this;
  /** Fails the oldest running Command matching `target` with its typed failure. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- typed failures are schema-erased until the update decodes them.
  fail: (target: Target, error: unknown) => this;
  /** Sends one element of the oldest running stream Command matching `target`. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- stream elements are schema-erased until the update decodes them.
  next: (target: StreamTarget, result: unknown) => this;
  /** Ends the oldest running stream Command matching `target`, sending nothing. */
  end: (target: StreamTarget) => this;
  /**
   * Ends an `afterRefetch` wait by budget and delivers its message.
   */
  waitExpired: (target: Target) => this;
  /** Loads a query with a Success. */
  loaded: (name: string, ...rest: readonly unknown[]) => this;
  /** Loads a query with a typed failure. */
  loadFailed: (name: string, ...rest: readonly unknown[]) => this;
  /** Settles an infinite query's pending load more. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- infinite-query pages are schema-erased until the query runtime decodes them.
  loadedMore: (name: string, page: unknown) => this;
  /** Settles an infinite query's pending load more with a failure. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- typed failures are schema-erased until the query runtime decodes them.
  loadMoreFailed: (name: string, error: unknown) => this;
  /** Loads several keys of a `queryMany` query in one write. */
  loadedMany: (name: string, entries: readonly KeyedLoad[]) => this;
  /** Acknowledges the oldest events after checking them in order against the `events` Schema. */
  emitted: (...events: readonly EventsOf<C>[]) => this;
  /** Acknowledges the oldest `$.send` to `owner`. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- sends are schema-erased until the owner's update decodes them.
  sent: (owner: unknown, message: unknown) => this;
  /**
   * Marks pending work as intended to stay pending, so it stops blocking
   * message steps: every pending Command `target` matches, or, given a
   * query's name, its unloaded entries or its pending load more (Query
   * slice). A kept query passes the end check; a kept Command or load more
   * doesn't. Throws if nothing pending matches.
   */
  keepPending: (target: Target | string) => this;
  /** Checks the whole record. `f` throws to fail the test. */
  check: (
    f: (
      current: Record<PropsOf<C>, ModelOf<C>, MessageOf<C>, EventsOf<C>>
    ) => void
  ) => this;
  /** Asserts that exactly these Commands are pending, in order. */
  expectExact: (...targets: readonly Target[]) => this;
  /** Asserts that a Command matching `target` is pending. */
  expectHas: (target: Target) => this;
  /** Asserts that nothing is pending. */
  expectNone: () => this;
  /** Applies `f` to the cursor, for shared setups. */
  pipe: <A>(f: (cursor: this) => A) => A;
}

/**
 * Helper types for `Steps`.
 */
// oxlint-disable-next-line typescript/no-namespace -- helper types for Steps live in the merged namespace by design.
export declare namespace Steps {
  /**
   * A cursor over any component, for steps shared across components.
   */
  export type Any = Steps<AnyComponent>;
}

/**
 * A slice plugs test support into the pure engine by registering one
 * of these. The base engine consults every registered extension for pending
 * descriptions, unacknowledged outputs, `given` guards, helper fields, and
 * the slice's own steps; methods with no provider throw a `notWired` error
 * naming the slice, so the API stays stable while slices land.
 *
 * Example (the Query slice):
 *
 * ```ts
 * import { registerTestExtension } from "@ilha/model/test"
 *
 * registerTestExtension({
 *   name: "query",
 *   steps: { loaded: (ctx, name, ...rest) => ctx.queryLoaded(name, rest) },
 *   inFlight: (state) => queryInFlight(state),
 *   ...
 * })
 * ```
 */
export interface TestExtension {
  /** The slice name used in `notWired` errors and `spec/testing.md`'s unwired list. */
  readonly name: string;
  /**
   * Extra cursor steps, bound as methods. Each receives the engine
   * internals plus the step arguments, and returns nothing; throwing fails
   * the step. Story and Scene expose every registered step whose name
   * doesn't collide with a base step.
   */
  readonly steps?:
    | Readonly<
        globalThis.Record<
          string,
          // oxlint-disable-next-line anti-slop/no-unknown-returns -- extension steps return nothing meaningful; throwing fails the step.
          (ctx: ExtensionContext, ...args: readonly unknown[]) => unknown
        >
      >
    | undefined;
  /** Work in flight that blocks a message step, as failure-list items. */
  readonly inFlight?:
    | ((state: EngineInternals) => readonly string[])
    | undefined;
  /** Every pending item, kept or exempt included: what the end check and `given` can't leave. */
  readonly allPending?:
    | ((state: EngineInternals) => readonly string[])
    | undefined;
  /** Outputs no step acknowledged yet, as failure-list items. */
  readonly outputs?:
    | ((state: EngineInternals) => readonly string[])
    | undefined;
  /** Extra `given` guards: items for work the new Model would discard. */
  readonly checkGiven?:
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- given models are schema-erased until the component decodes them.
    ((state: EngineInternals, model: unknown) => readonly string[]) | undefined;
  /** Extra fields merged into the view helper `h`. */
  readonly helper?:
    | ((ctx: ExtensionContext) => Readonly<globalThis.Record<string, unknown>>)
    | undefined;
}

/**
 * What an extension step receives: the engine state plus the operations the
 * core owns (dispatch a message, read the record, fail with a hint).
 */
export interface ExtensionContext {
  /** Dispatch a message through `update` synchronously, as `send` does. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- dispatched messages are schema-erased until update decodes them.
  readonly dispatchMessage: (message: unknown) => void;
  /** Read and replace the engine's slice state for `name`. */
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- slice state is schema-erased until the owning slice decodes it.
  readonly slice: (name: string) => unknown;
  /** Store the engine's slice state for `name`. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- slice state is schema-erased until the owning slice decodes it.
  readonly setSlice: (name: string, value: unknown) => void;
  /** Throw a step error with the acknowledgement-rule format. */
  readonly fail: (
    step: string,
    what: string,
    problems: readonly string[]
  ) => never;
}

/**
 * The engine state an extension inspects for pending and output checks.
 */
export interface ExtensionState {
  readonly component: AnyComponent;
  readonly props: unknown;
  readonly model: unknown;
  readonly slices: Readonly<globalThis.Record<string, unknown>>;
}

const extensions: TestExtension[] = [];

/**
 * Registers a slice's test support. Later slices land without
 * touching `Story` or `Scene`; `spec/testing.md` documents the protocol.
 */
export const registerTestExtension = (extension: TestExtension): void => {
  extensions.push(extension);
};

/**
 * Every registered extension, oldest first.
 */
export const testExtensions = (): readonly TestExtension[] => extensions;

/**
 * Throws when no registered extension provides `kind` for the `name` slice.
 */
export const notWired = (step: string, slice: string, kind: string): never => {
  throw new Error(
    `${step}: ${kind} needs the ${slice} slice, which isn't implemented yet (see spec/testing.md "Unwired steps")`
  );
};

/**
 * The acknowledgement-rule error format: `"<Module>.<step>: earlier work
 * isn't settled or acknowledged:\n  - …"`. Every item carries a hint.
 */
export const stepError = (
  step: string,
  what: string,
  problems: readonly string[]
): Error => new Error(`${step}: ${what}:\n  - ${problems.join("\n  - ")}`);

/**
 * Runs `fn` for a cursor step, rethrowing failures with the stack of the
 * call site that invoked the step.
 */
export const atSite = <A>(fn: () => A): A => {
  const site = new Error("step site").stack ?? "";
  const frames = site.split("\n").slice(2).join("\n");
  try {
    return fn();
  } catch (error) {
    if (error instanceof Error && !error.stack?.includes("atSite")) {
      error.stack = `${error.stack?.split("\n")[0] ?? error}\n${frames}`;
    }
    throw error;
  }
};
