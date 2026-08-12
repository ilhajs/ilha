export type HistoryMode = "history" | "hash";
export interface LogicalLocation {
  pathname: string;
  search: string;
  hash: string;
}
export interface HistoryAdapter {
  /** Read the current logical URL (the one routes are matched against). */
  readLocation(): LogicalLocation;
  /** Push a new logical URL onto the history stack. `state` is stored on the history entry. */
  push(to: string, state?: unknown): void;
  /** Replace the current history entry with a new logical URL. `state` is stored on the history entry. */
  replace(to: string, state?: unknown): void;
  /** Subscribe to logical-URL changes. Returns a cleanup function. */
  onChange(handler: () => void): () => void;
  /**
   * Convert a logical href (what the user writes, e.g. "/users/42") into
   * the actual DOM href attribute (e.g. "#/users/42" in hash mode).
   */
  toLinkHref(logicalPath: string): string;
  /**
   * Extract a logical path from an `<a>` element. Returns null when the
   * link is not an in-app navigation target (external, anchor-only, etc).
   * The caller still applies modifier-key / target=_blank checks.
   */
  extractLogicalPath(anchor: HTMLAnchorElement): string | null;
}
/**
 * Set the router's history mode. Call this once at app entry, before
 * mounting any router. Defaults to "history" (HTML5 History API).
 *
 * Use "hash" when the document is loaded over file:// (Electron, Tauri, etc.)
 * or any time there's no server able to serve a SPA fallback at arbitrary
 * pathnames.
 *
 * Switching modes mid-session is supported but not common — listeners
 * registered before the switch will keep using their original adapter
 * until they're re-attached (typically by unmounting and remounting
 * the router).
 */
export declare function setHistoryMode(mode: HistoryMode): void;
export declare function getHistoryMode(): HistoryMode;
/** Internal — used by index.ts. Not part of the public API. */
export declare function getAdapter(): HistoryAdapter;
