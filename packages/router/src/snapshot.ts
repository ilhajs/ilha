/**
 * Defensive parser for `data-ilha-state` / `data-ilha-props` snapshot
 * attributes on the router side. Mirrors the core ilha guards: size cap,
 * plain-object check, depth cap, and prototype-key stripping. Returns
 * undefined (degrade gracefully) on any failure.
 */
const MAX_SNAPSHOT_CHARS = 256 * 1024;
const MAX_SNAPSHOT_DEPTH = 32;
const UNSAFE_SNAPSHOT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function stripUnsafeKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) stripUnsafeKeys(item);
    return;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (UNSAFE_SNAPSHOT_KEYS.has(key)) {
      delete (value as Record<string, unknown>)[key];
    } else {
      stripUnsafeKeys((value as Record<string, unknown>)[key]);
    }
  }
}

function exceedsDepth(value: unknown, depth: number): boolean {
  if (depth > MAX_SNAPSHOT_DEPTH) return true;
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (const item of value) if (exceedsDepth(item, depth + 1)) return true;
    return false;
  }
  for (const key in value as Record<string, unknown>) {
    if (!Object.hasOwn(value, key)) continue;
    if (exceedsDepth((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

export function parseSnapshotAttr(raw: string): Record<string, unknown> | undefined {
  if (raw.length > MAX_SNAPSHOT_CHARS) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  if (exceedsDepth(parsed, 1)) return undefined;
  stripUnsafeKeys(parsed);
  return parsed as Record<string, unknown>;
}
