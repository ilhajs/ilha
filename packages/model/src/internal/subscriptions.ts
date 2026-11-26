/**
 * What the runtime says about one `subscriptions` result: the key rule and the
 * duplicate-key failure. Ported from Effect UI's `internal/subscriptions.ts`.
 *
 * @internal
 */
import type * as Subscription from "../subscription.ts";

/**
 * The error for the instance at `path` whose `subscriptions` returned two
 * entries with `key`. A key runs one Stream, so the second would never start.
 *
 * @internal
 */
export const duplicateKey = (path: string, key: string): Error =>
  new Error(
    `${path}: two Subscriptions share the key ${key}. A key runs one Stream, so give each its own name or deps.`
  );

// Strings are JSON, so they're quoted and self-delimiting. Everything else is
// its literal: `NaN`, `Infinity` and `-Infinity` stay distinct from `null`, and
// `-0` from `0`, since `1 / dep` tells them apart.
const encodeDep = (dep: Subscription.Dep): string => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Dep is a string|number|boolean|null domain union; the branch selects its encoding, it does not parse input.
  if (typeof dep === "string") {
    return JSON.stringify(dep);
  }
  return Object.is(dep, -0) ? "-0" : String(dep);
};

// A colon separates the name from the deps, so a colon in a name is doubled.
const encodeName = (name: string): string => name.replaceAll(":", "::");

/**
 * The key a Subscription runs under: `name` alone, or `name` plus the
 * comma-joined deps. `1` and `"1"` differ, as do `["a,b","c"]` and
 * `["a","b,c"]`; `NaN` differs from `null` and `0` from `-0`.
 *
 * @internal
 */
export const keyOf = (name: string, deps?: Subscription.Deps): string => {
  if (deps === undefined) {
    return encodeName(name);
  }
  // SAFETY: a non-array Deps is a single Dep by its domain type, so wrapping keeps one Dep per element.
  const list = (Array.isArray(deps) ? deps : [deps as Subscription.Dep])
    .map(encodeDep)
    .join(",");
  return `${encodeName(name)}:${list}`;
};
