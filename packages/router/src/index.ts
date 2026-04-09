import { context } from "ilha";
import type { Island, HydratableOptions } from "ilha";
import ilha, { html } from "ilha";
import { createRouter, addRoute, findRoute } from "rou3";

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
}

export interface NavigateOptions {
  replace?: boolean;
}

export interface HydratableRenderOptions extends Partial<Omit<HydratableOptions, "name">> {}

export interface RouterBuilder {
  route(pattern: string, island: Island<any, any>): RouterBuilder;
  mount(target: string | Element, options?: { hydrate?: boolean }): () => void;
  render(url: string | URL): string;
  renderHydratable(
    url: string | URL,
    registry: Record<string, Island<any, any>>,
    options?: HydratableRenderOptions,
  ): Promise<string>;
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

let _records: RouteRecord[] = [];
let _rou3 = createRouter<Island<any, any>>();

// ─────────────────────────────────────────────
// Sync signals from an explicit URL
// ─────────────────────────────────────────────

function syncRouteFromURL(url: string | URL): void {
  const parsed = typeof url === "string" ? new URL(url, "http://localhost") : url;
  const path = parsed.pathname;
  const search = parsed.search;
  const hash = parsed.hash;

  const match = findRoute(_rou3, "GET", path);
  const island = match?.data ?? null;

  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(match?.params ?? {})) {
    params[k] = decodeURIComponent(v as string);
  }

  routePath(path);
  routeParams(params);
  routeSearch(search);
  routeHash(hash);
  activeIsland(island);
}

function syncRoute(): void {
  syncRouteFromURL(location.href);
}

// ─────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────

export function navigate(to: string, opts: NavigateOptions = {}): void {
  if (!isBrowser) return;
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  syncRoute();
}

// ─────────────────────────────────────────────
// Link interception
// ─────────────────────────────────────────────

export function enableLinkInterception(root: Element | Document = document): () => void {
  if (!isBrowser) return () => {};

  const handler = (e: Event) => {
    const target = (e.target as Element).closest("a");
    if (!target) return;

    const href = target.getAttribute("href");
    if (!href) return;

    const isAnchorOnly = href.startsWith("#");
    const isBlank = target.getAttribute("target") === "_blank";
    const hasModifier =
      (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey || (e as MouseEvent).shiftKey;
    const isExternal =
      !!target.hostname &&
      (target.hostname !== location.hostname || target.protocol !== location.protocol);

    if (isExternal || isAnchorOnly || isBlank || hasModifier) return;

    e.preventDefault();
    navigate(target.pathname + target.search + target.hash);
  };

  root.addEventListener("click", handler);
  return () => root.removeEventListener("click", handler);
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
// RouterLink island
// ─────────────────────────────────────────────

export const RouterLink = ilha
  .state("href", "")
  .state("label", "")
  .on("[data-link]@click", ({ state, event }) => {
    event.preventDefault();
    navigate(state.href());
  })
  .render(({ state }) => html`<a data-link href="${state.href}">${state.label}</a>`);

// ─────────────────────────────────────────────
// isActive()
// ─────────────────────────────────────────────

export function isActive(pattern: string): boolean {
  const match = findRoute(_rou3, "GET", routePath());
  if (!match) return false;
  const record = _records.find((r) => r.island === match.data);
  return record?.pattern === pattern;
}

// ─────────────────────────────────────────────
// Router builder
// ─────────────────────────────────────────────

export function router(): RouterBuilder {
  _records = [];
  _rou3 = createRouter<Island<any, any>>();

  let _popstateCleanup: (() => void) | null = null;
  let _linkCleanup: (() => void) | null = null;

  const builder: RouterBuilder = {
    route(pattern: string, island: Island<any, any>): RouterBuilder {
      _records.push({ pattern, island });
      addRoute(_rou3, "GET", pattern, island);
      return builder;
    },

    // ── Client-side ──────────────────────────────────────────────────────────
    mount(target: string | Element, { hydrate = false } = {}): () => void {
      if (!isBrowser) {
        console.warn("[ilha-router] mount() called in a non-browser environment");
        return () => {};
      }

      const host = typeof target === "string" ? document.querySelector(target) : target;
      if (!host) {
        console.warn(`[ilha-router] No element found for selector "${target}"`);
        return () => {};
      }

      syncRoute();

      const popHandler = () => syncRoute();
      window.addEventListener("popstate", popHandler);
      _popstateCleanup = () => window.removeEventListener("popstate", popHandler);
      _linkCleanup = enableLinkInterception(document);

      let unmountView: () => void;

      if (hydrate) {
        // SSR HTML is already in the DOM — ilha.mount() has already hydrated
        // [data-ilha] nodes with reactivity. Mount RouterView onto the existing
        // [data-router-view] wrapper with _skipOnMount so the first effect()
        // does NOT re-render and clobber the hydrated children.
        const existing = host.querySelector<Element>("[data-router-view]");
        if (existing) {
          unmountView = RouterView.mount(existing, { _skipOnMount: true });
        } else {
          // no SSR content found — fall back to normal mount
          unmountView = RouterView.mount(host);
        }
      } else {
        unmountView = RouterView.mount(host);
      }

      return () => {
        unmountView();
        _popstateCleanup?.();
        _linkCleanup?.();
        _popstateCleanup = null;
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
    ): Promise<string> {
      syncRouteFromURL(url);

      const island = activeIsland();
      if (!island) return `<div data-router-empty></div>`;

      const name = Object.entries(registry).find(([, v]) => v === island)?.[0];
      if (!name) {
        console.warn(
          `[ilha-router] renderHydratable: active island for "${routePath()}" is not in the registry. ` +
            `Falling back to plain SSR — the island will not be interactive on the client.`,
        );
        return `<div data-router-view>${island.toString()}</div>`;
      }

      const rendered = await island.hydratable(
        {},
        {
          name,
          as: "div",
          snapshot: true,
          ...options,
        },
      );

      return `<div data-router-view>${rendered}</div>`;
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
  RouterView,
  RouterLink,
};
