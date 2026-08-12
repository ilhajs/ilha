import type { Island, HydratableOptions } from "ilha";
export { setHistoryMode, getHistoryMode } from "./hash";
export type { HistoryMode } from "./hash";
export interface RouteRecord {
  pattern: string;
  island: Island<any, any>;
  /** Merged loader chain (layouts outer→inner, then page) — `undefined` if no loaders. */
  loader?: Loader<any>;
  /** True when the route has a server-side loader, even if the client only has a marker. */
  hasLoader?: boolean;
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
/**
 * Serializable description of `<head>` (and html/body attributes) contributed
 * by a loader or a render-time `head()` call. Deliberately a plain POJO — Tier
 * 1 head management is SSR-only, so there is no reactive wrapper. Dedup keys
 * mirror unhead so a later move to a runtime head manager stays a drop-in.
 */
export interface HeadInput {
  title?: string;
  /** Wrap the resolved title. The last template in merge order wins. */
  titleTemplate?: string | ((title?: string) => string);
  meta?: Array<Record<string, string>>;
  link?: Array<Record<string, string>>;
  /**
   * Inline script bodies are emitted raw in SSR (`serializeHead`). Must be trusted
   * app code and must not contain a literal `</script>` sequence.
   */
  script?: Array<
    Record<string, string> & {
      children?: string;
    }
  >;
  htmlAttrs?: Record<string, string>;
  bodyAttrs?: Record<string, string>;
}
/** Serialized head fragments ready to inject into a document shell. */
export interface SerializedHead {
  /** Markup for inside `<head>` (title, meta, link, script). */
  headTags: string;
  /** Attribute string for the `<html>` tag (leading space included). */
  htmlAttrs: string;
  /** Attribute string for the `<body>` tag (leading space included). */
  bodyAttrs: string;
}
export interface LoaderContext {
  params: Record<string, string>;
  request: Request;
  url: URL;
  signal: AbortSignal;
  /** Contribute `<head>` data for this route. Safe to call multiple times. */
  head: (input: HeadInput) => void;
}
export type Loader<T> = (ctx: LoaderContext) => Promise<T> | T;
/**
 * Identity function for declaring a loader. Exists purely as a type anchor and
 * a marker for the Vite plugin to detect by export name.
 *
 * Loaders must read `ctx.params`/`ctx.url` rather than `useRoute()` — the
 * route store still holds the previous route while a navigation's loader is
 * in flight, so `useRoute().params()` inside a loader reads stale params.
 */
export declare function loader<T>(fn: Loader<T>): Loader<T>;
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
export declare class Redirect {
  readonly __ilhaRedirect: true;
  readonly to: string;
  readonly status: number;
  constructor(to: string, status?: number);
}
export declare class LoaderError {
  readonly __ilhaLoaderError: true;
  readonly status: number;
  readonly message: string;
  constructor(status: number, message: string);
}
export declare function redirect(to: string, status?: number): never;
export declare function error(status: number, message: string): never;
/**
 * Compose a list of loaders into a single loader. Later loaders win on key
 * collision (page loader overrides layout loader for the same key). All loaders
 * run concurrently within a chain since they share the same abort signal and
 * request — re-fetching is cheap with a request-scoped cache (future work).
 *
 * For v1 we run them in parallel via `Promise.all`. If a loader throws a
 * `Redirect` or `LoaderError`, the composed loader re-throws it unchanged.
 */
export declare function composeLoaders<Ls extends readonly Loader<any>[]>(
  loaders: Ls,
): Loader<MergeLoaders<Ls>>;
export declare function wrapLayout(layout: LayoutHandler, page: Island<any, any>): Island<any, any>;
export declare function wrapError(handler: ErrorHandler, page: Island<any, any>): Island<any, any>;
export declare function defineLayout(layout: LayoutHandler): LayoutHandler;
export interface NavigateOptions {
  replace?: boolean;
  /**
   * When `false`, keep the current scroll position instead of scrolling to the
   * top (or to the URL hash target) after navigation. Default: `true`.
   */
  scroll?: boolean;
}
export type RouterMode = "spa" | "static";
export interface RouterOptions {
  /**
   * Client navigation mode.
   * - `spa` — full route graph, SSR/hydration, client-side navigation.
   * - `static` — no route graph bundled; hydrate islands on the current
   *   pre-rendered page only.
   * Default: `spa`.
   */
  mode?: RouterMode;
  /**
   * When `true` (default), internal `<a>` clicks are intercepted and handled
   * by the client router. Set to `false` for MPA-style behavior where links
   * perform full document navigations.
   * Only meaningful in `spa` mode; ignored in `static` mode.
   * Default: `true`.
   */
  interceptLinks?: boolean;
  /**
   * Island rendered when no route matches the current URL — both on the
   * server (with a 404 status) and in the client `RouterView`.
   */
  notFound?: Island<any, any>;
  /**
   * Allow loader `redirect()` targets pointing at other origins. When `false`
   * (default), absolute cross-origin redirect targets are rejected with a 500
   * — redirect targets frequently carry user input (`?next=` params), and
   * rejecting external targets by default prevents open redirects.
   */
  allowExternalRedirects?: boolean;
  /**
   * Abort a route loader after this many milliseconds during SSR / loader
   * endpoint execution. `0`/`undefined` disables the timeout. The loader's
   * `ctx.signal` also aborts when the incoming `Request`'s signal aborts.
   */
  loaderTimeout?: number;
  /**
   * Wrap client-side view swaps in `document.startViewTransition()` when the
   * browser supports it (falls back to an instant swap otherwise).
   * Default: `false`.
   */
  viewTransitions?: boolean;
}
export interface HydratableRenderOptions extends Partial<Omit<HydratableOptions, "name">> {
  /**
   * Base `<head>` data merged before loader and render-time contributions, so
   * route-level head overrides it. Used by host entries (e.g. `IlhaHandler`)
   * to supply app-wide title/meta/scripts.
   */
  baseHead?: HeadInput;
}
export interface HydrateOptions {
  root?: Element;
  target?: string | Element;
  /**
   * When `true` (default), internal `<a>` clicks are intercepted for
   * client-side navigation. Set to `false` for MPA-style full-page navigations.
   */
  interceptLinks?: boolean;
}
export interface MountOptions {
  hydrate?: boolean;
  registry?: Record<string, Island<any, any>>;
  /**
   * When `true` (default), internal `<a>` clicks are intercepted for
   * client-side navigation. Set to `false` for MPA-style full-page navigations.
   */
  interceptLinks?: boolean;
}
/** Response envelope returned by `renderResponse` — lets the host app handle redirects. */
export type RenderResponse =
  | {
      kind: "html";
      html: string;
      status?: number;
      head?: SerializedHead;
    }
  | {
      kind: "redirect";
      to: string;
      status: number;
    }
  | {
      kind: "error";
      status: number;
      message: string;
      html: string;
      head?: SerializedHead;
    };
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
  /**
   * Attach a loader that runs **in the browser** on client navigations,
   * instead of fetching from the loader endpoint. Used by the FS-routing
   * codegen for `clientLoad` exports; also available for manual routers.
   * When a route has both, the client loader wins on client navigations and
   * the server loader runs during SSR. No-op if the pattern was never
   * registered via `.route()`.
   */
  clientLoader(pattern: string, loader: Loader<any>): RouterBuilder;
  /**
   * Attach the route's nearest `+error` boundary so **loader** errors render
   * through it (render errors are already handled by `wrapError` inside the
   * island). Used by the FS-routing codegen; also available for manual
   * routers. No-op if the pattern was never registered via `.route()`.
   */
  errorBoundary(pattern: string, handler: ErrorHandler): RouterBuilder;
  /**
   * Mark an already-registered route as having a server-side loader without
   * importing that loader into the client bundle. Used by FS-routing codegen
   * so SPA navigation knows to call the loader endpoint.
   */
  markLoader(pattern: string): RouterBuilder;
  /**
   * Return a snapshot of every registered route in match order. Useful for
   * prerenderers that need to discover the filesystem routes exposed by
   * `pageRouter` without reaching into router internals.
   */
  routes(): RouteRecord[];
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
   * Run the loader chain for a given URL without rendering. Backs the
   * `/__ilha/loader` endpoint that the host server handler (e.g. `IlhaHandler`)
   * serves as JSON for client-side navigation. Returns the raw loader result, a
   * redirect sentinel, or an error sentinel.
   */
  runLoader(
    url: string | URL,
    request?: Request,
  ): Promise<
    | {
        kind: "data";
        data: Record<string, unknown>;
        head?: SerializedHead;
      }
    | {
        kind: "redirect";
        to: string;
        status: number;
      }
    | {
        kind: "error";
        status: number;
        message: string;
      }
    | {
        kind: "not-found";
      }
  >;
  /**
   * Hydrate the application - combines prime(), mount(), and router.mount() into one call.
   * @param registry - The island registry from ilha:registry
   * @param options - Optional root element (defaults to document.body) and router target (defaults to root)
   * @returns Cleanup function
   */
  hydrate(registry: Record<string, Island<any, any>>, options?: HydrateOptions): () => void;
  /**
   * Hydrate islands on the current pre-rendered page without mounting a route
   * view or enabling client navigation. Intended for `static` mode: each page
   * is a self-contained HTML file; only interactive islands need activation.
   */
  hydrateStatic(
    registry: Record<string, Island<any, any>>,
    options?: {
      root?: Element;
    },
  ): () => void;
}
/** Path of the loader endpoint served by the Vite plugin / production adapter. */
export declare const LOADER_ENDPOINT = "/__ilha/loader";
/**
 * Prefetch loader data for a given path. Safe to call repeatedly — a single
 * inflight request is reused until it either resolves (and is consumed by
 * navigation) or is superseded by another prefetch.
 */
