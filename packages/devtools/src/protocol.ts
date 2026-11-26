/**
 * The contract between the page script and the panel: one channel name plus
 * the types both sides import. Nothing here runs.
 */
import type { InPageChannelProtocol } from "devframe/in-page-channel";
import type { IlhaInspectNode, SetAtomResult } from "ilha/debug";

import type { WireEntry } from "./wire";

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

/** One session the page's message-log pipeline holds, without payloads. */
export interface ModelSessionSummary {
  /** The session id: one mounted root. */
  readonly session: string;
  /** The `app` the session's `SessionStarted` reported, if any. */
  readonly app: string | undefined;
  /** How many entries the page keeps for the session. */
  readonly entries: number;
  /** The first and last kept `seq`, absent when the session is empty. */
  readonly first: number | undefined;
  readonly last: number | undefined;
  /** Whether the page has a live runtime bridge for this session. */
  readonly controllable: boolean;
  /** The shown `seq` while the session is paused for time travel. */
  readonly paused?: number | undefined;
}

/** Wire frames of one session with `seq` above `since`, oldest first, or why they are missing. */
export type ModelFramesResult =
  | { readonly ok: true; readonly frames: readonly WireEntry[] }
  | { readonly ok: false; readonly reason: string };

/** The JSON Schema of the messages a component accepts, or why it is missing. */
export type ModelSchemaResult =
  | { readonly ok: true; readonly schema: unknown }
  | { readonly ok: false; readonly reason: string };

/** A model control call that succeeded. */
export interface ModelControlSuccess {
  readonly ok: true;
  readonly session: string;
  /** The paused `seq` for `show_entry`; absent otherwise. */
  readonly seq?: number | undefined;
  /** The dispatched instance and path for `dispatch`; absent otherwise. */
  readonly instance?: number | undefined;
  readonly path?: string | undefined;
}

/** A model control call the page refused, with the reason. */
export interface ModelControlFailure {
  readonly ok: false;
  readonly reason: string;
}

/** The result of a `show_entry`, `resume` or `dispatch` page call. */
export type ModelControlResult = ModelControlSuccess | ModelControlFailure;

export interface IlhaDevtoolsProtocol extends InPageChannelProtocol {
  functions: {
    pageScript: {
      /** Trees of every live island, same shape as `inspect()` from `ilha/debug`. */
      inspect: () => IlhaInspectNode[];
      /** Outline a component's element on the page; `null` clears it. */
      highlight: (id: string | null) => boolean;
      /** Replace atom `index` of component `id` with a JSON value. */
      setAtom: (id: string, index: number, value: AtomJson) => SetAtomResult;
      /** Sessions the page's `@ilha/model` pipeline holds. */
      modelSessions: () => ModelSessionSummary[];
      /** Wire frames of one session with `seq` above `since`, oldest first. */
      modelFrames: (session: string, since: number) => ModelFramesResult;
      /** JSON Schema of the messages a component accepts, narrowed by `tag`. */
      modelMessageSchema: (
        component: string,
        tag?: string | undefined
      ) => ModelSchemaResult;
      /**
       * Pause a session at an entry: hide the live island (it keeps
       * running) and mount an inert server-rendered copy of each
       * instance's state at that entry. Resume restores live.
       */
      modelShowEntry: (session: string, seq: number) => ModelControlResult;
      /** Remove a pause's historical copy and restore the live island. */
      modelResume: (session: string) => ModelControlResult;
      /**
       * Deliver a message to a live instance through the normal runtime
       * update and logging, decoded against the instance's message
       * schema. Refused unless the page installed with `dispatch: true`.
       */
      modelDispatch: (
        session: string,
        instance: number,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- protocol boundary: the payload is validated against the instance message schema in webmcp before dispatch.
        message: unknown
      ) => ModelControlResult;
    };
  };
  sharedStates: {
    tree: IlhaTreeState;
  };
}
