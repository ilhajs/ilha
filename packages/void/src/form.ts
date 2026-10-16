import { atom, h, watch } from "ilha";
import type { View } from "ilha";
import type { JSX } from "ilha/jsx-runtime";
import {
  formErrorMessage,
  formRetryMessage,
  formSubmissionBlocked,
  scheduleFormRetry,
} from "void/pages-client";
import type { FormMethod, FormModel, VoidActionError } from "void/pages-client";

interface FormOptions {
  /** A `useForm()` result: its submit helpers take no arguments. */
  form: FormModel;
  method?: FormMethod;
  renderError?: (error: VoidActionError) => View;
  children?: View;
}

/** Form options plus `<form>` attributes, which pass through to the element. */
export type FormProps = FormOptions &
  Omit<JSX.IntrinsicElements["form"], keyof FormOptions | "onsubmit">;

/**
 * Submit `form` on `submit`, show its error, and block resubmits while a
 * rate-limit retry window is open.
 */
export const Form = ({
  children,
  form,
  method = "post",
  renderError,
  ...attributes
}: FormProps): View => {
  const now = atom(Date.now(), { snapshot: false });
  const { error } = form;
  watch.once(() =>
    globalThis.window === undefined
      ? undefined
      : scheduleFormRetry(error, () => now.set(Date.now()))
  );
  const message = formErrorMessage(form);
  const retry = formRetryMessage(error);
  return h(
    "form",
    {
      ...attributes,
      "aria-busy": String(form.pending),
      onsubmit: async (event: SubmitEvent) => {
        event.preventDefault();
        if (!formSubmissionBlocked(form, now())) {
          await form[method]();
        }
      },
    },
    message
      ? h(
          "div",
          { "data-void-form-error": "", role: "alert" },
          error && renderError ? renderError(error) : message,
          retry ? h("p", null, retry) : null
        )
      : null,
    children
  );
};
