// oxlint-disable eslint/max-classes-per-file -- RootCrashed, SettleError and ProblemsError are the host's three failure shapes; they belong together.
/**
 * The test host: mounts components with the real Ilha renderer under
 * happy-dom, settles them, and inspects the run through a memory log.
 * `Play` drives trees mounted here; the log and the `pending` scan are
 * log-derived, so deep runtime states (queued and stopping runs, fetches
 * held by the query cache) need their slices' extension hooks.
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { PropBag, View, VNode } from "ilha";
import { render } from "ilha/test";
import type { TestUi } from "ilha/test";

import { Component, defineComponent } from "../component.ts";
import { isService } from "../feature.ts";
import type * as Feature from "../feature.ts";
import * as MessageLog from "../message-log.ts";
import * as Subscription from "../subscription.ts";
import { stubBrand } from "./scene.ts";
import type { AnyComponent, PropsOf } from "./steps.ts";

/** Whether `value` is a string. */
const isString = <T>(value: T): value is T & string =>
  typeof value === "string";

/** Whether `value` is a number. */
const isNumber = <T>(value: T): value is T & number =>
  typeof value === "number";

/** A log entry viewed as a record for host inspection. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- log entries are heterogeneous; the host reads tag/path/model per case.
type EntryView = Record<string, unknown>;

/** Views a log entry as a record for host inspection. */
const viewOf = (entry: MessageLog.Entry): EntryView =>
  // SAFETY: the host only reads documented log fields; entries always carry a tag.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- log entries are a closed union with no single-step assertion to the view shape.
  entry as unknown as EntryView;

/** The un-dashed-tag element builder the stub view calls. */
type StubElement = (
  type: string,
  props: PropBag | null,
  ...rest: View[]
) => VNode;

export class RootCrashed extends Data.TaggedError("RootCrashed")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

/**
 * Settling ran out of budget: work kept arriving. The message carries the
 * last log lines and the pending list.
 */
export class SettleError extends Data.TaggedError("SettleError")<{
  readonly message: string;
  readonly pending: readonly Pending[];
  readonly log: readonly MessageLog.Entry[];
}> {}

/**
 * The `TestQuery` cache or the host reported problems nobody consumed with
 * `expectProblem`. The layer's scope close turns them into this defect.
 */
export class ProblemsError extends Data.TaggedError("ProblemsError")<{
  readonly problems: readonly unknown[];
}> {}

/**
 * A run or fetch the host still sees open: a Command whose `CommandStarted`
 * has no end yet (`running`, or `awaiting` when a `CommandAwaiting` entry
 * is open for it), or a fetch the log started.
 */
export type Pending =
  | {
      readonly _tag: "Command";
      readonly path: string;
      readonly name: string;
      readonly status: "running" | "awaiting";
    }
  | {
      readonly _tag: "Fetch";
      readonly path: string;
      readonly query: string;
      readonly logKey: string;
      readonly trigger: string;
    }
  | { readonly _tag: "Load"; readonly path: string; readonly name: string };

/**
 * A mounted test root: the container it paints into, snapshots of its DOM,
 * the Model from its latest log entry, and its own settle and inspect
 * helpers.
 */
export interface TestRoot {
  /** The instance path the root mounts at. */
  readonly path: string;
  /** The live container. */
  readonly container: Element;
  /** The container's text. */
  readonly text: () => string;
  /** The container's HTML. */
  readonly html: () => string;
  /** The Model of the root instance, from its latest log entry, or `undefined` after a crash. */
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- models are schema-erased until the test decodes them.
  readonly model: () => unknown;
  /** Settles this root's tree. */
  readonly settle: () => Effect.Effect<
    void,
    SettleError | RootCrashed | ProblemsError
  >;
  /** What this root's session still sees open. */
  readonly pending: () => readonly Pending[];
  /** This root's session entries, oldest first. */
  readonly log: () => readonly MessageLog.Entry[];
}

