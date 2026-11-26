/**
 * The pure engine behind `Story` and `Scene`: runs `init` and `update`
 * synchronously, schedules Commands through the shared `schedule` module,
 * and enforces the acknowledgement rule. No runtime, no Layers, no host.
 *
 * Wave-3 slices (queries, mounts, shared state, provide) plug in through
 * `registerTestExtension` in `steps.ts`; the engine consults them for
 * pending descriptions, outputs, `given` guards, helper fields and steps.
 *
 * @internal
 */
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { h as coreH } from "ilha";
import type { View, VNode } from "ilha";

import type * as Command from "../command.ts";
import { groupKeyOf, nameOf } from "../command.ts";
import type {
  Helper,
  InitStep,
  ListIssue,
  SendOptions,
  Step,
  Update,
} from "../component.ts";
import {
  initStepOf,
  isStep,
  makeInitApi,
  makeUpdateApi,
} from "../component.ts";
import { readCallProps, routeEmit } from "../internal/child.ts";
import { isNoop } from "../internal/noop.ts";
import { collectChildren, definitionNameOf } from "../internal/paths.ts";
import { next, schedule } from "../internal/schedule.ts";
import type * as Subscription from "../subscription.ts";
import {
  mountAllPending,
  mountInFlight,
  refreshMounts,
  registerMountsSlice,
} from "./mounts.ts";
import type { Slices } from "./parts.ts";
import {
  dropLivePatches,
  noteIssued,
  noteResolve,
  noteStepLists,
  queryAllPending,
  queryCheckGiven,
  queryInFlight,
  queryInfoOf,
  queryLoadingMore,
  queryOpened,
  refreshQueries,
  registerQuerySlice,
} from "./queries.ts";
import {
  noteStepSends,
  readsForUpdate,
  registerSharedSlice,
  sharedReports,
} from "./shared.ts";
import { stepError, testExtensions } from "./steps.ts";
import type {
  AnyComponent,
  AwaitedQuery,
  ExtensionContext,
  Pending,
  QueryInfo,
  Target,
} from "./steps.ts";
import { describeCommand, describeTarget, matchesTarget } from "./targets.ts";

/** Whether `value` is callable. */
const isFunction = <T>(
  value: T
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- predicates narrow; they expose no values.
): value is T & ((...args: readonly unknown[]) => unknown) =>
  typeof value === "function";

/** Whether a send message is a factory of the event rather than a literal message. */
const isMessageFactory = (
  message: unknown
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- predicates narrow; they expose no values.
): message is (event: unknown) => unknown => typeof message === "function";

/** Whether a subscription declaration carries the string key the runtime requires. */
const isKeyedDeclaration = (
  entry: unknown
): entry is { readonly key: string } =>
  typeof entry === "object" &&
  entry !== null &&
  "key" in entry &&
  typeof entry.key === "string";

export const isVNode = (node: unknown): node is VNode =>
  typeof node === "object" &&
  node !== null &&
  "$$ilha" in node &&
  node.$$ilha === 1;

/**
 * The runtime implementation behind a component function. The public
 * `ModelComponent` type erases it; the test engine reads it back through
 * this boundary.
 */
export interface ComponentImplementation {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the erased init boundary; the definition props Schema validates below.
  readonly init: ($: unknown, props: unknown) => unknown;
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the single-function update form takes erased args; update validates them.
  readonly update:
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- the single-function update form takes erased args; update validates them.
    | ((...args: readonly unknown[]) => unknown)
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- per-tag handlers take erased args; update validates them.
    | Record<string, (...args: readonly unknown[]) => unknown>;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the erased view boundary; h and model are validated by the definition schemas.
  readonly view?: ((h: unknown, model: unknown) => View) | undefined;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- parts callbacks receive erased owner props; parts.ts narrows them.
  readonly parts?: ((p: unknown, model: unknown) => unknown) | undefined;
  readonly subscriptions?:
    | ((current: {
        readonly model: unknown;
        readonly props: unknown;
      }) => readonly unknown[])
    | undefined;
}

