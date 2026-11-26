// oxlint-disable-next-line eslint/max-classes-per-file -- the two Layer markers are one concept split from layer-run; a file per marker would obscure them.
import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";

/**
 * Marker merged into a record's env delta while its provide builds, so
 * feature children below render their `fallback(Initial)` instead of
 * throwing "nothing provides".
 */
export class PendingLayer extends Context.Service<PendingLayer, true>()(
  "ilha/model/PendingLayer"
) {}

/**
 * Marker merged into a record's env delta when its provide failed but an
 * `onFailure` handler kept the instance mounted. Feature children below
 * render their `fallback(Failure(cause))`.
 */
export class FailedLayer extends Context.Service<
  FailedLayer,
  Cause.Cause<unknown>
>()("ilha/model/FailedLayer") {}
