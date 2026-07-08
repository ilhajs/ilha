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

// ─────────────────────────────────────────────
// Head types
// ─────────────────────────────────────────────

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
  script?: Array<Record<string, string> & { children?: string }>;
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

// ─────────────────────────────────────────────
// Loader types
// ─────────────────────────────────────────────

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

const WRAP_LAYOUT_LEAF = Symbol.for("ilha.router.wrapLayout.leaf");
const WRAP_LAYOUT_HANDLER = Symbol.for("ilha.router.wrapLayout.handler");
// Brand carried by `.key()` callables — ilha's interpolateValue only treats a
// bare-interpolated function (`{children}` in a layout) as an island call when
// this symbol is present; without it the call result is escaped to
// "[object Object]". Wrappers around keyed islands must re-apply it.
const ISLAND_CALL = Symbol.for("ilha.islandCall");

function extractHydratableInnerHtml(block: string): string {
  const m = block.match(/^<([a-zA-Z][\w-]*)\s[^>]*>([\s\S]*)<\/\1>\s*$/);
  return m ? m[2]! : block;
}

function parseHydratableOpenTag(block: string): { tag: string; attrs: string } | null {
  const m = block.match(/^<([a-zA-Z][\w-]*)\s([^>]*)>/);
  if (!m) return null;
  return { tag: m[1]!, attrs: m[2]! };
}

const K_PAGE_RAW_OPEN_RE = /<(pre|script|style|textarea)\b/i;

/** Skip through matching close tag, allowing nested `<pre>` (twoslash popups inside code blocks). */
function skipRawElement(html: string, i: number, tag: string): number | null {
  const openRe = new RegExp(`<${tag}\\b`, "gi");
  const closeRe = new RegExp(`</${tag}>`, "gi");
  let depth = 1;
  let pos = i;
  while (depth > 0 && pos < html.length) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const openM = openRe.exec(html);
    const closeM = closeRe.exec(html);
    if (!closeM) return null;
    if (openM && openM.index < closeM.index) {
      depth += 1;
      pos = openM.index + openM[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return closeM.index + closeM[0].length;
      pos = closeM.index + closeM[0].length;
    }
  }
  return pos;
}

/** Next `<div` or `</div>` outside raw/pre/script regions (MDX + twoslash often contain `</div>` / nested `<pre>`). */
function nextDivToken(
  html: string,
  from: number,
): { kind: "open" | "close"; index: number } | null {
  let i = from;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i);
      if (end === -1) return null;
      i = end + 3;
      continue;
    }
    const slice = html.slice(i);
    const skip = slice.match(K_PAGE_RAW_OPEN_RE);
    if (skip && skip.index != null && skip.index >= 0) {
      const rawStart = i + skip.index;
      let skipComment = false;
      let search = i;
      while (search < rawStart) {
        const commentStart = html.indexOf("<!--", search);
        if (commentStart === -1 || commentStart >= rawStart) break;
        const commentEnd = html.indexOf("-->", commentStart);
        if (commentEnd === -1) return null;
        if (rawStart < commentEnd + 3) {
          i = commentEnd + 3;
          skipComment = true;
          break;
        }
        search = commentEnd + 3;
      }
      if (skipComment) continue;
      const nextOpen = html.indexOf("<div", i);
      const nextClose = html.indexOf("</div>", i);
      const divBeforeRaw =
        (nextOpen !== -1 && nextOpen < rawStart) || (nextClose !== -1 && nextClose < rawStart);
      if (!divBeforeRaw) {
        const tag = skip[1]!.toLowerCase();
        const afterOpen = rawStart + skip[0].length;
        const end = skipRawElement(html, afterOpen, tag);
        if (end === null) return null;
        i = end;
        continue;
      }
    }
    const nextOpen = html.indexOf("<div", i);
    const nextClose = html.indexOf("</div>", i);
    if (nextClose === -1 && nextOpen === -1) return null;
    if (nextOpen === -1 || (nextClose !== -1 && nextClose < nextOpen)) {
      return { kind: "close", index: nextClose };
    }
    return { kind: "open", index: nextOpen };
  }
  return null;
}

function findKPageSlotSpans(layoutHtml: string): Array<{ openEnd: number; closeStart: number }> {
  const spans: Array<{ openEnd: number; closeStart: number }> = [];
  const openRe = /<div\s[^>]*data-ilha-slot="k:page"[^>]*>/g;
  for (const m of layoutHtml.matchAll(openRe)) {
    const openEnd = m.index! + m[0].length;
    let depth = 1;
    let i = openEnd;
    while (depth > 0) {
      const token = nextDivToken(layoutHtml, i);
      if (!token) break;
      if (token.kind === "open") {
        depth += 1;
        i = token.index + 4;
      } else {
        depth -= 1;
        if (depth === 0) {
          spans.push({ openEnd, closeStart: token.index });
          break;
        }
        i = token.index + 6;
      }
    }
  }
  return spans;
}

/** Replace inner HTML of the first or innermost `k:page` slot (empty or pre-filled). */
function injectKPageSlot(
  layoutHtml: string,
  slotInnerHtml: string,
  which: "first" | "innermost",
): string {
  const spans = findKPageSlotSpans(layoutHtml);
  if (spans.length === 0) return layoutHtml;
  const target = which === "innermost" ? spans[spans.length - 1]! : spans[0]!;
  return layoutHtml.slice(0, target.openEnd) + slotInnerHtml + layoutHtml.slice(target.closeStart);
}

/** Layout shell HTML with an empty `k:page` — avoids scanning MDX/twoslash inside `Wrapped.toString()`. */
function layoutHtmlWithEmptyKPage(
  wrappedLayout: Island<any, any>,
  props: Record<string, unknown>,
): string {
  const handler = (wrappedLayout as unknown as Record<symbol, LayoutHandler>)[WRAP_LAYOUT_HANDLER];
  if (!handler) return wrappedLayout.toString(props as never);
  const leaf =
    ((wrappedLayout as unknown as Record<symbol, Island<any, any>>)[WRAP_LAYOUT_LEAF] as
      | Island<any, any>
      | undefined) ?? wrappedLayout;
  const rawKeyed = leaf.key("page");
  // Layouts often pass a subset to `<Children />`; merge full route loader props
  // so slot markers and SSR do not drop page-only keys (e.g. todos + authSession).
  const shellChild = ((partial?: Record<string, unknown>) =>
    rawKeyed({ ...props, ...(partial ?? {}) })) as unknown as Island<any, any>;
  Object.assign(shellChild, { toString: () => "" });
  (shellChild as unknown as Record<symbol, boolean>)[ISLAND_CALL] = true;
  return handler(shellChild).toString(props as never);
}

async function wrapLayoutSlotMarkup(
  innerWrapped: Island<any, any>,
  leafPage: Island<any, any>,
  props: Record<string, unknown>,
  opts: HydratableOptions,
): Promise<string> {
  const pageBlock = await leafPage.hydratable(props, opts);
  const pageInner = extractHydratableInnerHtml(pageBlock);
  const layoutWithEmptyPage = injectKPageSlot(
    layoutHtmlWithEmptyKPage(innerWrapped, props),
    "",
    "innermost",
  );
  return injectKPageSlot(layoutWithEmptyPage, pageInner, "innermost");
}

