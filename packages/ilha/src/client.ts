import * as Context from "effect/Context";

/**
 * Browser-only services, provided by `mount` to the effects run in fibers. The server never provides it: a component that needs `Client` fails `renderToString` at compile time, and `Component.clientOnly` (in `@ilha/model`) renders a fallback there instead.
 */
export class Client extends Context.Service<
  Client,
  {
    readonly window: Window;
    readonly document: Document;
  }
>()("ilha/Client") {}
