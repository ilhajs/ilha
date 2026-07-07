export type { LayoutHandler, ErrorHandler, RouteSnapshot, AppError } from "./index";

export { ilhaPages, type IlhaPagesOptions } from "./plugin";

import { ilhaPages, type IlhaPagesOptions } from "./plugin";

/** Rspack plugin — use via `@ilha/router/rspack`. */
export function pages(options: IlhaPagesOptions = {}) {
  return ilhaPages.rspack(options);
}
