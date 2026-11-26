/**
 * Snapshot support: the `Schema.Redacted` walk that keeps secrets out of the
 * island snapshot. The walk itself lives in `internal/schema-redact.ts`;
 * this module applies it to instance Models.
 *
 * Query results are covered separately, not here: the query binding marks
 * entries whose args, success or error Schema holds `Schema.Redacted` and
 * builds their results atom with `snapshot: false` (see `internal/queries.ts`
 * and `internal/query-run.ts`). So an instance is excluded from the snapshot
 * exactly when its Model holds `Redacted` (this module) or one of its query
 * entries does (the query binding).
 *
 * @internal
 */
import * as Schema from "effect/Schema";

import { holdsRedacted } from "./schema-redact.ts";

/**
 * Whether the instance's Model must never be serialised: its Schema holds
 * `Schema.Redacted` anywhere (fields, arrays, unions, suspends,
 * declaration type parameters and encodings, as `holdsRedacted` walks them).
 *
 * @internal
 */
export const isRedactedState = (modelSchema: Schema.Schema<unknown>): boolean =>
  holdsRedacted(modelSchema.ast);

/**
 * Encode the model for the island snapshot with `Schema.toCodecJson`.
 * Redacted models are never encoded: the caller keeps them out of the
 * snapshot instead (see `kernel.md`).
 *
 * @internal
 */
export const modelCodecOf = (
  modelSchema: Schema.Schema<unknown>
): Schema.ConstraintCodec<unknown, unknown> =>
  // SAFETY: every Schema is a Codec over unknown at runtime; toCodecJson only reads the Codec view and the result value is unchanged.
  Schema.toCodecJson(
    modelSchema as Schema.Codec<unknown, unknown>
  ) as Schema.ConstraintCodec<unknown, unknown>;
