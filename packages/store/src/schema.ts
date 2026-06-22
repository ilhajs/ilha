// =============================================================================
// Standard Schema — initial state + commit-time validation for @ilha/store
// =============================================================================

import type { StandardSchemaV1 } from "./form";
import { issuesToErrors, validateWithSchema } from "./form";

export type { StandardSchemaV1 } from "./form";

export type StoreErrorSource = "validate";

/** Thrown into `.onError()` handlers; also `instanceof` checkable. */
export class StoreValidationError extends Error {
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
  readonly fieldErrors: Record<string, string[]>;

  readonly patch?: object;

  constructor(issues: ReadonlyArray<StandardSchemaV1.Issue>, patch?: object) {
    const fieldErrors = issuesToErrors(issues);
    const first = Object.values(fieldErrors).flat()[0] ?? "Validation failed";
    super(first);
    this.name = "StoreValidationError";
    this.issues = issues;
    this.fieldErrors = fieldErrors;
    this.patch = patch;
  }
}

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (value == null || typeof value !== "object") return false;
  const std = (value as StandardSchemaV1)["~standard"];
  return std != null && typeof std.validate === "function" && std.version === 1;
}

/** Store state must be a non-null plain object (not array/primitive). */
export function assertStoreStateObject(value: unknown, label: string): asserts value is object {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    throw new Error(`@ilha/store: ${label} must be a plain object, got ${kind}.`);
  }
}

/**
 * Derive initial store state from a Standard Schema (defaults, coercion).
 * Tries `{}` then `undefined` so Zod/Valibot `.default()` fields resolve.
 */
export function parseInitialStateFromSchema<S extends StandardSchemaV1>(
  schema: S,
): StandardSchemaV1.InferOutput<S> {
  for (const seed of [{}, undefined] as const) {
    const result = validateWithSchema(schema, seed);
    if (result.ok) return result.data;
  }
  const failed = validateWithSchema(schema, {});
  const detail = failed.ok ? "" : JSON.stringify(issuesToErrors(failed.issues));
  throw new Error(
    `@ilha/store: could not derive initial state from schema (tried {} and undefined). ${detail}`,
  );
}

export function validateStateSnapshot<S extends StandardSchemaV1>(
  schema: S,
  snapshot: unknown,
):
  | { ok: true; data: StandardSchemaV1.InferOutput<S> }
  | { ok: false; issues: StandardSchemaV1.Issue[] } {
  const result = validateWithSchema(schema, snapshot);
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, issues: [...result.issues] };
}

export function primaryIssuePath(
  issues: ReadonlyArray<StandardSchemaV1.Issue>,
): string | undefined {
  const first = issues[0];
  if (!first?.path?.length) return undefined;
  return first.path
    .map((p) => (typeof p === "object" && p != null && "key" in p ? String(p.key) : String(p)))
    .join(".");
}
