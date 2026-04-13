import { context, mount } from "ilha";
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
// Runtime helpers — wrapLayout / wrapError
// ─────────────────────────────────────────────

export function wrapLayout(layout: LayoutHandler, page: Island<any, any>): Island<any, any> {
  return layout(page);
}

export function wrapError(handler: ErrorHandler, page: Island<any, any>): Island<any, any> {
  // Create a wrapper island that handles errors during SSR but preserves
  // the original page island's interactivity on the client
  const wrapper = ilha.render(() => {
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
  wrapper.mount = (host: Element, props?: Record<string, unknown>) => {
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

  return wrapper;
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

export interface RouterBuilder {
  route(pattern: string, island: Island<any, any>): RouterBuilder;
  prime(): void;
  mount(target: string | Element, options?: MountOptions): () => void;
  render(url: string | URL): string;
  renderHydratable(
    url: string | URL,
    registry: Record<string, Island<any, any>>,
    options?: HydratableRenderOptions,
  ): Promise<string>;
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
// Client-side navigation hydration helper
// ─────────────────────────────────────────────

/**
 * Mounts a route island with proper hydration for client-side navigation.
 * Looks up the island in the reverse registry, renders it with hydration
 * markers, and mounts it for interactivity.
 */
async function mountRouteWithHydration(
  island: Island<any, any> | null,
  host: Element,
  registry?: Record<string, Island<any, any>>,
  reverseRegistry?: Map<Island<any, any>, string>,
): Promise<() => void> {
  if (!island) {
    host.innerHTML = `<div data-router-empty></div>`;
    return () => {};
  }

  // If no registry provided, fall back to static rendering (no interactivity)
  if (!registry) {
    console.warn(
      "[ilha-router] No registry provided for client-side navigation. Island will not be interactive.",
    );
    host.innerHTML = `<div data-router-view>${island.toString()}</div>`;
    return () => {};
  }

  // Find the island name via reverse map (O(1)) or linear scan as fallback
  const name =
    reverseRegistry?.get(island) ?? Object.entries(registry).find(([, v]) => v === island)?.[0];

  if (!name) {
    console.warn("[ilha-router] Island not found in registry for client-side navigation.");
    host.innerHTML = `<div data-router-view>${island.toString()}</div>`;
    return () => {};
  }

  // Render with hydration markers and mount for interactivity
  const html = await island.hydratable({}, { name, as: "div", snapshot: true });
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

let _records: RouteRecord[] = [];
let _rou3 = createRouter<Island<any, any>>();

// ─────────────────────────────────────────────
// Island → pattern reverse map (O(1) isActive)
// ─────────────────────────────────────────────

let _islandToPattern = new Map<Island<any, any>, string>();

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
  activeIsland(match?.data ?? null);
}

/** Client-only fast path — reads directly from `location` instead of parsing a URL. */
function syncRouteFromLocation(): void {
  const match = findRoute(_rou3, "GET", location.pathname);

  routePath(location.pathname);
  routeParams(extractParams(match?.params as Record<string, string> | undefined));
  routeSearch(location.search);
  routeHash(location.hash);
  activeIsland(match?.data ?? null);
}

// ─────────────────────────────────────────────
// Pre-hydration signal priming
// ─────────────────────────────────────────────

/**
 * Prime route context signals from the current `location` so that islands
 * hydrated by `ilha.mount()` see the correct route values on their first
 * render — preventing a mismatch morph that would destroy hydrated bindings.
 *
 * Call this **before** `ilha.mount()` and **after** all routes have been
 * registered (i.e. after the `router().route(…).route(…)` chain).
 *
 * ```ts
 * import { mount } from "ilha";
 * import { pageRouter } from "ilha:pages";
 * import { registry } from "ilha:registry";
 *
 * pageRouter.prime();              // ← sync signals first
 * mount(registry, { root: … });   // ← then hydrate islands
 * pageRouter.mount("#app", { hydrate: true });
 * ```
 */
export function prime(): void {
  if (isBrowser) syncRouteFromLocation();
}

// ─────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────

export function navigate(to: string, opts: NavigateOptions = {}): void {
  if (!isBrowser) return;

  // Skip duplicate navigations — same URL means no history push, no re-render
  const current = location.pathname + location.search + location.hash;
  if (to === current) return;

  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  syncRouteFromLocation();
}

// ─────────────────────────────────────────────
// Link interception
// ─────────────────────────────────────────────

export function enableLinkInterception(root: Element | Document = document): () => void {
  if (!isBrowser) return () => {};

  const handler = (e: Event) => {
    // Respect other handlers that already handled this event
    if (e.defaultPrevented) return;

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
    const hasNoIntercept = target.hasAttribute("data-no-intercept");

    if (isExternal || isAnchorOnly || isBlank || hasModifier || hasNoIntercept) return;

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
  // O(1) lookup via reverse map instead of linear scan through _records
  return _islandToPattern.get(match.data) === pattern;
}

// ─────────────────────────────────────────────
// Router builder
// ─────────────────────────────────────────────

export function router(): RouterBuilder {
  _records = [];
  _rou3 = createRouter<Island<any, any>>();
  _islandToPattern = new Map();

  let _popstateCleanup: (() => void) | null = null;
  let _linkCleanup: (() => void) | null = null;

  const builder: RouterBuilder = {
    route(pattern: string, island: Island<any, any>): RouterBuilder {
      _records.push({ pattern, island });
      addRoute(_rou3, "GET", pattern, island);
      // First pattern registered for an island wins (most specific due to sort order)
      if (!_islandToPattern.has(island)) {
        _islandToPattern.set(island, pattern);
      }
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

      // Ensure route signals are current.  If prime() was already called this
      // is a no-op (same values); if not, this syncs now — which is fine for
      // non-hydrate mounts but may be too late for hydrate mounts if
      // ilha.mount() already ran (see prime() docs above).
      syncRouteFromLocation();

      const popHandler = () => syncRouteFromLocation();
      window.addEventListener("popstate", popHandler);
      _popstateCleanup = () => window.removeEventListener("popstate", popHandler);
      _linkCleanup = enableLinkInterception(document);

      let unmountView: (() => void) | null = null;

      if (hydrate) {
        // SSR HTML is already in the DOM and ilha.mount() has already hydrated
        // [data-ilha] nodes with reactivity.  We must NOT mount RouterView now —
        // any morph (even with identical HTML) would replace the live DOM nodes,
        // destroying the event listeners and signal bindings ilha.mount() wired up.
        //
        // Instead we mount a "navigation handler" island that subscribes to activeIsland.
        // It tracks the current island and re-renders with hydration whenever the route changes.
        const viewHost = host.querySelector<Element>("[data-router-view]") ?? host;
        let currentMountedIsland: Island<any, any> | null = activeIsland();

        // Build reverse registry once for O(1) lookups during navigation
        const reverseRegistry = registry ? buildReverseRegistry(registry) : undefined;

        // Navigation version counter — prevents stale microtasks from applying
        let navVersion = 0;

        const navHandler = ilha.render((): string => {
          const current = activeIsland();
          if (current !== currentMountedIsland) {
            // activeIsland changed — a navigation happened.
            // Capture version so stale microtasks are discarded.
            const thisNav = ++navVersion;
            // Schedule re-hydration after this render completes.
            queueMicrotask(async () => {
              // Discard if a newer navigation has superseded this one
              if (thisNav !== navVersion) return;
              // Clean up previous view
              unmountView?.();
              // Mount the new route with hydration if registry is available
              unmountView = await mountRouteWithHydration(
                current,
                viewHost,
                registry,
                reverseRegistry,
              );
              currentMountedIsland = current;
            });
          }
          // Navigation handler produces no visible markup — it just tracks route changes.
          return "";
        });

        // Mount nav handler on a hidden helper node so it doesn't interfere with
        // the existing [data-router-view] children.
        const navHost = document.createElement("div");
        navHost.style.display = "none";
        host.appendChild(navHost);
        const unmountNavHandler = navHandler.mount(navHost);

        return () => {
          ++navVersion; // cancel any pending microtask
          unmountNavHandler();
          navHost.remove();
          unmountView?.();
          _popstateCleanup?.();
          _linkCleanup?.();
          _popstateCleanup = null;
          _linkCleanup = null;
        };
      }

      // SPA mode — RouterView renders HTML but islands need .mount() for interactivity.
      // We use the same navHandler pattern as hydrate mode: a hidden sentinel island
      // subscribes to activeIsland and mounts/unmounts page islands on navigation.
      let unmountIsland: (() => void) | null = null;
      let currentMountedIsland: Island<any, any> | null = null;
      let navVersion = 0;

      unmountView = RouterView.mount(host);

      /** Mount the active island onto the [data-router-view] container for interactivity. */
      function mountActiveIsland(island: Island<any, any> | null): void {
        unmountIsland?.();
        unmountIsland = null;
        currentMountedIsland = island;
        if (!island) return;
        const viewHost = host?.querySelector<Element>("[data-router-view]");
        if (viewHost) {
          unmountIsland = island.mount(viewHost);
        }
      }

      // Mount the initial page island (RouterView has already rendered the HTML)
      mountActiveIsland(activeIsland());

      // Watch for navigation — re-mount the new island after RouterView morphs the DOM
      const navHandler = ilha.render((): string => {
        const current = activeIsland();
        if (current !== currentMountedIsland) {
          const thisNav = ++navVersion;
          // Schedule after RouterView's morph completes in this same reactive tick
          queueMicrotask(() => {
            if (thisNav !== navVersion) return;
            mountActiveIsland(current);
          });
        }
        return "";
      });

      const navHost = document.createElement("div");
      navHost.style.display = "none";
      host.appendChild(navHost);
      const unmountNavHandler = navHandler.mount(navHost);

      return () => {
        ++navVersion;
        unmountIsland?.();
        unmountNavHandler();
        navHost.remove();
        unmountView?.();
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

      // O(1) reverse lookup instead of Object.entries().find()
      const reverseRegistry = buildReverseRegistry(registry);
      const name = reverseRegistry.get(island);
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

    hydrate(registry: Record<string, Island<any, any>>, options: HydrateOptions = {}): () => void {
      if (!isBrowser) {
        console.warn("[ilha-router] hydrate() called in a non-browser environment");
        return () => {};
      }

      const root = options.root ?? document.body;
      const target = options.target ?? root;

      // 1. Prime route signals first so islands see correct values on first render
      prime();

      // 2. Mount islands for interactivity
      const { unmount } = mount(registry, { root });

      // 3. Setup router for client-side navigation (pass registry for hydration on navigation)
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
  RouterView,
  RouterLink,
};
