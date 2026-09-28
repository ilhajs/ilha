import { KEY_ATTR, SLOT_ATTR } from "./shared.ts";

export { KEY_ATTR, SLOT_ATTR } from "./shared.ts";

const PRESERVE_ATTR = "data-morph-preserve";

const morphKeyOf = (el: Element): string | null => {
  const k = el.getAttribute(KEY_ATTR);
  if (k !== null) {
    return `k:${k}`;
  }
  const s = el.getAttribute(SLOT_ATTR);
  return s === null ? null : `s:${s}`;
};

const shouldPreserveMorphAttr = (el: Element, name: string): boolean => {
  if (name === "value" || name === "checked" || name === "selected") {
    return true;
  }
  if (name === PRESERVE_ATTR) {
    return el.hasAttribute(PRESERVE_ATTR);
  }
  const custom = el.getAttribute(PRESERVE_ATTR);
  if (custom !== null) {
    for (const token of custom.split(/\s+/u)) {
      if (token === name) {
        return true;
      }
    }
  }
  return false;
};

const syncAttributes = (from: Element, to: Element): void => {
  for (const { name, value } of to.attributes) {
    if (shouldPreserveMorphAttr(from, name)) {
      continue;
    }
    if (from.getAttribute(name) !== value) {
      from.setAttribute(name, value);
    }
  }
  // Snapshot names first — NamedNodeMap is live under removeAttribute.
  const names: string[] = [];
  for (const { name } of from.attributes) {
    names.push(name);
  }
  for (const name of names) {
    if (name === "open" && !to.hasAttribute("open")) {
      // A user-opened <details> or <dialog> stays open across rerenders
      // unless the new render explicitly sets `open`. Attribute sync above
      // still applies an explicit `open` from the render.
      continue;
    }
    if (shouldPreserveMorphAttr(from, name)) {
      continue;
    }
    if (!to.hasAttribute(name)) {
      from.removeAttribute(name);
    }
  }
};

interface MorphFocusSnapshot {
  active: HTMLElement;
  selection: {
    start: number | null;
    end: number | null;
    dir: string | null;
  } | null;
}

const snapshotFocus = (): MorphFocusSnapshot | null => {
  if (globalThis.document === undefined) {
    return null;
  }
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) {
    return null;
  }
  let selection: MorphFocusSnapshot["selection"] = null;
  try {
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
    ) {
      selection = {
        dir: active.selectionDirection,
        end: active.selectionEnd,
        start: active.selectionStart,
      };
    }
  } catch {
    /* type=email */
  }
  return { active, selection };
};

const restoreFocus = (snapshot: MorphFocusSnapshot | null): void => {
  if (!snapshot || !snapshot.active.isConnected) {
    return;
  }
  try {
    if (document.activeElement !== snapshot.active) {
      snapshot.active.focus({ preventScroll: true });
    }
    const sel = snapshot.selection;
    if (sel && sel.start !== null) {
      // SAFETY: selection is only recorded for input/textarea elements.
      const el = snapshot.active as HTMLInputElement;
      if (el.selectionStart !== sel.start || el.selectionEnd !== sel.end) {
        // SAFETY: selectionDirection is forward|backward|none when present.
        el.setSelectionRange(
          sel.start,
          sel.end,
          (sel.dir as "forward" | "backward" | "none") ?? "none"
        );
      }
    }
  } catch {
    /* best-effort */
  }
};

const buildKeyedIndex = (parent: Element): Map<string, Element> | null => {
  let fromKeyed: Map<string, Element> | null = null;
  for (const child of parent.children) {
    const k = morphKeyOf(child);
    if (k !== null) {
      fromKeyed ??= new Map();
      if (!fromKeyed.has(k)) {
        fromKeyed.set(k, child);
      }
    }
  }
  return fromKeyed;
};

const collectKeys = (parent: Element): Set<string> => {
  const keys = new Set<string>();
  for (const child of parent.children) {
    const k = morphKeyOf(child);
    if (k !== null) {
      keys.add(k);
    }
  }
  return keys;
};

const morphInput = (fromEl: Element, toEl: Element): void => {
  syncAttributes(fromEl, toEl);
  // SAFETY: localName === input on both sides after the pair check above.
  const from = fromEl as HTMLInputElement;
  // SAFETY: same pair check covers the render-side node.
  const to = toEl as HTMLInputElement;
  // Live props beat attributes: a fresh materialization sets the value the
  // render asked for, while the live node may hold user edits. Attribute
  // presence marks controlled renders — uncontrolled inputs keep user edits.
  // Equal values skip the write so a focused input keeps its caret.
  const toChecked = toEl.hasAttribute("checked");
  if (toChecked !== fromEl.hasAttribute("checked")) {
    if (toChecked) {
      fromEl.setAttribute("checked", "");
    } else {
      fromEl.removeAttribute("checked");
    }
  }
  if (toChecked && from.checked !== to.checked) {
    from.checked = to.checked;
  }
  const toValue = toEl.getAttribute("value");
  if (toValue !== fromEl.getAttribute("value")) {
    if (toValue === null) {
      fromEl.removeAttribute("value");
    } else {
      fromEl.setAttribute("value", toValue);
    }
  }
  if (toValue !== null && from.value !== to.value) {
    from.value = to.value;
  }
};

