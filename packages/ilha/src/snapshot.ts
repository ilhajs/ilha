const MAX_SNAPSHOT_CHARS = 256 * 1024;
const MAX_SNAPSHOT_DEPTH = 32;
const UNSAFE_SNAPSHOT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export const STATE_COMMENT = "ilha-state:";

function exceedsMaxDepth(value: unknown, depth: number): boolean {
  if (depth > MAX_SNAPSHOT_DEPTH) return true;
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (const item of value) if (exceedsMaxDepth(item, depth + 1)) return true;
    return false;
  }
  for (const key of Object.keys(value as object)) {
    if (exceedsMaxDepth((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

function stripUnsafeKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) stripUnsafeKeys(item);
    return;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (UNSAFE_SNAPSHOT_KEYS.has(key)) delete (value as Record<string, unknown>)[key];
    else stripUnsafeKeys((value as Record<string, unknown>)[key]);
  }
}

function safeParseSnapshot(raw: string): Record<string, unknown> | undefined {
  if (raw.length > MAX_SNAPSHOT_CHARS) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (exceedsMaxDepth(parsed, 1)) return undefined;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  stripUnsafeKeys(parsed);
  return parsed as Record<string, unknown>;
}

export function encodeSnapshot(values: unknown[]): string {
  return JSON.stringify({ v: values });
}

export function decodeSnapshot(raw: string): unknown[] | undefined {
  const parsed = safeParseSnapshot(raw) as { v?: unknown[] } | undefined;
  return Array.isArray(parsed?.v) ? parsed.v : undefined;
}
