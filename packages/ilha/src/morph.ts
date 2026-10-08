import { adoptEvents } from "./events.ts";
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

/** Whether `data-morph-preserve` on `el` lists `token`. */
const hasPreserveToken = (el: Element, token: string): boolean => {
  const custom = el.getAttribute(PRESERVE_ATTR);
  if (custom === null) {
    return false;
  }
  for (const listed of custom.split(/\s+/u)) {
    if (listed === token) {
      return true;
    }
  }
  return false;
};

const shouldPreserveMorphAttr = (el: Element, name: string): boolean => {
  if (name === "value" || name === "checked" || name === "selected") {
    return true;
  }
  if (name === PRESERVE_ATTR) {
    return el.hasAttribute(PRESERVE_ATTR);
  }
  return hasPreserveToken(el, name);
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
  /** Caret/selection ranges inside a focused contenteditable. */
  ranges: Range[] | null;
}

/** Deepest focused element, looking through open shadow roots. */
const deepActiveElement = (): Element | null => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
};

const snapshotRanges = (active: HTMLElement): Range[] | null => {
  if (!active.isContentEditable) {
    return null;
  }
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return null;
  }
  const ranges: Range[] = [];
  for (let i = 0; i < sel.rangeCount; i += 1) {
    const range = sel.getRangeAt(i);
    if (active.contains(range.startContainer)) {
      ranges.push(range.cloneRange());
    }
  }
  return ranges.length > 0 ? ranges : null;
};

const snapshotFocus = (): MorphFocusSnapshot | null => {
  if (globalThis.document === undefined) {
    return null;
  }
  const active = deepActiveElement();
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
  return { active, ranges: snapshotRanges(active), selection };
};

const restoreRanges = (ranges: Range[]): void => {
  const sel = document.getSelection();
  if (!sel || !ranges.every((r) => r.startContainer.isConnected)) {
    return;
  }
  sel.removeAllRanges();
  for (const r of ranges) {
    sel.addRange(r);
  }
};

