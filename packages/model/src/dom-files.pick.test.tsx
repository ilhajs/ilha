/**
 * Tests for the `DomFiles.pick` Command: it opens the `Files` picker with
 * the given options and maps the choice to a message. The body runs here
 * against the `TestFiles` fake, and a mounted island below proves the
 * kernel seeds a working `Files` service on the client.
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { render } from "ilha/test";

import type * as Command from "./command.ts";
import { defineComponent } from "./component.ts";
import { pick, Pick } from "./dom-files.ts";
import type { Files, Picked } from "./dom-files.ts";
import { TaggedEnum } from "./tagged-enum.ts";
import {
  choose,
  dismiss,
  layer as testFilesLayer,
  TestFiles,
} from "./test/test-files.ts";

describe("DomFiles.pick", () => {
  it("opens the picker with the options and maps the choice", async () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const issued: Command.Command<Picked, Files> = Pick({
      accept: [".txt"],
      multiple: true,
    });
    // SAFETY: narrows the command union's tag for the Interrupt check; the string comparison is type-only.
    if (
      (issued._tag as string) === "Interrupt" ||
      issued.effect === undefined
    ) {
      throw new Error("not an effect command");
    }
    const program = Effect.gen(function* program() {
      // SAFETY: guarded by the check above — a non-Interrupt command reaching here carries a defined Effect.
      const fiber = yield* Effect.forkChild(
        issued.effect as Effect.Effect<unknown>
      );
      yield* Effect.yieldNow;
      const pending = yield* TestFiles.use((control) =>
        Effect.sync(() => control.pending())
      );
      expect(pending).toEqual([{ accept: [".txt"], multiple: true }]);
      yield* choose([file]);
      return yield* Fiber.join(fiber);
    });
    const picked = await Effect.runPromise(
      program.pipe(Effect.provide(testFilesLayer))
    );
    expect(picked).toEqual({ files: [file], opened: true });
  });

  it("maps the dismissal through pick", async () => {
    const issued: Command.Command<{ readonly choice: Picked }, Files> = pick(
      (choice) => ({ choice }),
      { capture: "user" }
    );
    // SAFETY: narrows the command union's tag for the Interrupt check; the string comparison is type-only.
    if (
      (issued._tag as string) === "Interrupt" ||
      issued.effect === undefined
    ) {
      throw new Error("not an effect command");
    }
    const program = Effect.gen(function* program() {
      // SAFETY: guarded by the check above — a non-Interrupt command reaching here carries a defined Effect.
      const fiber = yield* Effect.forkChild(
        issued.effect as Effect.Effect<unknown>
      );
      yield* Effect.yieldNow;
      yield* dismiss;
      return issued.resolve(yield* Fiber.join(fiber));
    });
    const message = await Effect.runPromise(
      program.pipe(Effect.provide(testFilesLayer))
    );
    expect(message).toEqual({ choice: { files: [], opened: true } });
  });

  it("resolves in a mounted island through the island's Files service", async () => {
    const PickerMessage = TaggedEnum({
      Ask: {},
      Chose: { count: Schema.Number },
    });
    const PickerDef = defineComponent({
      message: PickerMessage,
      model: Schema.Number,
      name: "Picker",
    });
    const Picker = PickerDef.make<Files>({
      init: () => -1,
      update: ($, message) =>
        message._tag === "Ask"
          ? $.run(
              pick((picked) =>
                PickerMessage.Chose({ count: picked.files.length })
              )
            )
          : message.count,
      view: (h, model) => (
        <div>
          <output id="count">{model}</output>
          <button id="ask" onclick={h.send(PickerMessage.Ask())}>
            ask
          </button>
        </div>
      ),
    });
    const realCreateElement = document.createElement.bind(document);
    const created: HTMLInputElement[] = [];
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
    try {
      const ui = render(() => <Picker props={{}} />);
      await ui.settled();
      await ui.click("#ask");
      const start = Date.now();
      while (created.length === 0) {
        if (Date.now() - start > 5000) {
          throw new Error("the picker never opened an input");
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- polls until the picker opens; each sleep must follow the previous length check.
        await Effect.runPromise(Effect.sleep("10 millis"));
      }
      const file = new File(["hi"], "notes.txt");
      Object.defineProperty(created[0], "files", {
        configurable: true,
        value: [file],
      });
      created[0].dispatchEvent(new Event("change", { bubbles: true }));
      const startDone = Date.now();
      while (ui.query("#count")?.textContent !== "1") {
        if (Date.now() - startDone > 5000) {
          throw new Error("the pick never resolved");
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- polls until the pick resolves; each sleep must follow the previous text check.
        await Effect.runPromise(Effect.sleep("10 millis"));
      }
      expect(ui.query("#count")?.textContent).toBe("1");
      ui.unmount();
    } finally {
      document.createElement = realCreateElement;
    }
  });
});