export const implementationOf = (
  component: AnyComponent
): ComponentImplementation => {
  // SAFETY: ModelComponent erases its implementation; the test engine restores the documented init/update/view/parts/subscriptions shape.
  const holder = component as AnyComponent & {
    readonly implementation: ComponentImplementation;
  };
  return holder.implementation;
};

registerQuerySlice();
registerSharedSlice();
registerMountsSlice();
/** The path the component under test mounts at. */
export const rootPathOf = (component: AnyComponent): string =>
  `/${component.definitionName}`;

/** Whether a pending run blocks message steps: streams and `switch`/`queue` modes never do. */
export const isExempt = (entry: Pending): boolean =>
  entry.command._tag === "Stream" ||
  entry.command.mode === "switch" ||
  entry.command.mode === "queue";

/** The settle hint a failure item carries for one pending Command. */
export const settleHint = (entry: Pending): string => {
  if (entry.status === "awaiting") {
    // SAFETY: awaiting runs carry the queries they wait on; Pending erases the field the query slice sets.
    const names =
      (entry as { readonly awaiting?: readonly AwaitedQuery[] }).awaiting
        ?.map((a) => `"${a.name}"`)
        .join(", ") ?? "its queries";
    return `end its wait with loaded or loadFailed on ${names}, or waitExpired`;
  }
  if (entry.command._tag === "Stream") {
    return "settle it with next, end or fail";
  }
  return "settle it with resolve or fail";
};

/** The oldest running run matching `target`, or `undefined`. */
export const oldestMatch = (
  pending: readonly PendingEntry[],
  target: Target
): PendingEntry | undefined =>
  pending.find(
    (entry) =>
      entry.status === "running" && matchesTarget(entry.command, target)
  );

/**
 * One in-flight run: the issued Command, its scheduler status, the message
 * a settled run will deliver (set by the query runtime), and whether
 * `keepPending` marked it.
 */
export interface PendingEntry {
  readonly command: Command.Issued<unknown, never>;
  status: "running" | "queued" | "awaiting" | "stopping";
  readonly message: unknown | undefined;
  readonly kept: boolean;
  readonly awaiting: readonly AwaitedQuery[];
  readonly canFail: boolean;
}

/** A child the current view declares: its call options plus where it was written. */
export interface ChildEntry {
  readonly name: string;
  readonly key: string;
  readonly path: string;
  readonly vnode: VNode;
  readonly onEmit: unknown;
  readonly onFailure: unknown;
  readonly fallback: unknown;
}

/** The engine state between steps. */
export interface EngineState {
  component: AnyComponent;
  props: unknown;
  model: unknown;
  pending: PendingEntry[];
  interrupted: Command.Issued<unknown, never>[];
  emitted: unknown[];
  sent: { readonly owner: string; readonly message: unknown }[];
  ignored: boolean;
  defaultPrevented: boolean;
  acted: boolean;
  /** Messages delivered through `update`, for interaction produced-checks. */
  deliveries: number;
  children: ChildEntry[];
  slices: Slices;
  depth: number;
}

/**
 * The operations a wave-3 slice's steps get, besides `ExtensionContext`.
 * Slices manipulate runs through these so the scheduler invariants stay in
 * one place.
 */
export interface EngineInternals extends ExtensionContext {
  /** The live engine state. */
  readonly state: EngineState;
  /** The module name a step error starts with (`Story` or `Scene`). */
  readonly module: string;
  /** Remove `entry` from pending and start the group's oldest queued run. */
  readonly settleRun: (entry: PendingEntry) => void;
  /** Dispatch a message through `update` now, with the loop guard. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- slices dispatch unparsed author messages; update validates them.
  readonly deliver: (message: unknown) => void;
  /** Recompute children from the current view (Scene calls this after steps). */
  readonly refreshChildren: () => void;
}

