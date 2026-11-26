/**
 * Story tests drive `update` with messages and assert on the Model: pure,
 * with no runtime, no Layers, no host and no view.
 *
 * A story is evidence about `update`. Commands stay pending as data until a
 * step resolves them with the message they would have produced, so no
 * service is needed. `make` is a scoped Effect with the end check; `start`
 * returns a cursor with no end check. Every step follows the acknowledgement
 * rule described in `steps.ts`. A defect in `init` or `update` throws on the
 * calling line.
 */
// oxlint-disable-next-line eslint/max-classes-per-file -- StepsImpl holds the shared engine; StoryStepsImpl adds the story cursor.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import type * as Command from "../command.ts";
import type { HeadlessComponent } from "../component.ts";
import type * as MessageLog from "../message-log.ts";
import { Engine, eventsEqual, implementationOf } from "./engine.ts";
import { partsOfHeadless, partsSourceOf } from "./parts.ts";
import {
  ingestQueryChanged,
  queryCheckGiven,
  queryGiven,
  queryKeepPending,
  queryLoadFailed,
  queryLoaded,
  queryLoadedMany,
  queryLoadedMore,
  queryLoadMoreFailed,
  queryWaitExpired,
  refreshQueries,
} from "./queries.ts";
import {
  provideOnFailures,
  sharedGiven,
  sharedSent,
  sharedSet,
} from "./shared.ts";
import { atSite, stepError } from "./steps.ts";
import type {
  AnyComponent,
  EventsOf,
  Given,
  KeyedLoad,
  MessageOf,
  ModelOf,
  Pending,
  PropsOf,
  QueryInfo,
  Record as TestRecord,
  Steps as SharedSteps,
  StreamTarget,
  Target,
} from "./steps.ts";
import { describeCommand, describeTarget, matchesTarget } from "./targets.ts";

export type {
  AwaitedQuery,
  KeyedLoad,
  Pending,
  QueryInfo,
  StreamTarget,
  Target,
} from "./steps.ts";

/**
 * The state of one instance between steps, as a story records it.
 */
export interface Story<Props, Model, Msg, Events> extends TestRecord<
  Props,
  Model,
  Msg,
  Events
> {
  readonly model: Model;
  /**
   * The query results, beside the Model: the opened results the query
   * runtime holds, keyed by query name.
   */
  readonly results: unknown;
}

/**
 * A cursor over one story. It has the shared steps plus `send`, and reads
 * the Model and results off the cursor.
 */