const restoreFocus = (snapshot: MorphFocusSnapshot | null): void => {
  if (!snapshot || !snapshot.active.isConnected) {
    return;
  }
  try {
    if (deepActiveElement() !== snapshot.active) {
      snapshot.active.focus({ preventScroll: true });
      if (snapshot.ranges) {
        // Refocusing a contenteditable resets its caret.
        restoreRanges(snapshot.ranges);
      }
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

// Reused live nodes (component, island, and atom hosts) never enter the
// scratch tree a render materializes into: moving them there detaches them,
// which blurs inputs, reloads iframes, closes modal dialogs and popovers, and
// reruns custom element lifecycles. The scratch tree holds a stand-in instead,
// and the morph swaps it for the live node where it already sits.
const STAND_IN_ATTR = "data-ilha-reuse";
const standIns = new WeakMap<Node, Element>();
/** Live nodes with an outstanding stand-in: the morph must not consume them. */
const claimed = new WeakSet<Node>();

/** Placeholder for a connected live node inside a scratch render tree. */
export const standInFor = (live: Element): Element => {
  const el = document.createElementNS(live.namespaceURI, live.localName);
  for (const name of [SLOT_ATTR, KEY_ATTR]) {
    const v = live.getAttribute(name);
    if (v !== null) {
      el.setAttribute(name, v);
    }
  }
  el.setAttribute(STAND_IN_ATTR, "");
  standIns.set(el, live);
  claimed.add(live);
  return el;
};

const liveOf = (node: Node): Node => {
  const live = standIns.get(node);
  if (!live) {
    return node;
  }
  claimed.delete(live);
  return live;
};

type MoveCapable = ParentNode & {
  moveBefore?: (node: Node, child: Node | null) => void;
};

/**
 * Insert `node` before `ref`. Connected nodes move with `moveBefore` where the
 * browser has it, so they keep focus, iframe, dialog, and element state.
 */
const place = (
  parent: MoveCapable,
  node: Node,
  ref: ChildNode | null
): void => {
  if (
    node === ref ||
    (node.parentNode === parent && node.nextSibling === ref)
  ) {
    return;
  }
  if (node.isConnected && parent.isConnected && parent.moveBefore) {
    try {
      parent.moveBefore(node, ref);
      return;
    } catch {
      /* different root or unsupported node: plain insert */
    }
  }
  if (ref) {
    ref.before(node);
  } else {
    parent.append(node);
  }
};

/** Swap stand-ins nested in `node` (now in the document) for live nodes. */
const resolveNested = (node: Node): void => {
  if (!(node instanceof Element) || !node.firstElementChild) {
    return;
  }
  const nested = node.querySelectorAll(`[${STAND_IN_ATTR}]`);
  for (const s of nested) {
    const live = liveOf(s);
    if (live !== s && s.parentNode) {
      place(s.parentNode, live, s);
      s.remove();
    }
  }
};

/**
 * Put a rendered node into the live tree: stand-ins become their live nodes,
 * and stand-ins nested in fresh subtrees resolve once the subtree is attached.
 */
export const insertRendered = (
  parent: ParentNode,
  node: Node,
  ref: ChildNode | null
): void => {
  const live = liveOf(node);
  place(parent, live, ref);
  if (live === node) {
    resolveNested(node);
  }
};

/** Longest increasing run of old indexes: those nodes never move. */
const stableSet = (nodes: Node[], oldIndex: Map<Node, number>): Set<Node> => {
  const tails: number[] = [];
  const prev: number[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const idx = node ? oldIndex.get(node) : undefined;
    if (idx === undefined) {
      prev.push(-1);
      continue;
    }
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const tail = nodes[tails[mid] ?? 0];
      if ((tail ? (oldIndex.get(tail) ?? 0) : 0) < idx) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    prev.push(lo > 0 ? (tails[lo - 1] ?? -1) : -1);
    tails[lo] = i;
  }
  const stable = new Set<Node>();
  let k = tails.length > 0 ? (tails.at(-1) ?? -1) : -1;
  while (k >= 0) {
    const node = nodes[k];
    if (node) {
      stable.add(node);
    }
    k = prev[k] ?? -1;
  }
  return stable;
};

/**
 * Make `parent`'s children exactly `nodes` with the fewest moves. Nodes that
 * keep their relative order stay attached; removed nodes leave first.
 */
export const placeChildren = (parent: Element, rendered: Node[]): void => {
  const focus = snapshotFocus();
  const nodes = rendered.map(liveOf);
  const wanted = new Set(nodes);
  const oldIndex = new Map<Node, number>();
  let child = parent.firstChild;
  while (child) {
    const next = child.nextSibling;
    if (wanted.has(child)) {
      oldIndex.set(child, oldIndex.size);
    } else {
      child.remove();
    }
    child = next;
  }
  const stable = stableSet(nodes, oldIndex);
  let next: Node | null = null;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (!node) {
      continue;
    }
    if (!stable.has(node)) {
      place(parent, node, next);
      if (!oldIndex.has(node)) {
        resolveNested(node);
      }
    }
    next = node;
  }
  restoreFocus(focus);
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

/** Rendered inputs that carried a `checked` prop. `checked={false}` leaves no
 * attribute, so presence alone can't tell a controlled "off" from an
 * uncontrolled box. */
const controlledChecked = new WeakSet<Element>();

/** Mark a rendered input as controlled: the morph syncs its `checked` either way. */
export const markControlledChecked = (el: Element): void => {
  controlledChecked.add(el);
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
  const controlled = toChecked || controlledChecked.has(toEl);
  if (controlled && from.checked !== to.checked) {
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

/** Rendered element → the live element the morph kept in its place. */
const adoptedBy = new WeakMap<Element, Element>();

/** The element a rendered element ended up as in the document. */
export const committedElement = (el: Element): Element =>
  adoptedBy.get(el) ?? el;

/** `live` stays in the document for `fresh`: move the render's bindings. */
const adopt = (live: Element, fresh: Element): void => {
  adoptedBy.set(fresh, live);
  adoptEvents(live, fresh);
};

/**
 * A contenteditable the render leaves empty is uncontrolled: the user's
 * content (and caret) survives, like an uncontrolled textarea.
 */
const isUncontrolledEditable = (from: Element, to: Element): boolean => {
  const mode = to.getAttribute("contenteditable");
  return (
    mode !== null &&
    mode !== "false" &&
    !to.hasChildNodes() &&
    from.getAttribute("contenteditable") === mode
  );
};

/** Swap `fromNode` for a rendered node without ever detaching live nodes. */
const replaceRendered = (fromNode: ChildNode, toNode: Node): void => {
  const parent = fromNode.parentNode;
  if (!parent) {
    return;
  }
  insertRendered(parent, toNode, fromNode);
  fromNode.remove();
};

const morphElementPair = (
  fromEl: Element,
  toEl: Element,
  api: MorphApi
): void => {
  if (fromEl.localName !== toEl.localName) {
    replaceRendered(fromEl, toEl);
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
    replaceRendered(fromEl, toEl);
    return;
  }
  adopt(fromEl, toEl);
  if (fromEl.localName === "input") {
    morphInput(fromEl, toEl);
    return;
  }
  if (fromEl.localName === "select") {
    morphSelect(fromEl, toEl, api);
    return;
  }
  // `data-morph-preserve="children"` hands the subtree to code outside the
  // render after the first paint. Like attribute tokens, the live element's
  // list counts too, so a library can claim its node at runtime.
  const keepChildren =
    hasPreserveToken(fromEl, "children") ||
    hasPreserveToken(toEl, "children") ||
    isUncontrolledEditable(fromEl, toEl);
  syncAttributes(fromEl, toEl);
  if (keepChildren) {
    return;
  }
  if (fromEl.localName === "textarea") {
    morphTextarea(fromEl, toEl);
  } else {
    api.morphChildren(fromEl, toEl);
  }
};

/** Keyed node the new render drops and no stand-in still needs. */
const isStaleKeyed = (node: ChildNode, toKeys: Set<string>): boolean => {
  if (!(node instanceof Element) || claimed.has(node)) {
    return false;
  }
  const key = morphKeyOf(node);
  return key !== null && !toKeys.has(key);
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
      // Removed rows ahead of the match leave instead of the match moving
      // back past them: dropping the head of a list moves nothing.
      while (current && current !== match && isStaleKeyed(current, toKeys)) {
        const next: ChildNode | null = current.nextSibling;
        current.remove();
        current = next ?? undefined;
      }
      if (match !== current) {
        place(fromParent, match, current ?? null);
        current = match;
      }
    }
  }
  if (current instanceof Element) {
    const fromKey = morphKeyOf(current);
    if (fromKey !== null && fromKey !== toKey && toKeys.has(fromKey)) {
      insertRendered(fromParent, toNode, current);
      return "continue";
    }
  }
  return current;
};

interface MorphChildInput {
  api: MorphApi;
  fromParent: Element;
  fromNode: ChildNode | undefined;
  toNode: ChildNode;
}

const morphChild = ({
  api,
  fromParent,
  fromNode,
  toNode,
}: MorphChildInput): void => {
  if (standIns.has(toNode)) {
    // Reused host: keep it where it sits, or move it into this position.
    insertRendered(fromParent, toNode, fromNode ?? null);
    return;
  }
  if (!fromNode || claimed.has(fromNode)) {
    // A claimed node is a reused host a later stand-in still wants: render
    // in front of it rather than morphing it into something else.
    insertRendered(fromParent, toNode, fromNode ?? null);
    return;
  }
  if (fromNode.nodeType !== toNode.nodeType) {
    replaceRendered(fromNode, toNode);
    return;
  }
  if (fromNode.nodeType === 3 || fromNode.nodeType === 8) {
    if (fromNode.nodeValue !== toNode.nodeValue) {
      fromNode.nodeValue = toNode.nodeValue;
    }
    return;
  }
  if (fromNode.nodeType === 1) {
    // SAFETY: nodeType 1 is Element on both sides after the type match above.
    morphElementPair(fromNode as Element, toNode as Element, api);
  }
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
      morphChild({ api, fromNode, fromParent, toNode });
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
