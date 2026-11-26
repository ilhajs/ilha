/**
 * Unit tests for `DomCommand`: each factory resolves its ref through
 * `Refs` after the issuing update's commit and reports what the browser
 * did. The bodies run here against a hand-made `Refs`; the kernel path
 * (real elements, `h.ref`, commit timing) is covered by the runtime tests.
 */
import { describe, expect, it } from "bun:test";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Command from "./command.ts";
import {
  Blur,
  Focus,
  Measure,
  RequestSubmit,
  ScrollIntoView,
  Select,
  ShowPicker,
} from "./dom-command.ts";
import type { Opened } from "./dom-command.ts";
import * as Dom from "./dom.ts";

/** A `Refs` that resolves exactly the refs in `nodes`. */
const refsLayer = (nodes: ReadonlyMap<string, Element>): Layer.Layer<never> =>
  Layer.succeed(Dom.Refs, {
    lookup: <Node extends Element>(ref: Dom.Ref<Node>) =>
      // SAFETY: the test Refs resolves only Elements stored under the requested keys; Node narrows to the command's element type.
      Effect.succeed(
        Option.fromNullishOr(nodes.get(ref.key) as Node | undefined)
      ),
  } satisfies Dom.Refs);

const runBody = <A>(
  issued: Command.Command<A, Dom.Refs>,
  nodes: ReadonlyMap<string, Element>
): Promise<A> => {
  if (issued._tag === "Interrupt" || issued.effect === undefined) {
    throw new Error("not an effect command");
  }
  // SAFETY: guarded above — a non-Interrupt command reaching here carries a defined Effect.
  return Effect.runPromise(
    Effect.provide(issued.effect as Effect.Effect<A>, refsLayer(nodes))
  );
};

describe("DomCommand", () => {
  it("focuses and blurs the resolved element", async () => {
    const input = document.createElement("input");
    document.body.append(input);
    try {
      const nodes = new Map([["field", input]]);
      expect(await runBody(Focus({ ref: Dom.ref("field") }), nodes)).toEqual({
        found: true,
      });
      expect(document.activeElement).toBe(input);
      expect(await runBody(Blur({ ref: Dom.ref("field") }), nodes)).toEqual({
        found: true,
      });
      expect(await runBody(Focus({ ref: Dom.ref("missing") }), nodes)).toEqual({
        found: false,
      });
    } finally {
      input.remove();
    }
  });

  it("measures the resolved element, or nothing when it isn't rendered", async () => {
    const div = document.createElement("div");
    document.body.append(div);
    try {
      const nodes = new Map([["box", div]]);
      const rect = await runBody(Measure({ ref: Dom.ref("box") }), nodes);
      expect(Option.isSome(rect)).toBe(true);
      const missing = await runBody(
        Measure({ ref: Dom.ref("missing") }),
        nodes
      );
      expect(Option.isNone(missing)).toBe(true);
    } finally {
      div.remove();
    }
  });

  it("selects, scrolls, submits and opens pickers", async () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello";
    form.append(input);
    document.body.append(form);
    let submitted = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted = true;
    });
    try {
      const nodes = new Map<string, Element>([
        ["field", input],
        ["form", form],
      ]);
      const field = Dom.ref("field");
      expect(await runBody(Select({ ref: field }), nodes)).toEqual({
        found: true,
      });
      expect(await runBody(ScrollIntoView({ ref: field }), nodes)).toEqual({
        found: true,
      });
      const result = await runBody(RequestSubmit({ ref: field }), nodes);
      expect(result).toEqual({
        found: true,
        submitted: true,
      } satisfies typeof result);
      expect(submitted).toBe(true);
      const opened = await runBody(
        ShowPicker({ ref: Dom.ref("field") }),
        nodes
      );
      expect(opened satisfies Opened).toEqual({ found: true, opened: true });
      expect(
        await runBody(RequestSubmit({ ref: Dom.ref("orphan") }), new Map())
      ).toEqual({
        found: false,
        submitted: false,
      });
    } finally {
      form.remove();
    }
  });

  it("encodes ref args by key for the log", () => {
    const issued = Focus({ ref: Dom.ref("rows").at(3) });
    expect(issued.args).toEqual({
      ref: expect.objectContaining({ key: "rows[3]" }),
    });
  });
});
