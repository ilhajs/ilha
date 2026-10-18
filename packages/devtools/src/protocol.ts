/**
 * The contract between the page script and the panel: one channel name plus
 * the types both sides import. Nothing here runs.
 */
import type { InPageChannelProtocol } from "devframe/in-page-channel";
import type { IlhaInspectNode, SetAtomResult } from "ilha/debug";

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

export interface IlhaDevtoolsProtocol extends InPageChannelProtocol {
  functions: {
    pageScript: {
      /** Trees of every live island, same shape as `inspect()` from `ilha/debug`. */
      inspect: () => IlhaInspectNode[];
      /** Outline a component's element on the page; `null` clears it. */
      highlight: (id: string | null) => boolean;
      /** Replace atom `index` of component `id` with a JSON value. */
      setAtom: (id: string, index: number, value: AtomJson) => SetAtomResult;
    };
  };
  sharedStates: {
    tree: IlhaTreeState;
  };
}
