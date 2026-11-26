/**
 * A fake `Images` loader for whole-app tests, so a test decides how each
 * image load settles, without a document, in Node too.
 *
 * Provide `layer` next to the host layer. Every load stays pending until
 * `load` or `fail` settles the loads of its source.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DomImages from "../dom-images";

/**
 * The `TestImages` service: the fake's control.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair, mirroring ilha's Fragment.
export interface TestImages {
  /**
   * Settles every pending load of `source` with `status`. Sources with the
   * same fields are the same. Throws, listing the pending sources, when
   * none is of `source`.
   */
  readonly settle: (
    source: DomImages.ImageSource,
    status: "loaded" | "error"
  ) => void;
}

/**
 * The `TestImages` service.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair, mirroring ilha's Fragment.
export const TestImages: Context.Service<TestImages, TestImages> =
  Context.Service<TestImages>("@ilha/model/test/TestImages");

/** One load waiting for the test to settle it. */
interface Pending {
  readonly source: string;
  readonly settle: (status: "loaded" | "error") => void;
}

/** Sources are equal by field, so structurally identical sources are the same load. */
const encode = ({
  crossOrigin,
  referrerPolicy,
  sizes,
  src,
  srcSet,
}: DomImages.ImageSource): string =>
  JSON.stringify({ crossOrigin, referrerPolicy, sizes, src, srcSet });

/**
 * Makes a fake loader and its control. `layer` provides a new one per
 * build.
 */
export const make = (): DomImages.Images & TestImages => {
  const pending = new Set<Pending>();
  return {
    load: (source) =>
      Effect.callback((resume) => {
        const entry: Pending = {
          settle: (status) => resume(Effect.succeed(status)),
          source: encode(source),
        };
        pending.add(entry);
        return Effect.sync(() => {
          pending.delete(entry);
        });
      }),
    settle: (source, status) => {
      const key = encode(source);
      const matching = [...pending].filter((entry) => entry.source === key);
      if (matching.length === 0) {
        const sources = [
          ...new Set(Array.from(pending, (entry) => entry.source)),
        ].join(", ");
        throw new Error(
          `TestImages: no load of ${key} is pending; pending: [${sources}]`
        );
      }
      for (const entry of matching) {
        pending.delete(entry);
        entry.settle(status);
      }
    },
  };
};

/**
 * Provides a fake `DomImages.Images` with its control, `TestImages`.
 */
export const layer: Layer.Layer<TestImages> = Layer.effectContext(
  Effect.sync(() => {
    const images = make();
    return Context.make(TestImages, images).pipe(
      Context.add(DomImages.Images, images)
    );
  })
);

/**
 * Settles the pending loads of `source` as `"loaded"`.
 */
export const load = (
  source: DomImages.ImageSource
): Effect.Effect<void, never, TestImages> =>
  TestImages.useSync((images) => images.settle(source, "loaded"));

/**
 * Settles the pending loads of `source` as `"error"`.
 */
export const fail = (
  source: DomImages.ImageSource
): Effect.Effect<void, never, TestImages> =>
  TestImages.useSync((images) => images.settle(source, "error"));