/**
 * The test host: the controls and the records of one test mount.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the const below is the Context.Service for this contract; interface+service pairing is the documented pattern.
export interface TestHost {
  /** The memory log every mount under this host records to. */
  readonly log: MessageLog.Memory;
  /** Mounts a component and settles the first render. */
  readonly mount: <C extends AnyComponent>(
    component: C,
    props: PropsOf<C>
  ) => Effect.Effect<
    TestRoot,
    SettleError | RootCrashed | ProblemsError,
    Scope.Scope
  >;
  /** Drains every mounted tree until idle, then fails on crashes and problems. */
  readonly settle: () => Effect.Effect<
    void,
    SettleError | RootCrashed | ProblemsError
  >;
  /** What the host still sees open, across every mounted tree. */
  readonly pending: () => readonly Pending[];
  /** Reported problems nobody consumed with `expectProblem`. */
  readonly problems: () => readonly Problem[];
  /** Records a problem, as the runtime and the fakes do. */
  readonly report: (problem: Problem) => void;
  /** Removes and returns every reported problem with the tag, preventing scope-close failure. */
  readonly expectProblem: (tag: string) => readonly Problem[];
  /** Sets visibility and refires the host signal (`visibilitychange`). */
  readonly setVisible: (visible: boolean) => void;
  /** Sets connectivity and refires the host signal (`online`/`offline`). */
  readonly setOnline: (online: boolean) => void;
  /** One entry per line, for failure messages. */
  readonly formatLog: (entries: readonly MessageLog.Entry[]) => string;
  /** Facts with their consequences indented, for failure messages. */
  readonly formatTimeline: (entries: readonly MessageLog.Entry[]) => string;
  /**
   * Makes a stub component: renders `<stub data-stub="name">`, records the
   * distinct props in order, and emits through the parent's `onEmit` mapping.
   * In `Play`, `emit` settles, pushes, and settles again; in `Scene`, emit
   * through `childEmit` (a keyless emit reaches every mounted stub).
   * With a feature service, the stub also provides it through `layer`.
   */
  readonly stub: {
    <Props, Events>(
      name: string,
      options?: {
        readonly props?: Schema.Schema<Props> | undefined;
        readonly events?: Schema.Schema<Events> | undefined;
      }
    ): Stub<Props, Events>;
    <F extends Feature.Any>(
      feature: F
    ): FeatureStub<FeatureProps<F>, FeatureEvents<F>, F>;
  };
}

/**
 * The props of a feature service's contract.
 */
export type FeatureProps<F> =
  F extends Feature.Service<unknown, infer P, infer _E> ? P : never;

/**
 * The events of a feature service's contract.
 */
export type FeatureEvents<F> =
  F extends Feature.Service<unknown, infer _P, infer E> ? E : never;

/**
 * A reported problem: a log entry the host treats as a failure (`Failed`,
 * `CommandDropped`), or a value a fake reported.
 */
export interface Problem {
  readonly _tag: string;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- problems carry arbitrary log fields for failure messages; consumed by tag.
  readonly [field: string]: unknown;
}

/**
 * The `TestHost` service: the controls and the records of one test mount.
 */
export const TestHost: Context.Service<TestHost, TestHost> = Context.Service<
  TestHost,
  TestHost
>("@ilha/model/test/TestHost");

/**
 * Makes a ring-buffer log the host records to. The host attaches it
 * page-globally, so mounts need no extra wiring.
 */
export const makeMemoryLog = (size = 1000): MessageLog.Memory =>
  MessageLog.makeMemory({ size });

interface Mounted {
  readonly ui: TestUi;
  readonly path: string;
  readonly errors: Error[];
}

/** Entries of one root session: from the first `SessionStarted` for work at `path`, or all when unscoped. */
const sessionEntries = (
  entries: readonly MessageLog.Entry[],
  path: string | undefined
): readonly MessageLog.Entry[] => {
  if (path === undefined) {
    return entries;
  }
  const index = entries.findIndex((entry) => {
    const view = viewOf(entry);
    return (
      view["path"] === path &&
      (view["_tag"] === "Mounted" || view["_tag"] === "Update")
    );
  });
  return index === -1 ? [] : entries.slice(index);
};

