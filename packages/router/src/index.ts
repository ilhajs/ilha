import { context, mount, ISLAND_MOUNT_INTERNAL } from "ilha";
import type { Island, HydratableOptions } from "ilha";
import ilha, { html } from "ilha";
import { createRouter, addRoute, findRoute } from "rou3";

import { getAdapter, getHistoryMode } from "./hash";

export { setHistoryMode, getHistoryMode } from "./hash";
export type { HistoryMode } from "./hash";

// ─────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface RouteRecord {
  pattern: string;
  island: Island<any, any>;
  /** Merged loader chain (layouts outer→inner, then page) — `undefined` if no loaders. */
  loader?: Loader<any>;
}

export interface RouteSnapshot {
  path: string;
  params: Record<string, string>;
  search: string;
  hash: string;
}

export interface AppError {
  message: string;
  status?: number;
  stack?: string;
}

export type LayoutHandler = (children: Island<any, any>) => Island<any, any>;
export type ErrorHandler = (error: AppError, route: RouteSnapshot) => Island<any, any>;

// ─────────────────────────────────────────────
// Loader types
// ─────────────────────────────────────────────

export interface LoaderContext {
  params: Record<string, string>;
  request: Request;
  url: URL;
  signal: AbortSignal;
}

export type Loader<T> = (ctx: LoaderContext) => Promise<T> | T;

/**
 * Identity function for declaring a loader. Exists purely as a type anchor and
 * a marker for the Vite plugin to detect by export name.
 */
export function loader<T>(fn: Loader<T>): Loader<T> {
  return fn;
}

/** Extract the return type of a loader. */
export type InferLoader<L> = L extends Loader<infer T> ? Awaited<T> : never;

/**
 * Merge multiple loader return types into a single object type.
 * Later loaders override earlier ones on key collision — matching runtime merge.
 *
 * @example
 * type PageInput = MergeLoaders<[typeof rootLayoutLoad, typeof sectionLayoutLoad, typeof pageLoad]>;
 */
export type MergeLoaders<Ls extends readonly Loader<any>[]> = Ls extends readonly [
  infer First extends Loader<any>,
  ...infer Rest extends readonly Loader<any>[],
]
  ? Rest extends readonly []
    ? InferLoader<First>
    : Omit<InferLoader<First>, keyof MergeLoaders<Rest>> & MergeLoaders<Rest>
  : {};

// ─────────────────────────────────────────────
// Loader sentinels — redirect / error
// ─────────────────────────────────────────────

export class Redirect {
  readonly __ilhaRedirect = true as const;
  readonly to: string;
  readonly status: number;
  constructor(to: string, status = 302) {
    this.to = to;
    this.status = status;
  }
}

export class LoaderError {
  readonly __ilhaLoaderError = true as const;
  readonly status: number;
  readonly message: string;
  constructor(status: number, message: string) {
    this.status = status;
    this.message = message;
  }
}

export function redirect(to: string, status = 302): never {
  throw new Redirect(to, status);
}

export function error(status: number, message: string): never {
  throw new LoaderError(status, message);
}

// ─────────────────────────────────────────────
// Merge loader chain — layouts outer→inner, then page
// ─────────────────────────────────────────────

/**
 * Compose a list of loaders into a single loader. Later loaders win on key
 * collision (page loader overrides layout loader for the same key). All loaders
 * run concurrently within a chain since they share the same abort signal and
 * request — re-fetching is cheap with a request-scoped cache (future work).
 *
 * For v1 we run them in parallel via `Promise.all`. If a loader throws a
 * `Redirect` or `LoaderError`, the composed loader re-throws it unchanged.
 */
export function composeLoaders<Ls extends readonly Loader<any>[]>(
  loaders: Ls,
): Loader<MergeLoaders<Ls>> {
  if (loaders.length === 0) return async () => ({}) as MergeLoaders<Ls>;
  if (loaders.length === 1) return loaders[0] as Loader<MergeLoaders<Ls>>;

  return async (ctx) => {
    // Run all loaders in parallel. They share the same ctx/signal.
    const results = await Promise.all(loaders.map((l) => l(ctx)));
    // Shallow merge — later results win.
    return Object.assign({}, ...results) as MergeLoaders<Ls>;
  };
}

// ─────────────────────────────────────────────
// Runtime helpers — wrapLayout / wrapError
// ─────────────────────────────────────────────

export function wrapLayout(layout: LayoutHandler, page: Island<any, any>): Island<any, any> {
  return layout(page);
}

