import { describe, expect, it } from "bun:test";

import { Effect, Exit, Fiber } from "effect";
import * as Cause from "effect/Cause";

import { browserLayer, Images, makeBrowserImages } from "./dom-images";

describe("Images default", () => {
  it("never settles without a provided implementation", async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* exit() {
        const fiber = yield* Effect.forkChild(
          Images.pipe(
            Effect.flatMap((images) => images.load({ src: "/ada.png" }))
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

it("provides working loads through its layer", async () => {
  const load = Images.pipe(
    Effect.flatMap((images) =>
      images.load({ src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" })
    ),
    Effect.provide(browserLayer(document))
  );
  expect(await Effect.runPromise(load)).toBe("loaded");
});

describe("makeBrowserImages", () => {
  it("loads a data URL image that has pixels", async () => {
    const images = makeBrowserImages(document);
    expect(
      await Effect.runPromise(
        images.load({ src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" })
      )
    ).toBe("loaded");
  });

  it("reports an error for an image without pixels", async () => {
    const created: HTMLImageElement[] = [];
    const realCreateElement = document.createElement.bind(document);
    // SAFETY: the mock only records created images and otherwise delegates to the real createElement.
    document.createElement = ((
      tagName: string,
      options?: ElementCreationOptions
    ) => {
      const element = realCreateElement(tagName, options);
      if (tagName === "img") {
        // SAFETY: guarded by the tagName check — createElement("img") returns an HTMLImageElement.
        created.push(element as HTMLImageElement);
      }
      return element;
    }) as typeof document.createElement;
    try {
      const images = makeBrowserImages(document);
      const fiber = await Effect.runPromise(Effect.forkDetach(images.load({})));
      await Effect.runPromise(Effect.sleep("30 millis"));
      expect(created).toHaveLength(1);
      const [image] = created;
      expect(image.isConnected).toBe(false);
      image.dispatchEvent(new Event("error"));
      expect(await Effect.runPromise(Fiber.join(fiber))).toBe("error");
    } finally {
      document.createElement = realCreateElement;
    }
  });

  it("settles at once when the image is already complete", async () => {
    const realCreateElement = document.createElement.bind(document);
    // SAFETY: the mock only overrides complete/naturalWidth on images and otherwise delegates to the real createElement.
    document.createElement = ((
      tagName: string,
      options?: ElementCreationOptions
    ) => {
      const element = realCreateElement(tagName, options);
      if (tagName === "img") {
        // SAFETY: guarded by the tagName check — createElement("img") returns an HTMLImageElement.
        Object.defineProperties(element as HTMLImageElement, {
          complete: { configurable: true, value: true },
          naturalWidth: { configurable: true, value: 0 },
        });
      }
      return element;
    }) as typeof document.createElement;
    try {
      const images = makeBrowserImages(document);
      expect(
        await Effect.runPromise(images.load({ src: "/missing.png" }))
      ).toBe("error");
    } finally {
      document.createElement = realCreateElement;
    }
  });
  it("drops the load when interrupted", async () => {
    const realCreateElement = document.createElement.bind(document);
    // SAFETY: the mock only overrides complete on images and otherwise delegates to the real createElement.
    document.createElement = ((
      tagName: string,
      options?: ElementCreationOptions
    ) => {
      const element = realCreateElement(tagName, options);
      if (tagName === "img") {
        // SAFETY: guarded by the tagName check — createElement("img") returns an HTMLImageElement.
        Object.defineProperty(element as HTMLImageElement, "complete", {
          configurable: true,
          value: false,
        });
      }
      return element;
    }) as typeof document.createElement;
    try {
      const images = makeBrowserImages(document);
      const exit = await Effect.runPromise(
        Effect.gen(function* exit() {
          const fiber = yield* Effect.forkChild(
            images.load({ src: "/slow.png" })
          );
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(fiber);
          return yield* Fiber.await(fiber);
        })
      );
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
        true
      );
    } finally {
      document.createElement = realCreateElement;
    }
  });
});
