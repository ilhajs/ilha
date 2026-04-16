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
 * Keys are the DOM `name` attributes — arbitrary strings, including dotted
 * paths like `"user.email"`. Values are strings or string arrays (for
 * checkbox groups / multi-select).
 */
export type DefaultValues = Partial<Record<string, string | string[]>>;

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
   * @example
   * defaultValues: { email: "ada@example.com", role: "admin" }
   */
  defaultValues?: DefaultValues;
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
   * Manually trigger the validate → onSubmit/onError cycle programmatically.
   */
  submit(): void;

  /**
   * Attach event listeners to the form and activate the binding.
   * If `defaultValues` are provided they are applied to the DOM here, and
   * any stale validation state is cleared.
   * Returns a cleanup/unmount function.
   */
  mount(): () => void;

  /**
   * Remove all event listeners. Idempotent.
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
 * Applies `defaultValues` to the DOM elements inside the form.
 *
 * - Text / number / email / … inputs: sets `.value`
 * - `type="file"`: skipped — browser blocks programmatic `.value` assignment
 * - `type="checkbox"`: checks the element if its `.value` is in the default array
 * - `type="radio"`: checks the element whose `.value` matches the default string
 * - `<select>`: sets `.value`
 * - `<select multiple>`: marks each matching option as `.selected`
 * - `<textarea>`: sets `.value`
 */
function applyDefaultValues(
  form: HTMLFormElement,
  defaults: Record<string, string | string[]>,
): void {
  for (const [name, defaultValue] of Object.entries(defaults)) {
    const elements = Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        `[name="${CSS.escape(name)}"]`,
      ),
    );

    for (const el of elements) {
      if (el instanceof HTMLInputElement) {
        if (el.type === "checkbox") {
          const values = Array.isArray(defaultValue) ? defaultValue : [defaultValue];
          el.checked = values.includes(el.value);
        } else if (el.type === "radio") {
          el.checked = el.value === defaultValue;
        } else if (el.type !== "file") {
          // file inputs are intentionally skipped — browser blocks programmatic .value
          el.value = Array.isArray(defaultValue) ? (defaultValue[0] ?? "") : defaultValue;
        }
      } else if (el instanceof HTMLSelectElement) {
        if (el.multiple && Array.isArray(defaultValue)) {
          for (const option of el.options) {
            option.selected = defaultValue.includes(option.value);
          }
        } else {
          el.value = Array.isArray(defaultValue) ? (defaultValue[0] ?? "") : defaultValue;
        }
      } else if (el instanceof HTMLTextAreaElement) {
        el.value = Array.isArray(defaultValue) ? (defaultValue[0] ?? "") : defaultValue;
      }
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
 * Designed to integrate cleanly with ilha islands — pass `el` from an
 * `.effect()` context or resolve it inside `.on()` handlers.
 *
 * @example
 * const island = ilha
 *   .state("errors", {} as FormErrors)
 *   .effect(({ el, state }) => {
 *     const formEl = el.querySelector("form")!;
 *     const form = createForm({
 *       el: formEl,
 *       schema: z.object({
 *         email: z.string().email(),
 *         name: z.string().min(1),
 *       }),
 *       defaultValues: { email: "ada@example.com" },
 *       onSubmit(values) {
 *         console.log(values);
 *       },
 *       onError(issues) {
 *         state.errors(issuesToErrors(issues));
 *       },
 *       validateOn: "change",
 *     });
 *     return form.mount();
 *   })
 *   .render(({ state }) => html`
 *     <form>
 *       <input name="email" />
 *       <input name="name" />
 *       <button>Submit</button>
 *     </form>
 *   `);
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

      if (defaultValues) {
        applyDefaultValues(el, defaultValues as Record<string, string | string[]>);
        currentErrors = {};
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

      on(el, "submit", (e) => runSubmit(e as SubmitEvent));
      on(el, "change", markDirty);

      if (validateOn === "change") on(el, "change", runFieldValidation);
      if (validateOn === "input") on(el, "input", runFieldValidation);

      const unmountFn = () => {
        listeners.forEach((off) => off());
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
