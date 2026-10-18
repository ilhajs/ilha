import { isObject } from "./shared.ts";
import type { JsonText } from "./types.ts";

const MAX_SNAPSHOT_CHARS = 256 * 1024;
const MAX_SNAPSHOT_DEPTH = 32;
const UNSAFE_KEY = /^(?:__proto__|constructor|prototype)$/u;

/** JSON values accepted in SSR hydrate snapshots. */
export type SnapshotValue =
  | JsonText
  | SnapshotObject
  | readonly SnapshotValue[];

export interface SnapshotObject {
  readonly [key: string]: SnapshotValue | undefined;
}

/** Container nesting depth of a parsed JSON value. */
const depthOf = (value: SnapshotValue | undefined): number => {
  if (!Array.isArray(value) && !isObject(value)) {
    return 0;
  }
  let max = 0;
  for (const child of Object.values(value)) {
    max = Math.max(max, depthOf(child));
  }
  return max + 1;
};

export const encodeSnapshot = (values: readonly SnapshotValue[]): string =>
  JSON.stringify({ v: values });

/** Parse a snapshot; oversized, too deep, or malformed input yields `undefined`. */
export const decodeSnapshot = (raw: string): SnapshotValue[] | undefined => {
  if (raw.length > MAX_SNAPSHOT_CHARS) {
    return undefined;
  }
  let parsed: SnapshotValue | undefined;
  try {
    // The reviver drops prototype-polluting keys at every level.
    parsed = JSON.parse(raw, (k: string, v: SnapshotValue) =>
      UNSAFE_KEY.test(k) ? undefined : v
    );
  } catch {
    return undefined;
  }
  if (!isObject(parsed) || depthOf(parsed) > MAX_SNAPSHOT_DEPTH) {
    return undefined;
  }
  const values = "v" in parsed ? parsed.v : undefined;
  return Array.isArray(values) ? values : undefined;
};
