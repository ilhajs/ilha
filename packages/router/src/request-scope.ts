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
 * module sync fallback keeps `useContext().request` readable, and fallback
 * entries are serialized so concurrent renders cannot stomp each other.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { REQUEST_ALS_KEY } from "./als-key";
import { __setInWebcontainerForTests, inWebcontainer } from "./webcontainer";

export { REQUEST_ALS_KEY } from "./als-key";
export { __setInWebcontainerForTests } from "./webcontainer";
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
/** When true, getStore ignores ALS so tests exercise the sync fallback path. */
let alsBypassForTests = false;
/** Serialize WebContainer fallback entries (set syncStore → run → clear). */
let fallbackTail: Promise<null> = Promise.resolve(null);

/** Test-only: force getStore() to skip ALS (simulates WebContainer ALS loss). */
export const __setAlsBypassForTests = (value: boolean): void => {
  alsBypassForTests = value;
};

const withFallbackEntry = async <T>(fn: () => Promise<T>): Promise<T> => {
  const previous = fallbackTail;
  const next = Promise.withResolvers<null>();
  fallbackTail = next.promise;
  await previous;
  try {
    return await fn();
  } finally {
    next.resolve(null);
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
    getStore: () =>
      (alsBypassForTests ? undefined : innerAls.getStore()) ??
      syncStore ??
      undefined,
  };
  g[REQUEST_ALS_KEY] = scope;
  return scope;
};

const runScoped = <T>(
  request: Request,
  oxide: OxideRunWithRequest | undefined,
  fn: () => T
): T => innerAls.run(request, () => (oxide ? oxide(request, fn) : fn()));

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

  if (!inWebcontainer()) {
    return runScoped(request, oxide, fn);
  }

  // WebContainer: one syncStore owner at a time for the full entry lifetime.
  // SAFETY: T is awaited by SSR/frame callers when fn is async.
  return withFallbackEntry(async () => {
    const previous = syncStore;
    syncStore = request;
    try {
      return await Promise.resolve(runScoped(request, oxide, fn));
    } finally {
      syncStore = previous;
    }
  }) as T;
};
