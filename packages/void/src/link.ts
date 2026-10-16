import { atom, context, h, watch } from "ilha";
import type { View } from "ilha";
import type { JSX } from "ilha/jsx-runtime";
import { isModifiedEvent, mergeDataIntoHref } from "void/pages-client";
import type { PrefetchOptions } from "void/pages-client";

import { VoidContext } from "./context";
import type { FormValues } from "./types";

export type PrefetchStrategy = "hover" | "click" | "mount" | "visible";
export type LinkMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type Handler<E extends Event> = (event: E) => void;

interface LinkOptions {
  href: string;
  method?: LinkMethod | Lowercase<LinkMethod>;
  /** Query params for GET links; the request body for other methods. */
  data?: FormValues;
  preserveScroll?: boolean;
  preserveState?: boolean;
  replace?: boolean;
  /** Skip the Void Router and load the document. GET links only. */
  reloadDocument?: boolean;
  viewTransition?: boolean;
  /** `true` prefetches on hover. GET links only. */
  prefetch?: boolean | PrefetchStrategy | readonly PrefetchStrategy[];
  cacheFor?: PrefetchOptions["cacheFor"];
  onNavigate?: (event: { preventDefault: () => void }) => void;
  onclick?: Handler<MouseEvent>;
  onmouseenter?: Handler<MouseEvent>;
  onmouseleave?: Handler<MouseEvent>;
  onmousedown?: Handler<MouseEvent>;
  onfocus?: Handler<FocusEvent>;
  ontouchstart?: Handler<TouchEvent>;
  children?: View;
}

/** Link options plus `<a>` attributes, which pass through to the element. */
export type LinkProps = LinkOptions &
  Omit<JSX.IntrinsicElements["a"], keyof LinkOptions>;

interface LinkTimers {
  hover?: ReturnType<typeof setTimeout>;
  observer?: IntersectionObserver;
}

const DEFAULT_HOVER_DELAY = 75;

const isStrategyList = (
  prefetch: PrefetchStrategy | readonly PrefetchStrategy[]
): prefetch is readonly PrefetchStrategy[] => Array.isArray(prefetch);

const strategiesOf = ({
  prefetch,
  reloadDocument,
}: LinkOptions): readonly PrefetchStrategy[] => {
  if (prefetch === undefined || prefetch === false || reloadDocument) {
    return [];
  }
  if (prefetch === true) {
    return ["hover"];
  }
  return isStrategyList(prefetch) ? prefetch : [prefetch];
};

const isSameOrigin = (href: string): boolean =>
  new URL(href, window.location.origin).origin === window.location.origin;

const unlessPrevented =
  <E extends Event>(handler: Handler<E> | undefined, then: () => void) =>
  (event: E): void => {
    handler?.(event);
    if (!event.defaultPrevented) {
      then();
    }
  };

/**
 * Navigate through the Void Router. GET links render an `<a>`; other methods
 * render a `<button>` that submits `data`. Outside a regular page (island
 * pages, SSR) clicks fall back to the browser.
 */
export const Link = (props: LinkProps): View => {
  const {
    cacheFor,
    children,
    data,
    href,
    method = "GET",
    onNavigate,
    onclick,
    onfocus,
    onmousedown,
    onmouseenter,
    onmouseleave,
    ontouchstart,
    prefetch: _prefetch,
    preserveScroll,
    preserveState,
    reloadDocument,
    replace,
    viewTransition,
    ...attributes
  } = props;
  const router = context(VoidContext)()?.router ?? null;
  // SAFETY: method is a LinkMethod in either case; uppercasing normalizes it.
  const verb = method.toUpperCase() as LinkMethod;
  const isGet = verb === "GET";
  const strategies = strategiesOf(props);
  if (strategies.length > 0 && !isGet) {
    throw new Error(
      'Link: prefetch only supports GET links. Remove `prefetch` or use method="GET".'
    );
  }
  if (reloadDocument && !isGet) {
    throw new Error("Link: reloadDocument only supports GET links.");
  }
  const target = isGet ? mergeDataIntoHref(href, data) : href;
  const timers = atom.lazy((): LinkTimers => ({}), {
    snapshot: false,
  });

  const runPrefetch = (): void => {
    if (
      router &&
      target !== window.location.pathname + window.location.search
    ) {
      router.prefetch(target, cacheFor === undefined ? {} : { cacheFor });
    }
  };

  watch.once(() => {
    if (globalThis.window !== undefined && strategies.includes("mount")) {
      runPrefetch();
    }
    return () => {
      clearTimeout(timers().hover);
      timers().observer?.disconnect();
    };
  });

  const handleClick = (event: MouseEvent): void => {
    onclick?.(event);
    if (
      reloadDocument ||
      !router ||
      event.defaultPrevented ||
      isModifiedEvent(event) ||
      (event.currentTarget instanceof Element &&
        event.currentTarget.hasAttribute("download")) ||
      !isSameOrigin(target)
    ) {
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
    router.visit(target, {
      data: isGet ? undefined : data,
      method: verb,
      preserveScroll,
      preserveState,
      replace,
      viewTransition,
    });
  };

  const hover = strategies.includes("hover");
  const click = strategies.includes("click");
  const handlers = {
    onclick: handleClick,
    onfocus: hover ? unlessPrevented(onfocus, runPrefetch) : onfocus,
    onmousedown: click
      ? unlessPrevented(onmousedown, runPrefetch)
      : onmousedown,
    onmouseenter: hover
      ? unlessPrevented(onmouseenter, () => {
          clearTimeout(timers().hover);
          timers().hover = setTimeout(
            runPrefetch,
            router?._hoverDelay ?? DEFAULT_HOVER_DELAY
          );
        })
      : onmouseenter,
    onmouseleave: hover
      ? (event: MouseEvent) => {
          onmouseleave?.(event);
          clearTimeout(timers().hover);
        }
      : onmouseleave,
    ontouchstart:
      hover || click
        ? unlessPrevented(ontouchstart, runPrefetch)
        : ontouchstart,
  };

  const ref = strategies.includes("visible")
    ? (el: Element | null) => {
        timers().observer?.disconnect();
        timers().observer = undefined;
        if (!el) {
          return;
        }
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            runPrefetch();
          }
        });
        observer.observe(el);
        timers().observer = observer;
      }
    : undefined;

  if (isGet) {
    return h("a", { ...attributes, href: target, ref, ...handlers }, children);
  }
  return h(
    "button",
    { type: "button", ...attributes, ref, ...handlers },
    children
  );
};
