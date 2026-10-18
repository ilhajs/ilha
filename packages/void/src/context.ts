import { createContext } from "ilha";
import type { NavigationState, VoidRouter } from "void/pages-client";

import type { FieldErrors, JsonRecord } from "./types";

/** Route state every component under a Void page can read. */
export interface VoidPageState {
  /** The Void Router; `null` on island pages, which navigate with full loads. */
  readonly router: VoidRouter | null;
  readonly params: Readonly<Record<string, string>>;
  readonly shared: JsonRecord;
  /** Validation errors the last action returned through a redirect. */
  readonly errors: FieldErrors;
  readonly navigation: NavigationState;
}

export const VoidContext = createContext<VoidPageState | null>(null);

/**
 * Freeze page state for `VoidContext.Provider`. The provider keeps its value
 * out of the hydration snapshot; the client rebuilds it from
 * `__VOID_PAGE_DATA__`.
 */
export const createPageState = (state: VoidPageState): VoidPageState =>
  Object.freeze({ ...state });
