import { describe, expect, it } from "bun:test";

import { h } from "ilha";

import * as DomLocator from "./dom-locator.ts";
import * as Locator from "./locator.ts";

const todoTree: Locator.Node = {
  children: [
    { attrs: { for: "new" }, children: [{ text: "New todo" }], tag: "label" },
    { attrs: { id: "new" }, tag: "input" },
    { attrs: { type: "submit" }, children: [{ text: "Add" }], tag: "button" },
  ],
  tag: "form",
};

describe("queryAllByRole / getByRole", () => {
  it("finds a button by name", () => {
    const fields = todoTree.children ?? [];
    expect(DomLocator.getByRole(todoTree, "button", { name: "Add" })).toBe(
      fields[2]
    );
    expect(
      DomLocator.nameOf(todoTree, DomLocator.getByRole(todoTree, "textbox"))
    ).toBe("New todo");
  });

  it("matches names by RegExp and reports roles on failure", () => {
    const fields = todoTree.children ?? [];
    expect(DomLocator.getByRole(todoTree, "button", { name: /ad/iu })).toBe(
      fields[2]
    );
    expect(() =>
      DomLocator.getByRole(todoTree, "button", { name: "Missing" })
    ).toThrow(/nothing has role "button", name "Missing"/u);
  });

  it("throws when several match", () => {
    const two: Locator.Node = {
      children: [{ tag: "button" }, { tag: "button" }],
      tag: "div",
    };
    expect(() => DomLocator.getByRole(two, "button")).toThrow(
      "2 elements have"
    );
  });

  it("maps input types to roles", () => {
    const tree: Locator.Node = {
      children: [
        { attrs: { type: "checkbox" }, tag: "input" },
        { attrs: { type: "radio" }, tag: "input" },
        { attrs: { type: "range" }, tag: "input" },
        { attrs: { type: "number" }, tag: "input" },
        { attrs: { type: "search" }, tag: "input" },
        { attrs: { list: "x", type: "search" }, tag: "input" },
        { attrs: { type: "hidden" }, tag: "input" },
        { tag: "select" },
        { attrs: { multiple: "" }, tag: "select" },
        { tag: "textarea" },
      ],
      tag: "div",
    };
    expect(DomLocator.queryAllByRole(tree, "checkbox")).toHaveLength(1);
    expect(DomLocator.queryAllByRole(tree, "radio")).toHaveLength(1);
    expect(DomLocator.queryAllByRole(tree, "slider")).toHaveLength(1);
    expect(DomLocator.queryAllByRole(tree, "spinbutton")).toHaveLength(1);
    expect(DomLocator.queryAllByRole(tree, "searchbox")).toHaveLength(1);
    expect(DomLocator.queryAllByRole(tree, "combobox")).toHaveLength(2);
    expect(DomLocator.queryAllByRole(tree, "listbox")).toHaveLength(1);
    expect(DomLocator.queryAllByRole(tree, "textbox")).toHaveLength(1);
    // The hidden input is excluded without `hidden: true`.
    expect(
      DomLocator.queryAllByRole(tree, "textbox", { hidden: true })
    ).toHaveLength(1);
  });

  it("applies the heading level, header/footer and table rules", () => {
    const tree: Locator.Node = {
      children: [
        { children: [{ text: "Title" }], tag: "h2" },
        { children: [{ text: "top" }], tag: "header" },
        {
          children: [{ children: [{ text: "in" }], tag: "header" }],
          tag: "article",
        },
        { attrs: { scope: "row" }, children: [{ text: "r" }], tag: "th" },
        { children: [{ text: "c" }], tag: "th" },
        { attrs: { alt: "" }, tag: "img" },
        { attrs: { alt: "photo" }, tag: "img" },
        { tag: "a" },
        { attrs: { href: "/x" }, children: [{ text: "go" }], tag: "a" },
      ],
      tag: "div",
    };
    expect(
      DomLocator.queryAllByRole(tree, "heading", { level: 2 })
    ).toHaveLength(1);
    expect(DomLocator.queryAllByRole(tree, "banner")).toHaveLength(1);
    expect(DomLocator.queryAllByRole(tree, "rowheader")).toHaveLength(1);
    expect(DomLocator.queryAllByRole(tree, "columnheader")).toHaveLength(1);
    expect(
      DomLocator.queryAllByRole(tree, "presentation", { hidden: true })
    ).toHaveLength(1);
    expect(DomLocator.queryAllByRole(tree, "img")).toHaveLength(1);
    expect(DomLocator.queryAllByRole(tree, "link")).toHaveLength(1);
  });

  it("matches checked state and explicit roles", () => {
    const tree: Locator.Node = {
      children: [
        { attrs: { type: "checkbox" }, props: { checked: true }, tag: "input" },
        { attrs: { type: "checkbox" }, tag: "input" },
        { attrs: { role: "button" }, children: [{ text: "Go" }], tag: "span" },
      ],
      tag: "div",
    };
    const boxes = tree.children ?? [];
    expect(
      DomLocator.queryAllByRole(tree, "checkbox", { checked: true })
    ).toHaveLength(1);
    expect(
      DomLocator.queryAllByRole(tree, "checkbox", { checked: false })
    ).toHaveLength(1);
    expect(DomLocator.getByRole(tree, "button", { name: "Go" })).toBe(boxes[2]);
  });

  it("excludes hidden subtrees unless hidden: true", () => {
    const tree: Locator.Node = {
      children: [
        {
          attrs: { hidden: "" },
          children: [{ children: [{ text: "H" }], tag: "button" }],
          tag: "div",
        },
        {
          attrs: { "aria-hidden": "true" },
          children: [{ children: [{ text: "A" }], tag: "button" }],
          tag: "div",
        },
        {
          children: [{ children: [{ text: "T" }], tag: "button" }],
          tag: "template",
        },
        {
          children: [{ children: [{ text: "D" }], tag: "button" }],
          tag: "dialog",
        },
        { children: [{ text: "V" }], tag: "button" },
      ],
      tag: "div",
    };
    expect(
      DomLocator.queryAllByRole(tree, "button").map((b) => Locator.textOf(b))
    ).toEqual(["V"]);
    expect(
      DomLocator.queryAllByRole(tree, "button", { hidden: true })
    ).toHaveLength(5);
  });
});

