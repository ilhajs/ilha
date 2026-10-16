import {
  categorizeActionError,
  getValidationErrors,
  VoidActionError,
} from "void/pages-client";

import { formState } from "./form-state";
import type { FormFields } from "./form-state";
import type { FormValues, JsonValue, WidenFields } from "./types";

const UNPROCESSABLE = 422;

/** `useIslandForm()` state plus submit helpers that take the action URL. */
export interface IslandForm<T extends object> extends FormFields<T> {
  post: (url: string) => Promise<void>;
  put: (url: string) => Promise<void>;
  patch: (url: string) => Promise<void>;
  delete: (url: string) => Promise<void>;
}

/** Read an action error body: JSON when the server sent JSON, else text. */
const readErrorBody = async (response: Response): Promise<JsonValue> => {
  try {
    if (response.headers.get("content-type")?.includes("application/json")) {
      // SAFETY: response.json() parses JSON text, so the result is JSON.
      const body = (await response.json()) as JsonValue;
      return body;
    }
    return (await response.text()) || null;
  } catch {
    return null;
  }
};

/**
 * Form state for island pages, which have no Void Router. Submits with
 * `fetch()`, then reloads the page or follows the redirect.
 */
export const useIslandForm = <T extends FormValues>(
  defaults: T
): IslandForm<WidenFields<T>> => {
  const state = formState(defaults);

  const submit = async (url: string, method: string): Promise<void> => {
    state.begin();
    try {
      const response = await fetch(url, {
        body: JSON.stringify(state.read()),
        headers: { "Content-Type": "application/json" },
        method,
      });
      if (response.redirected) {
        window.location.href = response.url;
        return;
      }
      if (response.ok) {
        state.succeed();
        window.location.reload();
        return;
      }
      const body = await readErrorBody(response);
      const validationErrors =
        response.status === UNPROCESSABLE ? getValidationErrors(body) : null;
      if (validationErrors) {
        state.setErrors(validationErrors);
        return;
      }
      const error = new VoidActionError({
        body,
        status: response.status,
        statusText: response.statusText,
        url,
      });
      if (categorizeActionError(response.status) === "boundary") {
        throw error;
      }
      state.fail(error);
    } finally {
      state.finish();
    }
  };

  // SAFETY: defineProperties adds the submit helpers IslandForm declares.
  return Object.defineProperties(state.fields, {
    delete: { value: (url: string) => submit(url, "DELETE") },
    patch: { value: (url: string) => submit(url, "PATCH") },
    post: { value: (url: string) => submit(url, "POST") },
    put: { value: (url: string) => submit(url, "PUT") },
  }) as IslandForm<WidenFields<T>>;
};
