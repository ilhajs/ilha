/**
 * Live-runtime control seam for devtools time travel and gated dispatch
 * (SPEC §15). The kernel owns sessions, records and dispatch; this module
 * is the typed wrapper devtools calls. Painting the historical copy and
 * restoring the live container belong to the caller through `PauseHost`:
 * the kernel never touches the DOM.
 */
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";
import type { FiberLocal } from "ilha/internal";

import type * as Component from "./component.ts";
import {
  dispatchAtPath,
  hostOf,
  islands,
  isSessionPaused,
  messageSchemaOf as kernelMessageSchema,
  setSessionPaused,
  snapshotModels,
} from "./internal/kernel.ts";

/**
 * The island's mount host: the outermost fiber root above the island's
 * records. `hostOf` reports the record fiber's own root (a slot span when
 * the island nests in plain markup); devtools pause and the setAtom guard
 * need the mount container `inspect()` reports for the island's Root.
 */
const mountHostOf = (registry: AtomRegistry): Element | undefined => {
  const kernel = islands().find((candidate) => candidate.registry === registry);
  const first = kernel?.records.values().next().value;
  let top: FiberLocal | undefined;
  for (let at = first?.fiber; at !== undefined; at = at.parent) {
    top = at;
  }
  const root = top?.root ?? first?.fiber.root;
  if (root instanceof Element) {
    return root;
  }
  return hostOf(registry);
};

/**
 * One live island session: its registry plus the app/session names, the
 * pause flag and the host element the island paints into (`undefined`
 * before anything mounts).
 */
export interface SessionSummary {
  readonly registry: AtomRegistry;
  readonly app: string;
  readonly session: string;
  readonly paused: boolean;
  readonly host: Element | undefined;
}

/**
 * Every live island session, for `list_sessions`.
 */
export const listSessions = (): readonly SessionSummary[] =>
  islands().map((kernel) => ({
    app: kernel.app,
    host: mountHostOf(kernel.registry),
    paused: isSessionPaused(kernel.registry),
    registry: kernel.registry,
    session: kernel.session,
  }));

/**
 * One live instance in a session: its path (the stable instance id), the
 * component name and the lifecycle status.
 */
export interface InstanceSummary {
  readonly path: string;
  readonly name: string;
  readonly status: "live" | "failed" | "closed";
}

/**
 * Every known instance of a session by path, for `list_instances`.
 */
export const listInstances = (
  registry: AtomRegistry
): readonly InstanceSummary[] => {
  const out: InstanceSummary[] = [];
  for (const [path, rec] of islands().find(
    (kernel) => kernel.registry === registry
  )?.records ?? []) {
    out.push({ name: rec.name, path, status: rec.status });
  }
  return out;
};

/**
 * The live Model of the instance at `path`, or `undefined` when the path is
 * missing, closed, or cannot report.
 */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- the seam exposes the untyped live Model; callers decode it with the message schema.
export const modelOf = (registry: AtomRegistry, path: string): unknown =>
  snapshotModels(registry).get(path);

/**
 * The component message Schema of a definition, for dispatch decoding.
 */
export const messageSchemaOf = (
  definition: Component.DefinitionAny
): Schema.Top => kernelMessageSchema(definition);

/**
 * Decode an input against the component message Schema. Throws on bad input.
 */
export const decodeMessage = (
  definition: Component.DefinitionAny,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- decodeMessage IS the parse boundary: unknown input is decoded against the message schema.
  input: unknown
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- returns the schema-decoded message, still untyped at the seam.
): unknown =>
  Schema.decodeUnknownSync(
    // SAFETY: message schemas are Schemas and decodeUnknownSync re-validates the input against it; the cast only recovers the decoder interface that Schema.Top erases.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Schema.Top erases the decoder interface; no single assertion bridges the gap.
    messageSchemaOf(definition) as unknown as Schema.ConstraintDecoder<unknown>
  )(input);

/**
 * Deliver an already-decoded message to the instance at `path` through the
 * normal update and logging path. Returns `false` when the path is missing
 * or closed.
 */
export const dispatchMessage = (
  registry: AtomRegistry,
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- takes the decodeMessage-decoded message; unknown at the seam by design.
  message: unknown
): boolean => dispatchAtPath(registry, path, message);

/**
 * The historical state lookup the caller builds from `History.at`: the
 * Model an instance showed at the paused entry, or `undefined` to keep the
 * live Model for that path.
 */
export interface HistoryLookup {
  /** The historical Model for `path`, or `undefined` to keep the live one. */
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the caller-provided lookup returns the untyped historical Model by design.
  readonly stateOf: (path: string) => unknown | undefined;
}

/**
 * The DOM half of time travel, owned by devtools: hiding the live island,
 * showing the inert historical copy, and restoring the live container.
 */
export interface PauseHost {
  /** Hide the live island container (it keeps running). */
  readonly hideLive: () => void;
  /** Insert the inert historical copy built from `states`. Runs nothing. */
  readonly showHistorical: (states: ReadonlyMap<string, unknown>) => void;
  /** Remove the historical copy and show the live container again. */
  readonly restoreLive: () => void;
}

/**
 * A paused session: the per-path states the historical copy shows, plus
 * `resume` to unpause and restore the live container.
 */
export interface PausedSession {
  /** The per-path states the historical copy shows. */
  readonly states: ReadonlyMap<string, unknown>;
  /** Unpause the session and restore the live container. Idempotent. */
  readonly resume: () => void;
}

/**
 * Pause a session for time travel: snapshot the live Models, resolve each
 * path through `lookup` (falling back to the live Model), mark the session
 * paused, hide the live island and show the inert historical copy. The live
 * island keeps running hidden until `resume`.
 */
export const pauseSession = (
  registry: AtomRegistry,
  lookup: HistoryLookup,
  host: PauseHost
): PausedSession => {
  const states = new Map<string, unknown>();
  for (const [path, model] of snapshotModels(registry)) {
    states.set(path, lookup.stateOf(path) ?? model);
  }
  setSessionPaused(registry, true);
  host.hideLive();
  host.showHistorical(states);
  let done = false;
  return {
    resume: () => {
      if (done) {
        return;
      }
      done = true;
      setSessionPaused(registry, false);
      host.restoreLive();
    },
    states,
  };
};

/** The live Model of every live record in the island, by path. */
export { snapshotModels as snapshotLiveModels } from "./internal/kernel.ts";

/** The record mounted at `path`, if it exists. */
export { recordOf } from "./internal/kernel.ts";
