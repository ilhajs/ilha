export type { LayoutHandler, ErrorHandler, RouteSnapshot, AppError } from "./index";

export { ilhaPages, type IlhaPagesOptions } from "./plugin";

import { ilhaPages, type IlhaPagesOptions } from "./plugin";

/** Rsbuild plugin — use via `@ilha/router/rsbuild`. */
export function pages(options: IlhaPagesOptions = {}) {
  return ilhaPages.rsbuild(options);
}

export default pages;
