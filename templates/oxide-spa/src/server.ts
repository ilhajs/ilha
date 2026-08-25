import { setFrameAuth } from "@ilha/router/ssr";

// Oxide server entry. Return a Response to handle a request yourself;
// return undefined to fall through to the @ilha/router SSR middleware,
// static files, and index.html.
//
// Frames (server-page + server-island rendering) are deny-by-default in
// production. This demo serves world-readable state, so open them:
setFrameAuth({ defaultAction: "open" });

export default {
  async fetch() {
    return null as unknown as undefined;
  },
};
