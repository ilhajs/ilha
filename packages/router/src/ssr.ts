import { pageRouter, registry } from "ilha:pages/server";
import "ilha:loaders";
import { LOADER_ENDPOINT } from "./index";
import type { HeadInput, HydratableRenderOptions, SerializedHead } from "./index";

export interface AssetAttrs {
  href: string;
  "data-vite-dev-id"?: string;
}

/** Manifest slice without `merge` — matches Nitro/Vite `?assets` raw shape. */
export interface AssetsRaw {
  entry?: string;
  js: AssetAttrs[];
  css: AssetAttrs[];
}

/**
 * The asset descriptor produced by the `?assets=client` / `?assets=ssr`
 * imports. `merge` combines several descriptors, de-duping by href.
 *
 * Structurally compatible with Nitro's `ImportAssetsResult`.
 */
export type Assets = AssetsRaw & {
  merge(...others: AssetsRaw[]): Assets;
};

/** Client + SSR manifests from `?assets=client` / `?assets=ssr` imports. */
export interface IlhaAssetsPair {
  client: Assets;
  server: Assets;
}

/**
 * Merge client and SSR asset manifests (same as `client.merge(server)` from Nitro).
 */
export function mergeAssets({ client, server }: IlhaAssetsPair): Assets {
  return client.merge(server);
}

/**
 * App-wide `<head>` defaults for `IlhaHandler`. Same shape as route `head()`;
 * use so entry files read clearly: `head: appHead({ title, script: [...] })`.
 */
export function appHead(head: HeadInput): HeadInput {
  return head;
}

export interface IlhaHandlerOptions {
  /**
   * Merged asset manifest — use `mergeAssets({ client, server })` with imports
   * from `?assets=client` and `?assets=ssr`.
   */
  assets: Assets;
  /** `<html lang>` value. Default: `"en"`. */
  lang?: string;
  /** Id of the hydration mount container. Default: `"app"`. */
  appId?: string;
  /** Fallback client entry used when the merged assets have no `entry`. */
  clientEntry?: string;
  /**
   * App-wide `<head>` defaults — same shape as the `head()` API. Route-level
   * head (from loaders/pages) is merged on top, so anything here acts as a
   * base. Use it for the default `title`, app meta, and inline scripts.
   *
   * @example
   * head: {
   *   title: "Ilha + Nitro",
   *   script: [{ children: themeScript }],
   * }
   */
  head?: HeadInput;
  /** Options forwarded to `pageRouter.renderHydratable` / `renderResponse`. */
  renderOptions?: HydratableRenderOptions;
}

function stylesheetTag(attrs: AssetAttrs): string {
  const devId = attrs["data-vite-dev-id"] ? ` data-vite-dev-id="${attrs["data-vite-dev-id"]}"` : "";
  return `<link rel="stylesheet" href="${attrs.href}"${devId} />`;
}

/**
 * SSR host helper for Ilha apps. Wires the generated `pageRouter` /
 * `registry` and the asset manifest into a single `fetch`-style handler so a
 * host entry collapses to:
 *
 * ```ts
 * import { IlhaHandler } from "@ilha/router/ssr";
 * import client from "./entry-client.ts?assets=client";
 * import server from "./entry-server.ts?assets=ssr";
 *
 * const handler = new IlhaHandler({
 *   assets: mergeAssets({ client, server }),
 *   head: appHead({ title: "My app", script: [{ children: "..." }] }),
 * });
 *
 * export default { fetch: (request: Request) => handler.handle(request) };
 * ```
 */
export class IlhaHandler {
  private readonly assets: Assets;
  private readonly lang: string;
  private readonly appId: string;
  private readonly clientEntry: string;
  private readonly head: HeadInput;
  private readonly renderOptions: HydratableRenderOptions;

  constructor(options: IlhaHandlerOptions) {
    this.assets = options.assets;
    this.lang = options.lang ?? "en";
    this.appId = options.appId ?? "app";
    this.clientEntry = options.clientEntry ?? "/entry-client.js";
    this.head = options.head ?? {};
    this.renderOptions = options.renderOptions ?? {};
  }

  /** Render the document shell around an already-rendered island body. */
  document(body: string, head?: SerializedHead): string {
    const clientEntry = this.assets.entry ?? this.clientEntry;
    const styles = this.assets.css.map(stylesheetTag).join("\n  ");
    // The base head (from options) is merged into the serialized head at render
    // time, so it already carries title/meta/scripts. Fall back to a generic
    // <title> only when nothing contributed one.
    const titleTag = head?.headTags.includes("<title") ? "" : `<title>Ilha</title>\n  `;
    const routeHead = head?.headTags ? `\n  ${head.headTags}` : "";
    const htmlAttrsStr = head?.htmlAttrs ?? "";
    const langFromHead = htmlAttrsStr.match(/\blang="([^"]*)"/)?.[1];
    const langAttr = langFromHead != null ? langFromHead : this.lang;
    const htmlAttrsWithoutLang = htmlAttrsStr.replace(/\s*lang="[^"]*"/, "");
    return `<!doctype html>
<html lang="${langAttr}"${htmlAttrsWithoutLang}>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${titleTag}<link rel="icon" href="/favicon.svg" />
  ${styles}${routeHead}
</head>
<body${head?.bodyAttrs ?? ""}>
  <div id="${this.appId}">${body}</div>
  <script type="module" src="${clientEntry}"></script>
</body>
</html>`;
  }

  /** Handle an incoming request and return a full HTML / redirect Response. */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Client-side navigation fetches loader data from this endpoint (see
    // `fetchLoaderData`). It must return JSON — without this branch the request
    // falls through to page rendering and the client gets HTML back ("Unexpected
    // token '<' … is not valid JSON").
    if (url.pathname === LOADER_ENDPOINT) {
      const path = url.searchParams.get("path") ?? "/";
      const result = await pageRouter.runLoader(path, request);
      const status =
        result.kind === "error" ? result.status : result.kind === "not-found" ? 404 : 200;
      return new Response(JSON.stringify(result), {
        status,
        headers: { "content-type": "application/json;charset=utf-8" },
      });
    }

    const href = url.href.slice(url.origin.length);

    const renderOptions: HydratableRenderOptions = { ...this.renderOptions, baseHead: this.head };
    const response = await pageRouter.renderResponse(href, registry, renderOptions, request);

    if (response.kind === "redirect") {
      return new Response(null, {
        status: response.status,
        headers: { location: response.to },
      });
    }

    const status = response.kind === "error" ? response.status : (response.status ?? 200);

    return new Response(this.document(response.html, response.head), {
      status,
      headers: { "content-type": "text/html;charset=utf-8" },
    });
  }
}
