import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
/**
 * Files the user chooses: a picker that opens the browser's file dialog,
 * and reads of a `File` or `Blob` that stop when they're interrupted.
 *
 * A file input the view renders reports its files in its own payload.
 * `Files.pick` opens a picker without one, such as from a menu item or a
 * keyboard shortcut. Either way, send a `File` on to a Command and read it
 * there with `readAsText`, `readAsBytes` or `readAsDataUrl`. Interrupting
 * that Command cancels the read, so the browser stops reading the file
 * rather than reading it all and dropping the result.
 */
import * as Base64 from "effect/encoding/Base64";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as Command from "./command.ts";

/**
 * A read of a `Blob` failed, such as for a file deleted or changed after
 * the user chose it. `cause` is the browser's error.
 */
export class FileReadError extends Data.TaggedError("FileReadError")<{
  readonly cause: unknown;
}> {}

/**
 * Reads all of `blob`'s bytes. Interrupting it cancels the read.
 *
 * **Details**
 *
 * It reads `blob.stream()`, so it runs wherever `Blob` does, Node and
 * workers included. Read part of a large file with `blob.slice`.
 */
/** The bytes of `blob` as a stream, so interruption cancels the read. */
const bytesOf = (blob: Blob): Stream.Stream<Uint8Array, FileReadError> =>
  Stream.fromReadableStream({
    evaluate: () => blob.stream(),
    onError: (cause) => new FileReadError({ cause }),
  });

/**
 * Reads all of `blob`'s bytes. Interrupting it cancels the read.
 *
 * **Details**
 *
 * It reads `blob.stream()`, so it runs wherever `Blob` does, Node and
 * workers included. Read part of a large file with `blob.slice`.
 */
export const readAsBytes = (
  blob: Blob
): Effect.Effect<Uint8Array, FileReadError> =>
  Stream.mkUint8Array(bytesOf(blob));

/**
 * Reads `blob` as text in `encoding`, UTF-8 by default, as `TextDecoder`
 * decodes it. Interrupting it cancels the read.
 */
export const readAsText = (
  blob: Blob,
  encoding?: string
): Effect.Effect<string, FileReadError> =>
  bytesOf(blob).pipe(Stream.decodeText({ encoding }), Stream.mkString);

/**
 * Reads `blob` as a `data:` URL with its type and base64 content, as
 * `FileReader.readAsDataURL` does. Interrupting it cancels the read.
 *
 * **Details**
 *
 * The URL holds the whole content, so it costs a third more than the file
 * wherever it goes, the Model and the message log included. For a large
 * image, prefer `URL.createObjectURL`, revoked once the image isn't shown.
 */
export const readAsDataUrl = (
  blob: Blob
): Effect.Effect<string, FileReadError> =>
  Effect.map(
    readAsBytes(blob),
    (bytes) =>
      `data:${
        blob.type === "" ? "application/octet-stream" : blob.type
      };base64,${Base64.encode(bytes)}`
  );

/**
 * What a file picker shows and allows, as the file input attributes of the
 * same names: the file types it offers, such as `".pdf"` or `"image/*"`,
 * whether the user can choose more than one file, and the camera a phone
 * opens to capture a new one.
 */
export interface PickOptions {
  /** File types the picker offers, such as `".pdf"` or `"image/*"`. */
  readonly accept?: readonly string[] | undefined;
  /** Whether the user can choose more than one file. */
  readonly multiple?: boolean | undefined;
  /** The camera a phone opens to capture a new file. */
  readonly capture?: "user" | "environment" | undefined;
}

/**
 * What `Files.pick` reports: whether the browser opened the picker, and
 * the files the user chose, none when they dismissed it.
 *
 * **Details**
 *
 * The browser refuses to open a picker, giving `opened: false`, outside a
 * user's action. A Command issued from a click or key press runs within it.
 */
export interface Picked {
  /** False when the browser refused to open the picker. */
  readonly opened: boolean;
  /** The files the user chose; none when they dismissed the picker. */
  readonly files: readonly File[];
}