export function wrapLayout(layout: LayoutHandler, page: Island<any, any>): Island<any, any> {
  const leafPage: Island<any, any> =
    ((page as unknown as Record<symbol, Island<any, any>>)[WRAP_LAYOUT_LEAF] as
      | Island<any, any>
      | undefined) ?? page;
  const childWrapped = leafPage !== page ? (page as Island<any, any>) : null;

  // Key the page slot so its id (k:page) never collides with positional
  // child slots (p:0, p:1, …) inside the page render.
  const rawKeyedPage = page.key("page");
  const layoutInputRef: { merged?: Record<string, unknown> } = {};
  const KeyedPage = ((props?: Record<string, unknown>) => {
    const merged = layoutInputRef.merged;
    const slotProps =
      merged && typeof merged === "object" ? { ...merged, ...(props ?? {}) } : props;
    return rawKeyedPage(slotProps as never);
  }) as unknown as Island<any, any>;
  Object.assign(KeyedPage, { toString: page.toString.bind(page) });
  (KeyedPage as unknown as Record<symbol, boolean>)[ISLAND_CALL] = true;
  const Wrapped = layout(KeyedPage);

  (Wrapped as unknown as Record<symbol, Island<any, any>>)[WRAP_LAYOUT_LEAF] = leafPage;
  (Wrapped as unknown as Record<symbol, LayoutHandler>)[WRAP_LAYOUT_HANDLER] = layout;

  function setLayoutMergedInput(props: Record<string, unknown> | undefined): void {
    layoutInputRef.merged = props;
  }

  function pageMountHost(host: Element): Element {
    const slots = [...host.querySelectorAll('[data-ilha-slot="k:page"]')].filter((slot) => {
      const boundary = slot.closest("[data-ilha]");
      return boundary === null || boundary === host;
    });
    if (slots.length === 0) return host;
    return slots[slots.length - 1]!;
  }

  function preparePageMountHost(outer: Element, mountHost: Element): void {
    const applyOuterSnapshot = (snapshot: Record<string, unknown>): void => {
      delete snapshot._skipOnMount;
      mountHost.setAttribute("data-ilha-state", JSON.stringify(snapshot));
    };

    if (mountHost.hasAttribute("data-ilha-state")) {
      const outerState = outer.getAttribute("data-ilha-state");
      if (outerState) {
        try {
          applyOuterSnapshot(JSON.parse(outerState) as Record<string, unknown>);
          return;
        } catch {
          // fall through — still clear layout _skipOnMount on the slot snapshot
        }
      }
      const slotState = mountHost.getAttribute("data-ilha-state");
      if (slotState) {
        try {
          const snapshot = JSON.parse(slotState) as Record<string, unknown>;
          delete snapshot._skipOnMount;
          mountHost.setAttribute("data-ilha-state", JSON.stringify(snapshot));
        } catch {
          // keep existing slot attribute
        }
      }
      return;
    }

    const outerState = outer.getAttribute("data-ilha-state");
    if (outerState) {
      try {
        applyOuterSnapshot(JSON.parse(outerState) as Record<string, unknown>);
        return;
      } catch {
        // fall through — still mark SSR slot below
      }
    }
    // k:page is mounted via mountSlots (leaf internal), not Wrapped.mount — mark
    // hydration so ilha keeps SSR children and runs onMount before first render.
    if (mountHost.childNodes.length > 0) {
      mountHost.setAttribute("data-ilha-state", "{}");
    }
  }

  function wrapLeafPageMountHooks(leaf: Island<any, any>): void {
    const leafInternal = (leaf as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] as
      | ((
          host: Element,
          props?: Record<string, unknown>,
        ) => {
          unmount: () => void | Promise<void>;
          updateProps: (p?: Record<string, unknown>) => void;
        })
      | undefined;
    if (typeof leafInternal !== "function") return;

    (leaf as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] = (
      host: Element,
      props?: Record<string, unknown>,
    ) => {
      const outer = host.closest("[data-ilha]");
      if (outer && outer !== host) preparePageMountHost(outer, host);
      return leafInternal(host, props);
    };

    const leafMount = leaf.mount.bind(leaf);
    leaf.mount = (host: Element, props?: Record<string, unknown>) => {
      const outer = host.closest("[data-ilha]");
      if (outer && outer !== host) preparePageMountHost(outer, host);
      return leafMount(host, props as never);
    };
  }

  wrapLeafPageMountHooks(leafPage);

  const layoutMount = Wrapped.mount.bind(Wrapped);
  const layoutInternal = (Wrapped as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] as
    | ((
        host: Element,
        props?: Record<string, unknown>,
      ) => {
        unmount: () => void | Promise<void>;
        updateProps: (p?: Record<string, unknown>) => void;
      })
    | undefined;

  function prepareLayoutMountHost(host: Element): void {
    preparePageMountHost(host, pageMountHost(host));
    // Keep outer data-ilha-state so the layout island hydrates (preserve SSR DOM).
    // Page-only snapshot keys are copied onto k:page; layout has no .state() keys.
  }

  // Mount the full layout island so mountSlots wires layout child slots (p:*)
  // and the keyed page slot (k:page). preparePageMountHost copies outer SSR
  // state onto k:page and clears _skipOnMount so the page onMount still runs.
  Wrapped.mount = (host: Element, props?: Record<string, unknown>) => {
    setLayoutMergedInput(props as Record<string, unknown> | undefined);
    prepareLayoutMountHost(host);
    return layoutMount(host, props as never);
  };

  (Wrapped as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] = (
    host: Element,
    props?: Record<string, unknown>,
  ) => {
    setLayoutMergedInput(props as Record<string, unknown> | undefined);
    prepareLayoutMountHost(host);
    if (typeof layoutInternal === "function") {
      return layoutInternal(host, props);
    }
    return {
      unmount: layoutMount(host, props as never),
      updateProps: () => {},
    };
  };

  Wrapped.hydratable = async (
    props?: Record<string, unknown>,
    opts?: HydratableOptions,
  ): Promise<string> => {
    if (!opts?.name) throw new Error("wrapLayout: hydratable requires options.name");
    const resolvedProps = props ?? {};
    setLayoutMergedInput(resolvedProps);
    // Snapshot attrs from the leaf page island, not the layout shell.
    const pageBlock = await leafPage.hydratable(resolvedProps, opts);
    const open = parseHydratableOpenTag(pageBlock);
    if (!open) return pageBlock;

    const pageInner = extractHydratableInnerHtml(pageBlock);
    let slotContent = pageInner;
    if (childWrapped) {
      slotContent = await wrapLayoutSlotMarkup(childWrapped, leafPage, resolvedProps, opts);
    }

    const layoutWithEmptyPage = injectKPageSlot(
      layoutHtmlWithEmptyKPage(Wrapped, resolvedProps),
      "",
      "first",
    );
    const layoutInnerOut = injectKPageSlot(layoutWithEmptyPage, slotContent, "first");

    return `<${open.tag} ${open.attrs}>${layoutInnerOut}</${open.tag}>`;
  };

  return Wrapped;
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
  // interactivity. These two paths (.mount and ISLAND_MOUNT_INTERNAL) are
  // mutually exclusive by design: .mount is for top-level activation,
  // ISLAND_MOUNT_INTERNAL is for slot-based child mounting.
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
      // Error islands don't participate in prop updates — the parent
      // would need to re-navigate to recover from an error state.
      return { unmount: errorIsland.mount(host, props), updateProps: () => {} };
    }
  };

  Wrapper.hydratable = async (
    props?: Record<string, unknown>,
    opts?: HydratableOptions,
  ): Promise<string> => {
    if (!opts?.name) throw new Error("wrapError: hydratable requires options.name");
    return page.hydratable(props ?? {}, opts);
  };

  return Wrapper;
}

export function defineLayout(layout: LayoutHandler): LayoutHandler {
  return layout;
}

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
  | { kind: "html"; html: string; status?: number; head?: SerializedHead }
  | { kind: "redirect"; to: string; status: number }
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
    | { kind: "data"; data: Record<string, unknown>; head?: SerializedHead }
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
  /**
   * Hydrate islands on the current pre-rendered page without mounting a route
   * view or enabling client navigation. Intended for `static` mode: each page
   * is a self-contained HTML file; only interactive islands need activation.
   */
  hydrateStatic(
    registry: Record<string, Island<any, any>>,
    options?: { root?: Element },
  ): () => void;
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
const prefetchCache = new Map<string, { promise: Promise<LoaderFetchResult>; expires: number }>();

/** How long a hover prefetch stays servable. Consumed-on-use regardless. */
const PREFETCH_TTL_MS = 30_000;

type LoaderFetchResult =
  | { kind: "data"; data: Record<string, unknown>; headEntries?: HeadInput[] }
  | { kind: "redirect"; to: string; status: number }
  | { kind: "error"; status: number; message: string }
  | { kind: "not-found" };

// ─────────────────────────────────────────────
// View transitions (opt-in via router({ viewTransitions: true }))
// ─────────────────────────────────────────────

/** Mirrors the last router's `viewTransitions` option (module-level like `_notFound`). */
let _viewTransitions = false;

/**
 * Run a synchronous DOM mutation, wrapped in a view transition when enabled
 * and supported (the callback runs async — after the browser snapshots the old
 * view). Resolves with the mutation's result either way.
 */
async function withViewSwap<T>(mutate: () => T): Promise<T> {
  const start = (
    document as Document & {
      startViewTransition?: (cb: () => void) => { updateCallbackDone?: Promise<void> };
    }
  ).startViewTransition?.bind(document);
  if (!_viewTransitions || !start) return mutate();
  let result!: T;
  let thrown: unknown;
  let failed = false;
  const vt = start(() => {
    try {
      result = mutate();
    } catch (e) {
      failed = true;
      thrown = e;
      throw e;
    }
  });
  // Swallow only the transition's own rejection mirror — the mutation error
  // itself rethrows below so callers see it, matching the non-transition path.
  await vt.updateCallbackDone?.catch(() => {});
  if (failed) throw thrown;
  return result;
}

/**
 * Execute a loader registered in the browser (manual `.route(p, island, loader)`
 * or FS-routing `clientLoad`) and map its result to the loader endpoint's wire
 * shape, so all client mount paths handle both sources identically. Loader
 * `head` contributions are dropped, matching the endpoint fetch path.
 */
async function runLocalLoader(
  loader: Loader<any>,
  matchParams: Record<string, string> | undefined,
  pathWithSearch: string,
  signal?: AbortSignal,
): Promise<LoaderFetchResult> {
  const url = new URL(pathWithSearch, location.origin);
  const params = extractParams(matchParams);
  const headEntries: HeadInput[] = [];
  const result = await executeLoader(
    loader,
    url,
    params,
    defaultRequest(url),
    signal ?? new AbortController().signal,
    (input) => headEntries.push(input),
  );
  // A superseded navigation must not apply this result (executeLoader maps the
  // abort race to an error result; surface it as an AbortError instead).
  signal?.throwIfAborted();
  if (result.kind === "redirect") {
    // Same redirect policy as the server paths.
    const safe = resolveRedirectTarget(result.to, url, _allowExternalRedirects);
    if (!safe.ok) {
      console.warn(
        `[ilha-router] Blocked unsafe redirect target "${result.to}". ` +
          `Set allowExternalRedirects: true to allow cross-origin redirects.`,
      );
      return { kind: "error", status: 500, message: "Unsafe redirect target" };
    }
    return { kind: "redirect", to: safe.to, status: result.status };
  }
  if (result.kind === "data") {
    return headEntries.length > 0
      ? { kind: "data", data: result.data, headEntries }
      : { kind: "data", data: result.data };
  }
  return result;
}

