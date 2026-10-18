import * as AsyncResult from "effect/reactivity/AsyncResult";

import type { View } from "./types.ts";

export const KEY_ATTR = "data-ilha-key";
export const SLOT_ATTR = "data-ilha-slot";

export type AnyFn = (...args: never[]) => void;

export const isString = <T>(value: T): value is Extract<T, string> =>
  typeof value === "string";

export const isFunction = <T>(value: T): value is Extract<T, AnyFn> =>
  typeof value === "function";

/** Non-null, non-array object. */
export const isObject = <T>(value: T): value is Extract<T, object> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `value` carries ilha's runtime brand `key` (set to `1`). */
export const hasBrand = <T>(value: T, key: string): boolean =>
  (isObject(value) || isFunction(value)) &&
  Object.getOwnPropertyDescriptor(value, key)?.value === 1;

/** Arrays and other iterable objects (not strings). */
export const isIterable = <T>(
  value: T
): value is Extract<T, Iterable<unknown>> =>
  (Array.isArray(value) || isObject(value)) && Symbol.iterator in value;

export const noop = (): void => {
  /* nothing to do */
};

/** Views that paint nothing. */
export const skip = <T>(x: T): boolean =>
  x === null || x === undefined || x === true || x === false;

export const KEEP = Symbol("ilha.keep");

/** Normalize any thrown value into an `Error`. */
export const toError = <T>(e: T): Error =>
  e instanceof Error ? e : new Error(String(e));

/** Unwrap an atom value for painting; `AsyncResult` waits keep the last view. */
export const unwrap = <T>(value: T, keep?: View): View | typeof KEEP => {
  if (!AsyncResult.isAsyncResult(value)) {
    // SAFETY: non-AsyncResult paint inputs are View (vnode/text/component/stream).
    return value as View;
  }
  if (AsyncResult.isWaiting(value) && keep !== undefined) {
    return KEEP;
  }
  if (AsyncResult.isFailure(value)) {
    return String(AsyncResult.error(value) ?? "error");
  }
  const v = AsyncResult.value(value);
  // SAFETY: AsyncResult Some payload is the view materialize already accepted.
  return v._tag === "Some" ? (v.value as View) : "";
};

export const errorView = <T>(e: T): View => ({
  $$ilha: 1,
  children: [toError(e).message],
  props: { "data-ilha-error": "" },
  type: "pre",
});
