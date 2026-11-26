/**
 * The `Noop` message: a run that has nothing to report. Ported from Effect
 * UI's `internal/noop.ts`.
 *
 * @internal
 */
import type { Noop, NoopTypeId } from "../component.ts";

// The same string as `Component.NoopTypeId`, declared here too so this module
// needs `component.ts` for types only.
const TypeId: NoopTypeId = "~@effect/ui/Component/Noop";

/** @internal */
export const noop: Noop = Object.freeze({ [TypeId]: TypeId });

/**
 * Recognises the value by its type id, not by identity, so a copy made by
 * another copy of `effect` in the same bundle counts.
 *
 * @internal
 */
export const isNoop = (u: unknown): u is Noop =>
  typeof u === "object" &&
  u !== null &&
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: the read only probes for the branded Noop marker; the type guard re-establishes the Noop contract.
  (u as Record<string, unknown>)[TypeId] === TypeId;
