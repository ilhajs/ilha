import type { DeferredState } from "void";

/** A JSON value: what Void serializes into page data and island props. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | JsonRecord;

export interface JsonRecord {
  readonly [key: string]: JsonValue | undefined;
}

/** A loader prop: JSON, or the state of a `defer()`red value. */
export type PageValue = JsonValue | DeferredState<JsonValue>;

/** Props Void passes to a page: its loader result. */
export type PageProps = Readonly<Record<string, PageValue | undefined>>;

/** Field validation messages, keyed by field name. */
export type FieldErrors = Readonly<Record<string, string>>;

/** A form field value. `Blob`s make Void submit the form as multipart. */
export type FormValue =
  | JsonValue
  | Blob
  | readonly FormValue[]
  | { readonly [key: string]: FormValue | undefined };

/** Form data: field name → value. */
export type FormValues = Readonly<Record<string, FormValue | undefined>>;

/** Widen literal field types from form defaults: `false` → `boolean`. */
export type WidenFields<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends number
      ? number
      : T[K] extends boolean
        ? boolean
        : T[K];
};
