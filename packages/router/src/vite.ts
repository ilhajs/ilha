import type { Plugin } from "vite";

import { ilhaPages } from "./plugin";
import type { IlhaPagesOptions } from "./plugin";

export type {
  LayoutHandler,
  ErrorHandler,
  RouteSnapshot,
  AppError,
} from "./index";

export { ilhaPages, type IlhaPagesOptions } from "./plugin";

/** Vite plugin — use via `@ilha/router/vite`. */
export const pages = (options: IlhaPagesOptions = {}): Plugin =>
  // SAFETY: ilhaPages.vite returns a Vite Plugin; the builder's return type is
  // a union across bundlers, so narrow to Vite's Plugin here.
  ilhaPages.vite(options) as Plugin;

export default pages;
