const PRESERVE_ATTR = "data-morph-preserve";
const KEY_ATTR = "data-ilha-key";
const SLOT_ATTR = "data-ilha-slot";

function morphKeyOf(el: Element): string | null {
  const k = el.getAttribute(KEY_ATTR);
  if (k !== null) return `k:${k}`;
  const s = el.getAttribute(SLOT_ATTR);
  return s === null ? null : `s:${s}`;
}

function shouldPreserveMorphAttr(el: Element, name: string): boolean {
  if (name === "value" || name === "checked" || name === "selected") return true;
  if (name === PRESERVE_ATTR) return el.hasAttribute(PRESERVE_ATTR);
  const custom = el.getAttribute(PRESERVE_ATTR);
  if (custom !== null) {
    for (const token of custom.split(/\s+/)) if (token === name) return true;
  }
  return false;
}

function syncAttributes(from: Element, to: Element): void {
  for (const { name, value } of to.attributes) {
    if (shouldPreserveMorphAttr(from, name)) continue;
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  }
  for (const { name } of Array.from(from.attributes)) {
    if (shouldPreserveMorphAttr(from, name)) continue;
    if (!to.hasAttribute(name)) from.removeAttribute(name);
  }
}

type MorphFocusSnapshot = {
  active: HTMLElement;
  selection: {
    start: number | null;
    end: number | null;
    dir: string | null;
  } | null;
};

function snapshotFocus(): MorphFocusSnapshot | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  let selection: MorphFocusSnapshot["selection"] = null;
  try {
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      selection = {
        start: active.selectionStart,
        end: active.selectionEnd,
        dir: active.selectionDirection,
      };
    }
  } catch {
    /* type=email */
  }
  return { active, selection };
}

function restoreFocus(snapshot: MorphFocusSnapshot | null): void {
  if (!snapshot || !snapshot.active.isConnected) return;
  try {
    if (document.activeElement !== snapshot.active) {
      snapshot.active.focus({ preventScroll: true });
    }
    const sel = snapshot.selection;
    if (sel && sel.start !== null) {
      const el = snapshot.active as HTMLInputElement;
      if (el.selectionStart !== sel.start || el.selectionEnd !== sel.end) {
        el.setSelectionRange(sel.start, sel.end, (sel.dir as "forward") ?? "none");
      }
    }
  } catch {
    /* best-effort */
  }
}

function morphChildren(fromParent: Element, toParent: Element): void {
  const toNodes = Array.from(toParent.childNodes);
  let fromKeyed: Map<string, Element> | null = null;
  for (const child of fromParent.children) {
    const k = morphKeyOf(child);
    if (k !== null && !(fromKeyed ??= new Map()).has(k)) fromKeyed.set(k, child);
  }
  let toKeys: Set<string> | null = null;
  if (fromKeyed !== null) {
    toKeys = new Set();
    for (const child of toParent.children) {
      const k = morphKeyOf(child);
      if (k !== null) toKeys.add(k);
    }
  }

  for (let i = 0; i < toNodes.length; i++) {
    const toNode = toNodes[i]!;
    let fromNode: ChildNode | undefined = fromParent.childNodes[i];

    if (fromKeyed !== null) {
      const toKey = toNode.nodeType === 1 ? morphKeyOf(toNode as Element) : null;
      if (toKey !== null) {
        const match = fromKeyed.get(toKey);
        if (match) {
          fromKeyed.delete(toKey);
          if (match !== fromNode) {
            fromParent.insertBefore(match, fromNode ?? null);
            fromNode = match;
          }
        }
      }
      if (fromNode instanceof Element) {
        const fromKey = morphKeyOf(fromNode);
        if (fromKey !== null && fromKey !== toKey && toKeys!.has(fromKey)) {
          fromParent.insertBefore(toNode, fromNode);
          continue;
        }
      }
    }

    if (!fromNode) {
      fromParent.appendChild(toNode);
      continue;
    }
    if (fromNode.nodeType !== toNode.nodeType) {
      fromParent.replaceChild(toNode, fromNode);
      continue;
    }
    if (fromNode.nodeType === 3 || fromNode.nodeType === 8) {
      if (fromNode.nodeValue !== toNode.nodeValue) fromNode.nodeValue = toNode.nodeValue;
      continue;
    }
    if (fromNode.nodeType === 1) {
      const fromEl = fromNode as Element;
      const toEl = toNode as Element;
      if (fromEl.localName !== toEl.localName) {
        fromParent.replaceChild(toEl, fromEl);
        continue;
      }
      const slotId = toEl.getAttribute(SLOT_ATTR);
      if (slotId !== null && fromEl.getAttribute(SLOT_ATTR) === slotId) continue;
      if (fromEl.localName === "input") {
        const hadChecked = fromEl.hasAttribute("checked");
        const hadValue = fromEl.getAttribute("value");
        syncAttributes(fromEl, toEl);
        const hasChecked = toEl.hasAttribute("checked");
        if (hasChecked !== hadChecked) (fromEl as HTMLInputElement).checked = hasChecked;
        const newValue = toEl.getAttribute("value");
        if (newValue !== hadValue) (fromEl as HTMLInputElement).value = newValue ?? "";
        continue;
      }
      if (fromEl.localName === "select") {
        const before = new Map<HTMLOptionElement, { attr: boolean; live: boolean }>();
        for (const o of (fromEl as HTMLSelectElement).options) {
          before.set(o, { attr: o.hasAttribute("selected"), live: o.selected });
        }
        syncAttributes(fromEl, toEl);
        morphChildren(fromEl, toEl);
        const options = Array.from((fromEl as HTMLSelectElement).options);
        if (options.some((o) => o.hasAttribute("selected") !== (before.get(o)?.attr ?? false))) {
          for (const o of options) o.selected = o.hasAttribute("selected");
        } else {
          for (const o of options) {
            const prev = before.get(o);
            if (prev && o.selected !== prev.live) o.selected = prev.live;
          }
        }
        continue;
      }
      syncAttributes(fromEl, toEl);
      if (fromEl.localName === "textarea") {
        const newText = toEl.textContent ?? "";
        if (fromEl.textContent !== newText) {
          fromEl.textContent = newText;
          (fromEl as HTMLTextAreaElement).value = newText;
        }
      } else morphChildren(fromEl, toEl);
    }
  }
  while (fromParent.childNodes.length > toNodes.length) fromParent.lastChild!.remove();
}

export function morphInner(from: Element, to: Element): void {
  const focus = snapshotFocus();
  morphChildren(from, to);
  restoreFocus(focus);
}

export { KEY_ATTR, SLOT_ATTR };
