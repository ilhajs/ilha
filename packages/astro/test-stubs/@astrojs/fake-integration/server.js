// Server (SSR) entrypoint for the `@astrojs/fake-integration` stub renderer.
// Mimics the observable behavior the @ilha/astro routing test asserts: a
// permissive `check` (claims any function component), `data-hk` hydration
// markers in the emitted markup, and a `data-solid-render-id` attr on the
// island element. Does NOT run Solid's real runtime.
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// Serializes the `{ type, props }` tree produced by the solid-js jsx-runtime
// stub. Event handlers (`on*`) and `ref` are dropped.
function serialize(node) {
  if (node == null || node === false) return "";
  if (Array.isArray(node)) return node.map(serialize).join("");
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && node.type) {
    const props = node.props ?? {};
    let attrs = " data-hk";
    let children;
    for (const [key, value] of Object.entries(props)) {
      if (key === "children") {
        children = value;
        continue;
      }
      if (key === "ref" || (key.startsWith("on") && key.length > 2)) continue;
      if (value == null || value === false) continue;
      attrs += value === true ? ` ${key}` : ` ${key}="${escapeHtml(value)}"`;
    }
    return `<${node.type}${attrs}>${serialize(children)}</${node.type}>`;
  }
  return escapeHtml(node == null ? "" : String(node));
}

export default {
  check(Component) {
    return typeof Component === "function";
  },
  supportsAstroStaticPaths: async () => false,
  async renderToStaticMarkup(Component, props) {
    const tree = await Component(props ?? {});
    const html = serialize(tree);
    const renderId = "stub-" + Math.random().toString(36).slice(2);
    return { html, attrs: { "data-solid-render-id": renderId } };
  },
};
