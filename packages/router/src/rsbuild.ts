import { ilhaPages } from "./plugin";
import type { IlhaPagesOptions } from "./plugin";

export type {
  LayoutHandler,
  ErrorHandler,
  RouteSnapshot,
  AppError,
} from "./index";

export { ilhaPages, type IlhaPagesOptions } from "./plugin";

/** Rsbuild plugin — use via `@ilha/router/rsbuild`. */
export const pages = (options: IlhaPagesOptions = {}) =>
  ilhaPages.rsbuild(options);

export default pages;