const latestModel = (
  entries: readonly MessageLog.Entry[],
  path: string
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- models are schema-erased until the test decodes them.
): unknown => {
  let model: unknown = undefined;
  for (const entry of sessionEntries(entries, path)) {
    const view = viewOf(entry);
    if (
      (view["_tag"] === "Mounted" || view["_tag"] === "Update") &&
      "model" in view
    ) {
      ({ model } = view);
    }
  }
  return model;
};

/** Open runs: a `CommandStarted` with no end yet, with `awaiting` when a `CommandAwaiting` is open for it. */
export const pendingOf = (
  entries: readonly MessageLog.Entry[],
  path?: string
): readonly Pending[] => {
  const scoped = sessionEntries(entries, path);
  const started = new Map<string, { path: string; name: string }>();
  const awaiting = new Set<string>();
  const ended = new Set<string>();
  for (const entry of scoped) {
    const view = viewOf(entry);
    const tag = view["_tag"];
    if (
      tag === "CommandStarted" ||
      tag === "CommandAwaiting" ||
      tag === "CommandEnded" ||
      tag === "CommandInterrupted"
    ) {
      // SAFETY: command entries carry the issued ref; the host keys runs by it.
      const issued = view["issued"] as
        | { readonly seq?: unknown; readonly index?: unknown }
        | undefined;
      // SAFETY: command entries carry path and name; the run key shows them.
      const key = `${view["path"] as string}#${String(issued?.seq)}/${String(issued?.index)}`;
      if (tag === "CommandStarted") {
        // SAFETY: started commands carry path and name; the pending list shows them.
        started.set(key, {
          name: view["name"] as string,
          path: view["path"] as string,
        });
      } else if (tag === "CommandAwaiting") {
        awaiting.add(key);
      } else {
        ended.add(key);
      }
    }
  }
  const out: Pending[] = [];
  for (const [key, run] of started) {
    if (!ended.has(key)) {
      out.push({
        _tag: "Command",
        name: run.name,
        path: run.path,
        status: awaiting.has(key) ? "awaiting" : "running",
      });
    }
  }
  return out;
};

/** Problems the log reports: `Failed` entries and dropped Commands. */
const logProblems = (
  entries: readonly MessageLog.Entry[]
): readonly Problem[] =>
  entries.flatMap((entry) => {
    const view = viewOf(entry);
    const tag = view["_tag"];
    if (tag === "Failed" || tag === "CommandDropped" || tag === "SendDropped") {
      return [{ _tag: String(tag), ...view }];
    }
    return [];
  });

const truncate = (text: string, limit = 120): string =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;

/**
 * One entry per line: `#seq tag path[.instance]`, the message when the entry
 * carries one, and the cause link when it has one.
 */
export const formatLog = (entries: readonly MessageLog.Entry[]): string =>
  entries
    .map((entry) => {
      const view = viewOf(entry);
      const at = `#${String(view["seq"])} ${String(view["_tag"])}`;
      const where = isString(view["path"])
        ? ` ${view["path"]}${isNumber(view["instance"]) ? `.${view["instance"]}` : ""}`
        : "";
      const message =
        "message" in view && view["message"] !== undefined
          ? ` ${truncate(JSON.stringify(view["message"]))}`
          : "";
      const causedBy = isNumber(view["causedBy"])
        ? ` (after #${view["causedBy"]})`
        : "";
      return `${at}${where}${message}${causedBy}`;
    })
    .join("\n");

/**
 * Facts (entries with no `causedBy`) with their consequences indented; a
 * consequence whose cause left the buffer shows `(after #n)`.
 */
