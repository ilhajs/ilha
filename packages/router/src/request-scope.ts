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
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { REQUEST_ALS_KEY } from "./als-key";

export { REQUEST_ALS_KEY } from "./als-key";
export type { IslandContext } from "./index";

/** Installed by oxidejs when its module loads. Lets `useRequest()` resolve
 * inside island renders and frames, not just `/__oxide/action`. */
const OXIDE_RUN_WITH_REQUEST = Symbol.for("oxidejs.runWithRequest");

type OxideRunWithRequest = <T>(req: Request, fn: () => T) => T;

type GlobalSymbolSlots = Record<
  symbol,
  AsyncLocalStorage<Request> | OxideRunWithRequest | undefined
>;

/** Run `fn` with `request` available to `useContext().request`. When oxidejs
 * is loaded, its action scope is entered too, so `useRequest()` works in
 * island renders and streamed frames. */
export const runWithIslandRequest = <T>(request: Request, fn: () => T): T => {
  // SAFETY: REQUEST_ALS_KEY / oxide runWithRequest live on globalThis so every
  // module copy shares one AsyncLocalStorage. Only those two well-known
  // symbols are read or written here.
  const g = globalThis as GlobalSymbolSlots;
  const existing = g[REQUEST_ALS_KEY];
  let als: AsyncLocalStorage<Request>;
  if (existing instanceof AsyncLocalStorage) {
    als = existing;
  } else {
    als = new AsyncLocalStorage<Request>();
    g[REQUEST_ALS_KEY] = als;
  }
  const oxideSlot = g[OXIDE_RUN_WITH_REQUEST];
  // SAFETY: oxide installs runWithRequest under this well-known symbol; the
  // slot is either that function or undefined.
  const oxide =
    oxideSlot === undefined ? undefined : (oxideSlot as OxideRunWithRequest);
  return als.run(request, () => (oxide ? oxide(request, fn) : fn()));
};
