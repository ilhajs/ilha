// Minimal `solid-js` test stub — just enough for the fixture's `Counter.tsx`
// (createSignal + a JSX runtime that builds a stringifiable tree). Replaces
// the real dependency in integration tests only; this is NOT shipped.
export function createSignal(initialValue) {
  let value = initialValue;
  const get = () => value;
  const set = (next) => {
    value = typeof next === "function" ? next(value) : next;
  };
  return [get, set];
}
