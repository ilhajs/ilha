import type { Plugin } from "vite";

export type { LayoutHandler, ErrorHandler, RouteSnapshot, AppError } from "./index";

export { ilhaPages, type IlhaPagesOptions } from "./plugin";

import { ilhaPages, type IlhaPagesOptions } from "./plugin";

/** Vite plugin — use via `@ilha/router/vite`. */
export function pages(options: IlhaPagesOptions = {}): Plugin {
  return ilhaPages.vite(options) as Plugin;
}
