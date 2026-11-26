import { describe, expect, it } from "bun:test";

import { Effect, Exit, Fiber } from "effect";
import * as Cause from "effect/Cause";

import {
  browserLayer,
  FileReadError,
  Files,
  makeBrowserFiles,
  readAsBytes,
  readAsDataUrl,
  readAsText,
} from "./dom-files";

class TestBlob extends Blob {
  private readonly open: () => ReadableStream<Uint8Array<ArrayBuffer>>;
  constructor(
    parts: BlobPart[],
    open: () => ReadableStream<Uint8Array<ArrayBuffer>>
  ) {
    super(parts);
    this.open = open;
  }

  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    return this.open();
  }
}

const chunked = (chunks: readonly Uint8Array<ArrayBuffer>[]): TestBlob =>
  new TestBlob([...chunks], () => {
    const pending = [...chunks];
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        for (const chunk of pending) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
  });

describe("DomFiles readers", () => {
  it("reads a Blob's bytes, text and data URL", async () => {
    const chunks = [new Uint8Array([0x68, 0xc3]), new Uint8Array([0xa9, 0x21])];
    expect(await Effect.runPromise(readAsBytes(chunked(chunks)))).toEqual(
      new Uint8Array([0x68, 0xc3, 0xa9, 0x21])
    );
    expect(await Effect.runPromise(readAsText(chunked(chunks)))).toBe("hé!");
    expect(
      await Effect.runPromise(
        readAsText(new Blob([new Uint8Array([0xe9])]), "latin1")
      )
    ).toBe("é");
    expect(await Effect.runPromise(readAsDataUrl(new Blob(["hi"])))).toBe(
      "data:application/octet-stream;base64,aGk="
    );
    expect(
      await Effect.runPromise(
        readAsDataUrl(new Blob(["hi"], { type: "text/plain" }))
      )
    ).toBe("data:text/plain;base64,aGk=");
  });

  it("reports a failed read as a FileReadError with its cause", async () => {
    const cause = new DOMException("The file changed", "NotReadableError");
    const changed = new TestBlob([], () => {
      const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
        start: (controller) => controller.error(cause),
      });
      return stream;
    });
    const error = await Effect.runPromise(Effect.flip(readAsText(changed)));
    expect(error._tag).toBe("FileReadError");
    // SAFETY: Effect.flip exposes the failure; the tag assertion above confirms it is a FileReadError.
    expect((error as FileReadError).cause).toBe(cause);
    expect(error).toBeInstanceOf(FileReadError);
  });

  it("cancels the read when the reader is interrupted", async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* exit() {
        const fiber = yield* Effect.forkChild(
          readAsBytes(
            new TestBlob(
              [],
              () => new ReadableStream<Uint8Array<ArrayBuffer>>({})
            )
          )
        );
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      })
    );
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true
    );
  });
});

describe("Files default", () => {
  it("never settles without a provided implementation", async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* exit() {
        const fiber = yield* Effect.forkChild(
          Files.pipe(Effect.flatMap((files) => files.pick({})))
        );
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      })
    );
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true
    );
  });
});

