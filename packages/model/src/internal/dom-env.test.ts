/**
 * Tests for the per-island DOM environment: `Refs` retry timing, the
 * animation-frame loop's detach behavior, and the services `baseEnv` seeds
 * client instances with.
 */
import { describe, expect, it } from "bun:test";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import type { FiberLocal } from "ilha/internal";

import * as DomFiles from "../dom-files.ts";
import * as DomImages from "../dom-images.ts";
import * as DomSubscription from "../dom-subscription.ts";
import * as Dom from "../dom.ts";
import { baseEnv, makeRefs } from "./dom-env.ts";

// SAFETY: the env only reads `runtime.ssr` off the island handle; the double cast bridges the partial test double.
// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the test double provides only the `runtime.ssr` field the env reads.
const island = { runtime: { ssr: false } } as unknown as FiberLocal;

describe("makeRefs", () => {
  it("reads again after the microtask when the ref arrives late", async () => {
    const nodes = new Map<string, Element>();
    const refs = makeRefs({ nodes });
    const div = document.createElement("div");
    // The lookup runs synchronously until it waits on its microtask, so a
    // node stored in a microtask queued right after the issue is invisible
    // to the first read and visible only to a retry that reads after it.
    try {
      const result = Effect.runPromise(refs.lookup(Dom.ref("late")));
      queueMicrotask(() => {
        nodes.set("late", div);
      });
      const found = await result;
      expect(Option.isSome(found)).toBe(true);
      if (Option.isSome(found)) {
        expect(found.value === div).toBe(true);
      }
    } finally {
      div.remove();
    }
  });
});

describe("baseEnv", () => {
  it("does not re-arm the frame loop after a detach inside the callback", () => {
    const view = document.defaultView;
    if (view === null) {
      throw new Error("no window");
    }
    const realRequest = view.requestAnimationFrame;
    const realCancel = view.cancelAnimationFrame;
    const queued = new Map<number, FrameRequestCallback>();
    let next = 1;
    // SAFETY: the fakes keep the real rAF signatures, so queued callbacks run with a frame time and cancel drops the id.
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- the fake `requestAnimationFrame` must take a callback; that is its API.
    view.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
      const id = next;
      next += 1;
      queued.set(id, callback);
      return id;
    }) as typeof realRequest;
    // SAFETY: the fake keeps the real `cancelAnimationFrame` signature, so the loop under test drops the id.
    view.cancelAnimationFrame = ((id: number): void => {
      queued.delete(id);
    }) as typeof realCancel;
    try {
      const frames = Context.get(
        baseEnv(island),
        DomSubscription.AnimationFrames
      );
      let calls = 0;
      const detach = frames.listen(() => {
        calls += 1;
        detach();
      });
      expect(queued.size).toBe(1);
      for (const fire of queued.values()) {
        fire(16);
      }
      expect(calls).toBe(1);
      expect(queued.size).toBe(0);
    } finally {
      view.requestAnimationFrame = realRequest;
      view.cancelAnimationFrame = realCancel;
    }
  });

  it("seeds Files and Images so island Commands resolve them", async () => {
    const realCreateElement = document.createElement.bind(document);
    const created: HTMLInputElement[] = [];
    // SAFETY: the wrapper forwards every argument and returns the real element, preserving the overloads; `createElement("input")` returns an `HTMLInputElement` per the DOM standard.
    document.createElement = ((
      tagName: string,
      options?: ElementCreationOptions
    ) => {
      const element = realCreateElement(tagName, options);
      if (tagName === "input") {
        // SAFETY: `tagName` narrowed to `"input"`, whose elements the DOM standard types as `HTMLInputElement`.
        created.push(element as HTMLInputElement);
      }
      return element;
    }) as typeof document.createElement;
    try {
      const env = baseEnv(island);
      // SAFETY: the env is built by `baseEnv`, which provides every service the pick needs; `never` is only the env's requirement marker.
      const fiber = await Effect.runPromise(
        Effect.forkDetach(
          DomFiles.Files.use((files) => files.pick({})).pipe(
            Effect.provide(env as Context.Context<never>)
          )
        )
      );
      await Effect.runPromise(Effect.sleep("30 millis"));
      expect(created).toHaveLength(1);
      const file = new File(["hi"], "notes.txt");
      Object.defineProperty(created[0], "files", {
        configurable: true,
        value: [file],
      });
      created[0].dispatchEvent(new Event("change", { bubbles: true }));
      expect(await Effect.runPromise(Fiber.join(fiber))).toEqual({
        files: [file],
        opened: true,
      });
      // SAFETY: same seeded env as the pick above; the images service is always present.
      const loaded = await Effect.runPromise(
        DomImages.Images.use((images) =>
          images.load({ src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" })
        ).pipe(Effect.provide(env as Context.Context<never>))
      );
      expect(loaded).toBe("loaded");
    } finally {
      document.createElement = realCreateElement;
    }
  });
});
