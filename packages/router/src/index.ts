import { ErrorBoundary, atom, h, mount, renderToString } from "ilha";
import type { Component, View } from "ilha";

import { REQUEST_ALS_KEY } from "./als-key";
import { getAdapter, getHistoryMode } from "./hash";
import {
  applyHeadEntriesToDocument,
  openBrowserHead,
  serializeHead,
  withHeadStore,
} from "./head";
import type { HeadInput, SerializedHead } from "./head";
import { httpResponse, EMPTY_HEAD } from "./http";
import type { HttpResponseOptions } from "./http";
import { RouteError } from "./route-error";
import { matchSegments, parsePattern, safeDecode } from "./route-match";

export { setHistoryMode, getHistoryMode } from "./hash";
export type { HistoryMode } from "./hash";
export { head, serializeHead } from "./head";
export type { HeadInput, SerializedHead } from "./head";
export { httpResponse, EMPTY_HEAD } from "./http";
export type { HttpResponseOptions } from "./http";
export { RouteError } from "./route-error";

const objectTag = <T>(value: T): string =>
  Object.prototype.toString.call(value);

type AnyFn = (...args: never[]) => void;

const isString = <T>(value: T): value is Extract<T, string> =>
  objectTag(value) === "[object String]";

const isNumber = <T>(value: T): value is Extract<T, number> =>
  objectTag(value) === "[object Number]";

const isFunction = <T>(value: T): value is Extract<T, AnyFn> => {
  const tag = objectTag(value);
  return (
    tag === "[object Function]" ||
    tag === "[object AsyncFunction]" ||
    tag === "[object GeneratorFunction]"
  );
};

const isObject = <T>(value: T): value is Extract<T, object> =>
  value !== null && objectTag(value) === "[object Object]";

const isBrowser =
  globalThis.window !== undefined && globalThis.document !== undefined;

const noop = (): undefined => undefined;

export type Page = Component;

