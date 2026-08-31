import { h, mount, renderToString } from "ilha";
import type { Component, View } from "ilha";

import { REQUEST_ALS_KEY } from "./als-key";
import { getAdapter, getHistoryMode } from "./hash";
import {
  applyHeadEntriesToDocument,
  serializeHead,
  withHeadStore,
  type HeadInput,
  type SerializedHead,
} from "./head";
import { httpResponse, EMPTY_HEAD, type HttpResponseOptions } from "./http";
import { matchSegments, parsePattern, safeDecode } from "./route-match";

export { setHistoryMode, getHistoryMode } from "./hash";
export type { HistoryMode } from "./hash";
export { head, serializeHead } from "./head";
export type { HeadInput, SerializedHead } from "./head";
export { httpResponse, EMPTY_HEAD } from "./http";
export type { HttpResponseOptions } from "./http";

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

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

export type LayoutHandler = (props: { children?: View } & Record<string, unknown>) => unknown;
export type ErrorHandler = (error: AppError, route: RouteSnapshot) => Page | View;

export class Redirect {
  readonly __ilhaRedirect = true as const;
  readonly to: string;
  readonly status: number;
  constructor(to: string, status = 302) {
    this.to = to;
    this.status = status >= 300 && status <= 399 ? status : 302;
  }
}

export class RouteError {
  readonly __ilhaRouteError = true as const;
  readonly status: number;
  readonly message: string;
  constructor(status: number, message: string) {
    this.message = message;
    this.status = status >= 400 && status <= 599 ? status : 500;
  }
}

export function redirect(to: string, status = 302): never {
  throw new Redirect(to, status);
}

export function error(status: number, message: string): never {
  throw new RouteError(status, message);
}

export function wrapLayout(layout: LayoutHandler, page: Page): Page {
  return function Wrapped() {
    return h(layout as never, null, h(page as never, null));
  };
}

export function wrapError(handler: ErrorHandler, page: Page): Page {
  return async function Wrapped() {
    try {
      const out = page();
      return out instanceof Promise ? await out : out;
    } catch (e) {
      const err: AppError =
        e instanceof RouteError
          ? { message: e.message, status: e.status }
          : { message: e instanceof Error ? e.message : String(e) };
      const view = handler(err, snapshot());
      return typeof view === "function" ? (view as Page)() : view;
    }
  };
}

export function defineLayout(layout: LayoutHandler): LayoutHandler {
  return layout;
}

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

export interface RouterBuilder {
  route(pattern: string, page: Page): RouterBuilder;
  errorBoundary(pattern: string, handler: ErrorHandler): RouterBuilder;
  routes(): RouteRecord[];
  prime(): void;
  mount(target: string | Element, options?: MountOptions): () => void;
  render(
    url: string | URL | Request,
    options?: { timeout?: number; snapshot?: boolean; markers?: boolean },
  ): Promise<string>;
  renderResponse(
    url: string | URL | Request,
    options?: { timeout?: number; snapshot?: boolean; markers?: boolean },
  ): Promise<RenderResponse>;
  respond(url: string | URL | Request, options?: RespondOptions): Promise<Response>;
  hydrate(options?: { root?: Element; interceptLinks?: boolean }): () => void;
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
  errorHandler?: ErrorHandler;
}

interface RouteEntry {
  pattern: string;
  parsed: ReturnType<typeof parsePattern>;
  data: RouteData;
}

type RouteRegistry = RouteEntry[];

function createRouteRegistry(): RouteRegistry {
  return [];
}

function addRouteEntry(registry: RouteRegistry, pattern: string, data: RouteData): void {
  registry.push({ pattern, parsed: parsePattern(pattern), data });
}