describe("accessible names", () => {
  it("orders aria-labelledby, aria-label, labels, content, title, placeholder", () => {
    const tree: Locator.Node = {
      children: [
        { attrs: { id: "a" }, children: [{ text: "By" }], tag: "span" },
        {
          attrs: {
            "aria-label": "L",
            "aria-labelledby": "a",
            id: "f",
            placeholder: "P",
            title: "T",
          },
          tag: "input",
        },
      ],
      tag: "div",
    };
    const fields = tree.children ?? [];
    expect(DomLocator.nameOf(tree, fields[1])).toBe("By");

    const labelled: Locator.Node = {
      children: [
        {
          attrs: { "aria-label": "L", placeholder: "P", title: "T" },
          tag: "input",
        },
      ],
      tag: "div",
    };
    const labelledFields = labelled.children ?? [];
    expect(DomLocator.nameOf(labelled, labelledFields[0])).toBe("L");
  });

  it("names button inputs by value, defaulting submit/reset", () => {
    const tree: Locator.Node = {
      children: [
        { attrs: { type: "submit" }, tag: "input" },
        { attrs: { type: "reset" }, tag: "input" },
        { attrs: { alt: "Snap", type: "image" }, tag: "input" },
        { attrs: { title: "T", type: "text" }, tag: "input" },
        { attrs: { placeholder: "P", type: "text" }, tag: "input" },
      ],
      tag: "div",
    };
    const fields = tree.children ?? [];
    const names = fields.map((c) => DomLocator.nameOf(tree, c));
    expect(names).toEqual(["Submit", "Reset", "Snap", "T", "P"]);
  });

  it("names fieldset, table, figure and content roles", () => {
    const tree: Locator.Node = {
      children: [
        {
          children: [
            { children: [{ text: "Group" }], tag: "legend" },
            { tag: "input" },
          ],
          tag: "fieldset",
        },
        { children: [{ text: "Title" }], tag: "h1" },
      ],
      tag: "div",
    };
    const sections = tree.children ?? [];
    expect(DomLocator.nameOf(tree, sections[0])).toBe("Group");
    expect(DomLocator.nameOf(tree, sections[1])).toBe("Title");
    expect(DomLocator.roleOf(tree, sections[1])).toBe("heading");
  });

  it("roleOf returns undefined for plain elements", () => {
    const plain: Locator.Node = { tag: "div" };
    expect(DomLocator.roleOf(todoTree, todoTree)).toBe("form");
    expect(DomLocator.roleOf(todoTree, plain)).toBeUndefined();
  });
});

describe("role / label / placeholder locators", () => {
  it("role() composes with Locator.inside", () => {
    const fields = todoTree.children ?? [];
    const found = Locator.get(
      todoTree,
      Locator.inside(
        Locator.tag("form"),
        DomLocator.role("button", { name: "Add" })
      )
    );
    expect(found).toBe(fields[2]);
  });

  it("label() finds fields by for, wrapping, aria-label and aria-labelledby", () => {
    const tree: Locator.Node = {
      children: [
        {
          attrs: { for: "zip" },
          children: [{ text: "Zip code" }],
          tag: "label",
        },
        { attrs: { id: "zip" }, tag: "input" },
        {
          children: [{ text: "Wrap " }, { attrs: { id: "w" }, tag: "input" }],
          tag: "label",
        },
        { attrs: { "aria-label": "Code", id: "a" }, tag: "input" },
      ],
      tag: "form",
    };
    const fields = tree.children ?? [];
    const wrapped = fields[2].children ?? [];
    expect(Locator.get(tree, DomLocator.label("Zip code"))).toBe(fields[1]);
    expect(Locator.get(tree, DomLocator.label("Wrap"))).toBe(wrapped[1]);
    expect(Locator.get(tree, DomLocator.label("Code"))).toBe(fields[3]);
    expect(
      Locator.all(tree, DomLocator.label("zip", { exact: false }))
    ).toHaveLength(0);
  });

  it("placeholder() matches by placeholder text", () => {
    const tree: Locator.Node = {
      children: [{ attrs: { placeholder: "Search" }, tag: "input" }],
      tag: "div",
    };
    const fields = tree.children ?? [];
    expect(Locator.get(tree, DomLocator.placeholder("Search"))).toBe(fields[0]);
  });
});

