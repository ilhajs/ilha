// =============================================================================
// Property-path capture + immutable updates for store.bind(selector)
// =============================================================================

export type PathSegment = string | number;

const BIND_PATH_ERROR =
  "store.bind(selector) only supports property-path selectors like `s => s.user.name`.";

function toPathSegment(prop: string | symbol, isArray: boolean): PathSegment | null {
  if (typeof prop === "symbol") return null;
  if (isArray && prop === "length") return null;
  if (isArray && /^\d+$/.test(prop)) return Number(prop);
  return prop;
}

function getAtPath(obj: unknown, path: readonly PathSegment[]): unknown {
  let cur = obj;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

export function setIn(root: unknown, path: readonly PathSegment[], value: unknown): unknown {
  if (path.length === 0) return value;

  const [head, ...tail] = path;
  const base = root ?? (typeof head === "number" ? [] : {});
  const clone = Array.isArray(base) ? [...base] : { ...(base as object) };
  (clone as Record<string | number, unknown>)[head as string | number] = setIn(
    (base as Record<string | number, unknown>)[head as string | number],
    tail,
    value,
  );
  return clone;
}

function trackPropertyPath<T, S>(rootState: T, selector: (state: T) => S): readonly PathSegment[] {
  const path: PathSegment[] = [];
  const track = (value: unknown): unknown => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      return value;
    }
    return new Proxy(value as object, {
      get(target, prop, receiver) {
        const seg = toPathSegment(prop, Array.isArray(target));
        if (seg != null) path.push(seg);
        const next = Reflect.get(target, prop, receiver);
        return seg != null && next !== null && typeof next === "object" ? track(next) : next;
      },
    });
  };
  selector(track(rootState) as T);
  return path;
}

export function capturePropertyPath<T extends object, S>(
  getState: () => T,
  selector: (state: T) => S,
): readonly PathSegment[] {
  const state = getState();
  const path = trackPropertyPath(state, selector);
  const selected = selector(state);
  const resolved = path.length === 0 ? state : getAtPath(state, path);
  if (typeof selected === "function" || !Object.is(selected, resolved) || path.length === 0) {
    throw new Error(BIND_PATH_ERROR);
  }
  return path;
}

export function patchStateAtPath<T extends object>(
  state: T,
  path: readonly PathSegment[],
  value: unknown,
): Partial<T> {
  const topKey = path[0];
  const rest = path.slice(1);
  const topValue = (state as Record<string | number, unknown>)[topKey as string | number];
  const nextTopValue = setIn(topValue, rest, value);
  return { [topKey]: nextTopValue } as Partial<T>;
}