export const formatTimeline = (
  entries: readonly MessageLog.Entry[]
): string => {
  const byCause = new Map<number, MessageLog.Entry[]>();
  const facts: MessageLog.Entry[] = [];
  for (const entry of entries) {
    const { causedBy } = viewOf(entry);
    if (isNumber(causedBy)) {
      const list = byCause.get(causedBy) ?? [];
      list.push(entry);
      byCause.set(causedBy, list);
    } else {
      facts.push(entry);
    }
  }
  const lines: string[] = [];
  const seen = new Set<number>();
  for (const fact of facts) {
    const { seq } = viewOf(fact);
    lines.push(formatLog([fact]));
    if (isNumber(seq)) {
      seen.add(seq);
      for (const child of byCause.get(seq) ?? []) {
        lines.push(`  ${formatLog([child])}`);
        const { seq: childSeq } = viewOf(child);
        if (isNumber(childSeq)) {
          seen.add(childSeq);
        }
      }
    }
  }
  for (const [cause, orphans] of byCause) {
    if (seen.has(cause)) {
      continue;
    }
    for (const orphan of orphans) {
      lines.push(`${formatLog([orphan])} (after #${cause})`);
    }
  }
  return lines.join("\n");
};

/**
 * A layer providing `TestHost`. Unconsumed problems kill the layer's scope
 * with `ProblemsError`. Visibility and connectivity start true.
 */