function matchRoute(registry: RouteRegistry, pathname: string): RouteEntry | null {
  let best: RouteEntry | null = null;
  let bestScore = -1;
  for (const entry of registry) {
    if (matchSegments(entry.parsed.segments, pathname) == null) continue;
    const score = entry.parsed.kinds.reduce((s, k) => s + k, 0);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

function extractParams(match: RouteEntry | null, pathname: string): Record<string, string> {
  if (!match) return {};
  const raw = matchSegments(match.parsed.segments, pathname) ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = safeDecode(v);
  return out;
}

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

function snapshot(): RouteSnapshot {
  return { path: _path, params: _params, search: _search, hash: _hash };
}

export function routePath(): string {
  return _path;
}
export function routeParams(): Record<string, string> {
  return _params;
}
export function routeSearch(): string {
  return _search;
}
export function routeHash(): string {
  return _hash;
}
export function navigating(): boolean {
  return _navigating;
}

export function useRoute() {
  return {
    path: routePath,
    params: routeParams,
    search: routeSearch,
    hash: routeHash,
    navigating,
  };
}

export function useContext() {
  // SAFETY: REQUEST_ALS_KEY is the request-scope AsyncLocalStorage installed
  // by request-scope.ts; absence is normal { request: undefined }.
  const als = (
    globalThis as unknown as Record<symbol, { getStore?: () => Request | undefined } | undefined>
  )[REQUEST_ALS_KEY];
  return { request: als?.getStore?.() };
}

function syncFromParts(pathname: string, search: string, hash: string, routes = _routes): void {
  _path = pathname || "/";
  _search = search;
  _hash = hash;
  const match = matchRoute(routes, _path);
  _params = extractParams(match, _path);
}

function syncRouteFromLocation(): void {
  const loc = getAdapter().readLocation();
  syncFromParts(loc.pathname, loc.search, loc.hash);
}

export function prime(): void {
  if (isBrowser) syncRouteFromLocation();
}

export function beforeNavigate(fn: BeforeNavigateHook): () => void {
  _beforeNavigateHooks.push(fn);
  return () => {
    const i = _beforeNavigateHooks.indexOf(fn);
    if (i >= 0) _beforeNavigateHooks.splice(i, 1);
  };
}

export function afterNavigate(fn: AfterNavigateHook): () => void {
  _afterNavigateHooks.push(fn);
  return () => {
    const i = _afterNavigateHooks.indexOf(fn);
    if (i >= 0) _afterNavigateHooks.splice(i, 1);
  };
}

function runAfterNavigateHooks(nav: Navigation): void {
  for (const fn of _afterNavigateHooks) {
    try {
      fn(nav);
    } catch (e) {
      console.error("[ilha-router] afterNavigate hook threw:", e);
    }
  }
}

function currentNavKey(): number {
  const state = isBrowser ? history.state : null;
  const key =
    state && typeof state === "object"
      ? (state as { __ilhaNavKey?: number }).__ilhaNavKey
      : undefined;
  return typeof key === "number" ? key : 0;
}

function saveScrollPosition(): void {
  if (!isBrowser) return;
  _scrollPositions.set(_lastNavKey, { x: window.scrollX, y: window.scrollY });
}

function scrollAfterNavigate(hash: string): void {
  if (!isBrowser) return;
  if (hash && hash.length > 1) {
    const id = hash.slice(1);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView();
      return;
    }
  }
  window.scrollTo(0, 0);
}

function restoreScrollPosition(): void {
  const pos = _scrollPositions.get(currentNavKey());
  if (!pos) return;
  requestAnimationFrame(() => window.scrollTo(pos.x, pos.y));
}

export function navigate(to: string, opts: NavigateOptions = {}): void {
  if (!isBrowser) return;
  const adapter = getAdapter();
  const cur = adapter.readLocation();
  const current = cur.pathname + cur.search + cur.hash;
  if (to === current) return;
  const type: Navigation["type"] = opts.replace ? "replace" : "push";
  let cancelled = false;
  for (const fn of _beforeNavigateHooks) {
    try {
      fn({ from: current, to, type, cancel: () => (cancelled = true) });
    } catch (e) {
      console.error("[ilha-router] beforeNavigate hook threw:", e);
    }
  }
  if (cancelled) return;
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
    const same = fromMatch?.data.page != null && destMatch?.data.page === fromMatch.data.page;
    if (!same || (dest.hash && dest.hash !== "#")) scrollAfterNavigate(dest.hash);
  }
  runAfterNavigateHooks({ from: current, to, type });
}

export interface LinkInterceptionOptions {
  /** @deprecated prefetch was loader-only */
  prefetch?: boolean;
}

