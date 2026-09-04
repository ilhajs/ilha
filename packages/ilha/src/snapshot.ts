import { isObject } from "./shared.ts";
import type { JsonText } from "./types.ts";

const MAX_SNAPSHOT_CHARS = 256 * 1024;
const MAX_SNAPSHOT_DEPTH = 32;
export const STATE_COMMENT = "ilha-state:";

/** JSON values accepted in SSR hydrate snapshots. */
export type SnapshotValue =
  | JsonText
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

const safeParseSnapshot = (raw: string): SnapshotObject | undefined => {
  if (raw.length > MAX_SNAPSHOT_CHARS) {
    return undefined;
  }
  let parsed: SnapshotValue | undefined;
  try {
    // SAFETY: JSON.parse yields JSON; we validate shape before returning.
    parsed = JSON.parse(raw) as SnapshotValue;
  } catch {
    return undefined;
  }
  if (exceedsMaxDepth(parsed, 1)) {
    return undefined;
  }
  if (!isObject(parsed) || Array.isArray(parsed)) {
    return undefined;
  }
  stripUnsafeKeys(parsed);
  // SAFETY: isObject + stripUnsafeKeys left a plain SnapshotObject.
  return parsed as SnapshotObject;
};

export const encodeSnapshot = (values: readonly SnapshotValue[]): string =>
  JSON.stringify({ v: values });

export const decodeSnapshot = (raw: string): SnapshotValue[] | undefined => {
  const parsed = safeParseSnapshot(raw);
  const values = parsed?.v;
  return Array.isArray(values) ? values : undefined;
};
