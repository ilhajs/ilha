// Server (SSR) entrypoint for the `@astrojs/fake-integration` stub renderer.
// Mimics the observable behavior the @ilha/astro routing test asserts: a
// permissive `check` (claims any function component), `data-hk` hydration
// markers in the emitted markup, and a `data-solid-render-id` attr on the
// island element. Does NOT run Solid's real runtime.

const objectTag = (value) => Object.prototype.toString.call(value);

const isNumber = (value) => objectTag(value) === "[object Number]";

const isObject = (value) =>
  value !== null && objectTag(value) === "[object Object]";

const isFunction = (value) => {
  const tag = objectTag(value);
  return (
    tag === "[object Function]" ||
    tag === "[object AsyncFunction]" ||
    tag === "[object GeneratorFunction]"
  );
};

const escapeHtml = (value) =>
  String(value).replaceAll(
    /[&<>"']/gu,
    (c) =>
      ({ '"': "&quot;", "&": "&amp;", "'": "&#39;", "<": "&lt;", ">": "&gt;" })[
        c
      ]
  );

// Serializes the `{ type, props }` tree produced by the solid-js jsx-runtime
// stub. Event handlers (`on*`) and `ref` are dropped.
const serialize = (node) => {
  if (node === null || node === false) {
    return "";
  }
  if (Array.isArray(node)) {
    return node.map(serialize).join("");
  }
  if (isNumber(node)) {
    return String(node);
  }
  if (isObject(node) && node.type) {
    const props = node.props ?? {};
    let attrs = " data-hk";
    let children;
    for (const [key, value] of Object.entries(props)) {
      if (key === "children") {
        children = value;
        continue;
      }
      if (key === "ref" || (key.startsWith("on") && key.length > 2)) {
        continue;
      }
      if (value === null || value === false) {
        continue;
      }
      attrs += value === true ? ` ${key}` : ` ${key}="${escapeHtml(value)}"`;
    }
    return `<${node.type}${attrs}>${serialize(children)}</${node.type}>`;
  }
  return escapeHtml(node === null ? "" : String(node));
};

export default {
  check(Component) {
    return isFunction(Component);
  },
  async renderToStaticMarkup(Component, props) {
    const tree = await Component(props ?? {});
    const html = serialize(tree);
    const renderId = `stub-${Math.random().toString(36).slice(2)}`;
    return { attrs: { "data-solid-render-id": renderId }, html };
  },
  supportsAstroStaticPaths: () => Promise.resolve(false),
};