export function enableLinkInterception(
  root: Element | Document = document,
  _options: LinkInterceptionOptions = {},
): () => void {
  if (!isBrowser) return () => {};
  const clickHandler = (event: Event) => {
    const e = event as MouseEvent;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const a = (e.target as Element | null)?.closest?.("a");
    if (
      !a ||
      a.hasAttribute("download") ||
      a.getAttribute("target") === "_blank" ||
      a.hasAttribute("data-no-intercept")
    )
      return;
    const href = a.getAttribute("href");
    if (!href || /^(mailto|tel|javascript):/i.test(href)) return;
    if (href.startsWith("#") && getHistoryMode() !== "hash") return;
    if (href.startsWith("#") && !href.startsWith("#/")) return;
    let url: URL;
    try {
      url = new URL(href, location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) return;
    e.preventDefault();
    const to =
      getHistoryMode() === "hash"
        ? url.hash.startsWith("#/")
          ? url.hash.slice(1)
          : url.pathname + url.search
        : url.pathname + url.search + url.hash;
    navigate(to);
  };
  root.addEventListener("click", clickHandler);
  return () => root.removeEventListener("click", clickHandler);
}

export interface IsActiveOptions {
  end?: boolean;
}

export function isActive(pattern: string, options: IsActiveOptions = {}): boolean {
  if (options.end) return _path === pattern;
  if (pattern === "/") return _path === "/";
  return _path === pattern || _path.startsWith(pattern.endsWith("/") ? pattern : pattern + "/");
}

export function resolveRedirectTarget(
  to: string,
  base: URL,
  allowExternal: boolean,
): { ok: true; to: string } | { ok: false } {
  if (/[\\\u0000-\u0020]/.test(to)) return { ok: false };
  try {
    const u = new URL(to, base);
    if (!/^https?:$/.test(u.protocol)) return { ok: false };
    if (u.origin === base.origin) return { ok: true, to: u.pathname + u.search + u.hash };
    return allowExternal ? { ok: true, to: u.href } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function resolveRequestUrl(urlOrRequest: string | URL | Request): URL {
  try {
    if (urlOrRequest instanceof Request) return new URL(urlOrRequest.url);
    return typeof urlOrRequest === "string"
      ? new URL(urlOrRequest, "http://localhost")
      : urlOrRequest;
  } catch {
    return new URL("http://localhost/");
  }
}

function pageForPath(pathname: string, routes: RouteRegistry, notFound: Page | null): Page | null {
  const match = matchRoute(routes, pathname);
  if (match) return match.data.page;
  return notFound;
}

async function renderPage(
  page: Page,
  opts?: { timeout?: number; snapshot?: boolean; markers?: boolean },
): Promise<string> {
  return renderToString(page, opts);
}

export function router(options: RouterOptions = {}): RouterBuilder {
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
    route(pattern: string, page: Page): RouterBuilder {
      const data: RouteData = { page, pattern };
      records.push({ pattern, page });
      addRouteEntry(routes, pattern, data);
      patternToData.set(pattern, data);
      return builder;
    },

    errorBoundary(pattern: string, handler: ErrorHandler): RouterBuilder {
      const data = patternToData.get(pattern);
      if (!data) {
        console.warn(
          `[ilha-router] errorBoundary("${pattern}"): pattern was never registered via .route().`,
        );
        return builder;
      }
      data.errorHandler = handler;
      return builder;
    },

    routes(): RouteRecord[] {
      return records.map((r) => ({ ...r }));
    },

    prime,

    mount(target, { hydrate = false, interceptLinks: mountInterceptLinks }: MountOptions = {}) {
      if (!isBrowser) {
        console.warn("[ilha-router] mount() called in a non-browser environment");
        return () => {};
      }
      const host = typeof target === "string" ? document.querySelector(target) : target;
      if (!host) {
        console.warn(`[ilha-router] No element found for selector "${target}"`);
        return () => {};
      }
      if (mode === "static") {
        console.warn("[ilha-router] router.mount() is a no-op in static mode.");
        return () => {};
      }
      syncRouteFromLocation();
      _lastNavKey = currentNavKey();
      if (hydrate && getHistoryMode() === "hash") {
        console.warn(
          "[ilha-router] mount({ hydrate: true }) was called in hash mode. " +
            "The server never sees the hash, so SSR HTML is for '/'.",
        );
      }
      let mounted = true;
      const prevScroll = "scrollRestoration" in history ? history.scrollRestoration : null;
      if (prevScroll !== null) history.scrollRestoration = "manual";

      const popHandler = () => {
        if (!mounted) return;
        const prevPath = _path + _search + _hash;
        _scrollPositions.set(_lastNavKey, { x: window.scrollX, y: window.scrollY });
        _lastNavKey = currentNavKey();
        syncRouteFromLocation();
        restoreScrollPosition();
        runAfterNavigateHooks({
          from: prevPath,
          to: _path + _search + _hash,
          type: "pop",
        });
        remount();
      };
      navChangeCleanup = getAdapter().onChange(popHandler);
      linkCleanup =
        (mountInterceptLinks ?? defaultInterceptLinks) ? enableLinkInterception(document) : null;

      let unmountView: (() => void) | null = null;
      const remount = () => {
        unmountView?.();
        const page = pageForPath(_path, routes, notFound);
        if (!page) {
          unmountView = null;
          return;
        }
        unmountView = mount(host, page, { hydrate: unmountView == null && hydrate });
      };
      remount();

      const offNav = afterNavigate(() => {
        if (mounted) remount();
      });

      return () => {
        mounted = false;
        offNav();
        unmountView?.();
        navChangeCleanup?.();
        linkCleanup?.();
        if (prevScroll !== null) history.scrollRestoration = prevScroll;
      };
    },

    async render(url, options) {
      const result = await builder.renderResponse(url, options);
      if (result.kind === "html") return result.html;
      if (result.kind === "redirect") return "";
      return result.html;
    },

    async renderResponse(url, options) {
      const parsed = resolveRequestUrl(url);
      syncFromParts(parsed.pathname, parsed.search, parsed.hash, routes);
      const store = { entries: [] as HeadInput[] };
      try {
        const page = pageForPath(parsed.pathname, routes, notFound);
        if (!page) throw new RouteError(404, "Not found");
        let captured: unknown;
        const wrapped: Page = async () => {
          try {
            return await Promise.resolve(page());
          } catch (err) {
            captured = err;
            throw err;
          }
        };
        const html = await withHeadStore(store, () => renderPage(wrapped, options));
        if (captured instanceof Redirect || captured instanceof RouteError) throw captured;
        return {
          kind: "html" as const,
          html,
          status: 200,
          head: serializeHead(store.entries),
        };
      } catch (e) {
        if (e instanceof Redirect) {
          const safe = resolveRedirectTarget(e.to, parsed, allowExternalRedirects);
          if (!safe.ok) {
            return {
              kind: "error",
              status: 500,
              message: "unsafe redirect target",
              html: "",
              head: EMPTY_HEAD,
            };
          }
          return { kind: "redirect", to: safe.to, status: e.status };
        }
        if (e instanceof RouteError) {
          const match = matchRoute(routes, parsed.pathname);
          const boundary = match?.data.errorHandler;
          let html = "";
          if (boundary) {
            const view = boundary({ message: e.message, status: e.status }, snapshot());
            html = await renderPage(
              typeof view === "function" ? (view as Page) : async () => view,
              options,
            );
          }
          return {
            kind: "error",
            status: e.status,
            message: e.message,
            html,
            head: serializeHead(store.entries),
          };
        }
        throw e;
      }
    },

    async respond(url, options = {}) {
      const result = await builder.renderResponse(url, options);
      if (result.kind === "redirect") {
        return Response.redirect(result.to, result.status);
      }
      const head = result.head ?? EMPTY_HEAD;
      if (isBrowser && result.kind === "html") applyHeadEntriesToDocument([]);
      const body = options.shell
        ? options.shell(head, result.kind === "html" ? result.html : result.html)
        : result.kind === "html"
          ? result.html
          : result.html;
      return httpResponse(body, {
        status: result.kind === "error" ? result.status : (result.status ?? 200),
        headers: options.headers,
        cspNonce: options.cspNonce,
        contentSecurityPolicy: options.contentSecurityPolicy,
      });
    },

    hydrate(opts = {}) {
      const root = opts.root ?? (isBrowser ? document.body : null);
      if (!root) return () => {};
      return builder.mount(root, { hydrate: true, interceptLinks: opts.interceptLinks });
    },
  };

  return builder;
}

void _viewTransitions;
void _allowExternalRedirects;
void _notFound;
