// Solid's JSX runtime, stubbed to build a plain `{ type, props }` tree that
// the @astrojs/solid-js stub's `renderToStaticMarkup` can serialize.
// Matches the runtime shape Solid's compiled JSX (automatic mode) expects.
export const Fragment = (props) => props.children;

export const jsx = (type, props) => ({ props, type });
export const jsxs = jsx;
export const jsxDEV = jsx;
