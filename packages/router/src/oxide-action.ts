/**
 * Oxide-branded server-action wrapper.
 *
 * Lives in its own module so `@ilha/router/vite` / the pages plugin can load
 * frame helpers without resolving the optional `oxidejs` peer.
 */

import { action, brandServerAction } from "oxidejs";

import type { SnapshotValue } from "./snapshot";

interface AtomTagged {
  $$atom?: number;
}

/** Brand an exported server action with its generated RPC transport key. */
export const __ilhaServerAction = <
  A extends SnapshotValue[],
  R extends SnapshotValue,
>(
  key: string,
  fn: (...args: A) => R | Promise<R>
) => {
  // SAFETY: oxide action handles carry $$atom === 1; plain functions are wrapped.
  const tagged = fn as AtomTagged & typeof fn;
  // SAFETY: $$atom brand marks an existing oxide action; otherwise wrap with action().
  const handle =
    tagged.$$atom === 1
      ? (fn as ReturnType<typeof action<A, Awaited<R>>>)
      : action(fn as (...args: A) => Awaited<R>);
  return brandServerAction(key, handle);
};
