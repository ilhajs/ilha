import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { interpret } from "../src/interpret.ts";
import { makeFiber, makeRuntime } from "../src/runtime.ts";
import type { GeneratorFn, View, Yielded } from "../src/types.ts";

type TestGen = () => Generator<Yielded, View | undefined, View>;

const run = (gen: TestGen) => {
  const frames: View[] = [];
  const runtime = makeRuntime();
  const fiber = makeFiber(runtime, document.createElement("div"), (_f, v) => {
    frames.push(v);
  });
  // SAFETY: TestGen is a GeneratorFn subset used by interpret.
  interpret(gen as GeneratorFn, fiber);
  return { fiber, frames, runtime };
};

test("yield Effect binds", async () => {
  let got: View | undefined;
  const { frames } = run(function* appGen() {
    got = yield Effect.succeed(1);
    yield String(got);
  });
  await Promise.resolve();
  expect(got).toBe(1);
  expect(frames).toEqual(["1"]);
});

test("yield a then yield b records frames", () => {
  const { frames } = run(function* appGen() {
    yield "a";
    yield "b";
  });
  expect(frames).toEqual(["a", "b"]);
});

test("sleep between frames", async () => {
  const { frames, runtime } = run(function* appGen() {
    yield "a";
    yield Effect.sleep(10);
    yield "b";
  });
  expect(frames).toEqual(["a"]);
  await Bun.sleep(20);
  expect(frames).toEqual(["a", "b"]);
  runtime.close();
});

test("interrupt during sleep skips b", async () => {
  const { frames, fiber, runtime } = run(function* appGen() {
    yield "a";
    yield Effect.sleep(50);
    yield "b";
  });
  fiber.closed = true;
  runtime.close();
  await Bun.sleep(80);
  expect(frames).toEqual(["a"]);
});

const neverGen = function* neverGen(): Generator<
  Yielded,
  View | undefined,
  View
> {
  yield Effect.never;
};

test("re-entry while an Instruction is in flight throws", () => {
  const runtime = makeRuntime();
  const fiber = makeFiber(runtime, document.createElement("div"), () => {});
  // SAFETY: neverGen is a GeneratorFn that yields Effect.never.
  interpret(neverGen as GeneratorFn, fiber);
  // SAFETY: neverGen is a GeneratorFn that yields Effect.never.
  expect(() => interpret(neverGen as GeneratorFn, fiber)).toThrow(
    "ilha: re-enter while Instruction in flight"
  );
});