const toPending = (entry: PendingEntry): Pending => ({
  command: entry.command,
  message: entry.message,
  status: entry.status,
});

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Show an event through its Schema when possible, structurally otherwise. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- events are author values; the Schema validates them below.
const showEvent = (schema: Schema.Schema<unknown>, event: unknown): string => {
  try {
    // SAFETY: encodeUnknownSync runs the definition events Schema over the emitted value; the catch falls back to a structural show.
    return JSON.stringify(Schema.encodeUnknownSync(schema as never)(event));
  } catch {
    return JSON.stringify(event) ?? String(event);
  }
};

/** The record a test cursor exposes: the live state plus slice queries. */
export interface EngineRecord {
  readonly component: AnyComponent;
  readonly emitted: readonly unknown[];
  readonly interrupted: readonly Command.Issued<unknown, never>[];
  readonly loadingMore: readonly string[];
  readonly pending: readonly Pending[];
  readonly props: unknown;
  readonly queryInfo: readonly QueryInfo[];
  readonly reports: readonly {
    readonly owner: string;
    readonly report: unknown;
  }[];
  readonly sent: readonly {
    readonly owner: string;
    readonly message: unknown;
  }[];
  readonly slices: Slices;
  readonly subscriptions: () => readonly string[];
}

/**
 * The pure engine. One per cursor; steps mutate it and rebuild the record
 * view. `module` names the cursor kind for error prefixes.
 */
export class Engine {
  readonly state: EngineState;
  readonly module: string;
  private helper: Helper<unknown, never> | undefined = undefined;
  /** The `$.loadMore`/`$.reset` calls of the last applied step, for `fromLog`. */
  lastLists: readonly ListIssue[] = [];
  /** Handlers built by this engine's `h.send`, with their options, for Scene. */
  readonly sendOptions = new WeakMap<
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- the harness keys host handlers by identity; the callbacks are opaque.
    (...args: readonly unknown[]) => unknown,
    SendOptions
  >();

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the cursor drives whatever props the component declares; init decodes them.
  constructor(module: string, component: AnyComponent, props: unknown) {
    this.module = module;
    this.state = {
      acted: false,
      children: [],
      component,
      defaultPrevented: false,
      deliveries: 0,
      depth: 0,
      emitted: [],
      ignored: false,
      interrupted: [],
      model: undefined,
      pending: [],
      props,
      sent: [],
      slices: {},
    };
    this.runInit();
  }

  /** The definition Schemas, erased. */
  get definition() {
    return this.state.component.definition;
  }

  /** Run `init` and apply its step: Commands stay pending, events unacknowledged. */
  private runInit(): void {
    const { component } = this.state;
    const impl = implementationOf(component);
    let props: unknown;
    try {
      // SAFETY: decodeUnknownSync runs the definition props Schema over the test input; the Schema validates it.
      props = Schema.decodeUnknownSync(component.definition.props as never)(
        this.state.props ?? {}
      );
    } catch (error) {
      throw new Error(`${this.statePath()} init threw: ${messageOf(error)}`, {
        cause: error,
      });
    }
    this.state.props = props;
    const api = makeInitApi<unknown, unknown, never>(props, (model) =>
      initStepOf(model)
    );
    let out: Step<unknown, never> | unknown;
    try {
      out = impl.init(api, props);
    } catch (error) {
      throw new Error(`${this.statePath()} init threw: ${messageOf(error)}`, {
        cause: error,
      });
    }
    // SAFETY: isStep proves out carries a Step; the annotation restores the erased Model and message types.
    const step: Step<unknown, never> | InitStep<unknown, never, never> = isStep(
      out
    )
      ? (out as Step<unknown, never>)
      : initStepOf(out);
    if (step.model === undefined) {
      throw new Error(
        `init of ${this.statePath()} must set a Model: return a Model or call $.set(...)`
      );
    }
    this.applyStep(step, "init");
  }

  private statePath(): string {
    return rootPathOf(this.state.component);
  }

