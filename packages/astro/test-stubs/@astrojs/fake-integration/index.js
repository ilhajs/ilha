// `@astrojs/fake-integration` test stub — an Astro integration registering a
// permissive renderer (accepts any function component), exactly the behavior
// the @ilha/astro routing fix is tested against. Replaces the real dependency
// in integration tests only; this is NOT shipped.
export const getRenderer = () => ({
  clientEntrypoint: "@astrojs/fake-integration/client.js",
  name: "@astrojs/fake-integration",
  serverEntrypoint: "@astrojs/fake-integration/server.js",
});

export default function solidJs(_options = {}) {
  return {
    hooks: {
      "astro:config:setup"({ addRenderer }) {
        addRenderer(getRenderer());
      },
    },
    name: "@astrojs/fake-integration",
  };
}
