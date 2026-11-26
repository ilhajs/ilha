import { describe, expect, it } from "bun:test";

import { Effect, Fiber } from "effect";

import { Files } from "../dom-files";
import { choose, dismiss, layer, make, TestFiles } from "./test-files";

describe("TestFiles", () => {
  it("settles a pending pick with the chosen files", async () => {
    const files = make();
    const fiber = await Effect.runPromise(
      Effect.forkDetach(files.pick({ multiple: true }))
    );
    await Effect.runPromise(Effect.yieldNow);
    expect(files.pending()).toEqual([{ multiple: true }]);
    const chosen = [new File(["hi"], "notes.txt")];
    files.settle({ files: chosen, opened: true });
    expect(await Effect.runPromise(Fiber.join(fiber))).toEqual({
      files: chosen,
      opened: true,
    });
  });

  it("settles every pending pick at once, and throws when none is pending", async () => {
    const files = make();
    const first = await Effect.runPromise(Effect.forkDetach(files.pick({})));
    const second = await Effect.runPromise(
      Effect.forkDetach(files.pick({ accept: ["image/*"] }))
    );
    await Effect.runPromise(Effect.yieldNow);
    expect(files.pending()).toEqual([{}, { accept: ["image/*"] }]);
    files.settle({ files: [], opened: true });
    expect(await Effect.runPromise(Fiber.join(first))).toEqual({
      files: [],
      opened: true,
    });
    expect(await Effect.runPromise(Fiber.join(second))).toEqual({
      files: [],
      opened: true,
    });
    expect(files.pending()).toEqual([]);
    expect(() => files.settle({ files: [], opened: true })).toThrow(
      "TestFiles: no pick is pending"
    );
  });

  it("drops a pick when the waiter is interrupted", async () => {
    const files = make();
    const fiber = await Effect.runPromise(Effect.forkDetach(files.pick({})));
    await Effect.runPromise(Effect.yieldNow);
    expect(files.pending()).toHaveLength(1);
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(files.pending()).toEqual([]);
  });

  it("provides Files and TestFiles from its layer, with choose and dismiss", async () => {
    const file = new File(["hi"], "notes.txt");
    const [picked, dismissed] = await Effect.runPromise(
      Effect.gen(function* choosesFromLayer() {
        const first = yield* Effect.forkChild(
          Files.use((files) => files.pick({}))
        );
        yield* Effect.yieldNow;
        yield* choose([file]);
        const one = yield* Fiber.join(first);
        const second = yield* Effect.forkChild(
          Files.use((files) => files.pick({}))
        );
        yield* Effect.yieldNow;
        yield* dismiss;
        const two = yield* Fiber.join(second);
        return [one, two] as const;
      }).pipe(Effect.provide(layer), Effect.scoped)
    );
    expect(picked).toEqual({ files: [file], opened: true });
    expect(dismissed).toEqual({ files: [], opened: true });
  });

  it("exposes the control through the TestFiles service", async () => {
    const pending = await Effect.runPromise(
      Effect.gen(function* pending() {
        const fiber = yield* Effect.forkChild(
          Files.use((files) => files.pick({ multiple: true }))
        );
        yield* Effect.yieldNow;
        const control = yield* TestFiles;
        const options = control.pending();
        yield* Fiber.interrupt(fiber);
        return options;
      }).pipe(Effect.provide(layer), Effect.scoped)
    );
    expect(pending).toEqual([{ multiple: true }]);
  });
});