  /** Apply a step's Model, Commands, events, sends and query lists. */
  private applyStep(
    step: Step<unknown, never> | InitStep<unknown, never, never>,
    _origin: string
  ): void {
    this.state.model = step.model;
    for (const command of step.commands) {
      this.issue(command);
    }
    for (const event of step.events) {
      this.state.emitted.push(event);
    }
    noteStepSends(this, step.sends ?? []);
    const lists = "lists" in step ? step.lists : [];
    this.lastLists = lists;
    noteStepLists(this, lists);
    // SAFETY: the engine implements the query slice's host contract; never is its contravariant engine parameter.
    refreshQueries(this as never);
  }

  /** Issue a Command through the shared scheduler. */
  issue(command: Command.Command<unknown, never>): void {
    if (command._tag === "Interrupt") {
      const entries = this.state.pending.map((entry) => ({
        key: entry.command.groupKey,
        mode: entry.command.mode,
        name: entry.command.name,
        status: entry.status,
        value: entry,
      }));
      const decision = schedule(entries, command);
      for (const cut of decision.interrupt) {
        this.cut(cut.value);
      }
      return;
    }
    const issued = command;
    const entries = this.state.pending.map((entry) => ({
      key: entry.command.groupKey,
      mode: entry.command.mode,
      name: entry.command.name,
      status: entry.status,
      value: entry,
    }));
    const decision = schedule(entries, issued);
    for (const cut of decision.interrupt) {
      this.cut(cut.value);
    }
    if (decision.action === "none") {
      return;
    }
    this.state.pending.push({
      awaiting: [],
      canFail: issued.reject !== undefined,
      command: issued,
      kept: false,
      message: undefined,
      status: decision.action === "queue" ? "queued" : "running",
    });
    noteIssued(this, issued);
  }

  /** Cut a run: an awaiting run with a message delivers it instead. */
  private cut(entry: PendingEntry): void {
    this.state.pending = this.state.pending.filter((other) => other !== entry);
    dropLivePatches(this, entry.command);
    if (entry.message !== undefined && !isNoop(entry.message)) {
      this.deliver(entry.message);
      return;
    }
    this.state.interrupted.push(entry.command);
  }