export interface Steps<C extends AnyComponent> extends SharedSteps<C> {
  /** The story after the last step. */
  readonly current: Story<PropsOf<C>, ModelOf<C>, MessageOf<C>, EventsOf<C>>;
  /**
   * Sends a message to `update`. An updater is called with the current
   * Model. A message step. `undefined` and `Component.noop` are no-ops.
   */
  send: (message: MessageOf<C> | ((model: ModelOf<C>) => MessageOf<C>)) => this;
  /** The Model after the last step. */
  readonly model: ModelOf<C>;
  /** The query results after the last step, beside the Model. */
  readonly results: unknown;
  /** The queries' results, by name, as `$.queries` sees them. */
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- cursors expose query results keyed by query name.
  readonly queries: Record<string, unknown>;
  /**
   * Runs a headless component's `parts` and returns them. `source` is
   * `{model, props}`, a Story record (its Model and props), or a Scene
   * record (the stored `givenChild` Model of the headless component).
   * An assertion: it never triggers the acknowledgement checks.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- parts sources are story records and headless models the component decodes.
  parts: <P>(headless: HeadlessComponent, source: unknown) => P;
}
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- opened results are keyed by query name.
export const queryResultsOf = (engine: Engine): Record<string, unknown> =>
  // SAFETY: the queries slice holds opened results keyed by name; empty when the slice is unwired.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- opened results are keyed by query name.
  (engine.state.slices["queries"] ?? {}) as Record<string, unknown>;

/** The shared-step engine behind `Story` and `Scene` cursors. @internal */
export class StepsImpl<
  C extends AnyComponent,
  S = Story<PropsOf<C>, ModelOf<C>, MessageOf<C>, EventsOf<C>>,
> {
  protected readonly engine: Engine;
  protected readonly label: string;

  constructor(label: string, engine: Engine) {
    this.label = label;
    this.engine = engine;
  }

  protected stepName(step: string): string {
    return `${this.label}.${step}`;
  }

  /** Runs the scope-close end check from `make`. */
  checkScopeEnd(): void {
    this.engine.checkEnd(`${this.label}.make`);
  }

  pipe<A>(f: (cursor: this) => A): A {
    return f(this);
  }

  /** Builds the cursor's record view. Overridden by `Scene`. */
  protected buildCurrent(): S {
    const record = this.engine.record();
    // SAFETY: the record plus model and results is exactly the story state S; the engine holds them erased.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- S defaults to the story record; the chain bridges the generic default.
    return {
      ...record,
      model: this.engine.state.model,
      results:
        this.engine.state.slices["results"] ?? queryResultsOf(this.engine),
    } as unknown as S;
  }

  get current(): S {
    return this.buildCurrent();
  }

  get pending(): readonly Pending[] {
    return this.engine.record().pending;
  }

  get interrupted(): readonly Command.Issued<unknown, never>[] {
    return this.engine.record().interrupted;
  }

  get loadingMore(): readonly string[] {
    return this.engine.record().loadingMore;
  }

  get subscriptions(): readonly string[] {
    return this.engine.subscriptionKeys(this.stepName("subscriptions"));
  }

  get queryInfo(): readonly QueryInfo[] {
    return this.engine.record().queryInfo;
  }

  get model(): ModelOf<C> {
    // SAFETY: the engine holds this cursor's component model; the cursor is parameterized by C.
    return this.engine.state.model as ModelOf<C>;
  }

  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the results slot is schema-erased until the test narrows it.
  get results(): unknown {
    return this.engine.state.slices["results"] ?? queryResultsOf(this.engine);
  }

  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- cursors expose query results keyed by query name.
  get queries(): Record<string, unknown> {
    const queries =
      this.engine.state.slices["queries"] ?? queryResultsOf(this.engine);
    // SAFETY: query results are keyed by query name; the query runtime fills them per name.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- cursors expose query results keyed by query name.
    return queries as Record<string, unknown>;
  }

  protected act(
    kind: "message" | "acting",
    step: string,
    fn: () => void
  ): this {
    return atSite(() => {
      this.engine.checkBefore(this.stepName(step), kind);
      fn();
      this.engine.state.acted = true;
      return this;
    });
  }

  send(message: MessageOf<C> | ((model: ModelOf<C>) => MessageOf<C>)): this {
    return this.act("message", "send", () => {
      const resolved =
        // SAFETY: the typeof check below guarantees the updater shape.
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- send accepts a message or an updater by design; the branch runs the updater.
        typeof message === "function"
          ? (message as (model: ModelOf<C>) => MessageOf<C>)(this.model)
          : message;
      this.engine.deliver(resolved);
    });
  }

  subscription(key: string, message: MessageOf<C>): this {
    return this.act("message", "subscription", () => {
      const active = this.engine.subscriptionKeys(
        this.stepName("subscription")
      );
      if (!active.includes(key)) {
        throw new Error(
          `${this.stepName("subscription")}: no Subscription has the key ${JSON.stringify(key)}${
            active.length === 0
              ? `: nothing is subscribed`
              : `; active keys:\n  - ${active.join("\n  - ")}`
          }`
        );
      }
      this.engine.deliver(message);
    });
  }

  layerFailed(failure: { readonly _tag: string }): this {
    return this.act("message", "layerFailed", () => {
      const handlers = provideOnFailures(
        implementationOf(this.engine.state.component)
      );
      for (const onFailure of handlers) {
        let message: unknown;
        try {
          message = onFailure(failure);
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : String(error);
          throw new Error(
            `${this.stepName("layerFailed")}: the onFailure handler threw: ${messageText}`,
            { cause: error }
          );
        }
        if (message !== undefined) {
          this.engine.deliver(message);
        }
      }
    });
  }

  given(
    model: ModelOf<C> | ((model: ModelOf<C>) => ModelOf<C>),
    queries?: Given,
    shared?: readonly (readonly [unknown, unknown])[]
  ): this {
    return atSite(() => {
      const step = this.stepName("given");
      const next =
        // SAFETY: the typeof check below guarantees the updater shape.
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- given accepts a model or an updater by design; the branch runs the updater.
        typeof model === "function"
          ? (model as (model: ModelOf<C>) => ModelOf<C>)(this.model)
          : model;
      if (this.engine.state.acted) {
        const problems = [
          ...this.engine.allPending(),
          ...this.engine.outputs(),
          ...queryCheckGiven(this.engine, next),
        ];
        if (problems.length > 0) {
          throw stepError(
            step,
            "given would discard work not settled or acknowledged",
            problems
          );
        }
      }
      this.engine.state.model = next;
      refreshQueries(this.engine);
      if (queries !== undefined) {
        queryGiven(this.engine, step, queries);
      }
      if (shared !== undefined) {
        sharedGiven(
          // SAFETY: slices hold each slice's decoded state keyed by slice name.
          // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- slices are keyed by slice name by construction.
          this.engine.state.slices as Record<string, unknown>,
          shared
        );
      }
      this.engine.state.pending = [];
      this.engine.state.emitted = [];
      this.engine.state.sent = [];
      this.engine.state.interrupted = [];
      this.engine.state.ignored = false;
      this.engine.state.acted = true;
      return this;
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- shared values are schema-erased until the component decodes them.
  shared(owner: unknown, value: unknown): this {
    return this.act("message", "shared", () => {
      sharedSet(this.engine, this.stepName("shared"), owner, value);
    });
  }

  props(next: PropsOf<C> | ((props: PropsOf<C>) => PropsOf<C>)): this {
    return this.act("acting", "props", () => {
      // SAFETY: the engine holds this cursor's props; the cursor is parameterized by C.
      const current = this.engine.state.props as PropsOf<C>;
      this.engine.state.props =
        // SAFETY: the typeof check below guarantees the updater shape.
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- props accepts a value or an updater by design; the branch runs the updater.
        typeof next === "function"
          ? (next as (props: PropsOf<C>) => PropsOf<C>)(current)
          : next;
      refreshQueries(this.engine);
      this.engine.state.acted = true;
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- command results are schema-erased until the update decodes them.
  resolve(target: Target, result: unknown): this {
    return this.act("acting", "resolve", () => {
      this.engine.resolveRun(this.stepName("resolve"), target, result);
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- typed failures are schema-erased until the update decodes them.
  fail(target: Target, error: unknown): this {
    return this.act("acting", "fail", () => {
      this.engine.failRun(this.stepName("fail"), target, error);
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- stream elements are schema-erased until the update decodes them.
  next(target: StreamTarget, result: unknown): this {
    return this.act("acting", "next", () => {
      // SAFETY: nextElement takes the stream element erased; the stream's message type is checked at resolve.
      this.engine.nextElement(this.stepName("next"), target, result as never);
    });
  }

  end(target: StreamTarget): this {
    return this.act("acting", "end", () => {
      this.engine.endStream(this.stepName("end"), target);
    });
  }

  waitExpired(target: Target): this {
    return this.act("acting", "waitExpired", () => {
      queryWaitExpired(this.engine, this.stepName("waitExpired"), target);
    });
  }

  loaded(name: string, ...rest: readonly unknown[]): this {
    return this.act("acting", "loaded", () => {
      queryLoaded(this.engine, this.stepName("loaded"), name, rest);
    });
  }

  loadFailed(name: string, ...rest: readonly unknown[]): this {
    return this.act("acting", "loadFailed", () => {
      queryLoadFailed(this.engine, this.stepName("loadFailed"), name, rest);
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- infinite-query pages are schema-erased until the query runtime decodes them.
  loadedMore(name: string, page: unknown): this {
    return this.act("acting", "loadedMore", () => {
      queryLoadedMore(this.engine, this.stepName("loadedMore"), name, page);
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- typed failures are schema-erased until the query runtime decodes them.
  loadMoreFailed(name: string, error: unknown): this {
    return this.act("acting", "loadMoreFailed", () => {
      queryLoadMoreFailed(
        this.engine,
        this.stepName("loadMoreFailed"),
        name,
        error
      );
    });
  }

  loadedMany(name: string, entries: readonly KeyedLoad[]): this {
    return this.act("acting", "loadedMany", () => {
      queryLoadedMany(this.engine, this.stepName("loadedMany"), name, entries);
    });
  }

  emitted(...events: readonly EventsOf<C>[]): this {
    return atSite(() => {
      if (events.length === 0) {
        throw new Error(
          `${this.stepName("emitted")}: needs at least one event to acknowledge`
        );
      }
      const schema = this.engine.definition.events;
      const pending = this.engine.state.emitted;
      for (let index = 0; index < events.length; index += 1) {
        const expected = events[index];
        const actual = pending[index];
        if (actual === undefined || !eventsEqual(schema, actual, expected)) {
          throw new Error(
            `${this.stepName("emitted")}: event #${index + 1} differs:\n  recorded: ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`
          );
        }
      }
      this.engine.state.emitted = pending.slice(events.length);
      return this;
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- sends are schema-erased until the owner's update decodes them.
  sent(owner: unknown, message: unknown): this {
    return atSite(() => {
      sharedSent(this.engine, this.stepName("sent"), owner, message);
      return this;
    });
  }

  keepPending(target: Target | string): this {
    return atSite(() => {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- keepPending accepts a query name or a target by design; the branch runs the name path.
      if (typeof target === "string") {
        queryKeepPending(this.engine, this.stepName("keepPending"), target);
        return this;
      }
      const matches = this.engine.state.pending.filter((entry) =>
        matchesTarget(entry.command, target)
      );
      if (matches.length === 0) {
        throw new Error(
          `${this.stepName("keepPending")}: nothing pending matches ${describeTarget(target)}: only pending Commands can be kept`
        );
      }
      for (const entry of matches) {
        const index = this.engine.state.pending.indexOf(entry);
        this.engine.state.pending[index] = { ...entry, kept: true };
      }
      return this;
    });
  }

  expectExact(...targets: readonly Target[]): this {
    return atSite(() => {
      const step = this.stepName("expectExact");
      const { pending } = this.engine.record();
      const match =
        targets.length === pending.length &&
        targets.every((target, index) => {
          const entry = pending[index];
          return entry !== undefined && matchesTarget(entry.command, target);
        });
      if (!match) {
        const wanted = targets
          .map((target) => describeTarget(target))
          .join("\n  - ");
        const actual = pending
          .map((entry) => describeCommand(entry.command))
          .join("\n  - ");
        throw new Error(
          `${step}: expected exactly these Commands pending:\n  - ${wanted}\nactual pending:\n  - ${actual}`
        );
      }
      return this;
    });
  }

  expectHas(target: Target): this {
    return atSite(() => {
      const step = this.stepName("expectHas");
      const { pending } = this.engine.record();
      if (!pending.some((entry) => matchesTarget(entry.command, target))) {
        const actual = pending
          .map((entry) => describeCommand(entry.command))
          .join("\n  - ");
        throw new Error(
          `${step}: no pending Command matches ${describeTarget(target)}; actual pending:\n  - ${actual}`
        );
      }
      return this;
    });
  }

  expectNone(): this {
    return atSite(() => {
      const { pending } = this.engine.record();
      if (pending.length > 0) {
        const actual = pending
          .map((entry) => describeCommand(entry.command))
          .join("\n  - ");
        throw new Error(
          `${this.stepName("expectNone")}: expected nothing pending, but:\n  - ${actual}`
        );
      }
      return this;
    });
  }

  check(
    f: (
      current: Story<PropsOf<C>, ModelOf<C>, MessageOf<C>, EventsOf<C>>
    ) => void
  ): this {
    return atSite(() => {
      f(
        // SAFETY: check runs against the story-shaped record; the cast views the cursor's own record through it.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- S is the cursor's own record type; the chain bridges the generic.
        this.current as unknown as Story<
          PropsOf<C>,
          ModelOf<C>,
          MessageOf<C>,
          EventsOf<C>
        >
      );
      return this;
    });
  }
}

/**
 * The `Story` cursor: the shared steps plus `send` and `parts`.
 * `SceneStepsImpl` extends the base separately so its `parts` assertion
 * (over the scene's own headless component) doesn't collide with this one.
 */
export class StoryStepsImpl<C extends AnyComponent> extends StepsImpl<C> {
  /** Runs a headless component's `parts` and returns them. An assertion. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- parts sources are story records and headless models the component decodes.
  parts<P>(headless: HeadlessComponent, source: unknown): P {
    const step = this.stepName("parts");
    const resolved = partsSourceOf(this.engine, step, headless, source);
    // SAFETY: parts are built by the headless component's own definition; P names them.
    return partsOfHeadless(this.engine, step, headless, resolved.model) as P;
  }
}

/**
 * The cursor after `init`, with the first view rendered. Its steps follow
 * the acknowledgement rule, but nothing checks what's pending or
 * unacknowledged at the end.
 */
export const start = <C extends AnyComponent>(
  component: C,
  props: PropsOf<C>
): Steps<C> =>
  // SAFETY: StoryStepsImpl implements every shared step; the cast only hides the engine.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- StepsImpl's engine field blocks a direct cast to the public cursor.
  new StoryStepsImpl<C>(
    "Story",
    // SAFETY: the engine erases props; the cursor narrows them back through C.
    new Engine("Story", component, props as unknown)
  ) as unknown as Steps<C>;

/**
 * Starts a story: `init` with `props`, as a cursor in a scope. When the
 * scope closes with a success the end check runs: it fails on anything
 * pending (kept or exempt included), on an unacknowledged mount, and on any
 * event, send or ignored interaction not acknowledged. When the scope closes
 * with a failure the end check doesn't run.
 */
export const make = <C extends AnyComponent>(
  component: C,
  props: PropsOf<C>
): Effect.Effect<Steps<C>, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => start(component, props)),
    (cursor) =>
      Effect.sync(() => {
        // SAFETY: make hands the scoped cursor to the end check; the cast only recovers the shared engine.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the public cursor hides the engine; the value is the scoped cursor.
        (cursor as unknown as StepsImpl<C>).checkScopeEnd();
      })
  );

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * Where a replay first computed something other than what the log recorded:
 * the entry's `seq`, the message that diverged, and both outcomes.
 */
export interface Divergence<Model, Msg, Events> {
  readonly seq: number;
  readonly message: Msg;
  readonly recorded: Outcome<Model, Events>;
  readonly recomputed: Outcome<Model, Events>;
}

/**
 * What one `update` produced, as a replay compares it: the Model, the
 * events, the Commands in their Wire encoding, and the `$.loadMore`,
 * `$.reset` and `$.send` calls (compared, never run).
 */
export interface Outcome<Model, Events> {
  readonly model: Model;
  readonly events: readonly Events[];
  readonly commands: readonly {
    readonly name: string;
    readonly args: unknown;
  }[];
  /** The `$.loadMore` and `$.reset` calls, compared and never run. */
  readonly lists: readonly unknown[];
  /** The `$.send` calls, compared and never delivered. */
  readonly sends: readonly unknown[];
}

/**
 * The result of `fromLog`: the state the replay reached (the Model, props
 * and query results), how many messages it re-ran, and the first divergence,
 * if any. On a divergence, the state is the one the diverging message was
 * sent to: the Model before it, and the props and results its `update` read.
 */
export interface Replay<
  Model,
  Msg,
  Events,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- replays hold query results keyed by query name.
  Queries = Record<string, unknown>,
  Props = unknown,
> {
  readonly path: string;
  readonly model: Model;
  /** The props the instance had, from its latest `Mounted`, `PropsChanged` or `Update` entry. */
  readonly props: Props;
  /** The query results, beside the Model: the opened results the replay holds. */
  readonly results: unknown;
  /** The queries' results, by name. */
  readonly queries: () => Queries;
  readonly replayed: number;
  readonly divergence: Divergence<Model, Msg, Events> | undefined;
}

interface EntryView {
  readonly _tag: string;
  readonly seq: number;
  readonly path?: string | undefined;
  readonly instance?: number | undefined;
  readonly componentName?: string | undefined;
  readonly props?: unknown;
  readonly model?: unknown;
  readonly message?: unknown;
  readonly commands?:
    | readonly { readonly name: string; readonly args?: unknown }[]
    | undefined;
  readonly events?: readonly unknown[] | undefined;
  readonly lists?: readonly unknown[] | undefined;
  readonly sends?: readonly unknown[] | undefined;
  readonly queryName?: string | undefined;
  readonly queryResult?: unknown;
}

const outcomeOf = (entry: EntryView): Outcome<unknown, unknown> => ({
  commands: (entry.commands ?? []).map((command) => ({
    args: command.args ?? null,
    name: command.name,
  })),
  events: entry.events ?? [],
  lists: entry.lists ?? [],
  model: entry.model,
  sends: entry.sends ?? [],
});

const jsonEqual = (
  left: readonly unknown[],
  right: readonly unknown[]
): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every(
    (value, index) => JSON.stringify(value) === JSON.stringify(right[index])
  );
};

const modelsEqual = (
  component: AnyComponent,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- equality compares schema-erased models; the schema check is inside.
  left: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- equality compares schema-erased models; the schema check is inside.
  right: unknown
): boolean => {
  try {
    const equivalence = Schema.toEquivalence(
      // SAFETY: toEquivalence closes over the model's own definition schema; never marks its erased input.
      component.definition.model as Schema.Schema<never>
    );
    // SAFETY: the equivalence above compares two erased models and reports a boolean.
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the equivalence call takes the two erased models it compares.
    return (equivalence as (left: unknown, right: unknown) => boolean)(
      left,
      right
    );
  } catch {
    return false;
  }
};

const eventsEqualList = (
  component: AnyComponent,
  left: readonly unknown[],
  right: readonly unknown[]
): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((event, index) =>
    eventsEqual(component.definition.events, event, right[index])
  );
};

const commandsEqual = (
  left: readonly { readonly name: string; readonly args?: unknown }[],
  right: readonly { readonly name: string; readonly args: unknown }[]
): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((command, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      command.name === other.name &&
      JSON.stringify(command.args ?? null) ===
        JSON.stringify(other.args ?? null)
    );
  });
};

/** A placeholder anywhere inside `value`, or `undefined`. */
// oxlint-disable-next-line anti-slop/no-object-parameters -- placeholders are probed with `in`; the probe only needs an object.
const isPlaceholderLike = (value: object): boolean =>
  "~unserialisable" in value || "~redacted" in value || "~truncated" in value;

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the probe walks schemaless decoded values; placeholders are a wire-level marker.
const findPlaceholder = (value: unknown): unknown => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the probe walks schemaless decoded values; primitives return undefined.
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  if (isPlaceholderLike(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPlaceholder(item);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  for (const item of Object.values(value)) {
    const found = findPlaceholder(item);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};
const entryComponentName = (
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- wire entries are schemaless records until decoded per tag.
  view: Record<string, unknown>
): string | undefined => {
  const { component } = view;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- wire entries are schemaless; the dispatch reads representation fields.
  if (typeof component === "string") {
    return component;
  }
  if (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the component record's shape is representation data until decoded.
    typeof component === "object" &&
    component !== null &&
    // SAFETY: the null check above guarantees an object for the name probe.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the component record's shape is representation data until decoded.
    typeof (component as { readonly name?: unknown }).name === "string"
  ) {
    // SAFETY: the check above guarantees a string name on the component record.
    return (component as { readonly name: string }).name;
  }
  return undefined;
};

const decodeQueryChanged = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- wire entries are schemaless records until decoded per tag.
  view: Record<string, unknown>,
  step: string,
  index: number,
  path: string | undefined,
  componentName: string | undefined
): EntryView => {
  if (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- wire entries are schemaless; the tag dispatch reads representation fields.
    typeof view["result"] === "object" &&
    view["result"] !== null &&
    // SAFETY: the null check above guarantees an object for the placeholder probe.
    isPlaceholderLike(view["result"] as object)
  ) {
    throw new Error(
      `${step}: entry #${index}${path === undefined ? "" : ` (${path})`} has a result that can't be decoded, because it was logged as a placeholder`
    );
  }
  // SAFETY: QueryChanged entries carry the component's own query fields beside the envelope.
  return {
    _tag: view["_tag"] as string,
    componentName,
    instance:
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- wire entries are schemaless; instances are numbers when present.
      typeof view["instance"] === "number"
        ? (view["instance"] as number)
        : undefined,
    path,
    queryName: view["name"] as string | undefined,
    queryResult: (view as { readonly result?: unknown }).result,
    seq: view["seq"] as number,
  };
};

const decodeEntry = (
  step: string,
  _component: AnyComponent,
  entry: MessageLog.Entry | MessageLog.Wire,
  index: number
): EntryView => {
  // SAFETY: log entries carry their decoded payloads beside the envelope; the tag checks below reject non-entries.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- MessageLog variants share no index signature, so the field reads need the record view.
  const view = entry as unknown as Record<string, unknown>;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- wire entries are schemaless; the tag dispatch reads representation fields.
  if (typeof view["_tag"] !== "string" || typeof view["seq"] !== "number") {
    throw new TypeError(
      `${step}: entry #${index} isn't a log entry: it has no _tag or seq`
    );
  }
  if (view["_tag"] === "Hello") {
    throw new Error(
      `${step}: entry #${index} is a Wire Hello frame, not a log entry`
    );
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- wire entries are schemaless; paths are strings when present.
  const path = typeof view["path"] === "string" ? view["path"] : undefined;
  const at = (field: string): string =>
    `${step}: entry #${index}${path === undefined ? "" : ` (${path})`} has a ${field} that can't be decoded, because it was logged as a ~truncated placeholder`;
  for (const [field, value] of [
    ["model", view["model"]],
    ["message", view["message"]],
    ["props", view["props"]],
  ] as const) {
    const found = findPlaceholder(value);
    if (found !== undefined) {
      throw new Error(at(field));
    }
  }
  // SAFETY: events ride beside the entry envelope; non-arrays fall back to empty below.
  for (const event of (view["events"] as readonly unknown[]) ?? []) {
    if (findPlaceholder(event) !== undefined) {
      throw new Error(at("events"));
    }
  }
  const componentName = entryComponentName(view);
  if (view["_tag"] === "QueryChanged") {
    return decodeQueryChanged(view, step, index, path, componentName);
  }
  // SAFETY: the tag dispatch above guarantees a log entry of this component; the fields ride beside its envelope.
  return {
    _tag: view["_tag"] as string,
    commands: view["commands"] as EntryView["commands"],
    componentName,
    events: view["events"] as EntryView["events"],
    instance:
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- wire entries are schemaless; instances are numbers when present.
      typeof view["instance"] === "number"
        ? (view["instance"] as number)
        : undefined,
    lists: view["lists"] as EntryView["lists"],
    message: view["message"],
    model: view["model"],
    path,
    props: view["props"],
    sends: view["sends"] as EntryView["sends"],
    seq: view["seq"] as number,
  };
};
const findStart = (
  step: string,
  decoded: readonly EntryView[],
  name: string,
  wanted: string | undefined
) => {
  const index = decoded.findIndex(
    (entry) =>
      (entry._tag === "Mounted" || entry._tag === "Update") &&
      (wanted === undefined
        ? entry.componentName === name
        : entry.path === wanted)
  );
  const entry = index === -1 ? undefined : decoded[index];
  if (entry === undefined) {
    throw new Error(`${step}: the log has no entry for ${wanted ?? name}`);
  }
  return { entry, index, path: entry.path ?? `/${name}` };
};

const remountInstance = <C extends AnyComponent>(
  engine: Engine,
  entry: EntryView
) => {
  // SAFETY: mount entries carry the component's own model; fromLog only replays this component's path.
  const model = entry.model as ModelOf<C>;
  // SAFETY: mount entries carry the component's own props; fromLog only replays this component's path.
  const props = (entry.props ?? {}) as PropsOf<C>;
  engine.state.props = props;
  engine.state.model = model;
  engine.state.pending = [];
  engine.state.emitted = [];
  engine.state.sent = [];
  refreshQueries(engine);
  return { model, props };
};

const replayUpdate = <C extends AnyComponent>(
  engine: Engine,
  component: C,
  entry: EntryView,
  model: ModelOf<C>,
  props: PropsOf<C>
):
  | { readonly _tag: "advanced"; readonly model: ModelOf<C> }
  | {
      readonly _tag: "diverged";
      readonly divergence: Divergence<ModelOf<C>, MessageOf<C>, EventsOf<C>>;
    } => {
  engine.state.props = props;
  engine.state.model = model;
  refreshQueries(engine);
  const before = new Set(engine.state.pending);
  const emittedBefore = engine.state.emitted.length;
  const sentBefore = engine.state.sent.length;
  let recomputedModel = model;
  let recomputedEvents: readonly unknown[] = [];
  let recomputedCommands: readonly {
    readonly name: string;
    readonly args: unknown;
  }[] = [];
  let recomputedLists: readonly unknown[] = [];
  let recomputedSends: readonly unknown[] = [];
  let threw = false;
  try {
    engine.deliver(entry.message);
  } catch {
    threw = true;
  }
  if (!threw) {
    // SAFETY: the engine holds this component's model; the replay only runs this component's update.
    recomputedModel = engine.state.model as ModelOf<C>;
    recomputedEvents = engine.state.emitted.slice(emittedBefore);
    recomputedCommands = engine.state.pending
      .filter((run) => !before.has(run))
      .map((run) => ({ args: run.command.args, name: run.command.name }));
    recomputedSends = engine.state.sent.slice(sentBefore).map((send) => ({
      message: send.message,
      owner: send.owner,
    }));
    recomputedLists = engine.lastLists;
  }
  const recorded = outcomeOf(entry);
  if (
    threw ||
    !modelsEqual(component, recorded.model, recomputedModel) ||
    !eventsEqualList(component, recorded.events, recomputedEvents) ||
    !commandsEqual(recorded.commands, recomputedCommands) ||
    !jsonEqual(recorded.lists, recomputedLists) ||
    !jsonEqual(recorded.sends, recomputedSends)
  ) {
    return {
      _tag: "diverged",
      divergence: {
        // SAFETY: entry.message is the update's own message; the replay delivers it back through the same update.
        message: entry.message as MessageOf<C>,
        recomputed: {
          commands: recomputedCommands,
          // SAFETY: recomputed events come from this component's own emit; the cast views them as its event union.
          events: recomputedEvents as readonly EventsOf<C>[],
          lists: recomputedLists,
          model: recomputedModel,
          sends: recomputedSends,
        },
        // SAFETY: recorded and recomputed share this component's model, events and message types.
        recorded: recorded as Outcome<ModelOf<C>, EventsOf<C>>,
        seq: entry.seq,
      },
    };
  }
  return { _tag: "advanced", model: recomputedModel };
};

const absorbEntry = <C extends AnyComponent>(
  engine: Engine,
  step: string,
  entry: EntryView,
  path: string,
  instance: number | undefined,
  props: PropsOf<C>
) => {
  if (entry.path !== path) {
    return { props, skip: true };
  }
  if (entry._tag === "PropsChanged") {
    // SAFETY: PropsChanged entries carry the component's own props for this path.
    const next = entry.props as PropsOf<C>;
    engine.state.props = next;
    refreshQueries(engine);
    return { props: next, skip: true };
  }
  if (entry._tag === "QueryChanged") {
    if (entry.queryName !== undefined && entry.queryResult !== undefined) {
      ingestQueryChanged(engine, step, entry.queryName, entry.queryResult);
    }
    return { props, skip: true };
  }
  if (
    entry._tag === "LayerPending" ||
    entry._tag === "LayerReady" ||
    entry._tag === "LayerFailed"
  ) {
    return { props, skip: true };
  }
  if (entry._tag !== "Update") {
    return { props, skip: true };
  }
  if (entry.instance !== instance) {
    return { props, skip: true };
  }
  return { props, skip: false };
};

/**
 * Re-runs a logged session of one component, purely, and reports the first
 * place it doesn't reproduce. Starts at the oldest surviving `Mounted` or
 * `Update` for the path (the first one logged for a component of this name
 * unless `path` is given), takes its Model and props, and replays every
 * later `Update` with the recorded props, threading `PropsChanged` and
 * live `QueryChanged` results through. Commands are compared, never run.
 * Model and events compare with the component Schemas; Commands compare by
 * name and args, lists and sends structurally. A path that mounted more
 * than once replays instance by instance; the result is the last
 * instance's state.
 *
 * Errors start with `Story.fromLog:`. Wire frames decode through the
 * component Schemas; a placeholder value can't be decoded and names its
 * entry. Wire `QueryChanged` results aren't decodable: pass live entries
 * to replay queries.
 */
export const fromLog = <C extends AnyComponent>(
  component: C,
  entries: readonly (MessageLog.Entry | MessageLog.Wire)[],
  options?: { readonly path?: string | undefined }
): Replay<
  ModelOf<C>,
  MessageOf<C>,
  EventsOf<C>,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- replays hold query results keyed by query name.
  Record<string, unknown>,
  PropsOf<C>
> => {
  const step = "Story.fromLog";
  const name = component.definitionName;
  const decoded = entries.map((entry, index) =>
    decodeEntry(step, component, entry, index)
  );
  const wanted = options?.path;
  const opening = findStart(step, decoded, name, wanted);
  const { entry: first, index: startIndex, path } = opening;
  // SAFETY: the start entry carries this component's own model; the path filter guarantees the component.
  let model = first.model as ModelOf<C>;
  // SAFETY: the start entry carries this component's own props; the path filter guarantees the component.
  let props = (first.props ?? {}) as PropsOf<C>;
  let replayed = 0;
  let divergence:
    | Divergence<ModelOf<C>, MessageOf<C>, EventsOf<C>>
    | undefined = undefined;
  let { instance } = first;
  // SAFETY: the engine erases props; the cursor narrows them back through C.
  const engine = new Engine("Story", component, props as unknown);
  engine.state.model = model;
  refreshQueries(engine);
  for (
    let index = startIndex;
    index < decoded.length && divergence === undefined;
    index += 1
  ) {
    const entry = decoded[index];
    if (entry === undefined) {
      break;
    }
    if (entry.path !== path) {
      continue;
    }
    if (
      entry._tag === "Mounted" &&
      index !== startIndex &&
      entry.instance !== instance
    ) {
      // A second mount at the same path starts over; the result is the last instance's state.
      ({ instance } = entry);
      ({ model, props } = remountInstance<C>(engine, entry));
      replayed = 0;
      continue;
    }
    const { props: nextProps, skip } = absorbEntry(
      engine,
      step,
      entry,
      path,
      instance,
      props
    );
    props = nextProps;
    if (skip) {
      continue;
    }
    // SAFETY: update entries carry the component's own props, falling back to the last ones.
    props = (entry.props ?? props) as PropsOf<C>;
    engine.state.props = props;
    engine.state.model = model;
    refreshQueries(engine);
    const outcome = replayUpdate(engine, component, entry, model, props);
    if (outcome._tag === "diverged") {
      ({ divergence } = outcome);
      break;
    }
    ({ model } = outcome);
    replayed += 1;
  }
  return {
    divergence,
    model,
    path,
    props,
    queries: () =>
      // SAFETY: query results are keyed by query name; the query runtime fills them per name.
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- replays hold query results keyed by query name.
      (engine.state.slices["queries"] ?? {}) as Record<string, unknown>,
    replayed,
    results: engine.state.slices["results"],
  };
};
