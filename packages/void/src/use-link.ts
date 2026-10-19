import { context } from "ilha";
import type { VoidRouter } from "void/pages-client";

import { VoidContext } from "./context";
import { shouldInterceptClick } from "./link";

export interface UseLinkOptions {
  replace?: boolean;
  preserveScroll?: boolean;
  preserveState?: boolean;
  viewTransition?: boolean;
  onNavigate?: (event: { preventDefault: () => void }) => void;
  onclick?: (event: MouseEvent) => void;
}

export interface UseLinkProps {
  href: string;
  onclick: (event: MouseEvent) => void;
}

export type UseLink = (href: string, options?: UseLinkOptions) => UseLinkProps;

/**
 * Bind router navigation to a native `<a>` without rendering a component.
 *
 * Call it once at the top level of a component, then spread the result onto
 * a plain anchor: `<a {...link("/users/7")}>Ada</a>`. Clicks follow exactly
 * `Link`'s GET rules (modifier keys, `download`, cross-origin, and prevented
 * clicks fall back to the browser).
 *
 * GET only: there is no prefetch and no `data`. For those, use `Link`.
 *
 * It exists so a link can sit where CSS uses child combinators
 * (`ul.menu > li > a`). Every component, `Link` included, paints into a
 * `<span data-ilha-slot style="display:contents">` host, which breaks those
 * selectors; a bound native `<a>` stays a direct child of its parent.
 */
export const useLink = (): UseLink => {
  const router: VoidRouter | null = context(VoidContext)()?.router ?? null;
  return (href: string, options: UseLinkOptions = {}): UseLinkProps => {
    const {
      onNavigate,
      onclick,
      preserveScroll,
      preserveState,
      replace,
      viewTransition,
    } = options;
    return {
      href,
      onclick: (event: MouseEvent): void => {
        onclick?.(event);
        if (!shouldInterceptClick(event, { router, target: href })) {
          return;
        }
        event.preventDefault();
        let cancelled = false;
        onNavigate?.({
          preventDefault: () => {
            cancelled = true;
          },
        });
        if (cancelled) {
          return;
        }
        router?.visit(href, {
          method: "GET",
          preserveScroll,
          preserveState,
          replace,
          viewTransition,
        });
      },
    };
  };
};