const morphTextarea = (fromEl: Element, toEl: Element): void => {
  syncAttributes(fromEl, toEl);
  // SAFETY: localName === textarea on both sides.
  const from = fromEl as HTMLTextAreaElement;
  // SAFETY: same pair check covers the render-side node.
  const to = toEl as HTMLTextAreaElement;
  // Children are the controlled signal: no children anywhere means an
  // uncontrolled box whose live value (user edits) must survive.
  if (to.textContent !== "" || from.textContent !== to.textContent) {
    if (from.value !== to.value) {
      from.value = to.value;
    }
    if (from.textContent !== to.textContent) {
      from.textContent = to.textContent;
    }
  }
};

interface MorphApi {
  morphChildren: (fromParent: Element, toParent: Element) => void;
}

const morphSelect = (fromEl: Element, toEl: Element, api: MorphApi): void => {
  const before = new Map<HTMLOptionElement, { attr: boolean; live: boolean }>();
  // SAFETY: localName === select.
  const fromSelect = fromEl as HTMLSelectElement;
  for (const o of fromSelect.options) {
    before.set(o, { attr: o.hasAttribute("selected"), live: o.selected });
  }
  syncAttributes(fromEl, toEl);
  api.morphChildren(fromEl, toEl);
  const options = [...fromSelect.options];
  if (
    options.some(
      (o) => o.hasAttribute("selected") !== (before.get(o)?.attr ?? false)
    )
  ) {
    for (const o of options) {
      o.selected = o.hasAttribute("selected");
    }
  } else {
    for (const o of options) {
      const prev = before.get(o);
      if (prev && o.selected !== prev.live) {
        o.selected = prev.live;
      }
    }
  }
};

const morphElementPair = (
  fromEl: Element,
  toEl: Element,
  api: MorphApi
): void => {
  if (fromEl.localName !== toEl.localName) {
    fromEl.replaceWith(toEl);
    return;
  }
  const toSlot = toEl.getAttribute(SLOT_ATTR);
  const fromSlot = fromEl.getAttribute(SLOT_ATTR);
  if (toSlot !== null && fromSlot === toSlot) {
    // Same hole host — keep the live node (atom reuse / keepOnMorph).
    return;
  }
  if (toSlot !== null) {
    // New hole fiber roots point at `toEl`; install it in the document.
    fromEl.replaceWith(toEl);
    return;
  }
  if (fromEl.localName === "input") {
    morphInput(fromEl, toEl);
    return;
  }
  if (fromEl.localName === "select") {
    morphSelect(fromEl, toEl, api);
    return;
  }
  syncAttributes(fromEl, toEl);
  if (fromEl.localName === "textarea") {
    morphTextarea(fromEl, toEl);
  } else {
    api.morphChildren(fromEl, toEl);
  }
};

const alignKeyedNode = (
  fromParent: Element,
  fromNode: ChildNode | undefined,
  toNode: ChildNode,
  fromKeyed: Map<string, Element>,
  toKeys: Set<string>
): ChildNode | undefined | "continue" => {
  // SAFETY: nodeType 1 is Element; morphKeyOf only reads element attributes.
  const toKey = toNode.nodeType === 1 ? morphKeyOf(toNode as Element) : null;
  let current = fromNode;
  if (toKey !== null) {
    const match = fromKeyed.get(toKey);
    if (match) {
      fromKeyed.delete(toKey);
      if (match !== current) {
        current?.before(match);
        if (!current) {
          fromParent.append(match);
        }
        current = match;
      }
    }
  }
  if (current instanceof Element) {
    const fromKey = morphKeyOf(current);
    if (fromKey !== null && fromKey !== toKey && toKeys.has(fromKey)) {
      current.before(toNode);
      return "continue";
    }
  }
  return current;
};

const api = {
  morphChildren: (fromParent: Element, toParent: Element): void => {
    const toNodes = [...toParent.childNodes];
    const fromKeyed = buildKeyedIndex(fromParent);
    const toKeys = fromKeyed === null ? null : collectKeys(toParent);

    for (let i = 0; i < toNodes.length; i += 1) {
      const toNode = toNodes[i];
      if (!toNode) {
        continue;
      }
      let fromNode: ChildNode | undefined = fromParent.childNodes[i];

      if (fromKeyed !== null && toKeys !== null) {
        const aligned = alignKeyedNode(
          fromParent,
          fromNode,
          toNode,
          fromKeyed,
          toKeys
        );
        if (aligned === "continue") {
          continue;
        }
        fromNode = aligned;
      }

      if (!fromNode) {
        fromParent.append(toNode);
        continue;
      }
      if (fromNode.nodeType !== toNode.nodeType) {
        fromNode.replaceWith(toNode);
        continue;
      }
      if (fromNode.nodeType === 3 || fromNode.nodeType === 8) {
        if (fromNode.nodeValue !== toNode.nodeValue) {
          fromNode.nodeValue = toNode.nodeValue;
        }
        continue;
      }
      if (fromNode.nodeType === 1) {
        // SAFETY: nodeType 1 is Element on both sides after the type match above.
        morphElementPair(fromNode as Element, toNode as Element, api);
      }
    }
    while (fromParent.childNodes.length > toNodes.length) {
      fromParent.lastChild?.remove();
    }
  },
} satisfies MorphApi;

export const morphInner = (from: Element, to: Element): void => {
  const focus = snapshotFocus();
  api.morphChildren(from, to);
  restoreFocus(focus);
};
