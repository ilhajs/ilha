/**
 * Request scope for server-owned island rendering.
 *
 * A `.server.tsx` island's render function always executes on the server —
 * page SSR through the router, or streamed frames through the plugin's
 * `/__ilha/frame` endpoint. Both seed this scope with the originating
 * `Request`, so render functions can read request data (URL, headers,
 * cookies) without depending on Oxide's action-only `useRequest()`.
 *
 * The storage lives on `globalThis` under `ilha.requestAls` so every module
 * copy (plugin bundle, SSR graph) shares one instance. The public accessor
 * is `useContext()` from the main `@ilha/router` entry, which reads the
 * storage without importing `node:async_hooks`; this node-only module is the
 * sole place that constructs it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { IslandContext } from "./index";

export const REQUEST_ALS_KEY = Symbol.for("ilha.requestAls");

/** Run `fn` with `request` available to `useContext().request`. */
export function runWithIslandRequest<T>(request: Request, fn: () => T): T {
  const g = globalThis as unknown as Record<symbol, AsyncLocalStorage<Request> | undefined>;
  const als = (g[REQUEST_ALS_KEY] ??= new AsyncLocalStorage<Request>());
  return als.run(request, fn);
}

export type { IslandContext };
