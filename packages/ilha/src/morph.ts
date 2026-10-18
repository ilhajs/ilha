import { adoptEvents } from "./events.ts";
import type { FormControlKey } from "./paint-core.ts";
import { KEY_ATTR, SLOT_ATTR } from "./shared.ts";

const PRESERVE_ATTR = "data-morph-preserve";
const STAND_IN_ATTR = "data-ilha-reuse";
const FORM_ATTR = /^(?:value|checked|selected)$/u;

const morphKeyOf = (el: Element): string | null => {
  const k = el.getAttribute(KEY_ATTR);
  if (k !== null) {
    return `k:${k}`;
  }
  const s = el.getAttribute(SLOT_ATTR);
  return s === null ? null : `s:${s}`;
};

/** Whether `data-morph-preserve` on `el` lists `token`. */
const preserves = (el: Element, token: string): boolean =>
  el.getAttribute(PRESERVE_ATTR)?.split(/\s+/u).includes(token) ?? false;

/** Attributes the morph leaves to live state or to code outside the render. */
const keepAttr = (el: Element, name: string): boolean =>
  FORM_ATTR.test(name) ||
  (name === PRESERVE_ATTR ? el.hasAttribute(name) : preserves(el, name));

const syncAttributes = (from: Element, to: Element): void => {
  for (const { name, value } of to.attributes) {
    if (!keepAttr(from, name) && from.getAttribute(name) !== value) {
      from.setAttribute(name, value);
    }
  }
  // getAttributeNames() is a static copy, safe under removeAttribute. A
  // user-opened <details> or <dialog> stays open unless the render sets `open`.
  for (const name of from.getAttributeNames()) {
    if (!to.hasAttribute(name) && name !== "open" && !keepAttr(from, name)) {
      from.removeAttribute(name);
    }
  }
};

interface FocusSnapshot {
  active: HTMLElement;
  selection?: { start: number; end: number | null; dir: string | null };
  /** Caret/selection ranges inside a focused contenteditable. */
  ranges?: Range[];
}

/** Deepest focused element, looking through open shadow roots. */
const deepActiveElement = (): Element | null => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
};

const snapshotFocus = (): FocusSnapshot | undefined => {
  if (globalThis.document === undefined) {
    return undefined;
  }
  const active = deepActiveElement();
  if (!(active instanceof HTMLElement) || active === document.body) {
    return undefined;
  }
  const snap: FocusSnapshot = { active };
  try {
    if (
      (active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement) &&
      active.selectionStart !== null
    ) {
      snap.selection = {
        dir: active.selectionDirection,
        end: active.selectionEnd,
        start: active.selectionStart,
      };
    }
  } catch {
    /* type=email has no selection API */
  }
  const sel = active.isContentEditable ? document.getSelection() : null;
  if (sel) {
    const ranges: Range[] = [];
    for (let i = 0; i < sel.rangeCount; i += 1) {
      const range = sel.getRangeAt(i);
      if (active.contains(range.startContainer)) {
        ranges.push(range.cloneRange());
      }
    }
    snap.ranges = ranges.length > 0 ? ranges : undefined;
  }
  return snap;
};

const restoreFocus = (snap: FocusSnapshot | undefined): void => {
  if (!snap?.active.isConnected) {
    return;
  }
  const { active, ranges, selection } = snap;
  try {
    if (deepActiveElement() !== active) {
      active.focus({ preventScroll: true });
      // Refocusing a contenteditable resets its caret.
      const sel = document.getSelection();
      if (ranges && sel && ranges.every((r) => r.startContainer.isConnected)) {
        sel.removeAllRanges();
        for (const r of ranges) {
          sel.addRange(r);
        }
      }
    }
    if (selection) {
      // SAFETY: selection is only recorded for input/textarea elements.
      const el = active as HTMLInputElement;
      if (
        el.selectionStart !== selection.start ||
        el.selectionEnd !== selection.end
      ) {
        // SAFETY: selectionDirection is forward|backward|none when present.
        const dir = (selection.dir ?? "none") as
          | "forward"
          | "backward"
          | "none";
        el.setSelectionRange(selection.start, selection.end, dir);
      }
    }
  } catch {
    /* best-effort */
  }
};