export function wrapError(handler: ErrorHandler, page: Island<any, any>): Island<any, any> {
  // Create a wrapper island that handles errors during SSR but preserves
  // the original page island's interactivity on the client
  const Wrapper = ilha.render(() => {
    try {
      return page.toString();
    } catch (e: any) {
      const route: RouteSnapshot = {
        path: routePath(),
        params: routeParams(),
        search: routeSearch(),
        hash: routeHash(),
      };
      return handler({ message: e.message, status: e.status, stack: e.stack }, route).toString();
    }
  });

  // Preserve the original page's mount behavior for client-side interactivity.
  // We read .mount once and close over it — no repeated mutation.
  Wrapper.mount = (host: Element, props?: Record<string, unknown>) => {
    try {
      return page.mount(host, props);
    } catch (e: any) {
      // Mount failed — render the error handler into the host and mount *that*
      const route: RouteSnapshot = {
        path: routePath(),
        params: routeParams(),
        search: routeSearch(),
        hash: routeHash(),
      };
      const errorIsland = handler({ message: e.message, status: e.status, stack: e.stack }, route);
      host.innerHTML = errorIsland.toString();
      return errorIsland.mount(host, props);
    }
  };

  // Also override ISLAND_MOUNT_INTERNAL so that when the wrapper is used as a
  // child slot (e.g. inside a layout), mountSlots forwards to the page's
  // internal mount instead of re-rendering page.toString() and losing
  // interactivity.
  (Wrapper as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] = (
    host: Element,
    props?: Record<string, unknown>,
  ) => {
    try {
      // Forward to page's internal mount for full handle (unmount + updateProps)
      const pageInternal = (page as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL];
      if (typeof pageInternal === "function") {
        return pageInternal(host, props);
      }
      return { unmount: page.mount(host, props), updateProps: () => {} };
    } catch (e: any) {
      const route: RouteSnapshot = {
        path: routePath(),
        params: routeParams(),
        search: routeSearch(),
        hash: routeHash(),
      };
      const errorIsland = handler({ message: e.message, status: e.status, stack: e.stack }, route);
      host.innerHTML = errorIsland.toString();
      return { unmount: errorIsland.mount(host, props), updateProps: () => {} };
    }
  };

  return Wrapper;
}

export function defineLayout(layout: LayoutHandler): LayoutHandler {
  return layout;
}

export interface NavigateOptions {
  replace?: boolean;
}

export interface HydratableRenderOptions extends Partial<Omit<HydratableOptions, "name">> {}

export interface HydrateOptions {
  root?: Element;
  target?: string | Element;
}

export interface MountOptions {
  hydrate?: boolean;
  registry?: Record<string, Island<any, any>>;
}

/** Response envelope returned by `renderResponse` — lets the host app handle redirects. */
export type RenderResponse =
  | { kind: "html"; html: string; status?: number }
  | { kind: "redirect"; to: string; status: number }
  | { kind: "error"; status: number; message: string; html: string };

export interface RouterBuilder {
  /**
   * Register a route. The optional `loader` is the merged loader chain
   * (layout loaders outer→inner followed by the page loader) produced by
   * the FS-routing codegen.
   */
  route(pattern: string, island: Island<any, any>, loader?: Loader<any>): RouterBuilder;
  /**
   * Attach (or replace) a loader on an already-registered route pattern.
   * Used by the `ilha:loaders` virtual module to wire server-only loaders
   * onto the client-safe `pageRouter` at SSR time. No-op if the pattern
   * was never registered via `.route()`.
   */
  attachLoader(pattern: string, loader: Loader<any>): RouterBuilder;
  prime(): void;
  mount(target: string | Element, options?: MountOptions): () => void;
  render(url: string | URL): string;
  renderHydratable(
    url: string | URL,
    registry: Record<string, Island<any, any>>,
    options?: HydratableRenderOptions,
    request?: Request,
  ): Promise<string>;
  /**
   * Like `renderHydratable` but surfaces loader redirects and errors as
   * structured responses instead of baking them into HTML. Prefer this from
   * host server code so you can emit proper 302 / 4xx responses.
   */
  renderResponse(
    url: string | URL,
    registry: Record<string, Island<any, any>>,
    options?: HydratableRenderOptions,
    request?: Request,
  ): Promise<RenderResponse>;
  /**
   * Run the loader chain for a given URL without rendering. Used by the
   * `/__ilha/loader` endpoint the Vite plugin exposes for client-side
   * navigation. Returns the raw loader result, a redirect sentinel, or an
   * error sentinel.
   */
  runLoader(
    url: string | URL,
    request?: Request,
  ): Promise<
    | { kind: "data"; data: Record<string, unknown> }
    | { kind: "redirect"; to: string; status: number }
    | { kind: "error"; status: number; message: string }
    | { kind: "not-found" }
  >;
  /**
   * Hydrate the application - combines prime(), mount(), and router.mount() into one call.
   * @param registry - The island registry from ilha:registry
   * @param options - Optional root element (defaults to document.body) and router target (defaults to root)
   * @returns Cleanup function
   */
  hydrate(registry: Record<string, Island<any, any>>, options?: HydrateOptions): () => void;
}