export interface RouteRecord {
  pattern: string;
  page: Page;
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

export interface IslandContext {
  request?: Request;
}

export type LayoutProps = {
  children?: View;
} & SnapshotPropBag;

export interface SnapshotPropBag {
  readonly [key: string]: SnapshotPropValue | undefined;
}

export type SnapshotPropValue =
  | string
  | number
  | boolean
  | null
  | View
  | SnapshotPropValue[]
  | SnapshotPropBag;

export type LayoutHandler = (props: LayoutProps) => View | Promise<View>;
export type ErrorHandler = (
  error: AppError,
  route: RouteSnapshot
) => Page | View;

export class Redirect {
  readonly __ilhaRedirect = true as const;
  readonly to: string;
  readonly status: number;
  constructor(to: string, status = 302) {
    this.to = to;
    this.status = status >= 300 && status <= 399 ? status : 302;
  }
}

export const redirect = (to: string, status = 302): never => {
  throw new Redirect(to, status);
};

const throwAppError = (status: number, message: string): never => {
  throw new RouteError(status, message);
};
export { throwAppError as error };

export const defineLayout = (layout: LayoutHandler): LayoutHandler => layout;

export interface NavigateOptions {
  replace?: boolean;
  scroll?: boolean;
}

export type RouterMode = "spa" | "static";

export interface RouterOptions {
  mode?: RouterMode;
  interceptLinks?: boolean;
  allowExternalRedirects?: boolean;
  viewTransitions?: boolean;
  notFound?: Page;
}

export interface MountOptions {
  hydrate?: boolean;
  interceptLinks?: boolean;
}

export type RenderResponse =
  | { kind: "html"; html: string; status?: number; head?: SerializedHead }
  | { kind: "redirect"; to: string; status: number }
  | {
      kind: "error";
      status: number;
      message: string;
      html: string;
      head?: SerializedHead;
    };

export interface RespondOptions extends HttpResponseOptions {
  timeout?: number;
  snapshot?: boolean;
  markers?: boolean;
  shell?: (head: SerializedHead, html: string) => string;
}

export interface RenderPageOptions {
  timeout?: number;
  snapshot?: boolean;
  markers?: boolean;
}

export interface RouterBuilder {
  route: (
    pattern: string,
    page: Page,
    opts?: { layouts?: LayoutHandler[] }
  ) => RouterBuilder;
  errorBoundary: (pattern: string, handler: ErrorHandler) => RouterBuilder;
  routes: () => RouteRecord[];
  prime: () => void;
  mount: (target: string | Element, options?: MountOptions) => () => void;
  render: (
    url: string | URL | Request,
    options?: RenderPageOptions
  ) => Promise<string>;
  renderResponse: (
    url: string | URL | Request,
    options?: RenderPageOptions
  ) => Promise<RenderResponse>;
  respond: (
    url: string | URL | Request,
    options?: RespondOptions
  ) => Promise<Response>;
  hydrate: (options?: {
    root?: Element;
    interceptLinks?: boolean;
  }) => () => void;
}

export interface Navigation {
  from: string;
  to: string;
  type: "push" | "replace" | "pop";
  cancel?: () => void;
}

type BeforeNavigateHook = (nav: Navigation & { cancel: () => void }) => void;
type AfterNavigateHook = (nav: Navigation) => void;

interface RouteData {
  page: Page;
  pattern: string;
  layouts: LayoutHandler[];
  errorHandler?: ErrorHandler;
}

interface RouteEntry {
  pattern: string;
  parsed: ReturnType<typeof parsePattern>;
  data: RouteData;
}

type RouteRegistry = RouteEntry[];

const createRouteRegistry = (): RouteRegistry => [];

const addRouteEntry = (
  registry: RouteRegistry,
  pattern: string,
  data: RouteData
): void => {
  registry.push({ data, parsed: parsePattern(pattern), pattern });
};

const matchRoute = (
  registry: RouteRegistry,
  pathname: string
): RouteEntry | null => {
  let best: RouteEntry | null = null;
  let bestScore = -1;
  for (const entry of registry) {
    if (matchSegments(entry.parsed.segments, pathname) === null) {
      continue;
    }
    const score = entry.parsed.kinds.reduce((s, k) => s + k, 0);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
};

const extractParams = (match: RouteEntry | null, pathname: string) => {
  if (!match) {
    return {};
  }
  const raw = matchSegments(match.parsed.segments, pathname) ?? {};
  // SAFETY: decoded route params are always string→string.
  const out = {} as Record<string, string>;
  for (const [k, v] of Object.entries(raw)) {
    out[k] = safeDecode(v);
  }
  return out;
};

let _routes: RouteRegistry = [];
let _notFound: Page | null = null;
let _allowExternalRedirects = false;
let _viewTransitions = false;
let _path = "/";
let _params: Record<string, string> = {};
let _search = "";
let _hash = "";
const _navigating = false;
let _navKeyCounter = 0;
let _lastNavKey = 0;
const _scrollPositions = new Map<number, { x: number; y: number }>();
const _beforeNavigateHooks: BeforeNavigateHook[] = [];
const _afterNavigateHooks: AfterNavigateHook[] = [];

const snapshot = (): RouteSnapshot => ({
  hash: _hash,
  params: _params,
  path: _path,
  search: _search,
});

export const wrapLayout = (layout: LayoutHandler, page: Page): Page => {
  const Wrapped = () =>
    // SAFETY: layout/page are Components; h() accepts the island call surface.
    h(layout as never, null, h(page as never, null));
  return Wrapped;
};

export const wrapError = (handler: ErrorHandler, page: Page): Page => {
  const Wrapped = async () => {
    try {
      const out = page();
      return out instanceof Promise ? await out : out;
    } catch (error) {
      const err: AppError =
        error instanceof RouteError
          ? { message: error.message, status: error.status }
          : {
              message: error instanceof Error ? error.message : String(error),
            };
      const view = handler(err, snapshot());
      // SAFETY: ErrorHandler may return a Page component or a View.
      return isFunction(view) ? (view as Page)() : view;
    }
  };
  return Wrapped;
};

export const routePath = (): string => _path;
export const routeParams = (): Record<string, string> => _params;
export const routeSearch = (): string => _search;
export const routeHash = (): string => _hash;
export const navigating = (): boolean => _navigating;

export const useRoute = () => ({
  hash: routeHash,
  navigating,
  params: routeParams,
  path: routePath,
  search: routeSearch,
});

type RequestAlsHost = Record<
  symbol,
  { getStore?: () => Request | undefined } | undefined
>;

export const useContext = () => {
  // SAFETY: REQUEST_ALS_KEY is the request-scope AsyncLocalStorage installed
  // by request-scope.ts; absence is normal { request: undefined }.
  const als = (globalThis as RequestAlsHost)[REQUEST_ALS_KEY];
  return { request: als?.getStore?.() };
};

const syncFromParts = (
  pathname: string,
  search: string,
  hash: string,
  routes = _routes
): void => {
  _path = pathname || "/";
  _search = search;
  _hash = hash;
  const match = matchRoute(routes, _path);
  _params = extractParams(match, _path);
};

const syncRouteFromLocation = (): void => {
  const loc = getAdapter().readLocation();
  syncFromParts(loc.pathname, loc.search, loc.hash);
};

export const prime = (): void => {
  if (isBrowser) {
    syncRouteFromLocation();
  }
};

export const beforeNavigate = (fn: BeforeNavigateHook): (() => void) => {
  _beforeNavigateHooks.push(fn);
  return () => {
    const i = _beforeNavigateHooks.indexOf(fn);
    if (i !== -1) {
      _beforeNavigateHooks.splice(i, 1);
    }
  };
};

export const afterNavigate = (fn: AfterNavigateHook): (() => void) => {
  _afterNavigateHooks.push(fn);
  return () => {
    const i = _afterNavigateHooks.indexOf(fn);
    if (i !== -1) {
      _afterNavigateHooks.splice(i, 1);
    }
  };
};

const runAfterNavigateHooks = (nav: Navigation): void => {
  for (const fn of _afterNavigateHooks) {
    try {
      fn(nav);
    } catch (error) {
      console.error("[ilha-router] afterNavigate hook threw:", error);
    }
  }
};

interface NavKeyState {
  __ilhaNavKey?: number;
}

const currentNavKey = (): number => {
  const { state } = isBrowser ? history : { state: null };
  if (!state || !isObject(state)) {
    return 0;
  }
  // SAFETY: history.state may carry our __ilhaNavKey stamp.
  const { __ilhaNavKey: key } = state as NavKeyState;
  return isNumber(key) ? key : 0;
};

const saveScrollPosition = (): void => {
  if (!isBrowser) {
    return;
  }
  _scrollPositions.set(_lastNavKey, { x: window.scrollX, y: window.scrollY });
};

const scrollAfterNavigate = (hash: string): void => {
  if (!isBrowser) {
    return;
  }
  if (hash && hash.length > 1) {
    const id = hash.slice(1);
    const el = document.querySelector(`[id=${JSON.stringify(id)}]`);
    if (el) {
      el.scrollIntoView();
      return;
    }
  }
  window.scrollTo(0, 0);
};

const restoreScrollPosition = (): void => {
  const pos = _scrollPositions.get(currentNavKey());
  if (!pos) {
    return;
  }
  requestAnimationFrame(() => window.scrollTo(pos.x, pos.y));
};

export const navigate = (to: string, opts: NavigateOptions = {}): void => {
  if (!isBrowser) {
    return;
  }
  const adapter = getAdapter();
  const cur = adapter.readLocation();
  const current = cur.pathname + cur.search + cur.hash;
  if (to === current) {
    return;
  }
  const type: Navigation["type"] = opts.replace ? "replace" : "push";
  const cancelState = { cancelled: false };
  const cancelNav = () => {
    cancelState.cancelled = true;
  };
  for (const fn of _beforeNavigateHooks) {
    try {
      fn({ cancel: cancelNav, from: current, to, type });
    } catch (error) {
      console.error("[ilha-router] beforeNavigate hook threw:", error);
    }
  }
  if (cancelState.cancelled) {
    return;
  }
  if (opts.replace) {
    adapter.replace(to, { __ilhaNavKey: currentNavKey() });
  } else {
    saveScrollPosition();
    _navKeyCounter = Math.max(_navKeyCounter + 1, currentNavKey() + 1);
    adapter.push(to, { __ilhaNavKey: _navKeyCounter });
  }
  _lastNavKey = currentNavKey();
  const prevPath = cur.pathname;
  syncRouteFromLocation();
  if (opts.scroll !== false) {
    const dest = adapter.readLocation();
    const fromMatch = matchRoute(_routes, prevPath);
    const destMatch = matchRoute(_routes, dest.pathname);
    const same =
      fromMatch?.data.page !== null &&
      fromMatch?.data.page !== undefined &&
      destMatch?.data.page === fromMatch.data.page;
    if (!same || (dest.hash && dest.hash !== "#")) {
      scrollAfterNavigate(dest.hash);
    }
  }
  runAfterNavigateHooks({ from: current, to, type });
};

export interface SearchParamOptions<T> {
  /** Value when the param is absent. Writing it removes the param. */
  default: T;
  /** Decode the raw param. Default: the raw string. */
  parse?: (raw: string) => T;
  /** Encode a value for the URL. Default: `String(value)`. */
  serialize?: (value: T) => string;
}

export interface SearchParam<T> {
  (): T;
  set: (next: T) => void;
  update: (f: (current: T) => T) => void;
}

export interface SearchParamFn {
  /** String param: `parse` is optional. */
  (name: string, opts: SearchParamOptions<string>): SearchParam<string>;
  /** Non-string param: `parse` is required to decode the raw string. */
  <T>(
    name: string,
    opts: SearchParamOptions<T> & { parse: (raw: string) => T }
  ): SearchParam<T>;
}

/**
 * Read and write one query param through the router. Writes `replace` the
 * history entry without scrolling, so the mounted router re-renders the
 * current route in place instead of remounting it.
 */
export const searchParam: SearchParamFn = <T>(
  name: string,
  opts: SearchParamOptions<T>
): SearchParam<T> => {
  const serialize = opts.serialize ?? String;
  const read = (): T => {
    const raw = new URLSearchParams(_search).get(name);
    if (raw === null) {
      return opts.default;
    }
    // SAFETY: SearchParamFn requires parse unless T is string, so identity is exact.
    return opts.parse ? opts.parse(raw) : (raw as T);
  };
  const set = (next: T): void => {
    const params = new URLSearchParams(_search);
    const encoded = serialize(next);
    if (encoded === serialize(opts.default)) {
      params.delete(name);
    } else {
      params.set(name, encoded);
    }
    const qs = params.toString();
    navigate(`${_path}${qs ? `?${qs}` : ""}${_hash}`, {
      replace: true,
      scroll: false,
    });
  };
  return Object.assign(read, {
    set,
    update: (f: (current: T) => T) => {
      set(f(read()));
    },
  });
};

export type LinkInterceptionOptions = Record<string, never>;

const NON_NAV_SCHEME = /^(?:mailto|tel|javascript):/iu;

const resolveClickTarget = (_href: string, url: URL): string => {
  if (getHistoryMode() === "hash") {
    if (url.hash.startsWith("#/")) {
      return url.hash.slice(1);
    }
    return url.pathname + url.search;
  }
  return url.pathname + url.search + url.hash;
};

export const enableLinkInterception = (
  root: Element | Document = document,
  _options: LinkInterceptionOptions = {}
): (() => void) => {
  if (!isBrowser) {
    return noop;
  }
  const clickHandler = (event: Event) => {
    // SAFETY: click listeners receive MouseEvent.
    const mouseEvent = event as MouseEvent;
    if (
      mouseEvent.defaultPrevented ||
      mouseEvent.button !== 0 ||
      mouseEvent.metaKey ||
      mouseEvent.ctrlKey ||
      mouseEvent.shiftKey ||
      mouseEvent.altKey
    ) {
      return;
    }
    const { target } = mouseEvent;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest("a");
    if (
      !anchor ||
      anchor.hasAttribute("download") ||
      anchor.getAttribute("target") === "_blank" ||
      anchor.matches("[data-no-intercept]")
    ) {
      return;
    }
    const href = anchor.getAttribute("href");
    if (!href || NON_NAV_SCHEME.test(href)) {
      return;
    }
    if (href.startsWith("#") && getHistoryMode() !== "hash") {
      return;
    }
    if (href.startsWith("#") && !href.startsWith("#/")) {
      return;
    }
    let url: URL;
    try {
      url = new URL(href, location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) {
      return;
    }
    mouseEvent.preventDefault();
    navigate(resolveClickTarget(href, url));
  };
  root.addEventListener("click", clickHandler);
  return () => root.removeEventListener("click", clickHandler);
};

export interface IsActiveOptions {
  end?: boolean;
}

export const isActive = (
  pattern: string,
  options: IsActiveOptions = {}
): boolean => {
  if (options.end) {
    return _path === pattern;
  }
  if (pattern === "/") {
    return _path === "/";
  }
  return (
    _path === pattern ||
    _path.startsWith(pattern.endsWith("/") ? pattern : `${pattern}/`)
  );
};

export const resolveRedirectTarget = (
  to: string,
  base: URL,
  allowExternal: boolean
): { ok: true; to: string } | { ok: false } => {
  // Reject control characters and backslashes in redirect targets.
  for (const ch of to) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x5c) {
      return { ok: false };
    }
  }
  try {
    const u = new URL(to, base);
    if (!/^https?:$/u.test(u.protocol)) {
      return { ok: false };
    }
    if (u.origin === base.origin) {
      return { ok: true, to: u.pathname + u.search + u.hash };
    }
    return allowExternal ? { ok: true, to: u.href } : { ok: false };
  } catch {
    return { ok: false };
  }
};

const resolveRequestUrl = (urlOrRequest: string | URL | Request): URL => {
  try {
    if (urlOrRequest instanceof Request) {
      return new URL(urlOrRequest.url);
    }
    if (isString(urlOrRequest)) {
      return new URL(urlOrRequest, "http://localhost");
    }
    return urlOrRequest;
  } catch {
    return new URL("http://localhost/");
  }
};

const composedPageForPath = (
  pathname: string,
  routes: RouteRegistry,
  notFound: Page | null
): Page | null => {
  const match = matchRoute(routes, pathname);
  if (!match) {
    return notFound;
  }
  // Layouts compose here; error boundaries stay in renderResponse's RouteError
  // branch so thrown statuses keep their kind/status mapping.
  const { layouts } = match.data;
  let { page } = match.data;
  for (let j = layouts.length - 1; j >= 0; j -= 1) {
    const layout = layouts[j];
    if (layout) {
      page = wrapLayout(layout, page);
    }
  }
  return page;
};

const renderPage = (page: Page, opts?: RenderPageOptions): Promise<string> =>
  renderToString(page, opts);

const buildRespondBody = (
  result: Exclude<RenderResponse, { kind: "redirect" }>,
  respondOpts: RespondOptions,
  head: SerializedHead
): string => {
  const { html } = result;
  if (respondOpts.shell) {
    return respondOpts.shell(head, html);
  }
  return html;
};

export const router = (options: RouterOptions = {}): RouterBuilder => {
  const mode = options.mode ?? "spa";
  const defaultInterceptLinks = options.interceptLinks !== false;
  const allowExternalRedirects = options.allowExternalRedirects === true;
  const records: RouteRecord[] = [];
  const routes = createRouteRegistry();
  const patternToData = new Map<string, RouteData>();
  const notFound = options.notFound ?? null;

  _routes = routes;
  _notFound = notFound;
  _allowExternalRedirects = allowExternalRedirects;
  _viewTransitions = options.viewTransitions === true;

  let navChangeCleanup: (() => void) | null = null;
  let linkCleanup: (() => void) | null = null;

  const builder: RouterBuilder = {
    errorBoundary(pattern: string, handler: ErrorHandler): RouterBuilder {
      const data = patternToData.get(pattern);
      if (!data) {
        console.warn(
          `[ilha-router] errorBoundary("${pattern}"): pattern was never registered via .route().`
        );
        return builder;
      }
      data.errorHandler = handler;
      return builder;
    },

    hydrate(hydrateOpts = {}) {
      const root = hydrateOpts.root ?? (isBrowser ? document.body : null);
      if (!root) {
        return noop;
      }
      return builder.mount(root, {
        hydrate: true,
        interceptLinks: hydrateOpts.interceptLinks,
      });
    },

    mount(
      target,
      {
        hydrate = false,
        interceptLinks: mountInterceptLinks,
      }: MountOptions = {}
    ) {
      if (!isBrowser) {
        console.warn(
          "[ilha-router] mount() called in a non-browser environment"
        );
        return noop;
      }
      const host = isString(target) ? document.querySelector(target) : target;
      if (!host) {
        console.warn(`[ilha-router] No element found for selector "${target}"`);
        return noop;
      }
      if (mode === "static") {
        console.warn("[ilha-router] router.mount() is a no-op in static mode.");
        return noop;
      }
      syncRouteFromLocation();
      _lastNavKey = currentNavKey();
      if (hydrate && getHistoryMode() === "hash") {
        console.warn(
          "[ilha-router] mount({ hydrate: true }) was called in hash mode. " +
            "The server never sees the hash, so SSR HTML is for '/'."
        );
      }
      let mounted = true;
      const prevScroll =
        "scrollRestoration" in history ? history.scrollRestoration : null;
      if (prevScroll !== null) {
        history.scrollRestoration = "manual";
      }

      let unmountShell: (() => void) | null = null;
      let headSession: ReturnType<typeof openBrowserHead> | null = null;
      let bumpShell: (() => void) | null = null;
      // Persistent shell: one mount for the router lifetime. Navigations bump
      // a tick atom so the shell re-renders instead of remounting — matching
      // layout components keep their state and DOM. Route state itself stays
      // in module vars (atom handles are fiber-bound, so they cannot be shared
      // across islands); the tick subscription is what makes renders reactive.
      const Shell = () => {
        const tick = atom(0);
        bumpShell = () => {
          tick.update((t: number) => t + 1);
        };
        tick();
        const match = matchRoute(routes, _path);
        if (!match) {
          // SAFETY: notFound is a Page component; h accepts the island call surface.
          return notFound ? h(notFound as never, null) : "";
        }
        const { errorHandler, layouts, page } = match.data;
        // SAFETY: route pages are Components; h accepts the island call surface.
        let view: View = h(page as never, null);
        for (let j = layouts.length - 1; j >= 0; j -= 1) {
          const layout = layouts[j];
          if (layout) {
            // SAFETY: layouts are Components; h accepts the island call surface.
            view = h(layout as never, null, view);
          }
        }
        if (errorHandler) {
          const onBoundary = errorHandler;
          view = h(
            // SAFETY: ErrorBoundary is a Component; h accepts the island call surface.
            ErrorBoundary as never,
            // SAFETY: fallback is an ErrorBoundary prop, not a DOM event handler.
            {
              fallback: ({ error }: { error: Error }) =>
                onBoundary({ message: error.message }, snapshot()),
            } as never,
            view
          );
        }
        return view;
      };
      const mountShell = () => {
        headSession?.close();
        const session = openBrowserHead();
        headSession = session;
        unmountShell = mount(host, Shell, { hydrate });
        // Nested layout/page fibers may call head() after mount() returns.
        queueMicrotask(() => {
          session.flush();
        });
      };
      const refresh = () => {
        if (bumpShell) {
          // Fresh head window per navigation: reused layouts and the page
          // re-run head() on this render, so the previous route's entries
          // must not linger.
          headSession?.close();
          const session = openBrowserHead();
          headSession = session;
          bumpShell();
          queueMicrotask(() => {
            session.flush();
          });
          return;
        }
        mountShell();
      };

      const popHandler = () => {
        if (!mounted) {
          return;
        }
        const prevPath = _path + _search + _hash;
        _scrollPositions.set(_lastNavKey, {
          x: window.scrollX,
          y: window.scrollY,
        });
        _lastNavKey = currentNavKey();
        syncRouteFromLocation();
        restoreScrollPosition();
        runAfterNavigateHooks({
          from: prevPath,
          to: _path + _search + _hash,
          type: "pop",
        });
        refresh();
      };
      navChangeCleanup = getAdapter().onChange(popHandler);
      linkCleanup =
        (mountInterceptLinks ?? defaultInterceptLinks)
          ? enableLinkInterception(document)
          : null;

      mountShell();

      const offNav = afterNavigate(() => {
        if (mounted) {
          refresh();
        }
      });

      return () => {
        mounted = false;
        offNav();
        bumpShell = null;
        unmountShell?.();
        unmountShell = null;
        headSession?.close();
        headSession = null;
        navChangeCleanup?.();
        linkCleanup?.();
        if (prevScroll !== null) {
          history.scrollRestoration = prevScroll;
        }
      };
    },

    prime,

    async render(url, renderOpts) {
      const result = await builder.renderResponse(url, renderOpts);
      if (result.kind === "html") {
        return result.html;
      }
      if (result.kind === "redirect") {
        return "";
      }
      return result.html;
    },

    async renderResponse(url, renderOpts) {
      const parsed = resolveRequestUrl(url);
      syncFromParts(parsed.pathname, parsed.search, parsed.hash, routes);
      // SAFETY: head store starts empty; entries are HeadInput contributions.
      const store = { entries: [] as HeadInput[] };
      try {
        const page = composedPageForPath(parsed.pathname, routes, notFound);
        if (!page) {
          throw new RouteError(404, "Not found");
        }
        let captured: unknown;
        const wrapped: Page = async () => {
          try {
            return await Promise.resolve(page());
          } catch (error) {
            captured = error;
            throw error;
          }
        };
        const html = await withHeadStore(store, () =>
          renderPage(wrapped, renderOpts)
        );
        if (captured instanceof Redirect || captured instanceof RouteError) {
          throw captured;
        }
        return {
          head: serializeHead(store.entries),
          html,
          kind: "html" as const,
          status: 200,
        };
      } catch (error) {
        if (error instanceof Redirect) {
          const safe = resolveRedirectTarget(
            error.to,
            parsed,
            allowExternalRedirects
          );
          if (!safe.ok) {
            return {
              head: EMPTY_HEAD,
              html: "",
              kind: "error" as const,
              message: "unsafe redirect target",
              status: 500,
            };
          }
          return {
            kind: "redirect" as const,
            status: error.status,
            to: safe.to,
          };
        }
        if (error instanceof RouteError) {
          const match = matchRoute(routes, parsed.pathname);
          const boundary = match?.data.errorHandler;
          let html = "";
          if (boundary) {
            const view = boundary(
              { message: error.message, status: error.status },
              snapshot()
            );
            // SAFETY: ErrorHandler may return a Page component or a View.
            html = await renderPage(
              isFunction(view) ? (view as Page) : () => view,
              renderOpts
            );
          }
          return {
            head: serializeHead(store.entries),
            html,
            kind: "error" as const,
            message: error.message,
            status: error.status,
          };
        }
        throw error;
      }
    },

    async respond(url, respondOpts = {}) {
      const result = await builder.renderResponse(url, respondOpts);
      if (result.kind === "redirect") {
        return Response.redirect(result.to, result.status);
      }
      const head = result.head ?? EMPTY_HEAD;
      if (isBrowser && result.kind === "html") {
        applyHeadEntriesToDocument([]);
      }
      const body = buildRespondBody(result, respondOpts, head);
      return httpResponse(body, {
        contentSecurityPolicy: respondOpts.contentSecurityPolicy,
        cspNonce: respondOpts.cspNonce,
        headers: respondOpts.headers,
        status:
          result.kind === "error" ? result.status : (result.status ?? 200),
      });
    },

    route(
      pattern: string,
      page: Page,
      opts: { layouts?: LayoutHandler[] } = {}
    ): RouterBuilder {
      const data: RouteData = {
        layouts: opts.layouts ?? [],
        page,
        pattern,
      };
      records.push({ page, pattern });
      addRouteEntry(routes, pattern, data);
      patternToData.set(pattern, data);
      return builder;
    },

    routes(): RouteRecord[] {
      return records.map((r) => ({ ...r }));
    },
  };

  return builder;
};

void _viewTransitions;
void _allowExternalRedirects;
void _notFound;