// Reused live nodes (component and atom hosts) never enter the scratch tree a
// render materializes into: moving them there detaches them, which blurs
// inputs, reloads iframes, closes modal dialogs and popovers, and reruns
// custom element lifecycles. The scratch tree holds a stand-in instead, and
// the morph swaps it for the live node where it already sits.
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

/**
 * Insert `node` before `ref`. Connected nodes move with `moveBefore` where the
 * browser has it, so they keep focus, iframe, dialog, and element state.
 */
const place = (parent: ParentNode, node: Node, ref: Node | null): void => {
  if (
    node === ref ||
    (node.parentNode === parent && node.nextSibling === ref)
  ) {
    return;
  }
  // SAFETY: moveBefore is a newer ParentNode method not yet in every lib.dom.
  const movable = parent as ParentNode & {
    moveBefore?: (node: Node, child: Node | null) => void;
  };
  if (node.isConnected && parent.isConnected && movable.moveBefore) {
    try {
      movable.moveBefore(node, ref);
      return;
    } catch {
      /* different root or unsupported node: plain insert */
    }
  }
  // SAFETY: every ParentNode the painter targets is a Node.
  (parent as ParentNode & Node).insertBefore(node, ref);
};

/** Swap stand-ins nested in `node` (now in the document) for live nodes. */
const resolveNested = (node: Node): void => {
  if (!(node instanceof Element) || !node.firstElementChild) {
    return;
  }
  for (const s of node.querySelectorAll(`[${STAND_IN_ATTR}]`)) {
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
const insertRendered = (
  parent: ParentNode,
  node: Node,
  ref: Node | null
): void => {
  const live = liveOf(node);
  place(parent, live, ref);
  if (live === node) {
    resolveNested(node);
  }
};

/** Positions of the longest run of increasing old indexes: those never move. */
const stableSet = (olds: (number | undefined)[]): Set<number> => {
  const tails: number[] = [];
  const prev: number[] = [];
  for (const [i, idx] of olds.entries()) {
    if (idx === undefined) {
      continue;
    }
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if ((olds[tails[mid] ?? 0] ?? 0) < idx) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    prev[i] = tails[lo - 1] ?? -1;
    tails[lo] = i;
  }
  const stable = new Set<number>();
  for (let k = tails.at(-1) ?? -1; k >= 0; k = prev[k] ?? -1) {
    stable.add(k);
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
  for (let child = parent.firstChild; child;) {
    const after: ChildNode | null = child.nextSibling;
    if (wanted.has(child)) {
      oldIndex.set(child, oldIndex.size);
    } else {
      child.remove();
    }
    child = after;
  }
  const stable = stableSet(nodes.map((n) => oldIndex.get(n)));
  let next: Node | null = null;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i] ?? null;
    if (node && !stable.has(i)) {
      place(parent, node, next);
      if (!oldIndex.has(node)) {
        resolveNested(node);
      }
    }
    next = node;
  }
  restoreFocus(focus);
};

/**
 * Rendered elements that carried a non-null form-control prop, per key.
 * `checked={false}`, `selected={false}` and `<select value>` leave no
 * attribute, so presence alone can't tell a controlled render from an
 * uncontrolled one.
 */
interface TreeMorph {
  morphChildren: (from: Element, to: Element) => void;
}

/** Late-bound: element morphs recurse into children morphed below. */
// SAFETY: morphChildren is assigned at module load, before any morph runs.
const tree = {} as TreeMorph;

const controlledBy: Record<FormControlKey, WeakSet<Element>> = {
  checked: new WeakSet(),
  selected: new WeakSet(),
  value: new WeakSet(),
};

/** Mark a rendered element controlled for `key`: the morph syncs it either way. */
export const markControlled = (el: Element, key: FormControlKey): void => {
  controlledBy[key].add(el);
};

const morphInput = (from: HTMLInputElement, to: HTMLInputElement): void => {
  // Live props beat attributes: a fresh render sets the value it asked for,
  // while the live node may hold user edits. Attribute presence marks
  // controlled renders; uncontrolled inputs keep user edits. Equal values
  // skip the write so a focused input keeps its caret.
  const checked = to.hasAttribute("checked");
  from.toggleAttribute("checked", checked);
  if (
    (checked || controlledBy.checked.has(to)) &&
    from.checked !== to.checked
  ) {
    from.checked = to.checked;
  }
  const value = to.getAttribute("value");
  if (value === null) {
    from.removeAttribute("value");
  } else {
    if (from.getAttribute("value") !== value) {
      from.setAttribute("value", value);
    }
    if (from.value !== to.value) {
      from.value = to.value;
    }
  }
};

const morphTextarea = (
  from: HTMLTextAreaElement,
  to: HTMLTextAreaElement
): void => {
  // Children or a `value` prop are the controlled signal: neither means an
  // uncontrolled box whose live value (user edits) must survive.
  if (
    controlledBy.value.has(to) ||
    to.textContent !== "" ||
    from.textContent !== to.textContent
  ) {
    if (from.value !== to.value) {
      from.value = to.value;
    }
    if (from.textContent !== to.textContent) {
      from.textContent = to.textContent;
    }
  }
};

const morphSelect = (from: HTMLSelectElement, to: HTMLSelectElement): void => {
  const controlled =
    controlledBy.value.has(to) ||
    [...to.options].some((o) => controlledBy.selected.has(o));
  const before = new Map(
    [...from.options].map((o) => [o, [o.hasAttribute("selected"), o.selected]])
  );
  tree.morphChildren(from, to);
  const options = [...from.options];
  // The morph mirrors the option list, so indexes line up. A controlled
  // render's selection wins; otherwise changed `selected` attributes win,
  // and failing those the user's selection survives.
  const attrsChanged = options.some(
    (o) => o.hasAttribute("selected") !== (before.get(o)?.[0] ?? false)
  );
  for (const [i, o] of options.entries()) {
    let want = before.get(o)?.[1] ?? o.selected;
    if (controlled) {
      want = to.options[i]?.selected ?? false;
    } else if (attrsChanged) {
      want = o.hasAttribute("selected");
    }
    if (o.selected !== want) {
      o.selected = want;
    }
  }
};

/** Rendered element → the live element the morph kept in its place. */
const adoptedBy = new WeakMap<Element, Element>();

/** The element a rendered element ended up as in the document. */
export const committedElement = (el: Element): Element =>
  adoptedBy.get(el) ?? el;

/** Swap `fromNode` for a rendered node without ever detaching live nodes. */
const replaceRendered = (fromNode: ChildNode, toNode: Node): void => {
  if (fromNode.parentNode) {
    insertRendered(fromNode.parentNode, toNode, fromNode);
    fromNode.remove();
  }
};

/**
 * While hydrating, server slot hosts are replaced by the freshly painted ones:
 * the new hole fibers are rooted in those, so their content must be installed.
 */
let hydrating = false;

const morphElementPair = (from: Element, to: Element): void => {
  const toSlot = to.getAttribute(SLOT_ATTR);
  if (from.localName !== to.localName || (toSlot !== null && hydrating)) {
    replaceRendered(from, to);
    return;
  }
  if (toSlot !== null) {
    // The same hole host keeps its live node; a new hole's fiber is rooted
    // in `to`, so install it.
    if (from.getAttribute(SLOT_ATTR) !== toSlot) {
      replaceRendered(from, to);
    }
    return;
  }
  adoptedBy.set(to, from);
  adoptEvents(from, to);
  // `data-morph-preserve="children"` hands the subtree to code outside the
  // render after the first paint. A contenteditable the render leaves empty
  // is uncontrolled: the user's content and caret survive.
  const mode = to.getAttribute("contenteditable");
  const keepChildren =
    preserves(from, "children") ||
    preserves(to, "children") ||
    (mode !== null &&
      mode !== "false" &&
      !to.hasChildNodes() &&
      from.getAttribute("contenteditable") === mode);
  syncAttributes(from, to);
  if (from instanceof HTMLInputElement) {
    // SAFETY: localName matched, so `to` is an input too.
    morphInput(from, to as HTMLInputElement);
  } else if (from instanceof HTMLSelectElement) {
    // SAFETY: localName matched, so `to` is a select too.
    morphSelect(from, to as HTMLSelectElement);
  } else if (keepChildren) {
    // Left to code outside the render.
  } else if (from instanceof HTMLTextAreaElement) {
    // SAFETY: localName matched, so `to` is a textarea too.
    morphTextarea(from, to as HTMLTextAreaElement);
  } else {
    tree.morphChildren(from, to);
  }
};

const morphChild = (
  parent: Element,
  from: ChildNode | undefined,
  to: ChildNode
): void => {
  // A stand-in keeps its live node where it sits, or moves it here. A claimed
  // node is a reused host a later stand-in still wants: render in front of it
  // rather than morphing it into something else.
  if (standIns.has(to) || !from || claimed.has(from)) {
    insertRendered(parent, to, from ?? null);
  } else if (from.nodeType !== to.nodeType) {
    replaceRendered(from, to);
  } else if (from instanceof Element) {
    // SAFETY: nodeType matched, so `to` is an Element too.
    morphElementPair(from, to as Element);
  } else if (from.nodeValue !== to.nodeValue) {
    from.nodeValue = to.nodeValue;
  }
};

interface KeyedIndex {
  /** First live child per key. */
  from: Map<string, Element>;
  /** Keys the new render uses. */
  to: Set<string | null>;
}

const keyedIndex = (
  fromParent: Element,
  toParent: Element
): KeyedIndex | undefined => {
  const from = new Map<string, Element>();
  for (const child of fromParent.children) {
    const k = morphKeyOf(child);
    if (k !== null && !from.has(k)) {
      from.set(k, child);
    }
  }
  if (from.size === 0) {
    return undefined;
  }
  const to = new Set(Array.from(toParent.children, morphKeyOf));
  to.delete(null);
  return { from, to };
};

/** A keyed live node the new render drops and no stand-in still needs. */
const isStale = (node: ChildNode, index: KeyedIndex): boolean => {
  const key =
    node instanceof Element && !claimed.has(node) ? morphKeyOf(node) : null;
  return key !== null && !index.to.has(key);
};

/**
 * Bring the live node keyed like `to` into position `from`. Returns the node
 * to morph against, or `null` once `to` was inserted ahead of a keyed live
 * node that belongs further down.
 */
const alignKeyed = (
  parent: Element,
  start: ChildNode | undefined,
  to: ChildNode,
  index: KeyedIndex
): ChildNode | undefined | null => {
  let from = start;
  const toKey = to instanceof Element ? morphKeyOf(to) : null;
  const match = toKey === null ? undefined : index.from.get(toKey);
  if (toKey !== null && match) {
    index.from.delete(toKey);
    // Removed rows ahead of the match leave instead of the match moving
    // back past them: dropping the head of a list moves nothing.
    while (from && from !== match && isStale(from, index)) {
      const next: ChildNode | null = from.nextSibling;
      from.remove();
      from = next ?? undefined;
    }
    if (match !== from) {
      place(parent, match, from ?? null);
      from = match;
    }
  }
  const fromKey = from instanceof Element ? morphKeyOf(from) : null;
  if (from && fromKey !== null && fromKey !== toKey && index.to.has(fromKey)) {
    insertRendered(parent, to, from);
    return null;
  }
  return from;
};

tree.morphChildren = (fromParent, toParent) => {
  const toNodes = [...toParent.childNodes];
  const index = keyedIndex(fromParent, toParent);
  for (const [i, to] of toNodes.entries()) {
    const at = fromParent.childNodes[i];
    const from = index ? alignKeyed(fromParent, at, to, index) : at;
    if (from !== null) {
      morphChild(fromParent, from, to);
    }
  }
  while (fromParent.childNodes.length > toNodes.length) {
    fromParent.lastChild?.remove();
  }
};

/** Morph `from`'s children into `to`'s, keeping focus and selection. */
export const morphInner = (from: Element, to: Element): void => {
  const focus = snapshotFocus();
  tree.morphChildren(from, to);
  restoreFocus(focus);
};

/** Morph the first client render into server markup, replacing slot hosts. */
export const hydrateInner = (from: Element, to: Element): void => {
  hydrating = true;
  try {
    morphInner(from, to);
  } finally {
    hydrating = false;
  }
};