// ─────────────────────────────────────────────
// Reverse registry lookup — O(1) island → name
// ─────────────────────────────────────────────

function buildReverseRegistry(
  registry: Record<string, Island<any, any>>,
): Map<Island<any, any>, string> {
  const map = new Map<Island<any, any>, string>();
  for (const [name, island] of Object.entries(registry)) {
    if (!map.has(island)) map.set(island, name);
  }
  return map;
}

// ─────────────────────────────────────────────
// Client-side loader data fetch
// ─────────────────────────────────────────────

/** Path of the loader endpoint served by the Vite plugin / production adapter. */
export const LOADER_ENDPOINT = "/__ilha/loader";

/** In-memory cache for prefetched loader data, keyed by path+search. */
const prefetchCache = new Map<string, Promise<LoaderFetchResult>>();

type LoaderFetchResult =
  | { kind: "data"; data: Record<string, unknown> }
  | { kind: "redirect"; to: string; status: number }
  | { kind: "error"; status: number; message: string }
  | { kind: "not-found" };

async function fetchLoaderData(
  pathWithSearch: string,
  signal?: AbortSignal,
): Promise<LoaderFetchResult> {
  // Check prefetch cache first — if a prefetch is in flight, piggy-back on it.
  const cached = prefetchCache.get(pathWithSearch);
  if (cached) {
    // Consume the cache entry — prefetches are single-use to avoid serving
    // stale data across navigations.
    prefetchCache.delete(pathWithSearch);
    try {
      return await cached;
    } catch {
      // Prefetch failed — fall through to a fresh fetch
    }
  }

  const url = `${LOADER_ENDPOINT}?path=${encodeURIComponent(pathWithSearch)}`;
  try {
    const res = await fetch(url, { signal, headers: { accept: "application/json" } });
    if (!res.ok) {
      // Try to parse structured error; fall back to generic.
      try {
        const body = (await res.json()) as LoaderFetchResult;
        if (body && typeof body === "object" && "kind" in body) return body;
      } catch {
        /* fall through */
      }
      return { kind: "error", status: res.status, message: res.statusText };
    }
    return (await res.json()) as LoaderFetchResult;
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    return { kind: "error", status: 0, message: e?.message ?? "network error" };
  }
}

/**
 * Prefetch loader data for a given path. Safe to call repeatedly — a single
 * inflight request is reused until it either resolves (and is consumed by
 * navigation) or is superseded by another prefetch.
 */
export function prefetch(pathWithSearch: string): void {
  if (!isBrowser) return;
  if (prefetchCache.has(pathWithSearch)) return;
  // Don't prefetch routes that have no loader — nothing to fetch.
  const pathOnly = pathWithSearch.split("?")[0] ?? "";
  const match = findRoute(_rou3, "GET", pathOnly);
  if (!match?.data?.loader) return;
  const promise = fetchLoaderData(pathWithSearch).catch((e) => {
    return { kind: "error", status: 0, message: e?.message ?? "prefetch failed" } as const;
  });
  prefetchCache.set(pathWithSearch, promise);
}

// ─────────────────────────────────────────────
// Client-side navigation hydration helper
// ─────────────────────────────────────────────

/**
 * Mounts a route island with proper hydration for client-side navigation.
 * Looks up the island in the reverse registry, runs the loader (via fetch),
 * renders it with hydration markers, and mounts it for interactivity.
 */