async function fetchLoaderData(
  pathWithSearch: string,
  signal?: AbortSignal,
): Promise<LoaderFetchResult> {
  // Check prefetch cache first — if a prefetch is in flight, piggy-back on it.
  const cached = prefetchCache.get(pathWithSearch);
  if (cached) {
    // Consume the cache entry — prefetches are single-use to avoid serving
    // stale data across navigations, and expired entries are refetched.
    prefetchCache.delete(pathWithSearch);
    if (Date.now() <= cached.expires) {
      try {
        signal?.throwIfAborted();
        const result = await cached.promise;
        // Re-check after the await — a superseded navigation must not apply
        // the prefetched result to the view.
        signal?.throwIfAborted();
        return result;
      } catch (e: any) {
        if (e?.name === "AbortError") throw e;
        // Prefetch failed — fall through to a fresh fetch
      }
    }
  }

  // A loader registered in the browser runs locally — no server round-trip.
  // SSR-split builds strip `loader` from the client route graph (only
  // `hasLoader` survives), so they still fall through to the endpoint fetch.
  const pathOnly = pathWithSearch.split("?")[0] ?? "";
  const localMatch = findRoute(_rou3, "GET", pathOnly);
  const localLoader = localMatch?.data?.clientLoader ?? localMatch?.data?.loader;
  if (localLoader) {
    return runLocalLoader(
      localLoader,
      localMatch?.params as Record<string, string> | undefined,
      pathWithSearch,
      signal,
    );
  }

  const url = `${LOADER_ENDPOINT}?path=${encodeURIComponent(pathWithSearch)}`;
  try {
    const res = await fetch(url, {
      signal,
      headers: { accept: "application/json" },
    });
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
  const existing = prefetchCache.get(pathWithSearch);
  if (existing && Date.now() <= existing.expires) return;
  // Don't prefetch routes that have no loader — nothing to fetch.
  const pathOnly = pathWithSearch.split("?")[0] ?? "";
  const match = findRoute(_rou3, "GET", pathOnly);
  if (!match?.data?.hasLoader) return;
  const promise = fetchLoaderData(pathWithSearch).catch((e) => {
    return {
      kind: "error",
      status: 0,
      message: e?.message ?? "prefetch failed",
    } as const;
  });
  prefetchCache.set(pathWithSearch, {
    promise,
    expires: Date.now() + PREFETCH_TTL_MS,
  });
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
    if (_notFound) {
      const nf = _notFound;
      return withViewSwap(() => {
        host.innerHTML = `<div data-router-view data-router-not-found>${nf.toString()}</div>`;
        const nfHost = host.firstElementChild;
        return nfHost ? nf.mount(nfHost) : () => {};
      });
    }
    await withViewSwap(() => {
      host.innerHTML = `<div data-router-empty></div>`;
    });
    return () => {};
  }

  // Fetch loader data *only if* the matched route has a loader registered.
  // Routes registered client-side have `loader: undefined` when the Vite
  // plugin emits server-only loader imports behind `import.meta.env.SSR`.
  const clientMatch = findRoute(_rou3, "GET", pathWithSearch.split("?")[0] ?? "");
  const hasLoader = !!clientMatch?.data?.hasLoader;

  let props: Record<string, unknown> = {};
  const loaderResult: LoaderFetchResult = hasLoader
    ? await fetchLoaderData(pathWithSearch, signal)
    : { kind: "data", data: {} };

  if (loaderResult.kind === "redirect") {
    clientRedirect(loaderResult.to);
    return () => {};
  }
  if (loaderResult.kind === "error") {
    // Route the loader error through the nearest `+error` boundary when one
    // is registered; fall back to the minimal inline error div.
    const boundary = clientMatch?.data?.errorHandler;
    if (boundary) {
      return withViewSwap(() =>
        mountLoaderErrorBoundary(boundary, host, loaderResult.status, loaderResult.message),
      );
    }
    const escaped = escapeHtml(loaderResult.message);
    await withViewSwap(() => {
      host.innerHTML = `<div data-router-view data-router-error="${loaderResult.status}">${escaped}</div>`;
    });
    return () => {};
  }
  if (loaderResult.kind === "not-found") {
    await withViewSwap(() => {
      host.innerHTML = `<div data-router-empty></div>`;
    });
    return () => {};
  }
  props = loaderResult.data;

  // Seed with the loader's head contributions (loader first, render-time
  // `head()` later — later entries win), so client navigations keep
  // `document.title`/meta in sync just like SSR does.
  const headStore: HeadStore = { entries: [...(loaderResult.headEntries ?? [])] };

  // If no registry provided, fall back to static rendering (no interactivity)
  if (!registry) {
    console.warn(
      "[ilha-router] No registry provided for client-side navigation. Island will not be interactive.",
    );
    const html = await withHeadStore(headStore, () => island.toString(props));
    await withViewSwap(() => {
      applyHeadEntriesToDocument(headStore.entries);
      host.innerHTML = `<div data-router-view>${html}</div>`;
    });
    return () => {};
  }

  // Find the island name via reverse map (O(1)) or linear scan as fallback
  const name =
    reverseRegistry?.get(island) ?? Object.entries(registry).find(([, v]) => v === island)?.[0];

  if (!name) {
    console.warn("[ilha-router] Island not found in registry for client-side navigation.");
    const html = await withHeadStore(headStore, () => island.toString(props));
    await withViewSwap(() => {
      applyHeadEntriesToDocument(headStore.entries);
      host.innerHTML = `<div data-router-view>${html}</div>`;
    });
    return () => {};
  }

  // Render with hydration markers and mount for interactivity
  const html = await withHeadStore(headStore, () =>
    island.hydratable(props, { name, as: "div", snapshot: true }),
  );
  return withViewSwap(() => {
    applyHeadEntriesToDocument(headStore.entries);
    host.innerHTML = `<div data-router-view>${html}</div>`;
    // Mount the island for interactivity
    const islandHost = host.querySelector(`[data-ilha="${name}"]`);
    return islandHost ? island.mount(islandHost) : () => {};
  });
}

/** Render + mount a `+error` boundary island for a failed loader. */
function mountLoaderErrorBoundary(
  boundary: ErrorHandler,
  host: Element,
  status: number,
  message: string,
): () => void {
  try {
    const errorIsland = boundary(
      { message, status },
      {
        path: routePath(),
        params: routeParams(),
        search: routeSearch(),
        hash: routeHash(),
      },
    );
    host.innerHTML = `<div data-router-view data-router-error="${status}">${errorIsland.toString()}</div>`;
    const ehHost = host.firstElementChild;
    return ehHost ? errorIsland.mount(ehHost) : () => {};
  } catch (e) {
    // A throwing boundary must not take down navigation — fall back to the
    // minimal inline error.
    console.error("[ilha-router] error boundary threw while rendering a loader error:", e);
    host.innerHTML = `<div data-router-view data-router-error="${status}"></div>`;
    return () => {};
  }
}

// ─────────────────────────────────────────────
// Route context signals
//
// In the browser these are plain reactive context signals. On the server the
// module-global signals would be shared across concurrent requests — request B
// could overwrite routeParams() while request A awaits its loader mid-render.
// So on the server each render runs inside an AsyncLocalStorage scope holding
// a request-local route store, and the exported accessors read/write that
// store when one is active, falling back to the globals otherwise (e.g. the
// sync `render()` API before the ALS module has loaded).
// ─────────────────────────────────────────────

interface RouteStore {
  path: string;
  params: Record<string, string>;
  search: string;
  hash: string;
  island: Island<any, any> | null;
}

type RouteAls = {
  getStore(): RouteStore | undefined;
  run<R>(store: RouteStore, fn: () => R): R;
};

let _routeAls: RouteAls | null = null;
let _routeAlsInit: Promise<RouteAls> | null = null;

async function getRouteAlsAsync(): Promise<RouteAls> {
  if (_routeAls) return _routeAls;
  if (!_routeAlsInit) {
    _routeAlsInit = import("node:async_hooks").then(({ AsyncLocalStorage }) => {
      _routeAls = new AsyncLocalStorage<RouteStore>();
      return _routeAls;
    });
  }
  return _routeAlsInit;
}

// Eagerly load ALS on the server so even the sync `render()` API gets
// request-scoped context once the import settles (microtask after load).
if (!isBrowser) void getRouteAlsAsync().catch(() => {});

function activeRouteStore(): RouteStore | null {
  if (isBrowser) return null;
  return _routeAls?.getStore() ?? null;
}

function freshRouteStore(): RouteStore {
  return { path: "", params: {}, search: "", hash: "", island: null };
}

