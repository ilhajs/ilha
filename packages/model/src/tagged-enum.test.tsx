/**
 * `TaggedEnum`: unchecked constructors, `is`, `match` and decoding as a
 * tagged union. Ported from Effect UI's `UiSchema.test.ts` (`TaggedEnum`
 * block): parts, slots and queries play no role here.
 */
import { describe, expect, it } from "bun:test";

import * as Schema from "effect/Schema";

import { TaggedEnum } from "./tagged-enum.ts";

const Figure = TaggedEnum({
  Circle: { radius: Schema.Number },
  Empty: {},
  Rect: { height: Schema.Number, width: Schema.Number },
});

describe("TaggedEnum", () => {
  it("constructors only add _tag", () => {
    expect(Figure.Circle({ radius: -1 })).toEqual({
      _tag: "Circle",
      radius: -1,
    });
    expect(Figure.Empty()).toEqual({ _tag: "Empty" });
  });

  it("is checks only _tag", () => {
    expect(Figure.is("Circle")({ _tag: "Circle" })).toBe(true);
    expect(Figure.is("Circle")(Figure.Empty())).toBe(false);
    expect(Figure.is("Circle")(null)).toBe(false);
  });

  it("match supports data-first and data-last", () => {
    const cases = {
      Circle: () => "circle",
      Empty: () => "empty",
      Rect: () => "rect",
    };
    expect(Figure.match(Figure.Rect({ height: 2, width: 1 }), cases)).toBe(
      "rect"
    );
    expect(Figure.match(Figure.Empty(), cases)).toBe("empty");
  });

  it("decodes as a tagged union", () => {
    expect(
      Schema.decodeUnknownSync(Figure)({ _tag: "Rect", height: 2, width: 1 })
    ).toEqual(Figure.Rect({ height: 2, width: 1 }));
    expect(() =>
      Schema.decodeUnknownSync(Figure)({ _tag: "Rect", height: 2, width: "x" })
    ).toThrow();
  });

  it("throws when a case declares its own _tag", () => {
    // SAFETY: deliberately passes a case declaring its own _tag to assert the constructor throws.
    expect(() =>
      TaggedEnum({ A: { _tag: Schema.Literal("B") } } as never)
    ).toThrow("Case A can't declare _tag");
  });

  it("numeric keys become string tags", () => {
    const Code = TaggedEnum({ 404: {}, Ok: {} });
    expect(Code[404]()).toEqual({ _tag: "404" });
    expect(
      Code.is("404")(Schema.decodeUnknownSync(Code)({ _tag: "404" }))
    ).toBe(true);
  });
});