async function mountRouteWithHydration(
  island: Island<any, any> | null,
  host: Element,
  pathWithSearch: string,
  signal: AbortSignal,
  registry?: Record<string, Island<any, any>>,
  reverseRegistry?: Map<Island<any, any>, string>,
): Promise<() => void> {
  if (!island) {
    host.innerHTML = `<div data-router-empty></div>`;
    return () => {};
  }

  // Fetch loader data *only if* the matched route has a loader registered.
  // Routes registered client-side have `loader: undefined` when the Vite
  // plugin emits server-only loader imports behind `import.meta.env.SSR`.
  const clientMatch = findRoute(_rou3, "GET", pathWithSearch.split("?")[0] ?? "");
  const hasLoader = !!clientMatch?.data?.loader;

  let props: Record<string, unknown> = {};
  const loaderResult: LoaderFetchResult = hasLoader
    ? await fetchLoaderData(pathWithSearch, signal)
    : { kind: "data", data: {} };

  if (loaderResult.kind === "redirect") {
    navigate(loaderResult.to, { replace: true });
    return () => {};
  }
  if (loaderResult.kind === "error") {
    // Render a minimal inline error. See renderResponse for why loader errors
    // don't currently route through the page's +error.ts boundary.
    const escaped = String(loaderResult.message)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    host.innerHTML = `<div data-router-view data-router-error="${loaderResult.status}">${escaped}</div>`;
    return () => {};
  }
  if (loaderResult.kind === "not-found") {
    host.innerHTML = `<div data-router-empty></div>`;
    return () => {};
  }
  props = loaderResult.data;

  // If no registry provided, fall back to static rendering (no interactivity)
  if (!registry) {
    console.warn(
      "[ilha-router] No registry provided for client-side navigation. Island will not be interactive.",
    );
    host.innerHTML = `<div data-router-view>${island.toString(props)}</div>`;
    return () => {};
  }

  // Find the island name via reverse map (O(1)) or linear scan as fallback
  const name =
    reverseRegistry?.get(island) ?? Object.entries(registry).find(([, v]) => v === island)?.[0];

  if (!name) {
    console.warn("[ilha-router] Island not found in registry for client-side navigation.");
    host.innerHTML = `<div data-router-view>${island.toString(props)}</div>`;
    return () => {};
  }

  // Render with hydration markers and mount for interactivity
  const html = await island.hydratable(props, { name, as: "div", snapshot: true });
  host.innerHTML = `<div data-router-view>${html}</div>`;

  // Mount the island for interactivity
  const islandHost = host.querySelector(`[data-ilha="${name}"]`);
  if (islandHost) {
    return island.mount(islandHost);
  }

  return () => {};
}

// ─────────────────────────────────────────────
// Route context signals
// ─────────────────────────────────────────────

export const routePath = context<string>("router.path", "");
export const routeParams = context<Record<string, string>>("router.params", {});
export const routeSearch = context<string>("router.search", "");
export const routeHash = context<string>("router.hash", "");

export function useRoute() {
  return { path: routePath, params: routeParams, search: routeSearch, hash: routeHash };
}

// ─────────────────────────────────────────────
// Active island context signal
// ─────────────────────────────────────────────

const activeIsland = context<Island<any, any> | null>("router.active", null);

// ─────────────────────────────────────────────
// Route registry
// ─────────────────────────────────────────────

interface RouteData {
  island: Island<any, any>;
  loader?: Loader<any>;
}

let _records: RouteRecord[] = [];
let _rou3 = createRouter<RouteData>();

// ─────────────────────────────────────────────
// Island → pattern reverse map (O(1) isActive)
// ─────────────────────────────────────────────

let _islandToPattern = new Map<Island<any, any>, string>();

// ─────────────────────────────────────────────
// Pattern → RouteData map — lets attachLoader() mutate the loader in place
// on an already-registered route. The object stored here is the SAME
// reference stored in rou3, so mutating it is visible at findRoute time.
// ─────────────────────────────────────────────

let _patternToData = new Map<string, RouteData>();

// ─────────────────────────────────────────────
// Shared match → params extraction
// ─────────────────────────────────────────────

function extractParams(matchParams: Record<string, string> | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  if (matchParams) {
    for (const [k, v] of Object.entries(matchParams)) {
      params[k] = decodeURIComponent(v as string);
    }
  }
  return params;
}

// ─────────────────────────────────────────────
// Sync signals from an explicit URL (SSR path)
// ─────────────────────────────────────────────

function syncRouteFromURL(url: string | URL): void {
  const parsed = typeof url === "string" ? new URL(url, "http://localhost") : url;

  const match = findRoute(_rou3, "GET", parsed.pathname);

  routePath(parsed.pathname);
  routeParams(extractParams(match?.params as Record<string, string> | undefined));
  routeSearch(parsed.search);
  routeHash(parsed.hash);
  activeIsland(match?.data?.island ?? null);
}

/** Client-only fast path — reads directly from the history adapter (location in history mode, hash content in hash mode). */
function syncRouteFromLocation(): void {
  const loc = getAdapter().readLocation();
  const match = findRoute(_rou3, "GET", loc.pathname);

  routePath(loc.pathname);
  routeParams(extractParams(match?.params as Record<string, string> | undefined));
  routeSearch(loc.search);
  routeHash(loc.hash);
  activeIsland(match?.data?.island ?? null);
}

// ─────────────────────────────────────────────
// Pre-hydration signal priming
// ─────────────────────────────────────────────

