import { expect, test } from "bun:test";

import * as Effect from "effect/Effect";

import { interpret } from "../src/interpret.ts";
import { makeFiber, makeRuntime } from "../src/runtime.ts";
import type { View } from "../src/types.ts";

function run(gen: () => Generator<any, View | void, unknown>) {
  const frames: View[] = [];
  const runtime = makeRuntime();
  const fiber = makeFiber(runtime, document.createElement("div"), (_f, v) => {
    frames.push(v);
  });
  interpret(gen, fiber);
  return { frames, fiber, runtime };
}

test("yield Effect binds", async () => {
  let got: unknown;
  const { frames } = run(function* () {
    got = yield Effect.succeed(1);
    yield String(got);
  });
  await Promise.resolve();
  expect(got).toBe(1);
  expect(frames).toEqual(["1"]);
});

test("yield a then yield b records frames", () => {
  const { frames } = run(function* () {
    yield "a";
    yield "b";
  });
  expect(frames).toEqual(["a", "b"]);
});

test("sleep between frames", async () => {
  const { frames, runtime } = run(function* () {
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
  const { frames, fiber, runtime } = run(function* () {
    yield "a";
    yield Effect.sleep(50);
    yield "b";
  });
  fiber.closed = true;
  runtime.close();
  await Bun.sleep(80);
  expect(frames).toEqual(["a"]);
});
