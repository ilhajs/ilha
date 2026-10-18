import { context } from "ilha";
import type { CloudContextVariables } from "void";
import { idleNavigationState, ssrProxy } from "void/pages-client";
import type { NavigationState, VoidRouter } from "void/pages-client";

import { VoidContext } from "./context";
import type { VoidPageState } from "./context";

const readPage = (hook: string): VoidPageState => {
  const page = context(VoidContext)();
  if (!page) {
    throw new Error(`${hook}: must be used inside a Void page.`);
  }
  return page;
};

/** The Void Router. Outside a hydrated regular page it is a server-safe stub. */
export const useRouter = (): VoidRouter =>
  context(VoidContext)()?.router ?? ssrProxy;

/** Route params of the current page. Rerenders the component when they change. */
export const useParams = <
  T extends Record<string, string> = Record<string, string>,
>(): T =>
  // SAFETY: callers name the param shape their route pattern produces.
  readPage("useParams()").params as T;

/** Values the app's middleware shares with every page. */
export const useShared = <T = CloudContextVariables["shared"]>(): T =>
  // SAFETY: callers name the shared shape their middleware sets.
  readPage("useShared()").shared as T;

/** Pending navigation state. Idle on island pages and during SSR. */
export const useNavigation = (): NavigationState =>
  context(VoidContext)()?.navigation ?? idleNavigationState();

/** Validation errors the last page action returned. */
export const usePageErrors = (): Readonly<Record<string, string>> =>
  context(VoidContext)()?.errors ?? {};
