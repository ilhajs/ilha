/**
 * Request scope for server-owned island rendering.
 *
 * A `.server.tsx` island's render function always executes on the server —
 * page SSR through the router, or streamed frames through the plugin's
 * `/__ilha/frame` endpoint. Both seed this scope with the originating
 * `Request`, so render functions can read request data (URL, headers,
 * cookies) through `useContext().request` or a host integration such as Oxide's `useRequest()`.
 *
 * The storage lives on `globalThis` under `ilha.requestAls` so every module
 * copy (plugin bundle, SSR graph) shares one instance. The public accessor
 * is `useContext()` from the main `@ilha/router` entry, which reads the
 * storage without importing `node:async_hooks`; this node-only module is the
 * sole place that constructs it.
 *
 * StackBlitz WebContainers lose AsyncLocalStorage across `async/await`. A
 * module sync fallback keeps `useContext().request` readable for the lifetime
 * of `runWithIslandRequest` (same approach as oxidejs).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import process from "node:process";

import { REQUEST_ALS_KEY } from "./als-key";

export { REQUEST_ALS_KEY } from "./als-key";
export type { IslandContext } from "./index";

/** Installed by oxidejs when its module loads. Lets `useRequest()` resolve
 * inside island renders and frames, not just `/__oxide/action`. */
const OXIDE_RUN_WITH_REQUEST = Symbol.for("oxidejs.runWithRequest");

type OxideRunWithRequest = <T>(req: Request, fn: () => T) => T;

interface RequestScope {
  getStore: () => Request | undefined;
}

type GlobalSymbolSlots = Record<
  symbol,
  RequestScope | OxideRunWithRequest | undefined
>;

const innerAls = new AsyncLocalStorage<Request>();
let syncStore: Request | null = null;
let webcontainerOverride: boolean | null = null;

const inWebcontainer = (): boolean => {
  if (webcontainerOverride !== null) {
    return webcontainerOverride;
  }
  // This module is Node-only (`node:async_hooks` / `node:process`).
  // SAFETY: StackBlitz sets `process.versions.webcontainer` as an index string.
  const versions = process.versions as NodeJS.ProcessVersions & {
    webcontainer?: string;
  };
  return Boolean(versions.webcontainer);
};

/** Test-only: force or clear the WebContainer detection path. */
export const __setInWebcontainerForTests = (value: boolean | null): void => {
  webcontainerOverride = value;
};

const restoreAfterAsync = async <T>(
  request: Request,
  previous: Request | null,
  result: PromiseLike<T>
): Promise<T> => {
  try {
    return await result;
  } finally {
    if (syncStore === request) {
      syncStore = previous;
    }
  }
};

const ensureScope = (): RequestScope => {
  // SAFETY: REQUEST_ALS_KEY holds our RequestScope facade or is unset.
  const g = globalThis as GlobalSymbolSlots;
  const existing = g[REQUEST_ALS_KEY];
  if (existing && "getStore" in existing) {
    // SAFETY: only RequestScope objects are written to REQUEST_ALS_KEY here.
    return existing as RequestScope;
  }
  const scope: RequestScope = {
    getStore: () => innerAls.getStore() ?? syncStore ?? undefined,
  };
  g[REQUEST_ALS_KEY] = scope;
  return scope;
};

/** Run `fn` with `request` available to `useContext().request`. When oxidejs
 * is loaded, its action scope is entered too, so `useRequest()` works in
 * island renders and streamed frames. */
export const runWithIslandRequest = <T>(request: Request, fn: () => T): T => {
  ensureScope();
  // SAFETY: REQUEST_ALS_KEY / oxide runWithRequest live on globalThis so every
  // module copy shares one slot; only those well-known symbols are touched.
  const g = globalThis as GlobalSymbolSlots;
  const oxideSlot = g[OXIDE_RUN_WITH_REQUEST];
  // SAFETY: oxide installs runWithRequest under this well-known symbol.
  const oxide =
    oxideSlot === undefined ? undefined : (oxideSlot as OxideRunWithRequest);

  const previous = syncStore;
  syncStore = request;
  try {
    const result = innerAls.run(request, () =>
      oxide ? oxide(request, fn) : fn()
    );
    if (inWebcontainer() && result instanceof Promise) {
      // SAFETY: T is a Promise when fn is async; callers await the return value.
      return restoreAfterAsync(request, previous, result) as T;
    }
    return result;
  } finally {
    if (!inWebcontainer()) {
      syncStore = previous;
    }
  }
};
