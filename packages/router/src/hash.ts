// ─────────────────────────────────────────────
// History adapter — abstracts how the router reads/writes
// the "logical" URL it matches routes against.
//
// Two modes:
//   - "history" (default): reads/writes location.pathname directly,
//     uses History API (history.pushState / popstate). This is the
//     classic SPA setup and what every server-rendered page needs.
//   - "hash": stores the logical path in location.hash (e.g. "#/users/42").
//     Useful when the document is loaded over file:// (Electron, Electrobun,
//     Tauri, opening a built bundle directly) where the History API can't
//     write a meaningful pathname, or when there's no server able to serve
//     a SPA fallback at every URL.
//
// The adapter is process-global and selected once at app entry via
// setHistoryMode(). It does not affect server-side rendering — render(),
// renderHydratable() and renderResponse() all take an explicit URL argument
// and never touch window.location.
// ─────────────────────────────────────────────

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

export type HistoryMode = "history" | "hash";

export interface LogicalLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface HistoryAdapter {
  /** Read the current logical URL (the one routes are matched against). */
  readLocation(): LogicalLocation;
  /** Push a new logical URL onto the history stack. */
  push(to: string): void;
  /** Replace the current history entry with a new logical URL. */
  replace(to: string): void;
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

// ─────────────────────────────────────────────
// "history" mode — the classic SPA adapter (default)
// ─────────────────────────────────────────────

const historyAdapter: HistoryAdapter = {
  readLocation() {
    if (!isBrowser) return { pathname: "/", search: "", hash: "" };
    return {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    };
  },
  push(to) {
    if (!isBrowser) return;
    history.pushState(null, "", to);
  },
  replace(to) {
    if (!isBrowser) return;
    history.replaceState(null, "", to);
  },
  onChange(handler) {
    if (!isBrowser) return () => {};
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  },
  toLinkHref(p) {
    return p;
  },
  extractLogicalPath(anchor) {
    const href = anchor.getAttribute("href");
    if (!href) return null;
    // Anchor-only links ("#section") are in-page, not navigations.
    if (href.startsWith("#")) return null;
    // Same-origin check — `hostname` is empty for relative hrefs, which is fine.
    const isExternal =
      !!anchor.hostname &&
      (anchor.hostname !== location.hostname || anchor.protocol !== location.protocol);
    if (isExternal) return null;
    return anchor.pathname + anchor.search + anchor.hash;
  },
};

// ─────────────────────────────────────────────
// "hash" mode — logical URL lives in location.hash
// ─────────────────────────────────────────────
//
// The hash content after the leading "#" is parsed as if it were a URL itself,
// so "#/users/42?tab=info#section" yields:
//   pathname: "/users/42"
//   search:   "?tab=info"
//   hash:     "#section"      ← available via routeHash() for in-page anchors
//
// We use history.pushState / replaceState (rather than `location.hash = ...`)
// to write the hash. This avoids firing an extra `hashchange` event for
// programmatic navigation, since we already call the change handler manually
// after a push/replace via syncRouteFromLocation in index.ts. We still listen
// for `hashchange` to catch out-of-band changes like the user typing into the
// address bar or scripts setting `location.hash` directly.
// ─────────────────────────────────────────────

function parseHash(rawHash: string): LogicalLocation {
  // Strip the leading "#". Empty hash → root path.
  const stripped = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  const path = stripped === "" ? "/" : stripped.startsWith("/") ? stripped : "/" + stripped;
  // Use a dummy origin so the URL constructor parses pathname/search/hash
  // exactly as it would for a real URL. The origin is never read.
  const u = new URL(path, "http://_");
  return { pathname: u.pathname, search: u.search, hash: u.hash };
}

const hashAdapter: HistoryAdapter = {
  readLocation() {
    if (!isBrowser) return { pathname: "/", search: "", hash: "" };
    return parseHash(location.hash);
  },
  push(to) {
    if (!isBrowser) return;
    history.pushState(null, "", to.startsWith("#") ? to : "#" + to);
  },
  replace(to) {
    if (!isBrowser) return;
    history.replaceState(null, "", to.startsWith("#") ? to : "#" + to);
  },
  onChange(handler) {
    if (!isBrowser) return () => {};
    window.addEventListener("popstate", handler);
    window.addEventListener("hashchange", handler);
    return () => {
      window.removeEventListener("popstate", handler);
      window.removeEventListener("hashchange", handler);
    };
  },
  toLinkHref(p) {
    // p is a logical path like "/users/42"; convert to "#/users/42".
    // If the caller already passed something starting with "#", trust them.
    if (p.startsWith("#")) return p;
    return "#" + p;
  },
  extractLogicalPath(anchor) {
    const href = anchor.getAttribute("href");
    if (!href) return null;

    // Hash-form link: "#/about" or "#/users/42?x=1"
    if (href.startsWith("#")) {
      const inner = href.slice(1);
      // A bare "#" or "#section" without a leading slash is an in-page anchor,
      // not an in-app navigation. We only intercept "#/..." style links.
      if (inner === "" || !inner.startsWith("/")) return null;
      return inner;
    }

    // Absolute URL with a hash component to a same-origin page —
    // e.g. <a href="https://app.example.com/#/about">. Pull out the hash.
    // For other absolute URLs (no hash, different origin), don't intercept.
    if (/^https?:\/\//i.test(href)) {
      try {
        const u = new URL(href);
        if (u.origin !== location.origin) return null;
        if (!u.hash || u.hash === "#") return null;
        const inner = u.hash.slice(1);
        if (!inner.startsWith("/")) return null;
        return inner;
      } catch {
        return null;
      }
    }

    // A relative href like "/about" in hash mode is ambiguous. We treat it as
    // a logical path — this matches what existing apps will already write
    // (`<a href="/about">`) and keeps `navigate("/about")` symmetric. The
    // alternative (refusing to intercept) would force every link in a hash-mode
    // app to be hash-prefixed, which is hostile to code shared between modes.
    return href;
  },
};

// ─────────────────────────────────────────────
// Module-level adapter selector
// ─────────────────────────────────────────────

let _mode: HistoryMode = "history";
let _adapter: HistoryAdapter = historyAdapter;

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
export function setHistoryMode(mode: HistoryMode): void {
  _mode = mode;
  _adapter = mode === "hash" ? hashAdapter : historyAdapter;
}

export function getHistoryMode(): HistoryMode {
  return _mode;
}

/** Internal — used by index.ts. Not part of the public API. */
export function getAdapter(): HistoryAdapter {
  return _adapter;
}
