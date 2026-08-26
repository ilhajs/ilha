import "ilha";
import { bindServerAction, type ServerAction } from "ilha/internal";

/**
 * Declare an Oxide RPC action that can also be passed directly to server-island
 * event props or bound to a serializable payload with `.with()`.
 */
export function action<A extends unknown[], R>(fn: (...args: A) => R): ServerAction<A, R> {
  return bindServerAction(fn);
}

export type { ServerAction } from "ilha/internal";
