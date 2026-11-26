/**
 * The contract between the page script and the panel: one channel name plus
 * the types both sides import. Nothing here runs.
 */
import type { InPageChannelProtocol } from "devframe/in-page-channel";
import type { IlhaInspectNode, InspectValue, SetAtomResult } from "ilha/debug";

export type { IlhaInspectNode, SetAtomResult } from "ilha/debug";

/** In-page channel name; namespaced with the devframe id. */
export const ILHA_DEVTOOLS_CHANNEL = "devframes:plugin:ilha-devtools";

/** Where the Vite plugin from `@devframes/vite/single` mounts the panel. */
export const ILHA_DEVTOOLS_PANEL_PATH = "/__ilha-devtools/";

/** A JSON value `setAtom` accepts. */
export type AtomJson =
  | string
  | number
  | boolean
  | null
  | readonly AtomJson[]
  | { readonly [key: string]: AtomJson };

export interface IlhaTreeState {
  /**
   * `JSON.stringify` of the live roots, the same shape `inspect()` returns.
   * Kept as text because Devframe's `Immutable<T>` cannot instantiate a
   * recursive tree type.
   */
  json: string;
}

/** Read the tree out of a shared-state snapshot. */
export const parseTree = ({ json }: IlhaTreeState): IlhaInspectNode[] =>
  JSON.parse(json);

/** One changed top-level model field, summarized before and after. */
export interface ModelLogFieldChange {
  readonly before: InspectValue;
  readonly after: InspectValue;
}

/**
 * How one message changed the model: changed top-level fields for record
 * models, summarized before/after snapshots for anything else.
 */
export type ModelLogDiff =
  | {
      readonly _tag: "fields";
      readonly changed: Readonly<Record<string, ModelLogFieldChange>>;
    }
  | {
      readonly _tag: "snapshot";
      readonly before: InspectValue;
      readonly after: InspectValue;
    };

/** One recorded dispatch of a `@ilha/model` island. */
export interface ModelLogEntry {
  /** `Date.now()` when the message dispatched. */
  readonly at: number;
  /** How many commands the message started. */
  readonly commands: number;
  /** What the message changed in the model. */
  readonly diff: ModelLogDiff;
  /** The message, safely summarized. */
  readonly message: InspectValue;
}

/** Result of `modelLog`: the island's entries, or why it has none. */
export type ModelLogResult =
  | { readonly entries: readonly ModelLogEntry[]; readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface IlhaDevtoolsProtocol extends InPageChannelProtocol {
  functions: {
    pageScript: {
      /** Trees of every live island, same shape as `inspect()` from `ilha/debug`. */
      inspect: () => IlhaInspectNode[];
      /** Outline a component's element on the page; `null` clears it. */
      highlight: (id: string | null) => boolean;
      /** Replace atom `index` of component `id` with a JSON value. */
      setAtom: (id: string, index: number, value: AtomJson) => SetAtomResult;
      /** Recorded messages of one model island, or why it has none. */
      modelLog: (id: string) => ModelLogResult;
    };
  };
  sharedStates: {
    tree: IlhaTreeState;
  };
}
