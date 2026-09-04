/**
 * Defensive parser for `data-ilha-state` / `data-ilha-props` snapshot
 * attributes on the router side. Mirrors the core ilha guards: size cap,
 * plain-object check, depth cap, and prototype-key stripping. Returns
 * undefined (degrade gracefully) on any failure.
 */

const MAX_SNAPSHOT_CHARS = 256 * 1024;
const MAX_SNAPSHOT_DEPTH = 32;

const objectTag = <T>(value: T): string =>
  Object.prototype.toString.call(value);

const isObject = <T>(value: T): value is Extract<T, object> =>
  value !== null && objectTag(value) === "[object Object]";

/** JSON leaf values accepted in SSR hydrate snapshots. */
export type SnapshotLeaf = string | number | boolean | null;

/** JSON values accepted in SSR hydrate snapshots. */
export type SnapshotValue =
  | SnapshotLeaf
  | SnapshotObject
  | readonly SnapshotValue[];

export interface SnapshotObject {
  readonly [key: string]: SnapshotValue | undefined;
}

const exceedsMaxDepth = <T>(value: T, depth: number): boolean => {
  if (depth > MAX_SNAPSHOT_DEPTH) {
    return true;
  }
  if (value === null || !isObject(value)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (exceedsMaxDepth(item, depth + 1)) {
          return true;
        }
      }
    }
    return false;
  }
  // SAFETY: isObject narrowed to a plain object; keys are snapshot field names.
  const obj = value as SnapshotObject;
  for (const key of Object.keys(obj)) {
    if (exceedsMaxDepth(obj[key], depth + 1)) {
      return true;
    }
  }
  return false;
};

const deleteUnsafeKey = (
  obj: SnapshotObject,
  key: "__proto__" | "constructor" | "prototype"
): void => {
  if (Object.hasOwn(obj, key)) {
    Reflect.deleteProperty(obj, key);
  }
};

const stripUnsafeKeys = <T>(value: T): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      stripUnsafeKeys(item);
    }
    return;
  }
  if (value === null || !isObject(value)) {
    return;
  }
  // SAFETY: isObject narrowed to a plain object we mutate in place.
  const obj = value as SnapshotObject;
  deleteUnsafeKey(obj, "__proto__");
  deleteUnsafeKey(obj, "constructor");
  deleteUnsafeKey(obj, "prototype");
  for (const key of Object.getOwnPropertyNames(obj)) {
    stripUnsafeKeys(obj[key]);
  }
};

export const sanitizeSnapshotObject = <T>(
  value: T
): SnapshotObject | undefined => {
  if (!isObject(value) || Array.isArray(value)) {
    return undefined;
  }
  if (exceedsMaxDepth(value, 1)) {
    return undefined;
  }
  stripUnsafeKeys(value);
  // SAFETY: isObject + stripUnsafeKeys left a plain SnapshotObject.
  return value as SnapshotObject;
};

export const parseSnapshotAttr = (raw: string): SnapshotObject | undefined => {
  if (raw.length > MAX_SNAPSHOT_CHARS) {
    return undefined;
  }
  let parsed: SnapshotValue | undefined;
  try {
    // SAFETY: JSON.parse yields JSON; sanitizeSnapshotObject validates shape.
    parsed = JSON.parse(raw) as SnapshotValue;
  } catch {
    return undefined;
  }
  return sanitizeSnapshotObject(parsed);
};