/**
 * Prime route context signals from the current `location` so that islands
 * hydrated by `ilha.mount()` see the correct route values on their first
 * render — preventing a mismatch morph that would destroy hydrated bindings.
 */
export function prime(): void {
  if (isBrowser) syncRouteFromLocation();
}

// ─────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────

export function navigate(to: string, opts: NavigateOptions = {}): void {
  if (!isBrowser) return;

  const adapter = getAdapter();

  // Skip duplicate navigations — same logical URL means no history push, no re-render.
  // We compare against the adapter's logical location, not window.location, so the
  // dedup behaves identically in hash mode.
  const cur = adapter.readLocation();
  const current = cur.pathname + cur.search + cur.hash;
  if (to === current) return;

  if (opts.replace) adapter.replace(to);
  else adapter.push(to);
  syncRouteFromLocation();
}

// ─────────────────────────────────────────────
// Link interception — with optional hover prefetch
// ─────────────────────────────────────────────

export interface LinkInterceptionOptions {
  /**
   * Prefetch loader data on `mouseenter` for eligible links. Links opt in via
   * the `data-prefetch` attribute (set `data-prefetch="false"` to opt out a
   * specific link even when the framework is configured to prefetch by default).
   * Default: `true` — prefetches on hover for any link with `data-prefetch`.
   */
  prefetch?: boolean;
}