const _routePathSig = context<string>("router.path", "");
const _routeParamsSig = context<Record<string, string>>("router.params", {});
const _routeSearchSig = context<string>("router.search", "");
const _routeHashSig = context<string>("router.hash", "");

export function routePath(value?: string): string {
  const store = activeRouteStore();
  if (arguments.length > 0) {
    if (store) return (store.path = value!);
    return (_routePathSig(value!), value!);
  }
  return store ? store.path : _routePathSig();
}

export function routeParams(value?: Record<string, string>): Record<string, string> {
  const store = activeRouteStore();
  if (arguments.length > 0) {
    if (store) return (store.params = value!);
    return (_routeParamsSig(value!), value!);
  }
  return store ? store.params : _routeParamsSig();
}

export function routeSearch(value?: string): string {
  const store = activeRouteStore();
  if (arguments.length > 0) {
    if (store) return (store.search = value!);
    return (_routeSearchSig(value!), value!);
  }
  return store ? store.search : _routeSearchSig();
}

export function routeHash(value?: string): string {
  const store = activeRouteStore();
  if (arguments.length > 0) {
    if (store) return (store.hash = value!);
    return (_routeHashSig(value!), value!);
  }
  return store ? store.hash : _routeHashSig();
}

// ─────────────────────────────────────────────
// Navigation pending state
// ─────────────────────────────────────────────

// Count of in-flight client navigations (loader fetch + view swap). A counter
// rather than a boolean so an overlapping navigation that supersedes another
// doesn't clear the flag early.
const _navigatingSig = context<number>("router.navigating", 0);

/** Reactive: `true` while a client navigation (loader fetch + view swap) is in flight. */
export function navigating(): boolean {
  return _navigatingSig() > 0;
}

// Re-runs the active route's loader and re-renders the view. Registered by
// the mounted router (SPA or hydrate mode); null when no router is mounted.
let _revalidate: (() => Promise<void>) | null = null;

/**
 * Re-run the current route's loader and re-render the view with fresh data —
 * e.g. after a mutation. Resolves when the view has updated. No-op on the
 * server or when no router is mounted.
 */
export function invalidate(): Promise<void> {
  if (!isBrowser || !_revalidate) return Promise.resolve();
  return _revalidate();
}

