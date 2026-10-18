import {
  getValidationErrors,
  interpolateRouteParams,
  isAbortError,
  submitAction,
} from "void/pages-client";
import type { VisitOptions } from "void/pages-client";
import type {
  ActionFormOptions,
  ActionUrl,
  ResolveActionBody,
} from "void/routes";

import { formState } from "./form-state";
import type { FormFields } from "./form-state";
import { usePageErrors, useRouter } from "./hooks";
import type { FormValues, WidenFields } from "./types";

export type FormSubmitOptions = Omit<VisitOptions, "method" | "data"> & {
  data?: FormValues;
};

/** `useForm()` state plus submit helpers that go through the Void Router. */
export interface PageForm<T extends object> extends FormFields<T> {
  post: (options?: FormSubmitOptions) => Promise<void>;
  put: (options?: FormSubmitOptions) => Promise<void>;
  patch: (options?: FormSubmitOptions) => Promise<void>;
  delete: (options?: FormSubmitOptions) => Promise<void>;
}

export interface UseForm {
  /** Typed from the page's action when Void's route types are generated. */
  <U extends ActionUrl & string>(
    url: U,
    defaults: ResolveActionBody<U>,
    options?: ActionFormOptions<U>
  ): PageForm<WidenFields<ResolveActionBody<U>>>;
  <T extends FormValues>(
    url: string,
    defaults: T,
    options?: { params?: Record<string, string> }
  ): PageForm<WidenFields<T>>;
}

const createForm = (
  url: string,
  defaults: FormValues,
  options?: { params?: Record<string, string> }
): PageForm<FormValues> => {
  const router = useRouter();
  const pageErrors = usePageErrors();
  const state = formState(defaults, () => pageErrors);

  const submit = async (
    method: string,
    submitOptions: FormSubmitOptions = {}
  ): Promise<void> => {
    state.begin();
    try {
      // Params fill in on submit, so a param that would change the request
      // path (such as "..") fails this submit, not the page render.
      const result = await submitAction(
        router,
        interpolateRouteParams(url, options?.params),
        { data: state.read(), method, ...submitOptions }
      );
      if (result.ok) {
        state.succeed();
        return;
      }
      const validationErrors = getValidationErrors(result.error.body);
      if (validationErrors) {
        state.setErrors(validationErrors);
      } else {
        state.fail(result.error);
      }
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
    } finally {
      state.finish();
    }
  };

  // SAFETY: defineProperties adds the submit helpers PageForm declares.
  return Object.defineProperties(state.fields, {
    delete: { value: (o?: FormSubmitOptions) => submit("DELETE", o) },
    patch: { value: (o?: FormSubmitOptions) => submit("PATCH", o) },
    post: { value: (o?: FormSubmitOptions) => submit("POST", o) },
    put: { value: (o?: FormSubmitOptions) => submit("PUT", o) },
  }) as PageForm<FormValues>;
};

/**
 * Bind form state to a page action. Submits through the Void Router, so a
 * success refreshes page props without a full reload. Island pages use
 * `useIslandForm()` instead.
 */
// SAFETY: the signatures only narrow the field types createForm handles.
export const useForm = createForm as UseForm;