describe("state getters", () => {
  it("dialogState reads closed, open and modal", () => {
    expect(DomLocator.dialogState({ tag: "dialog" })).toBe("closed");
    expect(DomLocator.dialogState({ attrs: { open: "" }, tag: "dialog" })).toBe(
      "open"
    );
    expect(
      DomLocator.dialogState({ props: { open: "modal" }, tag: "dialog" })
    ).toBe("modal");
  });

  it("value prefers props over attributes", () => {
    expect(DomLocator.value({ attrs: { value: "a" }, tag: "input" })).toBe("a");
    expect(
      DomLocator.value({
        attrs: { value: "a" },
        props: { value: "b" },
        tag: "input",
      })
    ).toBe("b");
    expect(DomLocator.value({ tag: "input" })).toBeUndefined();
  });

  it("checked reads aria-checked, then prop, then attribute", () => {
    expect(
      DomLocator.checked({
        attrs: { "aria-checked": "true", type: "checkbox" },
        tag: "input",
      })
    ).toBe(true);
    expect(
      DomLocator.checked({ props: { checked: false }, tag: "input" })
    ).toBe(false);
    expect(DomLocator.checked({ attrs: { checked: "" }, tag: "input" })).toBe(
      true
    );
    expect(DomLocator.checked({ tag: "input" })).toBe(false);
    expect(DomLocator.checked({ tag: "div" })).toBeUndefined();
  });

  it("popoverState reads the popoverOpen prop", () => {
    expect(
      DomLocator.popoverState({ attrs: { popover: "" }, tag: "div" })
    ).toBe("closed");
    expect(
      DomLocator.popoverState({
        attrs: { popover: "" },
        props: { popoverOpen: true },
        tag: "div",
      })
    ).toBe("open");
  });
});

describe("fromVNode integration", () => {
  it("runs role queries over an Ilha view", () => {
    const view = h(
      "form",
      null,
      h("label", { for: "new" }, "New todo"),
      h("input", { id: "new" }),
      h("button", { type: "submit" }, "Add")
    );
    const root = Locator.fromVNode(view);
    const rootChildren = root.children ?? [];
    expect(DomLocator.getByRole(root, "button", { name: "Add" })).toBe(
      rootChildren[2]
    );
    expect(DomLocator.nameOf(root, DomLocator.getByRole(root, "textbox"))).toBe(
      "New todo"
    );
  });
});

describe("DOM actions", () => {
  it("click dispatches a click", () => {
    const button = document.createElement("button");
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks += 1;
    });
    document.body.append(button);
    try {
      DomLocator.click(button);
      expect(clicks).toBe(1);
    } finally {
      button.remove();
    }
  });

  it("type sets the value and fires input then change", () => {
    const input = document.createElement("input");
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));
    document.body.append(input);
    try {
      DomLocator.type(input, "hello");
      expect(input.value).toBe("hello");
      expect(events).toEqual(["input", "change"]);
    } finally {
      input.remove();
    }
  });

  it("keydown fires keydown then keyup with modifiers", () => {
    const input = document.createElement("input");
    const seen: { type: string; key: string; shift: boolean }[] = [];
    const record = (event: Event) => {
      // SAFETY: keydown/keyup listeners receive KeyboardEvents; the test dispatches real key events below.
      const keyboard = event as KeyboardEvent;
      seen.push({
        key: keyboard.key,
        shift: keyboard.shiftKey,
        type: event.type,
      });
    };
    input.addEventListener("keydown", record);
    input.addEventListener("keyup", record);
    document.body.append(input);
    try {
      DomLocator.keydown(input, "Enter", { shift: true });
      expect(seen).toEqual([
        { key: "Enter", shift: true, type: "keydown" },
        { key: "Enter", shift: true, type: "keyup" },
      ]);
    } finally {
      input.remove();
    }
  });

  it("submit submits the owning form", () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    form.append(input);
    let submitted = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted += 1;
    });
    document.body.append(form);
    try {
      DomLocator.submit(input);
      expect(submitted).toBe(1);
    } finally {
      form.remove();
    }
  });

  it("submit throws outside a form", () => {
    const div = document.createElement("div");
    expect(() => DomLocator.submit(div)).toThrow("isn't in a form");
  });

  it("role queries run over the real DOM", () => {
    const form = document.createElement("form");
    form.innerHTML = `<label for="n">Name</label><input id="n"><button>Add</button>`;
    document.body.append(form);
    try {
      const button = DomLocator.getByRole(form, "button", { name: "Add" });
      expect(button.localName).toBe("button");
      expect(
        DomLocator.nameOf(form, DomLocator.getByRole(form, "textbox"))
      ).toBe("Name");
      expect(DomLocator.roleOf(form, button)).toBe("button");
    } finally {
      form.remove();
    }
  });
});
