// =============================================================================
// each() — Svelte-style {#each} iteration (ported from quando)
// =============================================================================

import { describe, expect, it } from "bun:test";

import { each, ilha, html } from "./index";

describe("each()", () => {
  it("returns a builder with as", () => {
    const builder = each([1]);
    expect(typeof builder.as).toBe("function");
  });

  it(".as() returns a mapped array with optional else", () => {
    const result = each([1]).as((n) => n);
    expect(Array.isArray(result)).toBe(true);
    expect([...result]).toEqual([1]);
    expect(typeof result.else).toBe("function");
  });
});

describe("each() .as()", () => {
  it("maps each item", () => {
    expect([...each([1, 2, 3]).as((n) => n * 2)]).toEqual([2, 4, 6]);
  });

  it("passes index to the map function", () => {
    expect([...each(["a", "b", "c"]).as((_, i) => i)]).toEqual([0, 1, 2]);
  });

  it("returns an empty array when the collection is empty", () => {
    expect([...each([] as number[]).as((n) => n * 2)]).toEqual([]);
  });

  it("does not call the map function when the collection is empty", () => {
    let called = false;
    each([] as number[]).as(() => {
      called = true;
      return 0;
    });
    expect(called).toBe(false);
  });
});

describe("each() .as() .else()", () => {
  it("maps each item when the collection is non-empty", () => {
    expect(
      each([1, 2, 3])
        .as((n) => `item-${n}`)
        .else(() => "empty"),
    ).toEqual(["item-1", "item-2", "item-3"]);
  });

  it("returns the else branch when the collection is empty", () => {
    expect(
      each([] as number[])
        .as((n) => `item-${n}`)
        .else(() => "empty"),
    ).toEqual(["empty"]);
  });

  it("accepts a static else value", () => {
    expect(
      each([] as number[])
        .as((n) => `item-${n}`)
        .else("empty"),
    ).toEqual(["empty"]);
  });

  it("returns mapped items when collection is non-empty (static else)", () => {
    expect(
      each([1, 2])
        .as((n) => n * 2)
        .else("empty"),
    ).toEqual([2, 4]);
  });

  it("passes the empty collection to the else callback", () => {
    const received: number[][] = [];
    each([] as number[])
      .as((n) => n)
      .else((items) => {
        received.push([...items]);
        return "fallback";
      });
    expect(received).toEqual([[]]);
  });

  it("is lazy — else is not called when items exist", () => {
    let elseCalled = false;
    each([1])
      .as((n) => n)
      .else(() => {
        elseCalled = true;
        return "empty";
      });
    expect(elseCalled).toBe(false);
  });

  it("is lazy — map is not called when the collection is empty", () => {
    let mapCalled = false;
    each([] as number[])
      .as(() => {
        mapCalled = true;
        return 0;
      })
      .else(() => "empty");
    expect(mapCalled).toBe(false);
  });

  it("else may return a different type than mapped items", () => {
    const result = each([] as number[])
      .as((n) => n)
      .else(() => ({ kind: "empty" as const }));
    expect(result as unknown).toEqual([{ kind: "empty" }]);
  });

  it("works with object return types from map", () => {
    const result = each([1, 2])
      .as((n) => ({ id: n }))
      .else(() => null);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("keeps null and false else values unwrapped", () => {
    expect(
      each([] as number[])
        .as((n) => n)
        .else(() => null),
    ).toBe(null);
    expect(
      each([] as number[])
        .as((n) => n)
        .else(false),
    ).toBe(false);
  });

  it("wraps static renderable else values in an array", () => {
    const emptyNode = { value: "<p>No todos.</p>" };
    expect(
      each([] as number[])
        .as((n) => n)
        .else(emptyNode) as unknown,
    ).toEqual([emptyNode]);
  });

  it("throws when given a function instead of an array", () => {
    expect(() => each((() => []) as unknown as number[])).toThrow(
      /expected an array but received a function/,
    );
  });
});

describe("each() .key()", () => {
  it("returns a keyed builder with as", () => {
    const keyed = each([1]).key((n) => n);
    expect(typeof keyed.as).toBe("function");
  });

  it("passes the key as the third argument to as", () => {
    const keys: number[] = [];
    each([10, 20])
      .key((n) => n)
      .as((item, index, key) => {
        keys.push(key);
        return `${item}@${index}`;
      });
    expect(keys).toEqual([10, 20]);
  });

  it("works with else for empty collections", () => {
    expect(
      each([] as { id: string }[])
        .key((item) => item.id)
        .as((item, _i, id) => `row:${id}:${item.id}`)
        .else(() => "empty"),
    ).toEqual(["empty"]);
  });

  it("does not call key or map when the collection is empty", () => {
    let keyCalled = false;
    let mapCalled = false;
    each([] as number[])
      .key(() => {
        keyCalled = true;
        return 0;
      })
      .as(() => {
        mapCalled = true;
        return 0;
      })
      .else(() => "empty");
    expect(keyCalled).toBe(false);
    expect(mapCalled).toBe(false);
  });

  it("feeds island.key() slot composition", () => {
    type Item = { id: string; label: string };
    const items: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    const Row = ilha(({ item }: { item: Item }) => html`<li>${item.label}</li>`);

    const out = Row.toString === undefined ? "" : "";
    void out;
    const calls = each(items)
      .key((item) => item.id)
      .as((item, _i, id) => Row.key(id)({ item }));
    expect(calls.map((call) => call.key)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Rendering through html`` — end-to-end with morph-friendly keyed slots
// ---------------------------------------------------------------------------

describe("each() rendering", () => {
  it("renders mapped items into html`` output", () => {
    const List = ilha(
      ({ items }: { items: string[] }) =>
        html`<ul>
          ${each(items).as((item) => html`<li>${item}</li>`)}
        </ul>`,
    );
    expect(List.toString({ items: ["a", "b"] })).toMatch(/<li>a<\/li><li>b<\/li>/);
  });

  it("renders the else fallback for an empty list", () => {
    const List = ilha(
      ({ items }: { items: string[] }) =>
        html`<ul>
          ${each(items)
            .as((item) => html`<li>${item}</li>`)
            .else(html`<li data-empty>none</li>`)}
        </ul>`,
    );
    expect(List.toString({ items: [] })).toContain("data-empty>none");
  });
});