export const layer = (options?: {
  readonly budget?: number | undefined;
  readonly logSize?: number | undefined;
}): Layer.Layer<TestHost> =>
  Layer.effect(
    TestHost,
    Effect.gen(function* provide() {
      const log = makeMemoryLog(options?.logSize ?? 1000);
      const detach = MessageLog.attach(log);
      const mounts: Mounted[] = [];
      const reported: Problem[] = [];
      let visible = true;
      let online = true;
      const budget = options?.budget ?? 100_000;

      const entriesOf = (): readonly MessageLog.Entry[] => log.entries();

      const suppressed = new Set<unknown>();
      const liveProblems = (): readonly Problem[] =>
        [...reported, ...logProblems(entriesOf())].filter(
          (problem) => !suppressed.has(problem)
        );
      const settleAll = (): Effect.Effect<
        void,
        SettleError | RootCrashed | ProblemsError
      > =>
        Effect.gen(function* settle() {
          let rounds = 0;
          while (rounds < budget) {
            rounds += 1;
            for (const mounted of mounts) {
              yield* Effect.promise(() => mounted.ui.settled());
            }
            // Let promise work the runtime hasn't seen yet arrive.
            yield* Effect.promise(() => {
              const { promise, resolve } = Promise.withResolvers<undefined>();
              setTimeout(resolve, 0);
              return promise;
            });
            let quiet = true;
            for (const mounted of mounts) {
              const before = entriesOf().length;
              yield* Effect.promise(() => mounted.ui.settled());
              if (entriesOf().length !== before) {
                quiet = false;
              }
            }
            if (quiet) {
              break;
            }
          }
          // oxlint-disable-next-line eslint/no-use-before-define -- settleAll runs after the host is built; the reference is deferred in the Effect.
          const pending = host.pending();
          const tail = entriesOf().slice(-20);
          for (const mounted of mounts) {
            if (mounted.errors.length > 0) {
              return yield* Effect.fail(
                new RootCrashed({
                  cause: mounted.errors[0],
                  path: mounted.path,
                })
              );
            }
          }
          // oxlint-disable-next-line eslint/no-use-before-define -- settleAll runs after the host is built; the reference is deferred in the Effect.
          const problems = host.problems();
          if (problems.length > 0) {
            return yield* Effect.fail(new ProblemsError({ problems }));
          }
          if (rounds >= budget) {
            return yield* Effect.fail(
              new SettleError({
                log: tail,
                message: `TestHost.settle: work kept arriving for ${budget} rounds`,
                pending,
              })
            );
          }
        });
      const host: TestHost = {
        expectProblem: (tag) => {
          const matched = liveProblems().filter(
            (problem) => problem._tag === tag
          );
          if (matched.length === 0) {
            throw new Error(
              `TestHost.expectProblem: no problem has the tag ${JSON.stringify(tag)}`
            );
          }
          for (const problem of matched) {
            suppressed.add(problem);
          }
          return matched;
        },
        formatLog: (entries) => formatLog(entries),
        formatTimeline: (entries) => formatTimeline(entries),
        log,
        mount: (component, props) =>
          Effect.gen(function* mount() {
            // SAFETY: mount targets are components; the path mirrors the engine's root naming.
            const path = `/${(component as AnyComponent).definitionName}`;
            const errors: Error[] = [];
            const container = document.createElement("div");
            document.body.append(container);
            // SAFETY: the test host mounts erased components; root only needs the definition Schemas.
            const ui = render(
              Component.root(component as never, props as never),
              {
                container,
                onError: (error) => {
                  errors.push(error);
                },
              }
            );
            mounts.push({ errors, path, ui });
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                // No setup: acquire only registers the release that unmounts.
              }),
              () =>
                Effect.sync(() => {
                  ui.unmount();
                  container.remove();
                })
            );
            const root: TestRoot = {
              container,
              html: () => ui.html(),
              log: () => sessionEntries(entriesOf(), path),
              model: () => latestModel(entriesOf(), path),
              path,
              pending: () => pendingOf(entriesOf(), path),
              settle: () => host.settle(),
              text: () => ui.text(),
            };
            yield* settleAll();
            if (errors.length > 0) {
              return yield* Effect.fail(
                new RootCrashed({ cause: errors[0], path })
              );
            }
            return root;
          }),
        pending: () => pendingOf(entriesOf()),
        problems: () => [...liveProblems()],
        report: (problem) => {
          reported.push(problem);
        },
        setOnline: (next) => {
          online = next;
          window.dispatchEvent(new Event(next ? "online" : "offline"));
        },
        setVisible: (next) => {
          visible = next;
          document.dispatchEvent(new Event("visibilitychange"));
        },
        settle: () => settleAll(),
        // SAFETY: the implementation handles names and feature services; the overloads only narrow the call shape.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the implementation signature is unrelated to the overloaded stub shape.
        stub: ((
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- stubs take a name or a feature service; services narrow below.
          target: unknown,
          stubOptions?: {
            readonly props?: Schema.Schema<never> | undefined;
            readonly events?: Schema.Schema<never> | undefined;
          }
        ): Stub<never, never> =>
          // oxlint-disable-next-line eslint/no-use-before-define -- makeStubFrom is defined below; the call runs after module init.
          makeStubFrom(target, stubOptions)) as unknown as TestHost["stub"],
      };

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          detach();
          for (const mounted of mounts) {
            mounted.ui.unmount();
          }
          const problems = [...reported];
          if (problems.length > 0) {
            throw new ProblemsError({ problems });
          }
          void visible;
          void online;
        })
      );
      return host;
    })
  );

// ---------------------------------------------------------------------------
// stub
// ---------------------------------------------------------------------------

/**
 * A stub component for a feature: renders `<stub data-stub="name">`,
 * records the distinct props in order, and emits through the parent's
 * `onEmit` mapping. In `Play`, `emit` settles, pushes, and settles again;
 * in `Scene`, emit through `childEmit` (a keyless emit reaches every
 * mounted stub).
 */
export interface Stub<
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- stub props default to an open record; declared Schemas narrow them.
  Props = Record<string, unknown>,
  Events = unknown,
> {
  readonly component: AnyComponent;
  readonly recorded: () => readonly Props[];
  readonly emit: (...events: Events[]) => void;
}

/**
 * A stub bound to a feature service: `layer` provides the feature through
 * `feature.toLayer`, so `Play` mounts and the real runtime render the stub
 * wherever the parent renders the feature.
 */
export interface FeatureStub<Props, Events, F> extends Stub<Props, Events> {
  readonly feature: F;
  readonly layer: Layer.Layer<F, never, never>;
}

