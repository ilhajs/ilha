export {
  wrapLayout,
  wrapError,
  type LayoutHandler,
  type ErrorHandler,
  type RouteSnapshot,
  type AppError,
} from "./index";

export { ilhaPages, type IlhaPagesOptions } from "./plugin";

import { ilhaPages, type IlhaPagesOptions } from "./plugin";

/** Rspack plugin — use via `@ilha/router/rspack`. */
export function pages(options: IlhaPagesOptions = {}) {
  return ilhaPages.rspack(options);
}
