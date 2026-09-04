import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import { failureMessage } from "./errors.ts";
import type { View } from "./types.ts";

export const KEY_ATTR = "data-ilha-key";
export const SLOT_ATTR = "data-ilha-slot";

export const ISLAND = Symbol.for("ilha.island");
export const ISLAND_MOUNT_INTERNAL = Symbol.for("ilha.islandMountInternal");
export const ISLAND_SLOT_TAG = Symbol.for("ilha.islandSlotTag");

const objectTag = <T>(value: T): string =>
  Object.prototype.toString.call(value);

export type AnyFn = (...args: never[]) => void;

export const isBoolean = <T>(value: T): value is Extract<T, boolean> =>
  value === true || value === false;

export const isString = <T>(value: T): value is Extract<T, string> =>
  objectTag(value) === "[object String]";

export const isNumber = <T>(value: T): value is Extract<T, number> =>
  objectTag(value) === "[object Number]";

export const isBigInt = <T>(value: T): value is Extract<T, bigint> =>
  objectTag(value) === "[object BigInt]";

export const isFunction = <T>(value: T): value is Extract<T, AnyFn> => {
  const tag = objectTag(value);
  return (
    tag === "[object Function]" ||
    tag === "[object AsyncFunction]" ||
    tag === "[object GeneratorFunction]"
  );
};

export const isObject = <T>(value: T): value is Extract<T, object> =>
  value !== null && objectTag(value) === "[object Object]";

export const skip = <T>(x: T): boolean =>
  x === null || x === undefined || isBoolean(x);

export const KEEP = Symbol("ilha.keep");

export const unwrap = <T>(
  value: T,
  keep: View | undefined
): View | typeof KEEP => {
  if (AsyncResult.isAsyncResult(value)) {
    if (AsyncResult.isWaiting(value) && keep !== undefined) {
      return KEEP;
    }
    if (AsyncResult.isFailure(value) && !AsyncResult.isWaiting(value)) {
      return String(AsyncResult.error(value) ?? "error");
    }
    const v = AsyncResult.value(value);
    if (v._tag === "Some") {
      // SAFETY: AsyncResult Some payload is the view materialize already accepted.
      return v.value as View;
    }
    return "";
  }
  // SAFETY: non-AsyncResult paint inputs are View (vnode/text/component/stream).
  return value as View;
};

export const errorView = <T>(e: T): View => ({
  $$ilha: 1,
  children: [failureMessage(e)],
  props: { "data-ilha-error": "" },
  type: "pre",
});