  /**
   * Deliver a message to `update` synchronously, with the 100-round loop
   * guard. A defect throws on the calling line.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the test engine delivers unparsed author messages; update validates them.
  deliver(message: unknown): void {
    if (isNoop(message) || message === undefined) {
      return;
    }
    this.state.deliveries += 1;
    if (this.state.depth > 100) {
      throw new Error(
        `${this.statePath()} exceeded 100 nested messages: check for an emit ping-pong between parent and child`
      );
    }
    const { component, model, props } = this.state;
    const impl = implementationOf(component);
    this.state.depth += 1;
    try {
      const { update } = impl;
      // SAFETY: the query slice fills the opened queries; the engine passes them through opaquely.
      const apiFor = (tag?: string) =>
        makeUpdateApi<unknown, never, unknown>(
          model,
          props,
          tag,
          readsForUpdate(this),
          queryOpened(this) as never
        );
      let api: Update<unknown, never, unknown>;
      let out: unknown;
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- branches the erased update forms: a single function or the per-tag record.
      if (typeof update === "function") {
        api = apiFor();
        out = update(api, message);
      } else {
        // SAFETY: per-tag updates receive tagged record messages; the engine reads the tag structurally.
        const tag = (message as { readonly _tag?: unknown })._tag;
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the tag is author data; the record lookup below validates it.
        if (typeof tag !== "string") {
          throw new TypeError(
            `${this.statePath()} got a message with no _tag, but its update is a per-tag record`
          );
        }
        const handler = update[tag];
        if (handler === undefined) {
          throw new Error(
            `"${this.statePath()}" has no update handler for "${tag}"`
          );
        }
        api = apiFor(tag);
        out = handler(api, message);
      }
      // SAFETY: isStep proves out carries a Step; the annotation restores the erased Model and message types.
      const step: Step<unknown, never> = isStep(out)
        ? (out as Step<unknown, never>)
        : api.set(out);
      if (step.model === undefined) {
        throw new Error(
          `${this.statePath()} update returned undefined: return a Model or a step holding one`
        );
      }
      this.applyStep(step, "update");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith(this.statePath())
      ) {
        throw error;
      }
      throw new Error(`${this.statePath()} update threw: ${messageOf(error)}`, {
        cause: error,
      });
    } finally {
      this.state.depth -= 1;
    }
  }

  /** The view helper for the current props and Model. */
  viewHelper(): Helper<unknown, never> {
    const send = (
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the harness builds host handlers from unparsed author messages; update validates them.
      message: unknown,
      options?: SendOptions | undefined
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- host DOM events are untyped; the message factory narrows below.
    ): ((event: unknown) => void) => {
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- host DOM events are untyped; the message factory narrows below.
      const handler = (event: unknown): void => {
        const produced = isMessageFactory(message) ? message(event) : message;
        const prevent = options?.preventDefault ?? false;
        if (
          prevent === "always" ||
          (prevent === true && produced !== undefined)
        ) {
          try {
            // SAFETY: synthetic events carry preventDefault when prevent is set; the optional call tolerates its absence.
            (
              event as { readonly preventDefault?: () => void }
            ).preventDefault?.();
          } catch {
            // A synthetic event without preventDefault still dispatches.
          }
        }
        if (produced !== undefined) {
          this.deliver(produced);
        }
      };
      // SAFETY: the Scene reads these options back by handler identity; the harness records them even when undefined.
      this.sendOptions.set(handler, options as SendOptions);
      return handler;
    };
    const isRunning = (
      definition: Command.Definition.Any,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- groupKeyOf takes the caller's group pick; unknown is its honest input.
      group?: unknown
    ): boolean => {
      const name = nameOf(definition);
      const key =
        group === undefined ? undefined : groupKeyOf(definition, group);
      return this.state.pending.some(
        (entry) =>
          entry.command.name === name &&
          (group === undefined || entry.command.groupKey === key)
      );
    };
    const id = (name: string, key?: string | number | undefined): string =>
      `${this.statePath().replaceAll(/[^A-Za-z0-9]/gu, "_")}-${name}${key === undefined ? "" : `-${String(key)}`}`;
    const extra: Slices = {
      children: [],
      id,
      isRunning,
      props: this.state.props,
      send,
    };
    // SAFETY: the test helper reuses ilha's h with harness extras; the call shape matches h's.
    const base = Object.assign(
      coreH as (...args: readonly unknown[]) => View,
      extra
    );
    for (const extension of testExtensions()) {
      if (extension.helper === undefined) {
        continue;
      }
      Object.assign(base, extension.helper(this.internals()));
    }
    // SAFETY: the extras above complete h to the Helper contract the views consume.
    this.helper = base as typeof base & Helper<unknown, never>;
    return this.helper;
  }

  /** Render the view with the current helper. Defects throw on the calling line. */
  renderView(): View {
    const { component, model } = this.state;
    const impl = implementationOf(component);
    const helper = this.viewHelper();
    // SAFETY: the helper is rebuilt per render; refreshing its props keeps the record view current.
    (helper as { props: unknown }).props = this.state.props;
    if (impl.view === undefined) {
      throw new Error(
        `${this.statePath()} has no view: only a headless component renders without one`
      );
    }
    try {
      return impl.view(helper, model);
    } catch (error) {
      throw new Error(`${this.statePath()} view threw: ${messageOf(error)}`, {
        cause: error,
      });
    }
  }

  /** Recollect the view's model children (Scene calls this after every step). */
  refreshChildren(view?: View): void {
    const rendered = view ?? this.renderView();
    const calls = collectChildren(rendered);
    const parent = rootPathOf(this.state.component);
    this.state.children = calls.map((call) => {
      const { vnode } = call;
      const callProps = readCallProps(vnode.props);
      return {
        fallback: callProps.fallback,
        key: call.key,
        name: call.name,
        onEmit: callProps.onEmit,
        onFailure: callProps.onFailure,
        path: `${parent}/${call.name}${call.key === "" ? "" : `[${call.key}]`}`,
        vnode,
      };
    });
    refreshMounts(this, rendered);
  }

