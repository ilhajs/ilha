/**
 * Field validation for Ilha forms: rules, derived field state and submit gating.
 *
 * Import the whole module as a namespace:
 *
 * ```ts
 * import { Validation } from "@ilha/model/validation";
 *
 * const Signup = Validation.make({
 *   email: { required: "Email is required", rules: [Validation.Rule.email()] },
 * });
 * ```
 */
// oxlint-disable-next-line no-barrel-file -- package entry point re-exports the public API
export * from "./validation.ts";
// oxlint-disable-next-line no-barrel-file -- package entry point re-exports the public API
export * as Validation from "./validation.ts";
