declare module "ilha:pages/server" {
  import type { Page, RouterBuilder } from "./index";
  export const pageRouter: RouterBuilder;
  export const registry: Record<string, Page>;
}

declare module "ilha:pages/client" {
  import type { Page, RouterBuilder } from "./index";
  export const pageRouter: RouterBuilder;
  export const registry: Record<string, Page>;
}

declare module "ilha:loaders" {
  // Side-effect-only module. oxidejs imports it alongside @ilha/router/ssr.
}
