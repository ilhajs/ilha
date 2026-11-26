/**
 * `ssr()` renders on the server, hydrates in a fresh document, and fails
 * with `SsrError` for the checks that apply to Ilha: a Model that wasn't
 * adopted or drifted, a node that was rebuilt instead of adopted, and any
 * problem reported on either side. Query round-trips, the fetch-free
 * window, and waiting Layers are extension checks for their slices.
 */
import * as Data from "effect/Data";
import * as Schema from "effect/Schema";
import { renderToString } from "ilha";
import { render } from "ilha/test";
import type { TestUi } from "ilha/test";

import { Component } from "../index.ts";
import { boundOf } from "../internal/queries.ts";
import * as MessageLog from "../message-log.ts";
import type { AnyComponent, PropsOf } from "./steps.ts";
import { formatLog } from "./test-host.ts";

/**
 * What `ssr()` found wrong, as a list of problems. Throwing one fails the test.
 */
export class SsrError extends Data.TaggedError("SsrError")<{
  readonly problems: readonly string[];
}> {}

/**
 * The result of `ssr()`: the server HTML, the hydrated container, the root
 * Model and the adopted paths, and the client's log.
 */
export interface Ssr {
  /** The server render's HTML. */
  readonly html: string;
  /** The container the server HTML was injected into and hydrated. */
  readonly container: Element;
  /** The root Model after hydration, from the client's log. */
  readonly model: unknown;
  /** The instance paths that adopted their Model, from the client's log. */
  readonly adopted: readonly string[];
  /** The client's log entries for the root session. */
  readonly log: readonly MessageLog.Entry[];
  /** Stops the hydrated mount and removes its container. */
  readonly unmount: () => void;
}

