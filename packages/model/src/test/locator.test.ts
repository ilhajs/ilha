import { describe, expect, it } from "bun:test";

import { h } from "ilha";

import * as Locator from "./locator.ts";

const row = (id: string): Locator.Node => ({
  attrs: { "data-testid": id },
  children: [{ children: [{ text: "Save" }], tag: "button" }],
  tag: "li",
});

const PropsChild = (_props: { label: string }) => {};

const tree: Locator.Node = {
  children: [row("row-1"), row("row-2")],
  tag: "ul",
};

describe("text", () => {
  it("finds the innermost elements containing the text", () => {
    const rows = tree.children ?? [];
    const firstButton = rows[0].children ?? [];
    const secondButton = rows[1].children ?? [];
    const found = Locator.all(tree, Locator.text("Save"));
    expect(found).toHaveLength(2);
    expect(found[0]).toBe(firstButton[0]);
    expect(found[1]).toBe(secondButton[0]);
  });

  it("matches exactly with { exact: true }", () => {
    const nested: Locator.Node = {
      children: [
        { children: [{ text: "Save" }], tag: "p" },
        { children: [{ text: "Save now" }], tag: "p" },
      ],
      tag: "div",
    };
    expect(
      Locator.all(nested, Locator.text("Save", { exact: true }))
    ).toHaveLength(1);
    expect(Locator.all(nested, Locator.text("Save"))).toHaveLength(2);
  });

  it("collapses to the innermost match when nested", () => {
    const nested: Locator.Node = {
      children: [{ children: [{ text: "hi" }], tag: "span" }],
      tag: "div",
    };
    const paras = nested.children ?? [];
    const found = Locator.all(nested, Locator.text("hi"));
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(paras[0]);
  });
});

describe("attr / testId / tag", () => {
  it("matches by attribute presence and value", () => {
    const rows = tree.children ?? [];
    expect(Locator.all(tree, Locator.attr("data-testid"))).toHaveLength(2);
    expect(Locator.get(tree, Locator.attr("data-testid", "row-1"))).toBe(
      rows[0]
    );
  });

  it("matches test ids", () => {
    const rows = tree.children ?? [];
    expect(Locator.get(tree, Locator.testId("row-2"))).toBe(rows[1]);
  });

  it("matches tags", () => {
    expect(Locator.all(tree, Locator.tag("button"))).toHaveLength(2);
    expect(Locator.all(tree, Locator.tag("ul"))).toHaveLength(1);
  });
});

describe("inside", () => {
  it("narrows a locator to a container subtree", () => {
    const rows = tree.children ?? [];
    const secondButton = rows[1].children ?? [];
    const button = Locator.get(
      tree,
      Locator.inside(Locator.testId("row-2"), Locator.text("Save"))
    );
    expect(button).toBe(secondButton[0]);
  });

  it("finds nothing outside the container", () => {
    expect(
      Locator.all(
        tree,
        Locator.inside(Locator.testId("row-1"), Locator.testId("row-2"))
      )
    ).toHaveLength(0);
  });
});

describe("all / query / get", () => {
  it("query returns undefined on no match and throws on several", () => {
    expect(Locator.query(tree, Locator.testId("missing"))).toBeUndefined();
    expect(() => Locator.query(tree, Locator.text("Save"))).toThrow(
      "2 elements match"
    );
  });

  it("get throws on none or several", () => {
    expect(() => Locator.get(tree, Locator.testId("missing"))).toThrow(
      "nothing matches"
    );
    expect(() => Locator.get(tree, Locator.tag("button"))).toThrow(
      "2 elements match"
    );
  });
});

describe("textOf / elements", () => {
  it("reads text through tagless wrappers", () => {
    expect(
      Locator.textOf({
        children: [{ text: "a" }, { children: [{ text: "b" }] }],
      })
    ).toBe("ab");
  });

  it("lists elements in document order, root included, seeing through tagless nodes", () => {
    const root: Locator.Node = {
      children: [{ children: [{ tag: "li" }] }],
      tag: "ul",
    };
    const found = Locator.elements(root);
    expect(found).toHaveLength(2);
    expect(found[0]).toBe(root);
  });
});

describe("fire", () => {
  it("sends the event to the node", () => {
    const seen: { event: string; payload: unknown }[] = [];
    const node: Locator.Firable = {
      fire: (event, payload) => {
        seen.push({ event, payload });
      },
      tag: "button",
    };
    Locator.fire(node, "click", { button: 0 });
    Locator.fire(node, "input");
    expect(seen).toEqual([
      { event: "click", payload: { button: 0 } },
      { event: "input", payload: {} },
    ]);
  });
});

describe("fromVNode", () => {
  it("expands intrinsic elements and text", () => {
    const node = Locator.fromVNode(
      h("form", null, h("button", { type: "submit" }, "Add"))
    );
    expect(node).toEqual({
      children: [
        {
          attrs: { type: "submit" },
          children: [{ text: "Add" }],
          tag: "button",
        },
      ],
      tag: "form",
    });
  });

  it("drops event handlers and nullish props, maps className/htmlFor", () => {
    // SAFETY: the harness passes ilha props h() types structurally, not literally.
    const node = Locator.fromVNode(
      h("input", {
        className: "field",
        disabled: false,
        hidden: true,
        htmlFor: "x",
        id: "new",
        oninput: () => {},
        value: "typed",
      } as never)
    );
    expect(node.tag).toBe("input");
    expect(node.attrs).toEqual({
      class: "field",
      for: "x",
      hidden: "true",
      id: "new",
    });
    expect(node.props).toEqual({ value: "typed" });
  });

  it("keeps checked in props so DomLocator.checked reads it", () => {
    // SAFETY: the harness passes ilha props h() types structurally, not literally.
    const node = Locator.fromVNode(
      h("input", { checked: true, type: "checkbox" } as never)
    );
    expect(node.props).toEqual({ checked: true });
  });

  it("represents fragments as tagless nodes", () => {
    const node = Locator.fromVNode(h("div", null, h("span", null, "a"), "b"));
    expect(node.children).toHaveLength(2);
    expect(Locator.textOf(node)).toBe("ab");
  });

  it("represents component vnodes as tagless nodes holding their props", () => {
    const node = Locator.fromVNode(
      h("div", null, h(PropsChild, { label: "x" }))
    );
    const [child] = node.children ?? [];
    expect(child?.tag).toBeUndefined();
    expect(child?.props).toEqual({ label: "x" });
  });

  it("adapts a full view to role queries", () => {
    const view = h(
      "form",
      null,
      h("label", { for: "new" }, "New todo"),
      h("input", { id: "new" }),
      h("button", { type: "submit" }, "Add")
    );
    const root = Locator.fromVNode(view);
    const addButton = (root.children ?? []).at(-1);
    if (addButton === undefined) {
      throw new Error("expected the form to render three children");
    }
    expect(Locator.get(root, Locator.tag("button"))).toBe(addButton);
    expect(Locator.get(root, Locator.text("Add"))).toBe(addButton);
  });
});
