import { atom, batch, watch } from "ilha";
import { isEqualFormValue } from "void/pages-client";
import type { VoidActionError } from "void/pages-client";

import type { FieldErrors, FormValues } from "./types";

const RECENT_SUCCESS_MS = 2000;

interface TimerRef {
  current?: ReturnType<typeof setTimeout>;
}

/** Form state every Void form helper exposes. Reads subscribe the component. */
export interface FormFields<T extends object> {
  readonly data: T;
  setData: <K extends keyof T & string>(field: K, value: T[K]) => void;
  readonly errors: FieldErrors;
  readonly error: VoidActionError | null;
  readonly pending: boolean;
  readonly hasChanges: boolean;
  readonly wasSuccessful: boolean;
  readonly recentlySuccessful: boolean;
  reset: (...fields: (keyof T & string)[]) => void;
  clearErrors: (...fields: string[]) => void;
  clearError: () => void;
}

export interface FormState<T extends FormValues> {
  fields: FormFields<T>;
  /** Clear submit state before a request. */
  begin: () => void;
  /** Mark a successful submit; the current data becomes the new baseline. */
  succeed: () => void;
  fail: (error: VoidActionError) => void;
  setErrors: (errors: FieldErrors) => void;
  finish: () => void;
  /** Snapshot of the current data for a request body. */
  read: () => T;
}

const without = (errors: FieldErrors, fields: readonly string[]): FieldErrors =>
  Object.fromEntries(
    Object.entries(errors).filter(([field]) => !fields.includes(field))
  );

/**
 * Declare the atoms behind a form helper. Call it at the top level of a
 * component, like any other primitive.
 */
export const formState = <T extends FormValues>(
  defaults: T,
  globalErrors: () => FieldErrors = () => ({})
): FormState<T> => {
  const data = atom<T>({ ...defaults });
  const baseline = atom<T>({ ...defaults });
  const errors = atom<FieldErrors>({});
  const error = atom<VoidActionError | null>(null);
  const pending = atom(false);
  const wasSuccessful = atom(false);
  const recentlySuccessful = atom(false);
  const timer = atom.lazy((): TimerRef => ({}), { snapshot: false });
  watch.once(() => () => clearTimeout(timer().current));

  const fields: FormFields<T> = {
    clearError: () => error.set(null),
    clearErrors: (...names) =>
      errors.update((current) =>
        names.length === 0 ? {} : without(current, names)
      ),
    get data() {
      return data();
    },
    get error() {
      return error();
    },
    get errors() {
      const local = errors();
      return Object.keys(local).length > 0 ? local : globalErrors();
    },
    get hasChanges() {
      const current = data();
      const base = baseline();
      return Object.keys(base).some(
        (key) => !isEqualFormValue(current[key], base[key])
      );
    },
    get pending() {
      return pending();
    },
    get recentlySuccessful() {
      return recentlySuccessful();
    },
    reset: (...names) => {
      const base = baseline();
      if (names.length === 0) {
        data.set({ ...base });
        return;
      }
      data.update((current) => {
        const next = { ...current };
        for (const name of names) {
          next[name] = base[name];
        }
        return next;
      });
    },
    setData: (field, value) => {
      data.update((current) => ({ ...current, [field]: value }));
    },
    get wasSuccessful() {
      return wasSuccessful();
    },
  };

  return {
    begin: () => {
      clearTimeout(timer().current);
      batch(() => {
        pending.set(true);
        wasSuccessful.set(false);
        recentlySuccessful.set(false);
        errors.set({});
        error.set(null);
      });
    },
    fail: (next) => error.set(next),
    fields,
    finish: () => pending.set(false),
    read: () => ({ ...data() }),
    setErrors: (next) => errors.set(next),
    succeed: () => {
      batch(() => {
        wasSuccessful.set(true);
        recentlySuccessful.set(true);
        baseline.set({ ...data() });
      });
      timer().current = setTimeout(
        () => recentlySuccessful.set(false),
        RECENT_SUCCESS_MS
      );
    },
  };
};