  /** Route a child's event through the author's `onEmit`, returning the parent message. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, eslint/class-methods-use-this -- child events are author values; routeEmit validates them; the method is instance API for symmetry with deliver.
  routeChildEmit(child: ChildEntry, event: unknown): unknown {
    // SAFETY: onEmit is the author's handler union; never is its contravariant event parameter.
    return routeEmit(child.onEmit as never, event);
  }

  /** The internals a wave-3 slice's steps receive. */
  internals(): EngineInternals {
    return {
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the test engine delivers unparsed author messages; update validates them.
      deliver: (message: unknown) => this.deliver(message),
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the test engine delivers unparsed author messages; update validates them.
      dispatchMessage: (message: unknown) => this.deliver(message),
      fail: (
        step: string,
        what: string,
        // oxlint-disable-next-line typescript/array-type -- the slice contract names ReadonlyArray; changing it would ripple through every slice.
        problems: ReadonlyArray<string>
      ): never => {
        throw stepError(step, what, problems);
      },
      module: this.module,
      refreshChildren: () => this.refreshChildren(),
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- slices store arbitrary author values; the slice owns its entry.
      setSlice: (name: string, value: unknown) => {
        this.state.slices[name] = value;
      },
      settleRun: (entry: PendingEntry) => this.settleRun(entry),
      slice: (name: string) => this.state.slices[name],
      state: this.state,
    };
  }

  /** Remove `entry` from pending and start the group's oldest queued run. */
  settleRun(entry: PendingEntry): void {
    this.state.pending = this.state.pending.filter((other) => other !== entry);
    const candidates = this.state.pending.map((other) => ({
      key: other.command.groupKey,
      mode: other.command.mode,
      name: other.command.name,
      status: other.status,
      value: other,
    }));
    // oxlint-disable-next-line node/callback-return -- next is the scheduler helper, not a middleware callback.
    const promoted = next(candidates, {
      key: entry.command.groupKey,
      mode: entry.command.mode,
      name: entry.command.name,
      status: entry.status,
      value: entry,
    });
    if (promoted !== undefined) {
      promoted.value.status = "running";
    }
  }

  /** Resolve the oldest running run matching `target` with the raw result. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- resolve takes the raw Command result; the Command's own decoder validates it.
  resolveRun(step: string, target: Target, result: unknown): void {
    const entry = oldestMatch(this.state.pending, target);
    if (entry === undefined) {
      throw new Error(
        `${step}: nothing pending matches ${describeTarget(target)}${this.pendingHint()}`
      );
    }
    const issued = entry.command;
    let message: unknown;
    try {
      message = issued.resolve(result);
    } catch (error) {
      throw new Error(
        `${step}: resolving ${describeCommand(issued)} threw: ${messageOf(error)}`,
        { cause: error }
      );
    }
    if (noteResolve(this, entry, issued, result)) {
      return;
    }
    this.settleRun(entry);
    this.deliver(message);
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- fail takes the raw Command failure; the Command's reject maps it.
  failRun(step: string, target: Target, error: unknown): void {
    const entry = oldestMatch(this.state.pending, target);
    if (entry === undefined) {
      throw new Error(
        `${step}: nothing pending matches ${describeTarget(target)}${this.pendingHint()}`
      );
    }
    const { reject } = entry.command;
    if (reject === undefined) {
      throw new Error(
        `${step}: ${describeCommand(entry.command)} can't fail: no typed failure is mapped by Command.match`
      );
    }
    const message = reject(error);
    // A failure ends a stream Command and never waits for refetches.
    dropLivePatches(this, entry.command);
    this.settleRun(entry);
    this.deliver(message);
  }

  /** Send one element of the oldest running stream matching `target`. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- next takes the raw stream element; the stream Command decodes it.
  nextElement(step: string, target: Target, result: unknown): void {
    const entry = oldestMatch(this.state.pending, target);
    if (entry === undefined) {
      throw new Error(
        `${step}: nothing pending matches ${describeTarget(target)}${this.pendingHint()}`
      );
    }
    if (entry.command._tag !== "Stream") {
      throw new Error(
        `${step}: ${describeCommand(entry.command)} isn't a stream Command: use resolve to settle it`
      );
    }
    this.deliver(entry.command.resolve(result));
  }

  /** End the oldest running stream matching `target`, sending nothing. */
  endStream(step: string, target: Target): void {
    const entry = oldestMatch(this.state.pending, target);
    if (entry === undefined) {
      throw new Error(
        `${step}: nothing pending matches ${describeTarget(target)}${this.pendingHint()}`
      );
    }
    if (entry.command._tag !== "Stream") {
      throw new Error(
        `${step}: ${describeCommand(entry.command)} isn't a stream Command: use resolve to settle it`
      );
    }
    this.settleRun(entry);
  }

