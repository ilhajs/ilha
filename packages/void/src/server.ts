import { h, renderToString, unsafe } from "ilha";
import type { View } from "ilha";
import { createSsrRouter, idleNavigationState } from "void/pages-client";
import type { VoidRouter } from "void/pages-client";
import {
  renderBodyAttrs,
  renderHeadToString,
  renderHtmlAttrs,
} from "void/pages-head";
import type { PageObject } from "void/pages-protocol";
import { serializePageData } from "void/pages-server";

import { createPageRoot, loadPageComponents, routeData } from "./app";
import type {
  ComponentManifest,
  LayoutTree,
  PageComponent,
  PageTree,
} from "./app";
import { createPageState } from "./context";
import type { JsonRecord } from "./types";

/** Asset markup Void hands to a page renderer. */
export interface AssetTags {
  readonly css: string;
  readonly preloads: string;
  readonly body: string;
}

export interface PageRendererOptions {
  components: ComponentManifest;
  layoutTree: LayoutTree;
}

export interface IslandPageRendererOptions extends PageRendererOptions {
  /** Component IDs whose island page ships client JavaScript. */
  pagesNeedingClientJS: ReadonlySet<string>;
  /** Markdown component IDs with a client script for `void-md`. */
  markdownScriptIds: ReadonlySet<string>;
}

const escapeAttr = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

interface DocumentParts {
  pageObj: PageObject;
  head: string;
  app: string;
  body: string;
}

const renderDocument = ({
  app,
  body,
  head,
  pageObj,
}: DocumentParts): string => {
  const pageHead = pageObj.head ? renderHeadToString(pageObj.head) : "";
  const htmlAttrs = pageObj.head ? renderHtmlAttrs(pageObj.head) : "";
  const bodyAttrs = pageObj.head ? renderBodyAttrs(pageObj.head) : "";
  return `<!doctype html>
<html${htmlAttrs}>
<head>${pageHead}${head}</head>
<body${bodyAttrs}>
  ${app}
  ${body}
</body>
</html>`;
};

interface RenderTreeOptions extends PageRendererOptions {
  pageObj: PageObject;
  router: VoidRouter | null;
  /** Emit the hydration root and snapshot; island pages never hydrate whole. */
  hydratable: boolean;
}

const renderTree = async ({
  components,
  hydratable,
  layoutTree,
  pageObj,
  router,
}: RenderTreeOptions): Promise<string> => {
  const { errors, pageId, params, props, shared } = routeData(pageObj);
  const { layouts, page } = await loadPageComponents({
    componentId: pageId,
    components,
    layoutTree,
  });
  const tree: PageTree = {
    layouts,
    page,
    pageKey: pageId,
    props,
    state: createPageState({
      errors,
      navigation: idleNavigationState(),
      params,
      router,
      shared,
    }),
  };
  return await renderToString(createPageRoot({ read: () => tree }), {
    markers: hydratable,
    snapshot: hydratable,
  });
};

/** Build `renderPage` for regular pages: full SSR, hydrated by the Void Router. */
export const createPageRenderer =
  (options: PageRendererOptions) =>
  async (pageObj: PageObject, assetTags: AssetTags): Promise<string> => {
    const html = await renderTree({
      ...options,
      hydratable: true,
      pageObj,
      router: createSsrRouter(pageObj.url || "/", pageObj.params ?? {}),
    });
    return renderDocument({
      app: `<script id="__VOID_PAGE_DATA__" type="application/json">${serializePageData(pageObj)}</script>
  <div id="app">${html}</div>`,
      body: assetTags.body,
      head: `${assetTags.css}${assetTags.preloads}`,
      pageObj,
    });
  };

/** Build `renderIslandPage` for `.island` pages: static HTML plus islands. */
export const createIslandPageRenderer =
  (options: IslandPageRendererOptions) =>
  async (pageObj: PageObject, assetTags: AssetTags): Promise<string> => {
    const html = await renderTree({
      ...options,
      hydratable: false,
      pageObj,
      router: null,
    });
    const needsJS = options.pagesNeedingClientJS.has(pageObj.component);
    const mdScript = options.markdownScriptIds.has(pageObj.component)
      ? ` data-md-script="${escapeAttr(pageObj.component)}"`
      : "";
    return renderDocument({
      app: `<div id="app"${mdScript}>${html}</div>`,
      body: needsJS ? assetTags.body : "",
      head: `${assetTags.css}${needsJS ? assetTags.preloads : ""}`,
      pageObj,
    });
  };

export interface IslandOptions {
  /** Island ID in the client island manifest. */
  id: string;
  /** Void hydration strategy: `load`, `visible`, `idle`, or `media:(query)`. */
  hydrate: string;
}

/**
 * Wrap a component imported `with { island }`. The server renders it as its
 * own root so its hydration snapshot travels with it; the islands client
 * mounts it from the `data-island` marker.
 */
export const createIsland =
  (Component: PageComponent, { hydrate, id }: IslandOptions) =>
  async ({
    children: _children,
    ...props
  }: JsonRecord & { children?: View }): Promise<View> => {
    // Islands receive serialized props only: `children` cannot cross to the
    // client, so it is dropped here as well. The nested `renderToString`
    // starts its own runtime and root fiber, isolated from this page render.
    // SAFETY: island components are ilha components taking JSON props.
    const render = Component as (props: JsonRecord) => View;
    const html = await renderToString(() => render(props));
    return h(
      "div",
      {
        "data-hydrate": hydrate,
        "data-island": id,
        "data-props": JSON.stringify(props),
      },
      unsafe(html)
    );
  };
