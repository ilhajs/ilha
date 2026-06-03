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

/** Rolldown plugin — use via `@ilha/router/rolldown`. */
export function pages(options: IlhaPagesOptions = {}) {
  return ilhaPages.rolldown(options);
}