export declare function prefetch(pathWithSearch: string): void;
export declare function routePath(value?: string): string;
export declare function routeParams(value?: Record<string, string>): Record<string, string>;
export declare function routeSearch(value?: string): string;
export declare function routeHash(value?: string): string;
/** Reactive: `true` while a client navigation (loader fetch + view swap) is in flight. */
export declare function navigating(): boolean;
/**
 * Re-run the current route's loader and re-render the view with fresh data —
 * e.g. after a mutation. Resolves when the view has updated. No-op on the
 * server or when no router is mounted.
 */
export declare function invalidate(): Promise<void>;
export declare function useRoute(): {
  path: typeof routePath;
  params: typeof routeParams;
  search: typeof routeSearch;
  hash: typeof routeHash;
  navigating: typeof navigating;
};
/**
 * Prime route context signals from the current `location` so that islands
 * hydrated by `ilha.mount()` see the correct route values on their first
 * render — preventing a mismatch morph that would destroy hydrated bindings.
 */
export declare function prime(): void;
export interface Navigation {
  /** Logical URL (path + search + hash) being navigated away from. */
  from: string;
  /** Logical URL being navigated to. */
  to: string;
  /** `"push"`/`"replace"` for programmatic navigations, `"pop"` for history traversal. */
  type: "push" | "replace" | "pop";
}
export type BeforeNavigateHook = (
  nav: Navigation & {
    cancel(): void;
  },
) => void;
export type AfterNavigateHook = (nav: Navigation) => void;
/**
 * Run before a programmatic navigation commits. Call `nav.cancel()` to keep
 * the current URL (e.g. unsaved-changes guards). Not invoked for browser
 * back/forward — the URL has already changed by the time `popstate` fires.
 * Returns an unsubscribe function.
 */