/** Settle `input` with `files`, as the user choosing them. */
const choose = (input: HTMLInputElement, files: readonly File[]) => {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("makeBrowserFiles", () => {
  const created: HTMLInputElement[] = [];
  const realCreateElement = document.createElement.bind(document);

  const capture = () => {
    created.length = 0;
    // SAFETY: the mock only records created inputs and otherwise delegates to the real createElement.
    document.createElement = ((
      tagName: string,
      options?: ElementCreationOptions
    ) => {
      const element = realCreateElement(tagName, options);
      if (tagName === "input") {
        // SAFETY: guarded by the tagName check — createElement("input") returns an HTMLInputElement.
        created.push(element as HTMLInputElement);
      }
      return element;
    }) as typeof document.createElement;
  };

  const restore = () => {
    document.createElement = realCreateElement;
  };

  it("provides working picks through its layer", async () => {
    capture();
    try {
      const fiber = await Effect.runPromise(
        Effect.forkDetach(
          Files.pipe(
            Effect.flatMap((files) => files.pick({ accept: [".pdf"] })),
            Effect.provide(browserLayer(document))
          )
        )
      );
      await Effect.runPromise(Effect.sleep("30 millis"));
      expect(created).toHaveLength(1);
      expect(created[0].accept).toBe(".pdf");
      const file = new File(["hi"], "notes.txt");
      choose(created[0], [file]);
      expect(await Effect.runPromise(Fiber.join(fiber))).toEqual({
        files: [file],
        opened: true,
      });
    } finally {
      restore();
    }
  });

  it("opens a detached file input and reports a choice", async () => {
    capture();
    try {
      const files = makeBrowserFiles(document);
      const fiber = await Effect.runPromise(
        Effect.forkDetach(
          files.pick({
            accept: ["image/*", ".pdf"],
            capture: "environment",
            multiple: true,
          })
        )
      );
      await Effect.runPromise(Effect.sleep("30 millis"));
      expect(created).toHaveLength(1);
      const [input] = created;
      expect([
        input.type,
        input.accept,
        input.multiple,
        input.getAttribute("capture"),
        input.isConnected,
      ]).toEqual(["file", "image/*,.pdf", true, "environment", false]);
      const file = new File(["hi"], "notes.txt");
      choose(input, [file]);
      expect(await Effect.runPromise(Fiber.join(fiber))).toEqual({
        files: [file],
        opened: true,
      });
    } finally {
      restore();
    }
  });

  it("reports a dismissal with no files", async () => {
    capture();
    try {
      const files = makeBrowserFiles(document);
      const fiber = await Effect.runPromise(Effect.forkDetach(files.pick({})));
      await Effect.runPromise(Effect.sleep("30 millis"));
      expect(created).toHaveLength(1);
      created[0].dispatchEvent(new Event("cancel"));
      expect(await Effect.runPromise(Fiber.join(fiber))).toEqual({
        files: [],
        opened: true,
      });
    } finally {
      restore();
    }
  });

  it("reports opened: false when the browser refuses to open", async () => {
    capture();
    // SAFETY: the test only reads showPicker off the real input prototype in happy-dom
    const proto = window.HTMLInputElement.prototype as HTMLInputElement & {
      showPicker?: (() => void) | undefined;
    };
    proto.showPicker = () => {
      throw new DOMException("No user activation", "NotAllowedError");
    };
    try {
      const files = makeBrowserFiles(document);
      expect(await Effect.runPromise(files.pick({}))).toEqual({
        files: [],
        opened: false,
      });
    } finally {
      // SAFETY: showPicker was added by this test above; deleting restores the pristine prototype
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- delete needs an indexable view of the prototype
      delete (proto as unknown as Record<string, unknown>)["showPicker"];
      restore();
    }
  });

  it("calls click only when showPicker is unavailable", async () => {
    capture();
    // SAFETY: the test only reads showPicker off the real input prototype in happy-dom
    const proto = window.HTMLInputElement.prototype as HTMLInputElement & {
      showPicker?: (() => void) | undefined;
    };
    const realClick = proto.click;
    const realPicker = proto.showPicker;
    let clicks = 0;
    let pickers = 0;
    proto.click = function click(this: HTMLInputElement) {
      clicks += 1;
      return realClick.call(this);
    };
    proto.showPicker = () => {
      pickers += 1;
    };
    try {
      const files = makeBrowserFiles(document);
      const fiber = await Effect.runPromise(Effect.forkDetach(files.pick({})));
      await Effect.runPromise(Effect.sleep("30 millis"));
      expect(created).toHaveLength(1);
      expect(pickers).toBe(1);
      expect(clicks).toBe(0);
      const file = new File(["hi"], "notes.txt");
      choose(created[0], [file]);
      expect(await Effect.runPromise(Fiber.join(fiber))).toEqual({
        files: [file],
        opened: true,
      });
    } finally {
      proto.click = realClick;
      if (realPicker === undefined) {
        // SAFETY: showPicker was added by this test above; deleting restores the pristine prototype
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- delete needs an indexable view of the prototype
        delete (proto as unknown as Record<string, unknown>)["showPicker"];
      } else {
        proto.showPicker = realPicker;
      }
      restore();
    }
  });

  it("interrupting the pick stops waiting without settling", async () => {
    const files = makeBrowserFiles(document);
    const exit = await Effect.runPromise(
      Effect.gen(function* exit() {
        const fiber = yield* Effect.forkChild(files.pick({}));
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      })
    );
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true
    );
  });
});
