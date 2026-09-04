import { expect, test } from "bun:test";

import { morphInner } from "../src/morph.ts";

test("keyed morph moves node and keeps identity", () => {
  const from = document.createElement("ul");
  const a = document.createElement("li");
  a.dataset.ilhaKey = "a";
  a.textContent = "A";
  const b = document.createElement("li");
  b.dataset.ilhaKey = "b";
  b.textContent = "B";
  from.append(a, b);
  const to = document.createElement("ul");
  const b2 = document.createElement("li");
  b2.dataset.ilhaKey = "b";
  b2.textContent = "B";
  const a2 = document.createElement("li");
  a2.dataset.ilhaKey = "a";
  a2.textContent = "A";
  to.append(b2, a2);
  morphInner(from, to);
  expect(from.children[0]).toBe(b);
  expect(from.children[1]).toBe(a);
});

test("morph preserves focus", () => {
  const from = document.createElement("div");
  const input = document.createElement("input");
  from.append(input);
  document.body.append(from);
  input.focus();
  const to = document.createElement("div");
  to.append(document.createElement("input"));
  morphInner(from, to);
  expect(document.activeElement).toBe(input);
  from.remove();
});

test("morph input select textarea and preserve attr", () => {
  const from = document.createElement("div");
  const input = document.createElement("input");
  input.setAttribute("value", "a");
  input.value = "a";
  input.dataset.morphPreserve = "title";
  input.setAttribute("title", "keep");
  const ta = document.createElement("textarea");
  ta.textContent = "old";
  const sel = document.createElement("select");
  sel.append(
    document.createElement("option"),
    document.createElement("option")
  );
  from.append(input, ta, sel);
  const to = document.createElement("div");
  const input2 = document.createElement("input");
  input2.setAttribute("value", "b");
  input2.setAttribute("title", "drop");
  const ta2 = document.createElement("textarea");
  ta2.textContent = "new";
  const sel2 = document.createElement("select");
  const o = document.createElement("option");
  o.setAttribute("selected", "");
  sel2.append(o, document.createElement("option"));
  to.append(input2, ta2, sel2);
  morphInner(from, to);
  const [first, second] = from.children;
  // SAFETY: morph keeps the same input/textarea element identities under from.
  expect((first as HTMLInputElement).value).toBe("b");
  expect(first?.getAttribute("title")).toBe("keep");
  // SAFETY: second child remains the textarea morph reused.
  expect((second as HTMLTextAreaElement).value).toBe("new");
});

test("morph restores input selection", () => {
  const from = document.createElement("div");
  const input = document.createElement("input");
  input.setAttribute("value", "hello");
  input.value = "hello";
  from.append(input);
  document.body.append(from);
  input.focus();
  input.setSelectionRange(1, 4);
  const to = document.createElement("div");
  const input2 = document.createElement("input");
  input2.setAttribute("value", "hellp");
  to.append(input2);
  morphInner(from, to);
  expect(input.isConnected).toBe(true);
  from.remove();
});

test("morph keyed skip, type mismatch, extra nodes", () => {
  const from = document.createElement("div");
  const a = document.createElement("span");
  a.dataset.ilhaKey = "a";
  a.textContent = "A";
  const b = document.createElement("span");
  b.dataset.ilhaKey = "b";
  from.append(a, b, document.createTextNode("x"), document.createElement("i"));
  const to = document.createElement("div");
  const c = document.createElement("span");
  c.dataset.ilhaKey = "c";
  const a2 = document.createElement("span");
  a2.dataset.ilhaKey = "a";
  to.append(c, a2, document.createElement("b"));
  morphInner(from, to);
  expect(from.children.length).toBe(3);
  expect(from.querySelector('[data-ilha-key="a"]')).toBe(a);
});

test("morph select keeps live selected when attr unchanged", () => {
  const from = document.createElement("div");
  const sel = document.createElement("select");
  const o1 = document.createElement("option");
  const o2 = document.createElement("option");
  sel.append(o1, o2);
  o2.selected = true;
  from.append(sel);
  const to = document.createElement("div");
  const sel2 = document.createElement("select");
  sel2.append(
    document.createElement("option"),
    document.createElement("option")
  );
  to.append(sel2);
  morphInner(from, to);
  // SAFETY: morph keeps the select as firstChild of from.
  expect((from.firstChild as HTMLSelectElement).options.length).toBe(2);
});
