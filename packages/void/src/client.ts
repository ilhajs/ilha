import { mount } from "ilha";
import type { DeferredState } from "void";
import {
  createRouterFacade,
  createVoidRouter,
  idleNavigationState,
} from "void/pages-client";
import type {
  NavigationState,
  VoidRouter,
  VoidRouterConfig,
} from "void/pages-client";

import { setActionRouter } from "./action";
import { createPageRoot, routeData } from "./app";
import type {
  ComponentManifest,
  LayoutTree,
  PageComponent,
  PageTree,
  RouteData,
} from "./app";
import { createPageState } from "./context";
import type { JsonValue, PageProps } from "./types";

export type StartPagesOptions = Omit<
  VoidRouterConfig,
  | "adapter"
  | "components"
  | "layoutTree"
  | "onNavigationChange"
  | "onRouteChange"
> & {
  components: ComponentManifest;
  layoutTree: LayoutTree;
};

interface RouteState extends RouteData {
  page: PageComponent | null;
  pageKey: string;
  layouts: readonly PageComponent[];
}

type Deferred = DeferredState<JsonValue>;

const sameParams = (
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>
): boolean => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
};

const currentUrl = (): string =>
  window.location.pathname + window.location.search + window.location.hash;

const noop = (): void => undefined;

/** Longest an update waits for the DOM before it lets the router go on. */
const PAINT_TIMEOUT_MS = 1000;

const pendingDeferred = (): Deferred => ({
  error: null,
  loading: true,
  value: null,
});

const settledDeferred = (value: JsonValue): Deferred => ({
  error: null,
  loading: false,
  value,
});

const failedDeferred = (error: string): Deferred => ({
  error: new Error(error),
  loading: false,
  value: null,
});

/**
 * Hydrate `#app` and hand navigation to the Void Router. The generated
 * `virtual:void-pages-client` entry calls this once per document.
 */
export const startPages = async ({
  components,
  layoutTree,
  ...config
}: StartPagesOptions): Promise<VoidRouter> => {
  let rerender = noop;
  const paintWaiters: (() => void)[] = [];
  /** Rerender the page and resolve once the DOM reflects the new route. */
  const repaint = async (): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<null>();
    const timer = setTimeout(() => resolve(null), PAINT_TIMEOUT_MS);
    paintWaiters.push(() => {
      clearTimeout(timer);
      resolve(null);
    });
    rerender();
    await promise;
  };
  let url = currentUrl();
  let navigation: NavigationState = idleNavigationState();
  let navigations = 0;
  let route: RouteState = {
    errors: {},
    layouts: [],
    page: null,
    pageId: "",
    pageKey: "",
    params: {},
    props: {},
    shared: {},
  };
  const update = (next: Partial<RouteState>): Promise<void> => {
    route = { ...route, ...next };
    return repaint();
  };

  const {
    commitInitialRender,
    initialComponent,
    initialLayouts,
    initialPageData,
    router,
    start,
  } = await createVoidRouter({
    ...config,
    adapter: {
      // Resolves after paint, so a view transition captures the new page.
      applyUpdate(pageData, component, layouts, { preserveState }) {
        const data = routeData(pageData);
        const keep =
          preserveState &&
          route.pageId === data.pageId &&
          route.page === component &&
          sameParams(route.params, data.params);
        if (!keep) {
          navigations += 1;
        }
        return update({
          ...data,
          // SAFETY: the engine resolves layouts from the generated manifest.
          layouts: layouts as PageComponent[],
          // SAFETY: the engine resolves pages from the generated manifest.
          page: component as PageComponent,
          pageKey: keep
            ? route.pageKey
            : `${data.pageId}#${String(navigations)}`,
        });
      },
      createDeferred: pendingDeferred,
      // SAFETY: the engine only hands back refs this adapter created.
      isLoading: (ref) => (ref as Deferred).loading,
      onDeferredUpdate(props) {
        // SAFETY: deferred updates carry the page's JSON props.
        void update({ props: { ...(props as PageProps) } });
      },
      rejectDeferred: (_ref, error) => failedDeferred(error),
      // SAFETY: deferred values stream in as JSON page data.
      resolveDeferred: (_ref, value) => settledDeferred(value as JsonValue),
    },
    components,
    layoutTree,
    onNavigationChange(next) {
      navigation = next;
      void repaint();
    },
    onRouteChange(next) {
      url = next;
      void repaint();
    },
  });

  const facade = createRouterFacade(
    router,
    () => url,
    () => route.params
  );
  setActionRouter(facade);

  const initial = routeData(initialPageData);
  route = {
    ...initial,
    // SAFETY: initial modules come from the generated manifest.
    layouts: initialLayouts as PageComponent[],
    // SAFETY: initial modules come from the generated manifest.
    page: initialComponent as PageComponent,
    pageKey: initial.pageId,
  };

  const read = (): PageTree => ({
    layouts: route.layouts,
    page: route.page,
    pageKey: route.pageKey,
    props: route.props,
    state: createPageState({
      errors: route.errors,
      navigation,
      params: route.params,
      router: facade,
      shared: route.shared,
    }),
  });

  const app = document.querySelector<HTMLElement>("#app");
  if (!app) {
    throw new Error("@ilha/void: missing #app element for page hydration.");
  }
  const hydrate = app.dataset.voidSsr !== "false";
  const host = (hydrate && app.querySelector(":scope > [data-ilha]")) || app;
  mount(
    host,
    createPageRoot({
      connect: (next) => {
        rerender = next;
      },
      read,
    }),
    {
      hydrate,
      onIdle: () => {
        for (const resolve of paintWaiters.splice(0)) {
          resolve();
        }
      },
    }
  );
  app.dataset.hydrated = "true";
  start();
  commitInitialRender();
  return facade;
};