const makeStub = <Props, Events>(
  name: string,
  options?: {
    readonly props?: Schema.Schema<Props> | undefined;
    readonly events?: Schema.Schema<Events> | undefined;
  }
): Stub<Props, Events> => {
  interface Emit {
    readonly _tag: "StubEmit";
    readonly events: readonly unknown[];
  }
  const recorded: Props[] = [];
  const backlog: Emit[] = [];
  let queue: Queue.Queue<Emit> | undefined = undefined;
  // Emits before the subscription starts wait in the backlog; the unwrap
  // effect flushes them when the first mount starts the stream.
  const stream = Stream.unwrap(
    Effect.map(Queue.unbounded<Emit>(), (made) => {
      queue = made;
      for (const message of backlog.splice(0)) {
        Effect.runSync(Queue.offer(made, message));
      }
      return Stream.fromQueue(made);
    })
  );
  // SAFETY: unnamed stubs accept and emit anything; the fallback Schemas only carry the wire shape.
  const definition = defineComponent({
    events: (options?.events ?? Schema.Unknown) as Schema.Schema<Events>,
    message: Schema.TaggedStruct("StubEmit", {
      events: Schema.Array(Schema.Unknown),
    }),
    model: Schema.Struct({}),
    name,
    props: (options?.props ?? Schema.Struct({})) as Schema.Schema<Props>,
  });
  // SAFETY: the stub's emit stream is untyped by construction; the subscription only forwards StubEmit messages.
  const component = definition.make({
    init: () => ({}),
    subscriptions: () => [Subscription.make(`${name}/emit`, stream as never)],
    update: {
      // SAFETY: stub emits carry the declared events; the erased array flows back through emit.
      StubEmit: ($, message) => $.emit(...(message.events as never[])),
    },
    view: (h) => {
      // SAFETY: stub props flow from the declared Schema; the view only snapshots them.
      const seen = h.props as Props;
      if (!recorded.some((props) => Equal.equals(props, seen))) {
        recorded.push(seen);
      }
      // SAFETY: the core `h` has no un-dashed tag overload: the cast keeps the
      // runtime `<stub>` element while the types see a custom element.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- `h`'s overloads reject dashed tags; the element shape is otherwise identical.
      return (h as unknown as StubElement)("stub", { "data-stub": name });
    },
  });
  const emit = (...events: Events[]): void => {
    const message: Emit = { _tag: "StubEmit", events: [...events] };
    if (queue === undefined) {
      backlog.push(message);
    } else {
      Effect.runSync(Queue.offer(queue, message));
    }
  };
  return {
    component: Object.assign(component, { [stubBrand]: { name } }),
    emit,
    recorded: () => [...recorded],
  };
};

/**
 * Makes a stub from a name or a feature service. The feature form derives
 * the stub name and Schemas from the service contract and provides the
 * stub through `feature.toLayer`.
 */
const makeStubFrom = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- stubs take a name or a feature service; services narrow below.
  target: unknown,
  options?: {
    readonly props?: Schema.Schema<never> | undefined;
    readonly events?: Schema.Schema<never> | undefined;
  }
): Stub<never, never> => {
  if (isService(target)) {
    const name = target.key.startsWith("feature/")
      ? target.key.slice("feature/".length)
      : target.key;
    const stub = makeStub(name, {
      events: target.events,
      props: target.props,
    });
    // SAFETY: the stub component implements the feature's props and events; toLayer only needs the component.
    const provided = target.toLayer(stub.component as never);
    // SAFETY: the feature stub carries the service and its layer; the shape matches Stub.
    return { ...stub, feature: target, layer: provided } as Stub<never, never>;
  }
  if (!isString(target)) {
    throw new TypeError(
      `TestHost.stub takes a stub name or a feature service, not ${JSON.stringify(target)}`
    );
  }
  return makeStub<never, never>(target, options);
};
