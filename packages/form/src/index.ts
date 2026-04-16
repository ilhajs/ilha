// =============================================================================
// @ilha/form — typed form binding via Standard Schema
// No external dependencies — uses native DOM APIs only.
// https://standardschema.dev
// =============================================================================

// ---------------------------------------------------------------------------
// Standard Schema v1 spec — copied inline, no runtime dep.
// ---------------------------------------------------------------------------

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;
  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  export interface PathSegment {
    readonly key: PropertyKey;
  }
  export interface Types<Input, Output> {
    readonly input: Input;
    readonly output: Output;
  }

  export type InferInput<S extends StandardSchemaV1> = NonNullable<
    S["~standard"]["types"]
  >["input"];
  export type InferOutput<S extends StandardSchemaV1> = NonNullable<
    S["~standard"]["types"]
  >["output"];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Discriminated union result from reading or validating form values.
 * Never throws — validation failures are returned as data.
 */
export type FormResult<T> =
  | { ok: true; data: T }
  | { ok: false; issues: ReadonlyArray<StandardSchemaV1.Issue> };

/**
 * Per-field error map. Keys are dot-separated field paths matching the
 * schema's issue path (e.g. `"user.email"`). Values are arrays of messages
 * so multiple failing rules on a single field are all surfaced.
 */
export type FormErrors = Record<string, string[]>;

/**
 * When to run schema validation automatically against field changes.
 *
 * - `"submit"` (default) — only on form submission
 * - `"change"` — on `change` events (after a field loses focus with a new value)
 * - `"input"` — on every `input` event (every keystroke)
 */
export type ValidateOn = "submit" | "change" | "input";

/**
 * Partial map of field names to their default values.
 *
 * Known schema keys get autocomplete and are type-checked. Arbitrary string
 * keys (e.g. dotted paths like `"user.email"`) are also accepted for cases
 * where the DOM name does not map 1:1 to a top-level schema key.
 *
 * Values are `string` for text/select/radio/textarea inputs, or `string[]`
 * for checkbox groups and `<select multiple>`. File inputs are always skipped.
 */
export type DefaultValues<S extends StandardSchemaV1> = {
  [K in keyof StandardSchemaV1.InferInput<S> & string]?: string | string[];
} & {
  [key: string]: string | string[] | undefined;
};

export interface CreateFormOptions<S extends StandardSchemaV1> {
  /** The form element to bind to. */
  el: HTMLFormElement;

  /** Standard Schema — Zod, Valibot, ArkType, or any compatible library. */
  schema: S;

  /**
   * Called with fully typed output values after successful schema validation
   * on submission. Not called if validation fails.
   */
  onSubmit: (values: StandardSchemaV1.InferOutput<S>, event: SubmitEvent) => void;

  /**
   * Called with structured issues when schema validation fails on submission.
   */
  onError?: (issues: ReadonlyArray<StandardSchemaV1.Issue>, event: SubmitEvent) => void;

  /**
   * When to run validation automatically on field changes.
   * Defaults to `"submit"`.
   */
  validateOn?: ValidateOn;

  /**
   * Initial values applied to form fields on `mount()`.
   * Keys are field `name` attributes; values are strings (or string arrays
   * for checkbox / multi-select groups). File inputs are always skipped.
   *
   * These values are tracked and automatically re-applied after re-renders
   * (via MutationObserver). If the user has changed a field, their value is
   * preserved instead of the default.
   *
   * @example
   * defaultValues: { email: "ada@example.com", role: "admin" }
   */
  defaultValues?: DefaultValues<S>;
}

export interface Form<S extends StandardSchemaV1> {
  /**
   * Read and validate the current form values synchronously against the schema.
   * Returns a discriminated union — never throws.
   */
  values(): FormResult<StandardSchemaV1.InferOutput<S>>;

  /**
   * The per-field error state from the last validation attempt.
   * Empty object before the first validation runs.
   */
  errors(): FormErrors;

  /**
   * Whether any field value has changed since `mount()` was called.
   */
  isDirty(): boolean;