  private pendingHint(): string {
    if (this.state.pending.length === 0) {
      return `: nothing is pending`;
    }
    return `; pending:\n  - ${this.state.pending.map((entry) => `${describeCommand(entry.command)} [${entry.status}]`).join("\n  - ")}`;
  }

  // ---------------------------------------------------------------------------
  // acknowledgement rule
  // ---------------------------------------------------------------------------

  /** Work in flight that blocks a message step, as failure-list items. */
  inFlight(module: string): string[] {
    const items: string[] = [];
    for (const entry of this.state.pending) {
      if (entry.kept || isExempt(entry)) {
        continue;
      }
      items.push(
        `${describeCommand(entry.command)} [${entry.status}] is pending: ${settleHint(entry)}, or keep it with keepPending`
      );
    }
    items.push(
      ...queryInFlight(this),
      ...mountInFlight({ module, slices: this.state.slices })
    );
    for (const extension of testExtensions()) {
      if (extension.inFlight !== undefined) {
        items.push(...extension.inFlight(this.extensionState()));
      }
    }
    return items;
  }

  /** Every pending item, kept or exempt included: the end check and `given` can't leave it. */
  allPending(): string[] {
    const items = this.state.pending.map(
      (entry) =>
        `${describeCommand(entry.command)} [${entry.status}] is pending: ${settleHint(entry)}`
    );
    items.push(
      ...queryAllPending(this),
      ...mountAllPending({ module: this.module, slices: this.state.slices })
    );
    for (const extension of testExtensions()) {
      if (extension.allPending !== undefined) {
        items.push(...extension.allPending(this.extensionState()));
      }
    }
    return items;
  }

  /** Outputs no step acknowledged yet, as failure-list items. */
  outputs(): string[] {
    const items: string[] = [];
    for (const event of this.state.emitted) {
      items.push(
        `${showEvent(this.definition.events, event)} was emitted: acknowledge it with emitted`
      );
    }
    for (const send of this.state.sent) {
      items.push(
        `${JSON.stringify(send.message)} to the owner ${send.owner} was sent: acknowledge it with sent`
      );
    }
    if (this.state.ignored) {
      items.push(
        `the last interaction produced no message: acknowledge it with expectIgnored`
      );
    }
    for (const extension of testExtensions()) {
      if (extension.outputs !== undefined) {
        items.push(...extension.outputs(this.extensionState()));
      }
    }
    return items;
  }

  /** The pre-step checks: message steps see work in flight plus outputs, acting steps outputs only. */
  checkBefore(step: string, kind: "message" | "acting"): void {
    const problems =
      kind === "message"
        ? [...this.inFlight(step), ...this.outputs()]
        : this.outputs();
    if (problems.length > 0) {
      throw stepError(
        step,
        "earlier work isn't settled or acknowledged",
        problems
      );
    }
  }

