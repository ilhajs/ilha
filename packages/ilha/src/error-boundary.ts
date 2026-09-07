import { clearFiberView, getFiber } from "./runtime.ts";
import { errorView, isFunction } from "./shared.ts";
import { runSetup } from "./start.ts";
import type { View } from "./types.ts";

export interface ErrorFallbackProps {
  error: Error;
  reset: () => void;
}

export type ErrorFallback = (props: ErrorFallbackProps) => View;

export interface ErrorBoundaryProps {
  fallback?: ErrorFallback;
  onError?: (error: Error) => void;
  children?: View;
}

/** Catch subtree failures and paint a fallback. Supports reset(). */
export const ErrorBoundary = (props: ErrorBoundaryProps): View => {
  const fiber = getFiber();

  const remount = (): void => {
    if (fiber.closed) {
      return;
    }
    clearFiberView(fiber);
    // SAFETY: propsBox holds the JSX props bag painted for this boundary.
    const current = (fiber.propsBox?.current ?? props) as ErrorBoundaryProps;
    runSetup(fiber, () => ErrorBoundary(current));
  };

  fiber.handleError = (error) => {
    if (fiber.closed) {
      return;
    }
    clearFiberView(fiber);
    // SAFETY: propsBox holds the JSX props bag painted for this boundary.
    const current = (fiber.propsBox?.current ?? props) as ErrorBoundaryProps;
    const { onError, fallback } = current;
    if (isFunction(onError)) {
      onError(error);
    }
    if (isFunction(fallback)) {
      fiber.paint(fallback({ error, reset: remount }));
      return;
    }
    fiber.paint(errorView(error));
  };

  return props.children;
};