  /**
   * Programmatically set the value of a named field in the DOM.
   * Follows the same element-type rules as `defaultValues`:
   * - text/number/… inputs and `<textarea>`: sets `.value`
   * - `type="checkbox"`: checks/unchecks based on array membership
   * - `type="radio"`: checks the matching option
   * - `<select multiple>`: sets `.selected` per option
   * - `type="file"`: skipped
   */
  setValue(
    name: (keyof StandardSchemaV1.InferInput<S> & string) | (string & {}),
    value: string | string[],
  ): void;

  /**
   * Manually trigger the validate → onSubmit/onError cycle programmatically.
   */
  submit(): void;

  /**
   * Attach event listeners to the form and activate the binding.
   * Applies `defaultValues` to the DOM, resets dirty + validation state,
   * and starts a MutationObserver to re-apply values after re-renders.
   * Returns a cleanup/unmount function.
   */
  mount(): () => void;

  /**
   * Remove all event listeners and disconnect the MutationObserver. Idempotent.
   */
  unmount(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractFormData(form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form);
  const result: Record<string, unknown> = {};
  for (const key of new Set(data.keys())) {
    const values = data.getAll(key);
    result[key] = values.length === 1 ? values[0] : values;
  }
  return result;
}

function runSchemaSync<S extends StandardSchemaV1>(
  schema: S,
  data: unknown,
): FormResult<StandardSchemaV1.InferOutput<S>> {
  const result = schema["~standard"].validate(data);

  if (result instanceof Promise) {
    console.warn(
      "[ilha-form] Schema validation returned a Promise. " +
        "ilha-form is synchronous — use a schema with synchronous validation.",
    );
    return {
      ok: false,
      issues: [{ message: "Async schema validation is not supported in ilha-form." }],
    };
  }

  if (result.issues !== undefined) {
    return { ok: false, issues: result.issues };
  }

  return {
    ok: true,
    data: (result as StandardSchemaV1.SuccessResult<StandardSchemaV1.InferOutput<S>>).value,
  };
}

export function issuesToErrors(issues: ReadonlyArray<StandardSchemaV1.Issue>): FormErrors {
  const errors: FormErrors = {};
  for (const issue of issues) {
    const path =
      issue.path?.map((p) => (typeof p === "object" ? String(p.key) : String(p))).join(".") ?? "";
    if (!errors[path]) errors[path] = [];
    errors[path].push(issue.message);
  }
  return errors;
}

/**
 * Applies a value to all DOM elements matching `name` inside `form`.
 * File inputs are skipped. Silently ignores missing elements.
 */
function applyValueToField(form: HTMLFormElement, name: string, value: string | string[]): void {
  const elements = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[name="${CSS.escape(name)}"]`,
    ),
  );

  for (const el of elements) {
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox") {
        const values = Array.isArray(value) ? value : [value];
        el.checked = values.includes(el.value);
      } else if (el.type === "radio") {
        const scalar = Array.isArray(value) ? (value[0] ?? "") : value;
        el.checked = el.value === scalar;
      } else if (el.type !== "file") {
        el.value = Array.isArray(value) ? (value[0] ?? "") : value;
      }
    } else if (el instanceof HTMLSelectElement) {
      if (el.multiple && Array.isArray(value)) {
        for (const option of el.options) {
          option.selected = value.includes(option.value);
        }
      } else {
        el.value = Array.isArray(value) ? (value[0] ?? "") : value;
      }
    } else if (el instanceof HTMLTextAreaElement) {
      el.value = Array.isArray(value) ? (value[0] ?? "") : value;
    }
  }
}

// ---------------------------------------------------------------------------
// createForm
// ---------------------------------------------------------------------------

/**
 * Bind a Standard Schema to a form element. Wires up typed submission,
 * validation, and per-field error state using native DOM event listeners.
 *
 * @example
 * const form = createForm({
 *   el: formEl,
 *   schema: z.object({ email: z.string().email(), name: z.string().min(1) }),
 *   defaultValues: { email: "ada@example.com" },
 *   onSubmit(values) { console.log(values); },
 *   onError(issues) { state.errors(issuesToErrors(issues)); },
 *   validateOn: "change",
 * });
 * return form.mount();
 */
export function createForm<S extends StandardSchemaV1>(options: CreateFormOptions<S>): Form<S> {
  const { el, schema, onSubmit, onError, validateOn = "submit", defaultValues } = options;

  let currentErrors: FormErrors = {};
  let dirty = false;
  let activeUnmount: (() => void) | null = null;

  function readValues(): FormResult<StandardSchemaV1.InferOutput<S>> {
    return runSchemaSync(schema, extractFormData(el));
  }

  function runSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const result = readValues();
    if (result.ok) {
      currentErrors = {};
      onSubmit(result.data, event);
    } else {
      currentErrors = issuesToErrors(result.issues);
      onError?.(result.issues, event);
    }
  }

  function runFieldValidation(): void {
    const result = readValues();
    currentErrors = result.ok ? {} : issuesToErrors(result.issues);
  }

  function markDirty(): void {
    dirty = true;
  }

  const form: Form<S> = {
    values: readValues,

    errors() {
      return { ...currentErrors };
    },

    isDirty() {
      return dirty;
    },

    setValue(name, value) {
      applyValueToField(el, name, value);
    },

    submit() {
      const event = new SubmitEvent("submit", { bubbles: true, cancelable: true });
      if (activeUnmount) {
        el.dispatchEvent(event);
      } else {
        runSubmit(event);
      }
    },

    mount() {
      dirty = false;
      currentErrors = {}; // always reset on every mount

      // Tracks the latest value per field — seeded with defaults, updated on
      // change/input. The MutationObserver restores these after re-renders so
      // user-edited values survive DOM reconstruction.
      const trackedValues = new Map<string, string | string[]>();

      if (defaultValues) {
        for (const [name, value] of Object.entries(defaultValues)) {
          if (value !== undefined) {
            applyValueToField(el, name, value);
            trackedValues.set(name, value);
          }
        }
      }

      const listeners: Array<() => void> = [];

      function on<K extends keyof HTMLElementEventMap>(
        target: EventTarget,
        type: K,
        handler: (e: HTMLElementEventMap[K]) => void,
      ): void {
        target.addEventListener(type, handler as EventListener);
        listeners.push(() => target.removeEventListener(type, handler as EventListener));
      }

      function trackCurrentValues(): void {
        if (!defaultValues) return;
        for (const name of Object.keys(defaultValues)) {
          const elements = Array.from(
            el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
              `[name="${CSS.escape(name)}"]`,
            ),
          );
          if (elements.length === 0) continue;
          const first = elements[0]!;

          if (first instanceof HTMLInputElement && first.type === "checkbox") {
            const checked = (elements as HTMLInputElement[])
              .filter((e) => e.checked)
              .map((e) => e.value);
            trackedValues.set(name, checked);
          } else if (first instanceof HTMLInputElement && first.type === "radio") {
            const checked = (elements as HTMLInputElement[]).find((e) => e.checked);
            if (checked) trackedValues.set(name, checked.value);
          } else if (first instanceof HTMLSelectElement && first.multiple) {
            const selected = Array.from(first.selectedOptions).map((o) => o.value);
            trackedValues.set(name, selected);
          } else if (!(first instanceof HTMLInputElement && first.type === "file")) {
            trackedValues.set(name, first.value);
          }
        }
      }

      on(el, "submit", (e) => runSubmit(e as SubmitEvent));
      on(el, "change", () => {
        trackCurrentValues();
        markDirty();
      });
      on(el, "input", trackCurrentValues); // always track on input, regardless of validateOn

      if (validateOn === "change") on(el, "change", runFieldValidation);
      if (validateOn === "input") on(el, "input", runFieldValidation);

      let observer: MutationObserver | null = null;
      if (defaultValues) {
        observer = new MutationObserver(() => {
          for (const [name, value] of trackedValues) {
            applyValueToField(el, name, value);
          }
        });
        observer.observe(el, { childList: true, subtree: true });
      }

      const unmountFn = () => {
        listeners.forEach((off) => off());
        observer?.disconnect();
        activeUnmount = null;
      };

      activeUnmount = unmountFn;
      return unmountFn;
    },

    unmount() {
      activeUnmount?.();
    },
  };

  return form;
}