export function enableLinkInterception(
  root: Element | Document = document,
  options: LinkInterceptionOptions = {},
): () => void {
  if (!isBrowser) return () => {};

  const prefetchEnabled = options.prefetch !== false;

  /**
   * Determine whether this anchor is a same-origin in-app link we should handle,
   * and if so, the logical path to navigate to. Returns null when the link
   * should be left to the browser (external, modifier held, target=_blank, etc).
   */
  function logicalPathFor(target: HTMLAnchorElement, e?: Event): string | null {
    const isBlank = target.getAttribute("target") === "_blank";
    const hasModifier =
      !!e && ((e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey || (e as MouseEvent).shiftKey);
    const hasNoIntercept = target.hasAttribute("data-no-intercept");
    if (isBlank || hasModifier || hasNoIntercept) return null;
    return getAdapter().extractLogicalPath(target);
  }

  const clickHandler = (e: Event) => {
    if (e.defaultPrevented) return;
    const target = (e.target as Element).closest("a") as HTMLAnchorElement | null;
    if (!target) return;
    const path = logicalPathFor(target, e);
    if (path === null) return;

    e.preventDefault();
    navigate(path);
  };

  const hoverHandler = (e: Event) => {
    const target = (e.target as Element).closest("a") as HTMLAnchorElement | null;
    if (!target) return;
    // Opt-in only: link must have `data-prefetch` (and not `data-prefetch="false"`)
    const flag = target.getAttribute("data-prefetch");
    if (flag === null || flag === "false") return;
    const path = logicalPathFor(target);
    if (path === null) return;
    // Drop hash for prefetch — loaders are keyed on path+search.
    const noHash = path.split("#")[0] ?? path;
    prefetch(noHash);
  };

  root.addEventListener("click", clickHandler);
  if (prefetchEnabled) {
    // `mouseenter` does not bubble — use `mouseover` which does, then gate by closest('a').
    root.addEventListener("mouseover", hoverHandler, { passive: true } as AddEventListenerOptions);
  }

  return () => {
    root.removeEventListener("click", clickHandler);
    if (prefetchEnabled) {
      root.removeEventListener("mouseover", hoverHandler);
    }
  };
}

// ─────────────────────────────────────────────
// RouterView outlet island
// ─────────────────────────────────────────────

export const RouterView = ilha.render((): string => {
  const island = activeIsland();
  if (!island) return `<div data-router-empty></div>`;
  return `<div data-router-view>${island.toString()}</div>`;
});

// ─────────────────────────────────────────────
// RouterLink island — prefetches on hover by default
// ─────────────────────────────────────────────

export const RouterLink = ilha
  .state("href", "")
  .state("label", "")
  .on("[data-link]@click", ({ state, event }) => {
    event.preventDefault();
    navigate(state.href());
  })
  .on("[data-link]@mouseenter", ({ state }) => {
    const href = state.href();
    if (!href) return;
    // Only prefetch same-origin paths — href is usually "/foo" but could be absolute.
    if (/^https?:\/\//i.test(href)) {
      try {
        const u = new URL(href);
        if (u.origin !== location.origin) return;
        prefetch(u.pathname + u.search);
        return;
      } catch {
        return;
      }
    }
    prefetch(href);
  })
  .render(
    ({ state }) =>
      html`<a data-link data-prefetch href="${() => getAdapter().toLinkHref(state.href())}"
        >${state.label}</a
      >`,
  );

// ─────────────────────────────────────────────
// isActive()
// ─────────────────────────────────────────────

export function isActive(pattern: string): boolean {
  const match = findRoute(_rou3, "GET", routePath());
  if (!match) return false;
  // O(1) lookup via reverse map instead of linear scan through _records
  return _islandToPattern.get(match.data.island) === pattern;
}

// ─────────────────────────────────────────────
// Internal helpers for loader execution
// ─────────────────────────────────────────────

function parsedURL(url: string | URL): URL {
  return typeof url === "string" ? new URL(url, "http://localhost") : url;
}

function defaultRequest(url: URL): Request {
  // Best-effort synthesised Request for SSR callers that don't supply one.
  try {
    return new Request(url.toString());
  } catch {
    // Some environments may not have global Request; return a minimal shim.
    return { url: url.toString(), headers: new Headers() } as unknown as Request;
  }
}

async function executeLoader(
  loader: Loader<any>,
  url: URL,
  params: Record<string, string>,
  request: Request,
  signal: AbortSignal,
): Promise<
  | { kind: "data"; data: Record<string, unknown> }
  | { kind: "redirect"; to: string; status: number }
  | { kind: "error"; status: number; message: string }
> {
  try {
    const data = await loader({ params, request, url, signal });
    return { kind: "data", data: (data ?? {}) as Record<string, unknown> };
  } catch (e: any) {
    if (e instanceof Redirect) return { kind: "redirect", to: e.to, status: e.status };
    if (e instanceof LoaderError) return { kind: "error", status: e.status, message: e.message };
    // Non-sentinel error — surface as 500.
    return { kind: "error", status: e?.status ?? 500, message: e?.message ?? "Loader failed" };
  }
}

// ─────────────────────────────────────────────
// Router builder
// ─────────────────────────────────────────────

export function router(): RouterBuilder {
  _records = [];
  _rou3 = createRouter<RouteData>();
  _islandToPattern = new Map();
  _patternToData = new Map();

  let _navChangeCleanup: (() => void) | null = null;
  let _linkCleanup: (() => void) | null = null;

  const builder: RouterBuilder = {
    route(pattern: string, island: Island<any, any>, loader?: Loader<any>): RouterBuilder {
      const data: RouteData = { island, loader };
      _records.push({ pattern, island, loader });
      addRoute(_rou3, "GET", pattern, data);
      _patternToData.set(pattern, data);
      // First pattern registered for an island wins (most specific due to sort order)
      if (!_islandToPattern.has(island)) {
        _islandToPattern.set(island, pattern);
      }
      return builder;
    },

    attachLoader(pattern: string, loader: Loader<any>): RouterBuilder {
      const data = _patternToData.get(pattern);
      if (!data) {
        console.warn(
          `[ilha-router] attachLoader("${pattern}", …): pattern was never registered via .route(). ` +
            `The loader will be ignored.`,
        );
        return builder;
      }
      data.loader = loader;
      // Keep _records in sync for consumers that read it directly
      const rec = _records.find((r) => r.pattern === pattern);
      if (rec) rec.loader = loader;
      return builder;
    },

    // ── Pre-hydration signal priming ───────────────────────────────────────
    prime,

    // ── Client-side ──────────────────────────────────────────────────────────
    mount(target: string | Element, { hydrate = false, registry }: MountOptions = {}): () => void {
      if (!isBrowser) {
        console.warn("[ilha-router] mount() called in a non-browser environment");
        return () => {};
      }

      const host = typeof target === "string" ? document.querySelector(target) : target;
      if (!host) {
        console.warn(`[ilha-router] No element found for selector "${target}"`);
        return () => {};
      }

      // Ensure route signals are current.
      syncRouteFromLocation();

      const popHandler = () => syncRouteFromLocation();
      _navChangeCleanup = getAdapter().onChange(popHandler);
      _linkCleanup = enableLinkInterception(document);

      let unmountView: (() => void) | null = null;
      // Per-navigation AbortController — canceled when navigation is superseded
      // or the router unmounts. Used to abort in-flight loader fetches.
      let navAbort: AbortController | null = null;

      if (hydrate) {
        // Hash-mode + hydration is a footgun: the server only ever sees "/" because
        // the hash isn't sent in the request, so the SSR HTML was rendered for "/"
        // even when the user opened a deep link like "index.html#/about". On the
        // client we'd then try to hydrate "/about" against HTML rendered for "/" —
        // mismatch. Warn loudly so apps don't accidentally combine the two.
        if (getHistoryMode() === "hash") {
          console.warn(
            "[ilha-router] mount({ hydrate: true }) was called in hash mode. " +
              "SSR + hydration assumes the server can render the active route, but in " +
              "hash mode the server only ever sees the document URL. Use plain SPA mode " +
              "(`mount(target)` without `hydrate: true`) for hash-mode apps.",
          );
        }
        // SSR HTML is already in the DOM and ilha.mount() has already hydrated
        // [data-ilha] nodes with reactivity.  We must NOT mount RouterView now —
        // any morph (even with identical HTML) would replace the live DOM nodes,
        // destroying the event listeners and signal bindings ilha.mount() wired up.
        const viewHost = host.querySelector<Element>("[data-router-view]") ?? host;
        let currentMountedIsland: Island<any, any> | null = activeIsland();

        const reverseRegistry = registry ? buildReverseRegistry(registry) : undefined;

        let navVersion = 0;

        const NavHandler = ilha.render((): string => {
          const current = activeIsland();
          if (current !== currentMountedIsland) {
            const thisNav = ++navVersion;
            // Cancel any in-flight loader fetch for the previous nav
            navAbort?.abort();
            navAbort = new AbortController();
            const signal = navAbort.signal;

            queueMicrotask(async () => {
              if (thisNav !== navVersion) return;
              unmountView?.();
              try {
                const loc = getAdapter().readLocation();
                unmountView = await mountRouteWithHydration(
                  current,
                  viewHost,
                  loc.pathname + loc.search,
                  signal,
                  registry,
                  reverseRegistry,
                );
              } catch (e: any) {
                if (e?.name === "AbortError") return;
                throw e;
              }
              currentMountedIsland = current;
            });
          }
          return "";
        });

        const navHost = document.createElement("div");
        navHost.style.display = "none";
        host.appendChild(navHost);
        const unmountNavHandler = NavHandler.mount(navHost);

        return () => {
          ++navVersion;
          navAbort?.abort();
          unmountNavHandler();
          navHost.remove();
          unmountView?.();
          _navChangeCleanup?.();
          _linkCleanup?.();
          _navChangeCleanup = null;
          _linkCleanup = null;
        };
      }

      // SPA mode — RouterView renders HTML but islands need .mount() for interactivity.
      let unmountIsland: (() => void) | null = null;
      let currentMountedIsland: Island<any, any> | null = null;
      let navVersion = 0;

      unmountView = RouterView.mount(host);

      /**
       * Fetch loader data and mount the active island. SPA mode also fetches
       * from the loader endpoint — otherwise navigation after the initial SSR
       * render would have no access to loader data.
       */
      async function mountActiveIsland(
        island: Island<any, any> | null,
        signal: AbortSignal,
      ): Promise<void> {
        unmountIsland?.();
        unmountIsland = null;
        currentMountedIsland = island;
        if (!island) return;
        const viewHost = host?.querySelector<Element>("[data-router-view]");
        if (!viewHost) return;

        // Fetch loader data only if the matched route has a loader registered.
        const adapter = getAdapter();
        const loc = adapter.readLocation();
        const clientMatch = findRoute(_rou3, "GET", loc.pathname);
        const hasLoader = !!clientMatch?.data?.loader;
        const result: LoaderFetchResult = hasLoader
          ? await fetchLoaderData(loc.pathname + loc.search, signal)
          : { kind: "data", data: {} };
        if (signal.aborted) return;
        if (result.kind === "redirect") {
          navigate(result.to, { replace: true });
          return;
        }
        const props = result.kind === "data" ? result.data : {};

        // In SPA mode RouterView is already showing the island's no-props HTML.
        // Re-render with props, morph, and mount for interactivity.
        viewHost.innerHTML = island.toString(props);
        unmountIsland = island.mount(viewHost, props);
      }

      // Initial mount — no need to wait for a loader fetch since the first
      // render already ran synchronously via RouterView. However, for SPA mode
      // the initial render had no props, so we fetch and re-render once.
      navAbort = new AbortController();
      mountActiveIsland(activeIsland(), navAbort.signal);

      const NavHandler = ilha.render((): string => {
        const current = activeIsland();
        if (current !== currentMountedIsland) {
          const thisNav = ++navVersion;
          navAbort?.abort();
          navAbort = new AbortController();
          const signal = navAbort.signal;
          queueMicrotask(() => {
            if (thisNav !== navVersion) return;
            mountActiveIsland(current, signal);
          });
        }
        return "";
      });

      const navHost = document.createElement("div");
      navHost.style.display = "none";
      host.appendChild(navHost);
      const unmountNavHandler = NavHandler.mount(navHost);

      return () => {
        ++navVersion;
        navAbort?.abort();
        unmountIsland?.();
        unmountNavHandler();
        navHost.remove();
        unmountView?.();
        _navChangeCleanup?.();
        _linkCleanup?.();
        _navChangeCleanup = null;
        _linkCleanup = null;
      };
    },

    // ── Server-side — plain SSR ───────────────────────────────────────────────
    render(url: string | URL): string {
      syncRouteFromURL(url);
      return RouterView.toString();
    },

    // ── Server-side — hydratable SSR ─────────────────────────────────────────
    async renderHydratable(
      url: string | URL,
      registry: Record<string, Island<any, any>>,
      options: HydratableRenderOptions = {},
      request?: Request,
    ): Promise<string> {
      const response = await this.renderResponse(url, registry, options, request);
      if (response.kind === "html") return response.html;
      if (response.kind === "error") return response.html;
      // Redirects encoded as meta-refresh for callers that use the string API
      // directly. Prefer `renderResponse` to handle redirects at the HTTP layer.
      return `<meta http-equiv="refresh" content="0; url=${response.to}">`;
    },

    // ── Server-side — structured response (preferred) ────────────────────────
    async renderResponse(
      url: string | URL,
      registry: Record<string, Island<any, any>>,
      options: HydratableRenderOptions = {},
      request?: Request,
    ): Promise<RenderResponse> {
      const parsed = parsedURL(url);
      syncRouteFromURL(parsed);

      const match = findRoute(_rou3, "GET", parsed.pathname);
      const island = match?.data?.island ?? null;
      if (!island) {
        return {
          kind: "html",
          html: `<div data-router-empty></div>`,
          status: 404,
        };
      }

      // Run loader (if any)
      let props: Record<string, unknown> = {};
      if (match?.data?.loader) {
        const req = request ?? defaultRequest(parsed);
        const ctrl = new AbortController();
        const result = await executeLoader(
          match.data.loader,
          parsed,
          routeParams(),
          req,
          ctrl.signal,
        );
        if (result.kind === "redirect") {
          return { kind: "redirect", to: result.to, status: result.status };
        }
        if (result.kind === "error") {
          // Loader errors render a minimal inline error page. The page's
          // `+error.ts` boundary (applied via `wrapError` at codegen time)
          // wraps the page island's *render*, not the loader — so loader
          // errors cannot currently route through it. Host apps should
          // inspect `response.status` and substitute their own error page
          // if finer control is needed.
          const escapedMessage = String(result.message)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          const html = `<div data-router-view data-router-error="${result.status}">${escapedMessage}</div>`;
          return { kind: "error", status: result.status, message: result.message, html };
        }
        props = result.data;
      }

      const reverseRegistry = buildReverseRegistry(registry);
      const name = reverseRegistry.get(island);
      if (!name) {
        console.warn(
          `[ilha-router] renderHydratable: active island for "${routePath()}" is not in the registry. ` +
            `Falling back to plain SSR — the island will not be interactive on the client.`,
        );
        return {
          kind: "html",
          html: `<div data-router-view>${island.toString(props)}</div>`,
        };
      }

      const rendered = await island.hydratable(props, {
        name,
        as: "div",
        snapshot: true,
        ...options,
      });

      return { kind: "html", html: `<div data-router-view>${rendered}</div>` };
    },

    // ── Server-side — run loader for a URL (loader endpoint) ────────────────
    async runLoader(url: string | URL, request?: Request) {
      const parsed = parsedURL(url);

      const match = findRoute(_rou3, "GET", parsed.pathname);
      if (!match?.data?.island) return { kind: "not-found" as const };

      if (!match.data.loader) {
        return { kind: "data" as const, data: {} };
      }

      const params = extractParams(match.params as Record<string, string> | undefined);
      const req = request ?? defaultRequest(parsed);
      const ctrl = new AbortController();
      return executeLoader(match.data.loader, parsed, params, req, ctrl.signal);
    },

    hydrate(registry: Record<string, Island<any, any>>, options: HydrateOptions = {}): () => void {
      if (!isBrowser) {
        console.warn("[ilha-router] hydrate() called in a non-browser environment");
        return () => {};
      }

      const root = options.root ?? document.body;
      const target = options.target ?? root;

      prime();
      const { unmount } = mount(registry, { root });
      const unmountRouter = this.mount(target, { hydrate: true, registry });

      return () => {
        unmount();
        unmountRouter();
      };
    },
  };

  return builder;
}

// ─────────────────────────────────────────────
// Default export
// ─────────────────────────────────────────────

export default {
  router,
  navigate,
  useRoute,
  isActive,
  enableLinkInterception,
  prime,
  prefetch,
  RouterView,
  RouterLink,
  loader,
  redirect,
  error,
  composeLoaders,
};
