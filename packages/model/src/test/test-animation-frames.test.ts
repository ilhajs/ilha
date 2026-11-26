/**
 * Unit tests for the `TestAnimationFrames` fake: its clock starts at `0`,
 * `fire` advances it and calls every listener, and detached listeners hear
 * nothing. The runtime attach tests live in `dom-subscription.test`.
 */
import { describe, expect, it } from "bun:test";

import { make } from "./test-animation-frames";

describe("TestAnimationFrames", () => {
  it("starts at 0 and advances on fire, calling every listener", () => {
    const frames = make();
    expect(frames.now()).toBe(0);
    const heard: number[] = [];
    frames.listen((time) => heard.push(time));
    frames.fire();
    frames.fire(17);
    expect(frames.now()).toBe(33);
    expect(heard).toEqual([16, 33]);
  });

  it("stops calling detached listeners", () => {
    const frames = make();
    const heard: number[] = [];
    const detach = frames.listen((time) => heard.push(time));
    frames.fire();
    detach();
    frames.fire();
    expect(heard).toEqual([16]);
  });
});