  /** The end check: nothing pending (kept or exempt included), no unacknowledged output. */
  checkEnd(step: string): void {
    const problems = [...this.allPending(), ...this.outputs()];
    if (problems.length > 0) {
      throw stepError(
        step,
        "the test ends with work not settled or acknowledged",
        problems
      );
    }
  }

  /** `given` after an acting step throws rather than discard pending work or unacknowledged outputs. */
  checkGiven(step: string): void {
    const problems = [
      ...this.allPending(),
      ...this.outputs(),
      ...queryCheckGiven(this, this.state.model),
    ];
    for (const extension of testExtensions()) {
      if (extension.checkGiven !== undefined) {
        problems.push(
          ...extension.checkGiven(this.extensionState(), this.state.model)
        );
      }
    }
    if (problems.length > 0) {
      throw stepError(
        step,
        "given would discard work not settled or acknowledged",
        problems
      );
    }
  }

  private extensionState(): EngineInternals {
    return this.internals();
  }

  /** The active Subscription declarations the current Model and props ask for. */
  subscriptionDecls(): Subscription.Subscription<unknown, unknown>[] {
    const impl = implementationOf(this.state.component);
    if (impl.subscriptions === undefined) {
      return [];
    }
    let list: readonly unknown[];
    try {
      list = impl.subscriptions({
        model: this.state.model,
        props: this.state.props,
      });
    } catch (error) {
      throw new Error(
        `${this.statePath()} subscriptions threw: ${messageOf(error)}`,
        { cause: error }
      );
    }
    // SAFETY: isKeyedDeclaration proves the string key; the declarations come from the component's own subscriptions.
    return list.filter(isKeyedDeclaration) as Subscription.Subscription<
      unknown,
      unknown
    >[];
  }

  /** Compute the Subscription keys the current Model and props ask for. Throws on duplicates. */
  subscriptionKeys(step: string): string[] {
    const keys = this.subscriptionDecls().map((sub) => sub.key);
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) {
        throw new Error(
          `${step}: two Subscriptions share the key ${JSON.stringify(key)}: the instance fails in the runtime, so the step fails here`
        );
      }
      seen.add(key);
    }
    return keys;
  }

  /** The record the cursor exposes. */
  record(): EngineRecord {
    return {
      component: this.state.component,
      emitted: [...this.state.emitted],
      interrupted: [...this.state.interrupted],
      loadingMore: queryLoadingMore(this),
      pending: this.state.pending.map(toPending),
      props: this.state.props,
      queryInfo: queryInfoOf(this),
      reports: sharedReports(this),
      sent: [...this.state.sent],
      slices: this.state.slices,
      subscriptions: () =>
        this.subscriptionKeys(`${this.module}.subscriptions`),
    };
  }

  /** Marks the last interaction as producing no message, for `expectIgnored`. */
  markIgnored(): void {
    this.state.ignored = true;
  }
}

/** Compare events with the `events` Schema equivalence, falling back to `Equal`. */
export const eventsEqual = (
  schema: Schema.Schema<unknown>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- events are author values; the Schema equivalence validates them.
  left: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- events are author values; the Schema equivalence validates them.
  right: unknown
): boolean => {
  try {
    // SAFETY: the Schema equivalence runs on author values; the catch falls back to Equal on any mismatch.
    return Schema.toEquivalence(schema as Schema.Schema<never>)(
      left as never,
      right as never
    );
  } catch {
    return Equal.equals(left, right);
  }
};

/**
 * Whether `type` is a model component function, by its definition name.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- component values are erased at this boundary; definitionNameOf validates the brand.
export const componentNameOf = (type: unknown): string | undefined =>
  isFunction(type) ? definitionNameOf(type) : undefined;

/**
 * Whether a VNode is a model-component child.
 */
export const isModelChild = (vnode: VNode): boolean =>
  isFunction(vnode.type) && componentNameOf(vnode.type) !== undefined;

export { Fragment } from "ilha";
export { keyOf } from "../internal/subscriptions.ts";
