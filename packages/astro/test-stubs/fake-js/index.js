// Minimal `solid-js` test stub — just enough for the fixture's `Counter.tsx`
// (createSignal + a JSX runtime that builds a stringifiable tree). Replaces
// the real dependency in integration tests only; this is NOT shipped.

const objectTag = (value) => Object.prototype.toString.call(value);

const isFunction = (value) => {
  const tag = objectTag(value);
  return (
    tag === "[object Function]" ||
    tag === "[object AsyncFunction]" ||
    tag === "[object GeneratorFunction]"
  );
};

export const createSignal = (initialValue) => {
  let value = initialValue;
  const get = () => value;
  const set = (next) => {
    if (isFunction(next)) {
      return (value = next(value));
    }
    value = next;
  };
  return [get, set];
};
