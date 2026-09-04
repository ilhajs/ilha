/**
 * Shared, decoded-aware route pattern matching used by both the router
 * (`index.ts`) and the server-frame path (`ssr.ts`) so the
 * two never drift on segment semantics or parameter decoding.
 *
 * Patterns support `:name` segments, a bare mid-pattern `*` (one segment), and
 * a trailing `/**:name` catch-all. Static segments take priority over params,
 * which take priority over catch-alls — callers sort by that before matching.
 */

export interface ParsedPattern {
  segments: string[];
  kinds: number[];
}

const segmentKind = (segment: string): number => {
  if (segment.startsWith("*")) {
    return 0;
  }
  if (segment.startsWith(":")) {
    return 1;
  }
  return 2;
};

export const parsePattern = (pattern: string): ParsedPattern => {
  const segments = pattern.split("/").filter(Boolean);
  const kinds = segments.map(segmentKind);
  return { kinds, segments };
};

/**
 * Match `segments` against a pathname. Returns raw (still-encoded) captured
 * params, or `null` when the path doesn't match — the caller decides whether to
 * decode via {@link safeDecode}.
 */
export const matchSegments = (
  segments: string[],
  pathname: string
): Record<string, string> | null => {
  const pathSegments = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  let cursor = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === undefined) {
      return null;
    }
    const isLast = i === segments.length - 1;
    if (segment.startsWith("**") && isLast) {
      // Trailing catch-all consumes the rest — including nothing. Named
      // (`/**:slug`) captures the raw remainder; callers decode it.
      const name = segment.slice(2).replace(/^:/u, "");
      if (name) {
        params[name] = pathSegments.slice(cursor).join("/");
      }
      cursor = pathSegments.length;
      break;
    }
    if (segment.startsWith("*")) {
      // Bare mid-pattern `*` matches exactly one segment — never a catch-all.
      if (pathSegments[cursor] === undefined) {
        return null;
      }
      cursor += 1;
      continue;
    }
    if (segment.startsWith(":")) {
      const value = pathSegments[cursor];
      if (value === undefined) {
        return null;
      }
      params[segment.slice(1)] = value;
      cursor += 1;
    } else if (pathSegments[cursor] === segment) {
      cursor += 1;
    } else {
      return null;
    }
  }
  return cursor === pathSegments.length ? params : null;
};

/** Decode a route-param value, tolerating malformed percent-encoding. */
export const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
