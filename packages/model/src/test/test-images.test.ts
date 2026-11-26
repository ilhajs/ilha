import { describe, expect, it } from "bun:test";

import { Effect, Fiber } from "effect";

import { Images } from "../dom-images";
import { fail, layer, load, make, TestImages } from "./test-images";

describe("TestImages", () => {
  it("settles the loads of a source, and throws for one with none pending", async () => {
    const images = make();
    const fiber = await Effect.runPromise(
      Effect.forkDetach(images.load({ sizes: undefined, src: "/ada.png" }))
    );
    await Effect.runPromise(Effect.yieldNow);
    expect(() => images.settle({ src: "/grace.png" }, "loaded")).toThrow(
      `TestImages: no load of {"src":"/grace.png"} is pending; pending: [{"src":"/ada.png"}]`
    );
    images.settle({ src: "/ada.png" }, "error");
    expect(await Effect.runPromise(Fiber.join(fiber))).toBe("error");
  });

  it("settles only the loads of the exact source", async () => {
    const images = make();
    const first = await Effect.runPromise(
      Effect.forkDetach(images.load({ src: "/ada.png" }))
    );
    const second = await Effect.runPromise(
      Effect.forkDetach(
        images.load({ crossOrigin: "anonymous", src: "/ada.png" })
      )
    );
    await Effect.runPromise(Effect.yieldNow);
    images.settle({ src: "/ada.png" }, "loaded");
    expect(await Effect.runPromise(Fiber.join(first))).toBe("loaded");
    expect(() =>
      images.settle({ crossOrigin: "anonymous", src: "/ada.png" }, "loaded")
    ).not.toThrow();
    expect(await Effect.runPromise(Fiber.join(second))).toBe("loaded");
  });
  it("drops a load when the waiter is interrupted", async () => {
    const images = make();
    const fiber = await Effect.runPromise(
      Effect.forkDetach(images.load({ src: "/ada.png" }))
    );
    await Effect.runPromise(Effect.yieldNow);
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(() => images.settle({ src: "/ada.png" }, "loaded")).toThrow(
      `TestImages: no load of {"src":"/ada.png"} is pending; pending: []`
    );
  });

  it("provides Images and TestImages from its layer, with load and fail", async () => {
    const [loaded, failed] = await Effect.runPromise(
      Effect.gen(function* loadsFromLayer() {
        const first = yield* Effect.forkChild(
          Images.use((images) => images.load({ src: "/ada.png" }))
        );
        const second = yield* Effect.forkChild(
          Images.use((images) => images.load({ src: "/grace.png" }))
        );
        yield* Effect.yieldNow;
        yield* load({ src: "/ada.png" });
        yield* fail({ src: "/grace.png" });
        return [yield* Fiber.join(first), yield* Fiber.join(second)] as const;
      }).pipe(Effect.provide(layer), Effect.scoped)
    );
    expect(loaded).toBe("loaded");
    expect(failed).toBe("error");
  });

  it("exposes the control through the TestImages service", async () => {
    await Effect.runPromise(
      Effect.gen(function* exposesControl() {
        const fiber = yield* Effect.forkChild(
          Images.use((images) => images.load({ src: "/ada.png" }))
        );
        yield* Effect.yieldNow;
        const control = yield* TestImages;
        control.settle({ src: "/ada.png" }, "loaded");
        expect(yield* Fiber.join(fiber)).toBe("loaded");
      }).pipe(Effect.provide(layer), Effect.scoped)
    );
  });
});