/** Mark a navigation as started; returns an idempotent settle callback. */
function beginNavigation(): () => void {
  if (!isBrowser) return () => {};
  _navigatingSig(_navigatingSig() + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    _navigatingSig(Math.max(0, _navigatingSig() - 1));
  };
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

// ─────────────────────────────────────────────
// Active island context signal
// ─────────────────────────────────────────────

const _activeIslandSig = context<Island<any, any> | null>("router.active", null);

function activeIsland(value?: Island<any, any> | null): Island<any, any> | null {
  const store = activeRouteStore();
  if (arguments.length > 0) {
    if (store) return (store.island = value ?? null);
    return (_activeIslandSig(value ?? null), value ?? null);
  }
  return store ? store.island : _activeIslandSig();
}

// ─────────────────────────────────────────────
// Route registry
// ─────────────────────────────────────────────

interface RouteData {
  island: Island<any, any>;
  /** The pattern this route was registered under — exact `isActive()` checks compare against it. */
  pattern: string;
  loader?: Loader<any>;
  /** Loader that runs in the browser on client navigations (manual SPA builder or FS `clientLoad`). */
  clientLoader?: Loader<any>;
  /** Nearest `+error` boundary — renders loader errors instead of the bare inline error div. */
  errorHandler?: ErrorHandler;
  hasLoader?: boolean;
}

// Module-level pointers to the most recently constructed router's registry —
// they back the browser-side module helpers (prefetch/isActive/RouterView and
// location syncing). Server render methods close over their own instance
// registry instead; see router().
let _rou3 = createRouter<RouteData>();

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

function syncRouteFromURL(url: string | URL, rou3: typeof _rou3 = _rou3): void {
  const parsed = typeof url === "string" ? new URL(url, "http://localhost") : url;

  const match = findRoute(rou3, "GET", parsed.pathname);

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
// Navigation hooks
// ─────────────────────────────────────────────

export interface Navigation {
  /** Logical URL (path + search + hash) being navigated away from. */
  from: string;
  /** Logical URL being navigated to. */
  to: string;
  /** `"push"`/`"replace"` for programmatic navigations, `"pop"` for history traversal. */
  type: "push" | "replace" | "pop";
}

export type BeforeNavigateHook = (nav: Navigation & { cancel(): void }) => void;
export type AfterNavigateHook = (nav: Navigation) => void;

const _beforeNavigateHooks = new Set<BeforeNavigateHook>();
const _afterNavigateHooks = new Set<AfterNavigateHook>();

/**
 * Run before a programmatic navigation commits. Call `nav.cancel()` to keep
 * the current URL (e.g. unsaved-changes guards). Not invoked for browser
 * back/forward — the URL has already changed by the time `popstate` fires.
 * Returns an unsubscribe function.
 */
export function beforeNavigate(fn: BeforeNavigateHook): () => void {
  _beforeNavigateHooks.add(fn);
  return () => _beforeNavigateHooks.delete(fn);
}

/** Run after a navigation (push, replace, or pop) has committed. Returns an unsubscribe function. */
export function afterNavigate(fn: AfterNavigateHook): () => void {
  _afterNavigateHooks.add(fn);
  return () => _afterNavigateHooks.delete(fn);
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

// ─────────────────────────────────────────────
// Scroll management
//
// Programmatic navigations scroll to the top (or the URL hash target); browser
// back/forward restores the position saved for that history entry. Entries are
// keyed by a counter stamped into `history.state` on push/replace. Positions
// live in memory only — after a full reload the browser's own restoration
// takes over for the initial entry.
// ─────────────────────────────────────────────

const _scrollPositions = new Map<number, { x: number; y: number }>();
let _navKeyCounter = 0;
// Nav key of the entry currently displayed. Needed by the popstate handler:
// when popstate fires, history.state already points at the *destination*
// entry, so the outgoing entry's scroll must be saved under this key.
let _lastNavKey = 0;

function currentNavKey(): number {
  if (!isBrowser) return 0;
  const s = history.state as { __ilhaNavKey?: number } | null;
  return typeof s?.__ilhaNavKey === "number" ? s.__ilhaNavKey : 0;
}

function saveScrollPosition(): void {
  _scrollPositions.set(currentNavKey(), {
    x: window.scrollX,
    y: window.scrollY,
  });
}

function scrollAfterNavigate(hash: string): void {
  requestAnimationFrame(() => {
    if (hash && hash !== "#") {
      const el =
        document.getElementById(hash.slice(1)) ??
        document.querySelector(`a[name="${cssEscapeAttr(hash.slice(1))}"]`);
      if (el) {
        el.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  });
}

/** Restore the saved position for the current history entry (popstate). */
function restoreScrollPosition(): void {
  const pos = _scrollPositions.get(currentNavKey());
  if (!pos) return;
  requestAnimationFrame(() => window.scrollTo(pos.x, pos.y));
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
  syncRouteFromLocation();
  if (opts.scroll !== false) {
    scrollAfterNavigate(adapter.readLocation().hash);
  }
  runAfterNavigateHooks({ from: current, to, type });
}

/**
 * Follow a loader redirect on the client. Same-origin absolute URLs collapse
 * to a logical path; external URLs perform a full document navigation (the
 * server has already applied the external-redirect policy).
 */
function clientRedirect(to: string): void {
  if (/^https?:\/\//i.test(to)) {
    try {
      const u = new URL(to);
      if (u.origin === location.origin) {
        navigate(u.pathname + u.search + u.hash, { replace: true });
        return;
      }
    } catch {
      return;
    }
    location.assign(to);
    return;
  }
  navigate(to, { replace: true });
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
      !!e &&
      ((e as MouseEvent).ctrlKey ||
        (e as MouseEvent).metaKey ||
        (e as MouseEvent).shiftKey ||
        (e as MouseEvent).altKey);
    const hasNoIntercept = target.hasAttribute("data-no-intercept");
    const isDownload = target.hasAttribute("download");
    const isExternalRel = /\bexternal\b/i.test(target.getAttribute("rel") ?? "");
    if (isBlank || hasModifier || hasNoIntercept || isDownload || isExternalRel) return null;
    return getAdapter().extractLogicalPath(target);
  }

  const clickHandler = (e: Event) => {
    if (e.defaultPrevented) return;
    // Only intercept plain left-clicks — some browsers dispatch `click` for
    // middle/auxiliary buttons too.
    if (typeof (e as MouseEvent).button === "number" && (e as MouseEvent).button !== 0) return;
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
    root.addEventListener("mouseover", hoverHandler, {
      passive: true,
    } as AddEventListenerOptions);
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

/** Custom 404 island — set via `router({ notFound })`. Module-level because
 * RouterView is a module-level island (single active router per document). */
let _notFound: Island<any, any> | null = null;

/** Redirect policy for browser-executed loaders — mirrors the last router's
 * `allowExternalRedirects` option (module-level for the same reason as `_notFound`). */
let _allowExternalRedirects = false;

export const RouterView = ilha.render((): string => {
  const island = activeIsland();
  if (!island) {
    if (_notFound)
      return `<div data-router-view data-router-not-found>${_notFound.toString()}</div>`;
    return `<div data-router-empty></div>`;
  }
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

export interface IsActiveOptions {
  /**
   * When `false`, `isActive("/docs")` also matches nested paths like
   * `/docs/getting-started` (prefix match on the current path).
   * Default: `true` (the matched route's pattern must equal `pattern`).
   */
  exact?: boolean;
}

export function isActive(pattern: string, options: IsActiveOptions = {}): boolean {
  if (options.exact === false) {
    const path = routePath();
    const base = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
    return path === base || path === base + "/" || path.startsWith(base + "/");
  }
  const match = findRoute(_rou3, "GET", routePath());
  if (!match) return false;
  // Compare against the matched route's own pattern — an island registered
  // under several patterns would otherwise only ever report its first one.
  return match.data.pattern === pattern;
}

// ─────────────────────────────────────────────
// Head collection — render-scoped store
// ─────────────────────────────────────────────

interface HeadStore {
  entries: HeadInput[];
}

const ILHA_HEAD_ATTR = "data-ilha-head";
const ILHA_ROUTER_HTML_ATTR = "data-ilha-router-html";
const ILHA_ROUTER_BODY_ATTR = "data-ilha-router-body";

/** Browser-only fallback; SSR uses AsyncLocalStorage (see `withHeadStore`). */
let _browserHeadStore: HeadStore | null = null;

type HeadAls = {
  getStore(): HeadStore | undefined;
  run<R>(store: HeadStore, fn: () => R): R;
};

let _headAls: HeadAls | null = null;
let _headAlsInit: Promise<HeadAls> | null = null;

/** ESM dynamic import — Nitro/Vite SSR workers have no `require`. */
async function getHeadAlsAsync(): Promise<HeadAls> {
  if (_headAls) return _headAls;
  if (!_headAlsInit) {
    _headAlsInit = import("node:async_hooks").then(({ AsyncLocalStorage }) => {
      _headAls = new AsyncLocalStorage<HeadStore>();
      return _headAls;
    });
  }
  return _headAlsInit;
}

function activeHeadStore(): HeadStore | null {
  if (isBrowser) return _browserHeadStore;
  return _headAls?.getStore() ?? null;
}

/**
 * Contribute `<head>` data from inside an island's `.render()` body or a
 * layout. During SSR this collects into the active render window; on the
 * client, entries are collected when the router re-renders a route inside
 * `withHeadStore` and then applied to `document`. Prefer a loader's `ctx.head`
 * for data that depends on the request.
 */
export function head(input: HeadInput): void {
  const store = activeHeadStore();
  if (!store) {
    if (!isBrowser) {
      console.warn("[ilha-router] head() called outside an SSR render window — ignored.");
    }
    return;
  }
  store.entries.push(input);
}

function cssEscapeAttr(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function headManagedMetaSelector(tag: Record<string, string>): string | null {
  if ("charset" in tag) return `meta[charset][${ILHA_HEAD_ATTR}]`;
  if ("name" in tag) return `meta[name="${cssEscapeAttr(tag.name)}"][${ILHA_HEAD_ATTR}]`;
  if ("property" in tag)
    return `meta[property="${cssEscapeAttr(tag.property)}"][${ILHA_HEAD_ATTR}]`;
  if ("http-equiv" in tag)
    return `meta[http-equiv="${cssEscapeAttr(tag["http-equiv"])}"][${ILHA_HEAD_ATTR}]`;
  return null;
}

function headManagedLinkSelector(tag: Record<string, string>): string | null {
  if (tag.rel && tag.href) {
    return `link[rel="${cssEscapeAttr(tag.rel)}"][href="${cssEscapeAttr(tag.href)}"][${ILHA_HEAD_ATTR}]`;
  }
  return null;
}

/**
 * Apply merged head entries on client navigations. Updates `document.title` and
 * managed meta/link nodes (`data-ilha-head`). Script tags from HeadInput are
 * SSR-only and are not re-injected here. Removes managed tags from the previous
 * route that are not part of this navigation's set.
 */
function applyHeadEntriesToDocument(entries: HeadInput[]): void {
  if (!isBrowser) return;

  let title: string | undefined;
  let titleTemplate: HeadInput["titleTemplate"];
  const meta: Array<Record<string, string>> = [];
  const link: Array<Record<string, string>> = [];
  let htmlAttrs: Record<string, string> = {};
  let bodyAttrs: Record<string, string> = {};

  for (const entry of entries) {
    if (entry.title !== undefined) title = entry.title;
    if (entry.titleTemplate !== undefined) titleTemplate = entry.titleTemplate;
    if (entry.meta) meta.push(...entry.meta);
    if (entry.link) link.push(...entry.link);
    if (entry.htmlAttrs) htmlAttrs = { ...htmlAttrs, ...entry.htmlAttrs };
    if (entry.bodyAttrs) bodyAttrs = { ...bodyAttrs, ...entry.bodyAttrs };
  }

  const resolvedTitle = applyTitleTemplate(title, titleTemplate);
  if (resolvedTitle !== undefined) document.title = resolvedTitle;

  const metaTags = dedupByKey(meta, metaDedupKey);
  const linkTags = dedupByKey(link, (t) => `${t.rel ?? ""}:${t.href ?? ""}`);
  const keepManaged = new Set<Element>();

  for (const tag of metaTags) {
    const selector = headManagedMetaSelector(tag);
    if (!selector) continue;
    let el = document.querySelector(selector) as HTMLMetaElement | null;
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(ILHA_HEAD_ATTR, "");
      document.head.appendChild(el);
    }
    for (const [k, v] of Object.entries(tag)) el.setAttribute(k, v);
    keepManaged.add(el);
  }

  for (const tag of linkTags) {
    const selector = headManagedLinkSelector(tag);
    let el: HTMLLinkElement | null = selector
      ? (document.querySelector(selector) as HTMLLinkElement | null)
      : null;
    if (!el) {
      el = document.createElement("link");
      el.setAttribute(ILHA_HEAD_ATTR, "");
      document.head.appendChild(el);
    }
    for (const [k, v] of Object.entries(tag)) el.setAttribute(k, v);
    keepManaged.add(el);
  }

  for (const el of [...document.head.querySelectorAll(`[${ILHA_HEAD_ATTR}]`)]) {
    if (!keepManaged.has(el)) el.remove();
  }

  const htmlEl = document.documentElement;
  const prevHtmlKeys = (htmlEl.getAttribute(ILHA_ROUTER_HTML_ATTR) ?? "")
    .split(/\s+/)
    .filter(Boolean);
  for (const k of prevHtmlKeys) htmlEl.removeAttribute(k);
  const nextHtmlKeys = Object.keys(htmlAttrs);
  for (const [k, v] of Object.entries(htmlAttrs)) htmlEl.setAttribute(k, v);
  if (nextHtmlKeys.length) htmlEl.setAttribute(ILHA_ROUTER_HTML_ATTR, nextHtmlKeys.join(" "));
  else htmlEl.removeAttribute(ILHA_ROUTER_HTML_ATTR);

  const bodyEl = document.body;
  const prevBodyKeys = (bodyEl.getAttribute(ILHA_ROUTER_BODY_ATTR) ?? "")
    .split(/\s+/)
    .filter(Boolean);
  for (const k of prevBodyKeys) bodyEl.removeAttribute(k);
  const nextBodyKeys = Object.keys(bodyAttrs);
  for (const [k, v] of Object.entries(bodyAttrs)) bodyEl.setAttribute(k, v);
  if (nextBodyKeys.length) bodyEl.setAttribute(ILHA_ROUTER_BODY_ATTR, nextBodyKeys.join(" "));
  else bodyEl.removeAttribute(ILHA_ROUTER_BODY_ATTR);
}

async function withHeadStore<T>(store: HeadStore, fn: () => T | Promise<T>): Promise<T> {
  if (isBrowser) {
    const prev = _browserHeadStore;
    _browserHeadStore = store;
    try {
      return await fn();
    } finally {
      _browserHeadStore = prev;
    }
  }
  const als = await getHeadAlsAsync();
  return await als.run(store, () => Promise.resolve(fn()));
}

const HEAD_ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHeadAttr(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => HEAD_ESC[c]!);
}

/** Escape text content for inline HTML (loader error messages etc.). */
function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>]/g, (c) => HEAD_ESC[c]!);
}

function serializeAttrs(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeHeadAttr(v)}"`)
    .join("");
}

function metaDedupKey(tag: Record<string, string>): string {
  if ("charset" in tag) return "charset";
  if ("name" in tag) return `name:${tag.name}`;
  if ("property" in tag) return `property:${tag.property}`;
  if ("http-equiv" in tag) return `http-equiv:${tag["http-equiv"]}`;
  return JSON.stringify(tag);
}

function dedupByKey<T extends Record<string, string>>(tags: T[], keyOf: (t: T) => string): T[] {
  const map = new Map<string, T>();
  for (const tag of tags) map.set(keyOf(tag), tag);
  return [...map.values()];
}

function applyTitleTemplate(
  title: string | undefined,
  template: HeadInput["titleTemplate"],
): string | undefined {
  if (template === undefined) return title;
  if (typeof template === "function") return template(title);
  // String template uses `%s` as the title placeholder.
  return template.replace(/%s/g, title ?? "");
}

/**
 * Merge head entries in contribution order (loader first as the base, then
 * render-time outer→inner layouts, then the page) and serialize. Later entries
 * win on collision; the last `titleTemplate` wraps the resolved title.
 */
export function serializeHead(entries: HeadInput[]): SerializedHead {
  let title: string | undefined;
  let titleTemplate: HeadInput["titleTemplate"];
  const meta: Array<Record<string, string>> = [];
  const link: Array<Record<string, string>> = [];
  const script: Array<Record<string, string> & { children?: string }> = [];
  let htmlAttrs: Record<string, string> = {};
  let bodyAttrs: Record<string, string> = {};

  for (const entry of entries) {
    if (entry.title !== undefined) title = entry.title;
    if (entry.titleTemplate !== undefined) titleTemplate = entry.titleTemplate;
    if (entry.meta) meta.push(...entry.meta);
    if (entry.link) link.push(...entry.link);
    if (entry.script) script.push(...entry.script);
    if (entry.htmlAttrs) htmlAttrs = { ...htmlAttrs, ...entry.htmlAttrs };
    if (entry.bodyAttrs) bodyAttrs = { ...bodyAttrs, ...entry.bodyAttrs };
  }

  const resolvedTitle = applyTitleTemplate(title, titleTemplate);

  const parts: string[] = [];
  if (resolvedTitle !== undefined) parts.push(`<title>${escapeHeadAttr(resolvedTitle)}</title>`);
  for (const tag of dedupByKey(meta, metaDedupKey)) {
    parts.push(`<meta${serializeAttrs({ ...tag, [ILHA_HEAD_ATTR]: "" })} />`);
  }
  for (const tag of dedupByKey(link, (t) => `${t.rel ?? ""}:${t.href ?? ""}`)) {
    parts.push(`<link${serializeAttrs({ ...tag, [ILHA_HEAD_ATTR]: "" })} />`);
  }
  for (const tag of script) {
    const { children, ...attrs } = tag;
    // Script bodies are trusted app code, but neutralise a literal `</script`
    // so a stray sequence can't terminate the tag and inject markup.
    const body = (children ?? "").replace(/<\/script/gi, "<\\/script");
    parts.push(`<script${serializeAttrs(attrs)}>${body}</script>`);
  }

  return {
    headTags: parts.join("\n  "),
    htmlAttrs: serializeAttrs(htmlAttrs),
    bodyAttrs: serializeAttrs(bodyAttrs),
  };
}

// ─────────────────────────────────────────────
// Internal helpers for loader execution
// ─────────────────────────────────────────────

function parsedURL(url: string | URL): URL {
  return typeof url === "string" ? new URL(url, "http://localhost") : url;
}

/** Dev detection for error-message redaction. Browser builds map `process` to `false`. */
function isDevEnv(): boolean {
  try {
    return (
      typeof process !== "undefined" &&
      !!(process as { env?: Record<string, string | undefined> }).env &&
      process.env.NODE_ENV !== "production"
    );
  } catch {
    return false;
  }
}

/**
 * Validate a loader redirect target. Relative paths always pass; same-origin
 * absolute URLs collapse to a path; cross-origin targets are rejected unless
 * `allowExternal`. Protocol-relative (`//host`) and unparsable targets are
 * always rejected.
 */
function resolveRedirectTarget(
  to: string,
  base: URL,
  allowExternal: boolean,
): { ok: true; to: string } | { ok: false } {
  if (to.startsWith("/") && !to.startsWith("//")) return { ok: true, to };
  try {
    const u = new URL(to, base);
    if (!/^https?:$/.test(u.protocol)) return { ok: false };
    if (u.origin === base.origin) return { ok: true, to: u.pathname + u.search + u.hash };
    return allowExternal ? { ok: true, to: u.href } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Build the loader's AbortSignal: aborts when the incoming request aborts or
 * when `timeout` (ms) elapses. Call `done()` when the loader settles.
 */
function loaderAbort(
  request: Request | undefined,
  timeout: number | undefined,
): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  const reqSignal = request?.signal;
  if (reqSignal) {
    if (reqSignal.aborted) abort();
    else reqSignal.addEventListener("abort", abort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeout && timeout > 0) timer = setTimeout(abort, timeout);
  return {
    signal: ctrl.signal,
    done: () => {
      if (timer !== undefined) clearTimeout(timer);
      reqSignal?.removeEventListener("abort", abort);
    },
  };
}

function defaultRequest(url: URL): Request {
  // Best-effort synthesised Request for SSR callers that don't supply one.
  try {
    return new Request(url.toString());
  } catch {
    // Some environments may not have global Request; return a minimal shim.
    return {
      url: url.toString(),
      headers: new Headers(),
    } as unknown as Request;
  }
}

async function executeLoader(
  loader: Loader<any>,
  url: URL,
  params: Record<string, string>,
  request: Request,
  signal: AbortSignal,
  onHead?: (input: HeadInput) => void,
): Promise<
  | { kind: "data"; data: Record<string, unknown>; head?: SerializedHead }
  | { kind: "redirect"; to: string; status: number }
  | { kind: "error"; status: number; message: string }
> {
  // Bind `ctx.head` to this request's collector — never the module global, so
  // concurrent loaders stay isolated.
  const headEntries: HeadInput[] = [];
  const head = onHead ?? ((input: HeadInput) => headEntries.push(input));
  try {
    // Race the loader against its abort signal so a loader that ignores
    // `signal` still can't hang past the timeout / request abort.
    const loaderPromise = Promise.resolve(loader({ params, request, url, signal, head }));
    // Detach a no-op handler so a late loader rejection after the race is
    // lost doesn't surface as an unhandled rejection.
    loaderPromise.catch(() => {});
    const data = await Promise.race([
      loaderPromise,
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(new LoaderError(504, "Loader aborted or timed out"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
    const out: {
      kind: "data";
      data: Record<string, unknown>;
      head?: SerializedHead;
    } = {
      kind: "data",
      data: (data ?? {}) as Record<string, unknown>,
    };
    if (headEntries.length > 0) out.head = serializeHead(headEntries);
    return out;
  } catch (e: any) {
    if (e instanceof Redirect) return { kind: "redirect", to: e.to, status: e.status };
    if (e instanceof LoaderError) return { kind: "error", status: e.status, message: e.message };
    // Non-sentinel error — surface as 500. The raw message (DB errors, file
    // paths, …) is logged server-side and redacted from the client-visible
    // payload outside dev; only `LoaderError` messages are meant for users.
    console.error("[ilha-router] loader failed:", e);
    const status = typeof e?.status === "number" ? e.status : 500;
    const message = isDevEnv() ? (e?.message ?? "Loader failed") : "Internal error";
    return { kind: "error", status, message };
  }
}

// ─────────────────────────────────────────────
// Router builder
// ─────────────────────────────────────────────

export function router(options: RouterOptions = {}): RouterBuilder {
  const mode = (options.mode ?? "spa") as RouterMode;
  const defaultInterceptLinks = options.interceptLinks !== false;
  const allowExternalRedirects = options.allowExternalRedirects === true;
  const loaderTimeout = options.loaderTimeout;

  // Instance-local route registry. Server render methods close over these, so
  // concurrent routers (e.g. a server router plus a test router) don't clobber
  // each other. The module-level pointers below back the browser-side helpers
  // (navigate/prefetch/isActive/RouterView) — last constructed router wins
  // there, matching the one-router-per-document reality.
  const records: RouteRecord[] = [];
  const rou3 = createRouter<RouteData>();
  const patternToData = new Map<string, RouteData>();
  // Instance-local 404 island — server render paths must not read the
  // module-level `_notFound`, which a later router() call would overwrite.
  const notFound = options.notFound ?? null;

  _rou3 = rou3;
  _notFound = notFound;
  _allowExternalRedirects = allowExternalRedirects;
  _viewTransitions = options.viewTransitions === true;

  let _navChangeCleanup: (() => void) | null = null;
  let _linkCleanup: (() => void) | null = null;

  const builder: RouterBuilder = {
    route(pattern: string, island: Island<any, any>, loader?: Loader<any>): RouterBuilder {
      const hasLoader = !!loader;
      const data: RouteData = { island, pattern, loader, hasLoader };
      records.push({ pattern, island, loader, hasLoader });
      addRoute(rou3, "GET", pattern, data);
      patternToData.set(pattern, data);
      return builder;
    },

    attachLoader(pattern: string, loader: Loader<any>): RouterBuilder {
      const data = patternToData.get(pattern);
      if (!data) {
        console.warn(
          `[ilha-router] attachLoader("${pattern}", …): pattern was never registered via .route(). ` +
            `The loader will be ignored.`,
        );
        return builder;
      }
      data.loader = loader;
      data.hasLoader = true;
      // Keep records in sync for consumers that read it directly
      const rec = records.find((r) => r.pattern === pattern);
      if (rec) {
        rec.loader = loader;
        rec.hasLoader = true;
      }
      return builder;
    },

    clientLoader(pattern: string, loader: Loader<any>): RouterBuilder {
      const data = patternToData.get(pattern);
      if (!data) {
        console.warn(
          `[ilha-router] clientLoader("${pattern}", …): pattern was never registered via .route(). ` +
            `The loader will be ignored.`,
        );
        return builder;
      }
      data.clientLoader = loader;
      data.hasLoader = true;
      const rec = records.find((r) => r.pattern === pattern);
      if (rec) rec.hasLoader = true;
      return builder;
    },

    errorBoundary(pattern: string, handler: ErrorHandler): RouterBuilder {
      const data = patternToData.get(pattern);
      if (!data) {
        console.warn(
          `[ilha-router] errorBoundary("${pattern}", …): pattern was never registered via .route(). ` +
            `The boundary will be ignored.`,
        );
        return builder;
      }
      data.errorHandler = handler;
      return builder;
    },

    markLoader(pattern: string): RouterBuilder {
      const data = patternToData.get(pattern);
      if (!data) {
        console.warn(
          `[ilha-router] markLoader("${pattern}"): pattern was never registered via .route(). ` +
            `The loader marker will be ignored.`,
        );
        return builder;
      }
      data.hasLoader = true;
      const rec = records.find((r) => r.pattern === pattern);
      if (rec) rec.hasLoader = true;
      return builder;
    },

    routes(): RouteRecord[] {
      return records.map((record) => ({ ...record }));
    },

    // ── Pre-hydration signal priming ───────────────────────────────────────
    prime,

    // ── Static mode ───────────────────────────────────────────────────────────
    hydrateStatic(
      registry: Record<string, Island<any, any>>,
      options: { root?: Element } = {},
    ): () => void {
      if (!isBrowser) return () => {};
      const root = options.root ?? document.body;
      prime();
      const { unmount } = mount(registry, { root });
      return unmount;
    },

    // ── Client-side ──────────────────────────────────────────────────────────
    mount(
      target: string | Element,
      { hydrate = false, registry, interceptLinks: mountInterceptLinks }: MountOptions = {},
    ): () => void {
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
      _lastNavKey = currentNavKey();

      // static mode — no client navigation, no RouterView, no NavHandler.
      // Islands in the pre-rendered HTML are hydrated by ilha.mount() via
      // hydrateStatic(); this path is only reached if someone calls .mount()
      // directly in static mode, which is a no-op.
      if (mode === "static") {
        console.warn(
          "[ilha-router] router.mount() called in static mode. " +
            "Use router.hydrateStatic(registry) instead.",
        );
        return () => {};
      }

      let mounted = true;

      // Take over scroll restoration: programmatic navigations scroll to top /
      // hash target (see navigate()), back/forward restores saved positions.
      const prevScrollRestoration =
        "scrollRestoration" in history ? history.scrollRestoration : null;
      if (prevScrollRestoration !== null) history.scrollRestoration = "manual";

      const popHandler = () => {
        if (!mounted) return;
        const prevPath = routePath() + routeSearch() + routeHash();
        // Save the outgoing entry's scroll before syncing — history.state
        // already holds the destination key when popstate fires, so key it by
        // the entry we're leaving; otherwise forward/back positions are lost.
        _scrollPositions.set(_lastNavKey, { x: window.scrollX, y: window.scrollY });
        _lastNavKey = currentNavKey();
        syncRouteFromLocation();
        restoreScrollPosition();
        runAfterNavigateHooks({
          from: prevPath,
          to: routePath() + routeSearch() + routeHash(),
          type: "pop",
        });
      };
      _navChangeCleanup = getAdapter().onChange(popHandler);
      _linkCleanup =
        (mountInterceptLinks ?? defaultInterceptLinks) ? enableLinkInterception(document) : null;

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
              const settle = beginNavigation();
              unmountView?.();
              unmountView = null;
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
                // Contain navigation failures — an unhandled rejection here
                // would leave a blank view with no diagnostics.
                console.error("[ilha-router] navigation failed:", e);
                viewHost.innerHTML = `<div data-router-view data-router-error="500"></div>`;
                return;
              } finally {
                settle();
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

        void (async () => {
          const island = activeIsland();
          if (!island) return;
          const loc = getAdapter().readLocation();
          const pathWithSearch = loc.pathname + loc.search;
          const clientMatch = findRoute(_rou3, "GET", loc.pathname);
          // A client-side loader can't run during SSR, so its data is missing
          // from the server HTML — replace the SSR DOM with a full client
          // render for the initial route.
          if (clientMatch?.data?.clientLoader) {
            const thisNav = ++navVersion;
            const ac = new AbortController();
            navAbort = ac;
            try {
              const um = await mountRouteWithHydration(
                island,
                viewHost,
                pathWithSearch,
                ac.signal,
                registry,
                reverseRegistry,
              );
              // A navigation that started while we awaited owns the view now.
              if (thisNav === navVersion) unmountView = um;
              else um();
            } catch (e: any) {
              if (e?.name !== "AbortError") {
                console.error("[ilha-router] initial client loader render failed:", e);
              }
            }
            return;
          }
          const hasLoader = !!clientMatch?.data?.hasLoader;
          const loaderResult: LoaderFetchResult = hasLoader
            ? await fetchLoaderData(pathWithSearch)
            : { kind: "data", data: {} };
          if (loaderResult.kind === "redirect" || loaderResult.kind === "error") return;
          const props = loaderResult.kind === "data" ? loaderResult.data : {};
          const headStore: HeadStore = {
            entries: [...(loaderResult.kind === "data" ? (loaderResult.headEntries ?? []) : [])],
          };
          await withHeadStore(headStore, () => island.toString(props));
          if (!mounted) return;
          applyHeadEntriesToDocument(headStore.entries);
        })();

        _revalidate = async () => {
          const island = activeIsland();
          const thisNav = ++navVersion;
          navAbort?.abort();
          const ac = new AbortController();
          navAbort = ac;
          const settle = beginNavigation();
          try {
            const loc = getAdapter().readLocation();
            const um = await mountRouteWithHydration(
              island,
              viewHost,
              loc.pathname + loc.search,
              ac.signal,
              registry,
              reverseRegistry,
            );
            if (thisNav === navVersion) {
              unmountView?.();
              unmountView = um;
              currentMountedIsland = island;
            } else {
              um();
            }
          } catch (e: any) {
            if (e?.name !== "AbortError") console.error("[ilha-router] invalidate failed:", e);
          } finally {
            settle();
          }
        };

        return () => {
          mounted = false;
          ++navVersion;
          _revalidate = null;
          navAbort?.abort();
          unmountNavHandler();
          navHost.remove();
          unmountView?.();
          _linkCleanup?.();
          _navChangeCleanup?.();
          _linkCleanup = null;
          _navChangeCleanup = null;
          if (prevScrollRestoration !== null) history.scrollRestoration = prevScrollRestoration;
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
        if (!island) {
          // RouterView rendered the 404 island's HTML statically; mount it so
          // it gets a real island lifecycle (events, effects) like any route.
          const nfHost = host?.querySelector<Element>("[data-router-not-found]");
          if (_notFound && nfHost) unmountIsland = _notFound.mount(nfHost);
          return;
        }
        const viewHost = host?.querySelector<Element>("[data-router-view]");
        if (!viewHost) return;

        // Fetch loader data only if the matched route has a loader registered.
        const adapter = getAdapter();
        const loc = adapter.readLocation();
        const clientMatch = findRoute(_rou3, "GET", loc.pathname);
        const hasLoader = !!clientMatch?.data?.hasLoader;
        const result: LoaderFetchResult = hasLoader
          ? await fetchLoaderData(loc.pathname + loc.search, signal)
          : { kind: "data", data: {} };
        if (signal.aborted) return;
        if (result.kind === "redirect") {
          clientRedirect(result.to);
          return;
        }
        if (result.kind === "error") {
          // Route the loader error through the nearest `+error` boundary when
          // one is registered; otherwise render the same inline error marker
          // as `mountRouteWithHydration` instead of hiding the failure behind
          // an island rendered with empty props.
          const boundary = clientMatch?.data?.errorHandler;
          if (boundary) {
            unmountIsland = await withViewSwap(() =>
              mountLoaderErrorBoundary(boundary, viewHost, result.status, result.message),
            );
            return;
          }
          const escaped = escapeHtml(result.message);
          await withViewSwap(() => {
            viewHost.innerHTML = `<div data-router-error="${result.status}">${escaped}</div>`;
          });
          return;
        }
        const props = result.kind === "data" ? result.data : {};

        // In SPA mode RouterView is already showing the island's no-props HTML.
        // Re-render with props, morph, and mount for interactivity. Loader
        // head entries seed the store so `document.title`/meta stay in sync.
        const headStore: HeadStore = {
          entries: [...(result.kind === "data" ? (result.headEntries ?? []) : [])],
        };
        const html = await withHeadStore(headStore, () => island.toString(props));
        unmountIsland = await withViewSwap(() => {
          applyHeadEntriesToDocument(headStore.entries);
          viewHost.innerHTML = html;
          return island.mount(viewHost, props);
        });
      }

      // Initial mount — no need to wait for a loader fetch since the first
      // render already ran synchronously via RouterView. However, for SPA mode
      // the initial render had no props, so we fetch and re-render once.
      navAbort = new AbortController();
      mountActiveIsland(activeIsland(), navAbort.signal).catch((e: unknown) => {
        if ((e as { name?: string })?.name === "AbortError") return;
        console.error("[ilha-router] initial mount failed:", e);
      });

      const NavHandler = ilha.render((): string => {
        const current = activeIsland();
        if (current !== currentMountedIsland) {
          const thisNav = ++navVersion;
          navAbort?.abort();
          navAbort = new AbortController();
          const signal = navAbort.signal;
          queueMicrotask(() => {
            if (thisNav !== navVersion) return;
            const settle = beginNavigation();
            mountActiveIsland(current, signal)
              .catch((e: unknown) => {
                if ((e as { name?: string })?.name === "AbortError") return;
                console.error("[ilha-router] navigation failed:", e);
              })
              .finally(settle);
          });
        }
        return "";
      });

      const navHost = document.createElement("div");
      navHost.style.display = "none";
      host.appendChild(navHost);
      const unmountNavHandler = NavHandler.mount(navHost);

      _revalidate = async () => {
        ++navVersion;
        navAbort?.abort();
        navAbort = new AbortController();
        const settle = beginNavigation();
        try {
          await mountActiveIsland(activeIsland(), navAbort.signal);
        } catch (e: any) {
          if (e?.name !== "AbortError") console.error("[ilha-router] invalidate failed:", e);
        } finally {
          settle();
        }
      };

      return () => {
        mounted = false;
        ++navVersion;
        _revalidate = null;
        navAbort?.abort();
        unmountIsland?.();
        unmountNavHandler();
        navHost.remove();
        unmountView?.();
        _linkCleanup?.();
        _navChangeCleanup?.();
        _linkCleanup = null;
        _navChangeCleanup = null;
        if (prevScrollRestoration !== null) history.scrollRestoration = prevScrollRestoration;
      };
    },

    // ── Server-side — plain SSR ───────────────────────────────────────────────
    render(url: string | URL): string {
      const doRender = () => {
        syncRouteFromURL(url, rou3);
        return RouterView.toString();
      };
      // Request-scoped route context when ALS is available (sync API — we
      // can't await the ALS import here; the module-load kickoff usually has
      // it ready by the first request).
      if (!isBrowser && _routeAls) return _routeAls.run(freshRouteStore(), doRender);
      return doRender();
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
      // Escaped — redirect targets often carry user input (e.g. ?next= params).
      return `<meta http-equiv="refresh" content="0; url=${escapeHeadAttr(response.to)}">`;
    },

    // ── Server-side — structured response (preferred) ────────────────────────
    async renderResponse(
      url: string | URL,
      registry: Record<string, Island<any, any>>,
      options: HydratableRenderOptions = {},
      request?: Request,
    ): Promise<RenderResponse> {
      // Run the whole render inside a request-scoped route context so
      // concurrent SSR requests can't clobber each other's route signals.
      if (!isBrowser) {
        const als = await getRouteAlsAsync();
        if (!als.getStore()) {
          return als.run(freshRouteStore(), () =>
            renderResponseInner(url, registry, options, request),
          );
        }
      }
      return renderResponseInner(url, registry, options, request);
    },

    // ── Server-side — run loader for a URL (loader endpoint) ────────────────
    async runLoader(url: string | URL, request?: Request) {
      const parsed = parsedURL(url);

      const match = findRoute(rou3, "GET", parsed.pathname);
      if (!match?.data?.island) return { kind: "not-found" as const };

      if (!match.data.loader) {
        return { kind: "data" as const, data: {} };
      }

      const params = extractParams(match.params as Record<string, string> | undefined);
      const req = request ?? defaultRequest(parsed);
      const abort = loaderAbort(request, loaderTimeout);
      const headStore: HeadStore = { entries: [] };
      try {
        const result = await executeLoader(
          match.data.loader,
          parsed,
          params,
          req,
          abort.signal,
          (input) => headStore.entries.push(input),
        );
        if (result.kind === "redirect") {
          const safe = resolveRedirectTarget(result.to, parsed, allowExternalRedirects);
          if (!safe.ok) {
            console.warn(
              `[ilha-router] Blocked unsafe redirect target "${result.to}". ` +
                `Set allowExternalRedirects: true to allow cross-origin redirects.`,
            );
            return {
              kind: "error" as const,
              status: 500,
              message: "Unsafe redirect target",
            };
          }
          return { ...result, to: safe.to };
        }
        if (result.kind !== "data") return result;
        if (headStore.entries.length === 0) return result;
        // `head` (serialized) feeds SSR shells; `headEntries` (raw POJOs) let
        // client navigations apply loader head to the live document.
        return {
          ...result,
          head: serializeHead(headStore.entries),
          headEntries: headStore.entries,
        };
      } finally {
        abort.done();
      }
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
      const unmountRouter = this.mount(target, {
        hydrate: true,
        registry,
        interceptLinks: options.interceptLinks,
      });

      return () => {
        unmount();
        unmountRouter();
      };
    },
  };

  async function renderResponseInner(
    url: string | URL,
    registry: Record<string, Island<any, any>>,
    options: HydratableRenderOptions = {},
    request?: Request,
  ): Promise<RenderResponse> {
    const { baseHead, ...renderOptions } = options;
    const parsed = parsedURL(url);
    syncRouteFromURL(parsed, rou3);

    const match = findRoute(rou3, "GET", parsed.pathname);
    const island = match?.data?.island ?? null;
    if (!island) {
      const headStore: HeadStore = { entries: baseHead ? [baseHead] : [] };
      if (notFound) {
        const html = await withHeadStore(headStore, () => notFound.toString());
        return {
          kind: "html",
          html: `<div data-router-view data-router-not-found>${html}</div>`,
          status: 404,
          head: serializeHead(headStore.entries),
        };
      }
      return {
        kind: "html",
        html: `<div data-router-empty></div>`,
        status: 404,
        head: baseHead ? serializeHead([baseHead]) : undefined,
      };
    }

    // Head store for this request. The optional `baseHead` seeds it as the
    // base layer; loader writes go through the bound collector below;
    // render-time `head()` writes go through `withHeadStore` around the
    // synchronous render. Later entries win.
    const headStore: HeadStore = { entries: baseHead ? [baseHead] : [] };

    // Run loader (if any)
    let props: Record<string, unknown> = {};
    if (match?.data?.loader) {
      const req = request ?? defaultRequest(parsed);
      const abort = loaderAbort(request, loaderTimeout);
      let result: Awaited<ReturnType<typeof executeLoader>>;
      try {
        result = await executeLoader(
          match.data.loader,
          parsed,
          routeParams(),
          req,
          abort.signal,
          (input) => headStore.entries.push(input),
        );
      } finally {
        abort.done();
      }
      if (result.kind === "redirect") {
        const safe = resolveRedirectTarget(result.to, parsed, allowExternalRedirects);
        if (!safe.ok) {
          console.warn(
            `[ilha-router] Blocked unsafe redirect target "${result.to}". ` +
              `Set allowExternalRedirects: true to allow cross-origin redirects.`,
          );
          result = {
            kind: "error",
            status: 500,
            message: "Unsafe redirect target",
          };
        } else {
          return { kind: "redirect", to: safe.to, status: result.status };
        }
      }
      if (result.kind === "error") {
        // Route the loader error through the route's `+error` boundary when
        // one is registered (render errors are already covered by `wrapError`
        // inside the island); fall back to a minimal inline error page.
        const boundary = match.data.errorHandler;
        if (boundary) {
          try {
            const errorIsland = boundary(
              { message: result.message, status: result.status },
              {
                path: routePath(),
                params: routeParams(),
                search: routeSearch(),
                hash: routeHash(),
              },
            );
            const html = await withHeadStore(headStore, () => errorIsland.toString());
            return {
              kind: "error",
              status: result.status,
              message: result.message,
              html: `<div data-router-view data-router-error="${result.status}">${html}</div>`,
              head: serializeHead(headStore.entries),
            };
          } catch (e) {
            console.error("[ilha-router] error boundary threw while rendering a loader error:", e);
            // fall through to the inline error below
          }
        }
        const escapedMessage = escapeHtml(result.message);
        const html = `<div data-router-view data-router-error="${result.status}">${escapedMessage}</div>`;
        return {
          kind: "error",
          status: result.status,
          message: result.message,
          html,
          head: serializeHead(headStore.entries),
        };
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
      const html = await withHeadStore(headStore, () => island.toString(props));
      return {
        kind: "html",
        html: `<div data-router-view>${html}</div>`,
        head: serializeHead(headStore.entries),
      };
    }

    // `withHeadStore` stays active until `hydratable()` settles so layout/page
    // `head()` calls inside async SSR (e.g. wrapLayout) still collect.
    const rendered = await withHeadStore(headStore, () =>
      island.hydratable(props, {
        name,
        as: "div",
        snapshot: true,
        ...renderOptions,
      }),
    );

    return {
      kind: "html",
      html: `<div data-router-view>${rendered}</div>`,
      head: serializeHead(headStore.entries),
    };
  }

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
  beforeNavigate,
  afterNavigate,
  RouterView,
  RouterLink,
  loader,
  redirect,
  error,
  composeLoaders,
  head,
};