/**
 * Opens the browser's file picker.
 *
 * **Details**
 *
 * `pick` settles when the user chooses files or dismisses the picker. A
 * browser that doesn't report a dismissal leaves it pending, so let the user
 * move on without it. Interrupting it stops waiting, but the picker stays
 * open until the user closes it. The browser layer opens a detached file
 * input of its document. The default never settles, so on a host without a
 * document a pick stays pending. A test settles picks with `TestFiles` from
 * `@ilha/model/test`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the interface is the service contract, the const its Reference; intentional merging like ilha's `Fragment`.
export interface Files {
  /** Open the picker; settles with the user's choice or dismissal. */
  readonly pick: (options: PickOptions) => Effect.Effect<Picked>;
}

/**
 * The file picker. It defaults to one whose picks never settle.
 */
/** A picker whose picks never settle: the default without a document. */
const pending: Files = { pick: () => Effect.never };
export const Files: Context.Reference<Files> = Context.Reference<Files>(
  "@ilha/model/DomFiles/Files",
  { defaultValue: () => pending }
);

/**
 * A `Files` service that opens a detached `<input type=file>` of
 * `document`. The input is never attached, so it leaves no DOM behind.
 * `showPicker` opens it when the browser has it, else `click()` does;
 * a browser that refuses to open (outside a user action) settles with
 * `opened: false`.
 */
export const makeBrowserFiles = (document: Document): Files => ({
  pick: (options) =>
    Effect.callback((resume) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = options.multiple === true;
      if (options.accept !== undefined) {
        input.accept = options.accept.join(",");
      }
      if (options.capture !== undefined) {
        input.setAttribute("capture", options.capture);
      }
      const settle = (picked: readonly File[]) =>
        resume(Effect.succeed({ files: picked, opened: true }));
      const onChange = (): void => settle([...(input.files ?? [])]);
      const onCancel = (): void => settle([]);
      input.addEventListener("change", onChange);
      input.addEventListener("cancel", onCancel);
      try {
        // SAFETY: `showPicker` is missing from older DOM libs and older browsers, so check it exists first: calling `click()` too would open the picker twice, since `showPicker()` returns `undefined`.
        const picker = input as HTMLInputElement & {
          showPicker?: (() => void) | undefined;
        };
        if (picker.showPicker === undefined) {
          input.click();
        } else {
          picker.showPicker();
        }
      } catch {
        return resume(Effect.succeed({ files: [], opened: false }));
      }
      return Effect.sync(() => {
        input.removeEventListener("change", onChange);
        input.removeEventListener("cancel", onCancel);
      });
    }),
});

/**
 * Provide `Files` from `document`'s detached file inputs.
 */
export const browserLayer = (document: Document): Layer.Layer<Files> =>
  // SAFETY: `Context.add` stores the service under the reference's key, which `Context.get(Files)` reads back; the `never` is only the reference's missing input type.
  Layer.succeedContext(
    Context.empty().pipe(
      Context.add(Files, makeBrowserFiles(document))
    ) as Context.Context<Files>
  );

declare module "./command.ts" {
  interface FrameworkServices {
    /** The file picker `pick` opens. */
    readonly files: Files;
  }
}

/**
 * The Command behind `pick`.
 */
export const Pick: Command.Factory<
  "DomFiles.pick",
  PickOptions,
  Picked,
  Files
> = Command.make(
  "DomFiles.pick",
  // SAFETY: each field is a Schema for its option; the record bridges them to `ArgsInput` for the log encoder.
  {
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- `ArgsInput`'s variance needs the `unknown` stopover; each field keeps its precise schema.
    args: {
      accept: Schema.optional(Schema.Array(Schema.String)),
      capture: Schema.optional(Schema.Literals(["user", "environment"])),
      multiple: Schema.optional(Schema.Boolean),
    } as unknown as Record<string, Schema.Any>,
  },
  (options) => Files.use((files) => files.pick(options))
);

/**
 * Opens the browser's file picker and sends `f`'s message with the files
 * the user chose, or none when they dismissed it. Use to open a picker
 * from something other than a file input, such as a menu item or a
 * keyboard shortcut.
 */
export const pick = <Msg>(
  f: (picked: Picked) => Msg,
  options: PickOptions = {}
): Command.Mapped<Command.Issued<Picked, Files>, Msg> =>
  Command.map(Pick(options), f);