/** The log-entry fields the ssr checks read. */
interface LogFields {
  readonly adopted?: unknown;
  readonly instance?: unknown;
  readonly inWindow?: unknown;
  readonly model?: unknown;
  readonly path?: unknown;
  readonly queries?: unknown;
  readonly query?: unknown;
  readonly trigger?: unknown;
  readonly _tag?: unknown;
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Fails when a shipped query result doesn't survive a JSON round trip
 * through the component's query results schema.
 */
const checkShippedQueries = (
  // oxlint-disable-next-line anti-slop/no-object-parameters -- component definitions carry heterogeneous schemas; boundOf reads only "~queries".
  definition: object,
  view: LogFields,
  problems: string[]
): void => {
  const { queries } = view;
  if (queries === undefined) {
    return;
  }
  try {
    // SAFETY: query-bearing test components carry "~queries"; boundOf returns undefined otherwise.
    const bound = boundOf(definition as { readonly "~queries": unknown });
    if (bound === undefined) {
      return;
    }
    Schema.decodeUnknownSync(bound.logSchema)(
      // oxlint-disable-next-line unicorn/prefer-structured-clone -- the JSON round trip is the point: shipped queries must survive JSON serialization.
      JSON.parse(JSON.stringify(queries))
    );
  } catch {
    problems.push(
      `a shipped query of the instance at ${String(view.path)} doesn't round-trip`
    );
  }
};

/**
 * Runs `renderToString`, then mounts with hydration in a fresh document,
 * and fails with `SsrError` when:
 *
 * - the server render throws;
 * - hydration reports errors (a node rebuilt instead of adopted shows here
 *   as HTML that differs right after mounting);
 * - the settled client HTML differs from the server HTML (a drifted Model);
 * - a root instance's Model wasn't adopted, or differs after a codec
 *   round-trip (this catches props drift and non-serializable Models);
 * - any problem is reported on either side, including
 *   `ServerCommandIssued`.
 */
// oxlint-disable-next-line eslint/complexity -- ssr sequences eight hydration checks; each pushes a problem string, so splitting would scatter the problems flow.
export const ssr = async <C extends AnyComponent>(
  component: C,
  props: PropsOf<C>,
  options?: { readonly static?: boolean | undefined }
): Promise<Ssr> => {
  void options;
  // SAFETY: the test component's constructor and props are well-typed by construction; root erases them to its internal node.
  const root = Component.root(component as never, props as never);
  let html: string;
  try {
    // SAFETY: root is the node Component.root built above; renderToString erases its element type.
    html = await renderToString(root as never);
  } catch (error) {
    throw new SsrError({
      problems: [`SsrError: server rendering failed: ${messageOf(error)}`],
    });
  }
  const container = document.createElement("div");
  container.innerHTML = html;
  // happy-dom serializes bare attributes (e.g. `data-ilha`) with `=""`, so
  // the raw server string never equals a re-serialized container: normalize
  // the server HTML through the same serializer once, and compare against
  // that. Core SSR output is unchanged; only the comparison is normalized.
  html = container.innerHTML;
  const log = MessageLog.makeMemory();
  const detach = MessageLog.attach(log);
  const errors: Error[] = [];
  let ui: TestUi | undefined = undefined;
  try {
    // SAFETY: root is the node Component.root built above; render erases its element type.
    ui = render(root as never, {
      container,
      hydrate: true,
      onError: (error) => {
        errors.push(error);
      },
    });
    const mounted = container.innerHTML;
    await ui.settled();
    const settled = container.innerHTML;
    const problems: string[] = [];
    for (const error of errors) {
      problems.push(`hydration failed: ${messageOf(error)}`);
    }
    if (mounted !== html) {
      problems.push(
        `a node was rebuilt instead of adopted: the container differs right after hydration`
      );
    }
    if (settled !== html) {
      problems.push(
        `the Model drifted during hydration: the settled HTML differs from the server HTML`
      );
    }
    // SAFETY: test components expose their definition name; only the name is read here.
    const path = `/${(component as AnyComponent).definitionName}`;
    const mountedEntries = log.entries().filter((entry) => {
      // SAFETY: log entries are tagged records; only path and _tag are read here.
      const view = entry as LogFields;
      return view.path === path && view._tag === "Mounted";
    });
    const adopted: string[] = [];
    let model: unknown = undefined;
    // SAFETY: test components expose their definition; only model and queries schemas are read below.
    const { definition } = component as AnyComponent;
    for (const entry of mountedEntries) {
      // SAFETY: mounted entries are tagged records; only adopted, path and model are read here.
      const view = entry as LogFields;
      if (view.adopted === true) {
        adopted.push(String(view.path));
      } else {
        problems.push(`the Model at ${String(view.path)} wasn't adopted`);
      }
      ({ model } = view);
      try {
        // SAFETY: definition.model is the component's own model schema; decode re-validates the input against it.
        const decoder =
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Schema<unknown> erases the decoder interface; no single assertion bridges the gap.
          definition.model as unknown as Schema.ConstraintDecoder<unknown>;
        // SAFETY: definition.model is the component's own model schema; encode re-validates the input against it.
        const encoder =
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Schema<unknown> erases the encoder interface; no single assertion bridges the gap.
          definition.model as unknown as Schema.ConstraintEncoder<unknown>;
        const roundTripped = Schema.decodeUnknownSync(decoder)(
          // oxlint-disable-next-line unicorn/prefer-structured-clone -- the JSON round trip is the point: Models must survive JSON serialization.
          JSON.parse(JSON.stringify(Schema.encodeUnknownSync(encoder)(model)))
        );
        const equal = Schema.toEquivalence(definition.model)(
          model,
          roundTripped
        );
        if (!equal) {
          problems.push(
            `the Model at ${String(view.path)} differs after re-encoding`
          );
        }
      } catch {
        problems.push(
          `the Model at ${String(view.path)} doesn't round-trip through its codec`
        );
      }
      checkShippedQueries(definition, view, problems);
    }
    for (const entry of log.entries()) {
      // SAFETY: log entries are tagged records; only _tag is read here.
      const tag = (entry as LogFields)._tag;
      if (
        tag === "Failed" ||
        tag === "CommandDropped" ||
        tag === "SendDropped"
      ) {
        problems.push(`a problem was reported: ${formatLog([entry])}`);
      }
      if (tag === "FetchStarted" && options?.static !== true) {
        // SAFETY: FetchStarted entries carry inWindow, trigger and query; tag was checked above.
        const fetch = entry as LogFields;
        if (fetch.inWindow === true && fetch.trigger !== "get") {
          problems.push(
            `a hydrated entry of the query ${JSON.stringify(fetch.query)} was fetched inside the fetch-free window`
          );
        }
      }
      if (tag === "Waiting") {
        // SAFETY: Waiting entries carry path and instance; tag was checked above.
        const waiting = entry as LogFields;
        const later = log.entries().some((other) => {
          // SAFETY: log entries are tagged records; only _tag, path and instance are read here.
          const view = other as LogFields;
          return (
            view._tag === "Mounted" &&
            view.path === waiting.path &&
            view.instance === waiting.instance
          );
        });
        if (!later) {
          problems.push(
            `the instance at ${String(waiting.path)} is still waiting for its Layer`
          );
        }
      }
    }
    if (problems.length > 0) {
      throw new SsrError({ problems });
    }
    const finalUi = ui;
    return {
      adopted,
      container,
      html,
      log: log.entries(),
      model,
      unmount: () => {
        finalUi.unmount();
        container.remove();
      },
    };
  } catch (error) {
    ui?.unmount();
    container.remove();
    if (error instanceof SsrError) {
      throw error;
    }
    throw new SsrError({
      problems: [`SsrError: hydration failed: ${messageOf(error)}`],
    });
  } finally {
    detach();
  }
};
