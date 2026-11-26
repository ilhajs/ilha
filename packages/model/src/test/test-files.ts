/**
 * A fake `Files` picker for whole-app tests, so a test decides what the
 * user chooses in each file picker, without a document, in Node too.
 *
 * Provide `layer` next to the host layer. Every pick stays pending until
 * `choose` or `dismiss` settles it.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DomFiles from "../dom-files";

/**
 * The `TestFiles` service: the fake's control.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair, mirroring ilha's Fragment.
export interface TestFiles {
  /** The options of each pending pick, oldest first. */
  readonly pending: () => readonly DomFiles.PickOptions[];
  /** Settles every pending pick with `picked`. Throws when none is pending. */
  readonly settle: (picked: DomFiles.Picked) => void;
}

/**
 * The `TestFiles` service.
 */
// oxlint-disable-next-line eslint/no-redeclare -- intentional const+type pair, mirroring ilha's Fragment.
export const TestFiles: Context.Service<TestFiles, TestFiles> =
  Context.Service<TestFiles>("@ilha/model/test/TestFiles");

/** One pick waiting for the test to settle it. */
interface Pending {
  readonly options: DomFiles.PickOptions;
  readonly settle: (picked: DomFiles.Picked) => void;
}

/**
 * Makes a fake picker and its control. `layer` provides a new one per build.
 */
export const make = (): DomFiles.Files & TestFiles => {
  const pending = new Set<Pending>();
  return {
    pending: () => Array.from(pending, (entry) => entry.options),
    pick: (options) =>
      Effect.callback((resume) => {
        const entry: Pending = {
          options,
          settle: (picked) => resume(Effect.succeed(picked)),
        };
        pending.add(entry);
        return Effect.sync(() => {
          pending.delete(entry);
        });
      }),
    settle: (picked) => {
      if (pending.size === 0) {
        throw new Error("TestFiles: no pick is pending");
      }
      const entries = [...pending];
      pending.clear();
      for (const entry of entries) {
        entry.settle(picked);
      }
    },
  };
};

/**
 * Provides a fake `DomFiles.Files` with its control, `TestFiles`.
 */
export const layer: Layer.Layer<TestFiles> = Layer.effectContext(
  Effect.sync(() => {
    const files = make();
    return Context.make(TestFiles, files).pipe(
      // SAFETY: `make` returns one object implementing both services; the cast reuses it for each key.
      Context.add(DomFiles.Files, files as DomFiles.Files)
    );
  })
);

/**
 * Settles the pending picks with `files`, as the user choosing them.
 */
export const choose = (
  files: readonly File[]
): Effect.Effect<void, never, TestFiles> =>
  TestFiles.useSync((control) => control.settle({ files, opened: true }));

/**
 * Settles the pending picks with no files, as the user dismissing the picker.
 */
export const dismiss: Effect.Effect<void, never, TestFiles> = TestFiles.useSync(
  (control) => control.settle({ files: [], opened: true })
);