export declare function beforeNavigate(fn: BeforeNavigateHook): () => void;
/** Run after a navigation (push, replace, or pop) has committed. Returns an unsubscribe function. */
export declare function afterNavigate(fn: AfterNavigateHook): () => void;
export declare function navigate(to: string, opts?: NavigateOptions): void;
export interface LinkInterceptionOptions {
  /**
   * Prefetch loader data on `mouseenter` for eligible links. Links opt in via
   * the `data-prefetch` attribute (set `data-prefetch="false"` to opt out a
   * specific link even when the framework is configured to prefetch by default).
   * Default: `true` — prefetches on hover for any link with `data-prefetch`.
   */
  prefetch?: boolean;
}
export declare function enableLinkInterception(
  root?: Element | Document,
  options?: LinkInterceptionOptions,
): () => void;
export declare const RouterView: Island<
  {
    [x: string]: unknown;
  },
  {}
>;
export declare const RouterLink: Island<
  {
    [x: string]: unknown;
  },
  Omit<Omit<{}, "href"> & Record<"href", string>, "label"> & Record<"label", string>
>;
export interface IsActiveOptions {
  /**
   * When `false`, `isActive("/docs")` also matches nested paths like
   * `/docs/getting-started` (prefix match on the current path).
   * Default: `true` (the matched route's pattern must equal `pattern`).
   */
  exact?: boolean;
}
export declare function isActive(pattern: string, options?: IsActiveOptions): boolean;
/**
 * Contribute `<head>` data from inside an island's `.render()` body or a
 * layout. During SSR this collects into the active render window; on the
 * client, entries are collected when the router re-renders a route inside
 * `withHeadStore` and then applied to `document`. Prefer a loader's `ctx.head`
 * for data that depends on the request.
 */
export declare function head(input: HeadInput): void;
/**
 * Merge head entries in contribution order (loader first as the base, then
 * render-time outer→inner layouts, then the page) and serialize. Later entries
 * win on collision; the last `titleTemplate` wraps the resolved title.
 */
export declare function serializeHead(entries: HeadInput[]): SerializedHead;
export declare function router(options?: RouterOptions): RouterBuilder;
declare const _default: {
  router: typeof router;
  navigate: typeof navigate;
  useRoute: typeof useRoute;
  isActive: typeof isActive;
  enableLinkInterception: typeof enableLinkInterception;
  prime: typeof prime;
  prefetch: typeof prefetch;
  beforeNavigate: typeof beforeNavigate;
  afterNavigate: typeof afterNavigate;
  RouterView: Island<
    {
      [x: string]: unknown;
    },
    {}
  >;
  RouterLink: Island<
    {
      [x: string]: unknown;
    },
    Omit<Omit<{}, "href"> & Record<"href", string>, "label"> & Record<"label", string>
  >;
  loader: typeof loader;
  redirect: typeof redirect;
  error: typeof error;
  composeLoaders: typeof composeLoaders;
  head: typeof head;
};
export default _default;
