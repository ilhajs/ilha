import { clearFiberView, getFiber } from "./runtime.ts";
import { errorView } from "./shared.ts";
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
  // SAFETY: propsBox holds the JSX props bag painted for this boundary.
  const current = () =>
    (fiber.propsBox?.current ?? props) as ErrorBoundaryProps;
  fiber.handleError = (error) => {
    if (fiber.closed) {
      return;
    }
    clearFiberView(fiber);
    const { onError, fallback } = current();
    onError?.(error);
    fiber.paint(
      fallback
        ? fallback({
            error,
            reset: () => {
              if (!fiber.closed) {
                clearFiberView(fiber);
                runSetup(fiber, () => ErrorBoundary(current()));
              }
            },
          })
        : errorView(error)
    );
  };
  return props.children;
};
