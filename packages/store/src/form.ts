// =============================================================================
// @ilha/store/form — typed form helpers via Standard Schema
// Unopinionated building blocks. Compose them with createStore however you like.
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
 * Discriminated union result from validating form values.
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

// ---------------------------------------------------------------------------
// extractFormData
// ---------------------------------------------------------------------------

/**
 * Extract a plain object from a `<form>` element or `FormData` instance.
 * Duplicate keys (checkbox groups, `<select multiple>`) collapse to a
 * `string[]`; single keys stay as `string`. File inputs are preserved as
 * `File` values — pass them straight through to your schema.
 *
 * @example
 * ilha.on("form@submit", ({ event }) => {
 *   event.preventDefault();
 *   const data = extractFormData(event.target as HTMLFormElement);
 *   const result = validateWithSchema(SignInSchema, data);
 *   // ...
 * });
 */
export function extractFormData(source: HTMLFormElement | FormData): Record<string, unknown> {
  const data = source instanceof FormData ? source : new FormData(source);
  const result: Record<string, unknown> = {};
  for (const key of new Set(data.keys())) {
    const values = data.getAll(key);
    result[key] = values.length === 1 ? values[0] : values;
  }
  return result;
}

// ---------------------------------------------------------------------------
// validateWithSchema
// ---------------------------------------------------------------------------

/**
 * Run a Standard Schema synchronously and return a discriminated union.
 * Never throws. If the schema returns a Promise (i.e. it has async refinements),
 * a warning is logged and a failure result is returned — pair it with an
 * async schema by awaiting `schema["~standard"].validate(...)` directly instead.
 *
 * Compatible with Zod, Valibot, ArkType, and any other Standard Schema library.
 *
 * @example
 * const result = validateWithSchema(SignInSchema, extractFormData(form));
 * if (result.ok) {
 *   formStore.setState({ data: result.data, errors: {} });
 * } else {
 *   formStore.setState({ errors: issuesToErrors(result.issues) });
 * }
 */
export function validateWithSchema<S extends StandardSchemaV1>(
  schema: S,
  data: unknown,
): FormResult<StandardSchemaV1.InferOutput<S>> {
  let result: StandardSchemaV1.Result<StandardSchemaV1.InferOutput<S>>;
  try {
    result = schema["~standard"].validate(data) as StandardSchemaV1.Result<
      StandardSchemaV1.InferOutput<S>
    >;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Schema validation threw: " + String(error);
    console.warn("[@ilha/store/form] Schema validation threw an exception:", message);
    return {
      ok: false,
      issues: [{ message }],
    };
  }

  if (result instanceof Promise) {
    console.warn(
      "[@ilha/store/form] Schema validation returned a Promise. " +
        "validateWithSchema is synchronous — use validateWithSchemaAsync " +
        "or call schema['~standard'].validate(...) directly for async schemas.",
    );
    result.catch(() => {});
    return {
      ok: false,
      issues: [{ message: "Async schema validation is not supported by validateWithSchema." }],
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

/**
 * Async variant of {@link validateWithSchema}. Always returns a Promise,
 * supports both sync and async schemas. Use this when your schema has
 * async refinements (e.g. uniqueness checks against a server).
 */
export async function validateWithSchemaAsync<S extends StandardSchemaV1>(
  schema: S,
  data: unknown,
): Promise<FormResult<StandardSchemaV1.InferOutput<S>>> {
  let result: StandardSchemaV1.Result<StandardSchemaV1.InferOutput<S>>;
  try {
    result = (await schema["~standard"].validate(data)) as StandardSchemaV1.Result<
      StandardSchemaV1.InferOutput<S>
    >;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Schema validation threw: " + String(error);
    console.warn("[@ilha/store/form] Schema validation threw an exception:", message);
    return {
      ok: false,
      issues: [{ message }],
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

// ---------------------------------------------------------------------------
// issuesToErrors
// ---------------------------------------------------------------------------

/**
 * Flatten Standard Schema issues into a per-field error map keyed by
 * dot-separated path. Issues without a path are grouped under the empty
 * string key — useful for form-level errors.
 *
 * @example
 * // issues: [{ message: "Invalid email", path: ["email"] }]
 * issuesToErrors(issues);
 * // => { email: ["Invalid email"] }
 */
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
