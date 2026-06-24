declare module "ilha:pages/server" {
  import type { Island } from "ilha";

  import type { RouterBuilder } from "./index";
  export const pageRouter: RouterBuilder;
  export const registry: Record<string, Island<any, any>>;
}

declare module "ilha:loaders" {}
