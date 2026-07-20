import { signal, computed, effect, setActiveSub, startBatch, endBatch } from "alien-signals";

// ---------------------------------------------
// Standard Schema V1 (inlined, type-only)
// ---------------------------------------------

interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

declare namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: Types<Input, Output> | undefined;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
  }
  type Result<Output> = SuccessResult<Output> | FailureResult;
  interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  interface PathSegment {
    readonly key: PropertyKey;
  }
  interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
  type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}

// ---------------------------------------------
// Dev-mode warning helper
// ---------------------------------------------

declare const __ILHA_DEV__: boolean | undefined;

const __DEV__ =
  typeof __ILHA_DEV__ !== "undefined"
    ? __ILHA_DEV__
    : typeof process !== "undefined"
      ? process.env?.["NODE_ENV"] !== "production"
      : true;

function warn(msg: string): void {
  if (__DEV__) console.warn(`[ilha] ${msg}`);
}

// Dev-only: find the first value in a snapshot that will not survive a JSON
// round-trip (dropped or silently transformed by JSON.stringify), so authors
// hear about hydration divergence instead of debugging it. Returns a
// "path: reason" description, or null when the value is JSON-safe.
function findNonJsonSafeValue(
  value: unknown,
  path: string,
  seen: WeakSet<object> = new WeakSet(),
): string | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? null : `${path}: non-finite number becomes null`;
  }
  if (value === undefined) return `${path}: undefined is dropped`;
  if (typeof value === "function") return `${path}: functions are dropped`;
  if (typeof value === "symbol") return `${path}: symbols are dropped`;
  if (typeof value === "bigint") return `${path}: bigint throws in JSON.stringify`;
  if (value instanceof Date) return `${path}: Date becomes a string`;
  if (value instanceof Map || value instanceof Set) {
    return `${path}: ${value instanceof Map ? "Map" : "Set"} becomes {}`;
  }
  if (value instanceof RegExp) return `${path}: RegExp becomes {}`;
  if (Array.isArray(value)) {
    if (seen.has(value)) return `${path}: circular reference throws in JSON.stringify`;
    seen.add(value);
    for (let i = 0; i < value.length; i++) {
      const found = findNonJsonSafeValue(value[i], `${path}[${i}]`, seen);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    // Objects with toJSON serialize intentionally; trust them.
    if (typeof (value as { toJSON?: unknown }).toJSON === "function") return null;
    if (seen.has(value)) return `${path}: circular reference throws in JSON.stringify`;
    seen.add(value);
    for (const [k, v] of Object.entries(value)) {
      const found = findNonJsonSafeValue(v, `${path}.${k}`, seen);
      if (found) return found;
    }
  }
  return null;
}

// ---------------------------------------------
// SSR snapshot deserialization guards
// ---------------------------------------------

// Upper bound on the size of a single data-ilha-* JSON attribute (in chars).
// SSR snapshots are author-generated and normally tiny; a payload past this
// is almost certainly malformed or hostile, so we reject rather than hand it
// to JSON.parse. 256 KB is generous for legitimate island props/state.
const MAX_SNAPSHOT_CHARS = 256 * 1024;

// Upper bound on nesting depth of a parsed snapshot. Deeply nested input can
// trigger pathological work in downstream resolveInput / shallow comparisons,
// so we cap it. 32 comfortably exceeds any reasonable props/state shape.
const MAX_SNAPSHOT_DEPTH = 32;

function exceedsMaxDepth(value: unknown, depth: number): boolean {
  if (depth > MAX_SNAPSHOT_DEPTH) return true;
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (const item of value) if (exceedsMaxDepth(item, depth + 1)) return true;
    return false;
  }
  for (const key in value as Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (exceedsMaxDepth((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

// Recursively drop prototype-polluting keys from a parsed JSON payload.
// JSON.parse creates them as plain own properties (harmless by itself), but
// they flow into input/state objects and are one deep-merge away from being
// exploitable — cheaper to strip at the parse boundary.
const UNSAFE_SNAPSHOT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function stripUnsafeKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) stripUnsafeKeys(item);
    return;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (UNSAFE_SNAPSHOT_KEYS.has(key)) {
      delete (value as Record<string, unknown>)[key];
    } else {
      stripUnsafeKeys((value as Record<string, unknown>)[key]);
    }
  }
}

// Parse a data-ilha-* JSON attribute defensively: cap size, parse, cap depth.
// Returns undefined (and warns) on any failure so callers degrade gracefully
// instead of throwing or accepting a pathological payload. `label` is used in
// the warning to identify which attribute failed.
function safeParseSnapshot(raw: string, label: string): unknown {
  if (raw.length > MAX_SNAPSHOT_CHARS) {
    warn(`${label} exceeds ${MAX_SNAPSHOT_CHARS} chars — snapshot ignored.`);
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warn(`Failed to parse ${label} — invalid JSON, snapshot ignored.`);
    return undefined;
  }
  if (exceedsMaxDepth(parsed, 1)) {
    warn(`${label} nesting exceeds depth ${MAX_SNAPSHOT_DEPTH} — snapshot ignored.`);
    return undefined;
  }
  // Hydration callers treat the snapshot as a plain object (props/state).
  // Reject scalars, arrays, and null so a malformed payload degrades to the
  // empty-snapshot fallback instead of being spread as state/props.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warn(`${label} is not an object — snapshot ignored.`);
    return undefined;
  }
  stripUnsafeKeys(parsed);
  return parsed;
}

// Shallow equality on two resolved-input objects. Used to short-circuit
// updateProps when a parent re-renders with the same props — avoids
// unnecessary signal churn (and therefore unnecessary child re-renders).
// Objects only; both arguments are always plain objects produced by
// resolveInput. Uses Object.is so NaN compares equal to itself.
function shallowEqualInput(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

// Detect the expected client-mount divergence: eager render inlines child
// SSR while the first reactive pass emits empty slot stubs. Props encoded on
// the stub must match — if they differ, state changed before the first
// effect (e.g. Parent.onMount wrote new props) and we must reconcile.
function parseHtmlFragment(html: string): DocumentFragment {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return tpl.content;
}

function extractDirectChildSlotIdsInOrder(root: DocumentFragment): string[] {
  const ids: string[] = [];
  for (const el of root.querySelectorAll("[data-ilha-slot]")) {
    if (!(el instanceof Element)) continue;
    let parent: Node | null = el.parentElement ?? el.parentNode;
    let nested = false;
    while (parent && parent !== root) {
      if (parent instanceof Element && parent.hasAttribute("data-ilha-slot")) {
        nested = true;
        break;
      }
      parent =
        parent instanceof Element ? (parent.parentElement ?? parent.parentNode) : parent.parentNode;
    }
    if (!nested) ids.push(el.getAttribute("data-ilha-slot")!);
  }
  return ids;
}

// Find the slot element with the given id in a parsed fragment and return its
// props attribute value ("" when the slot exists without props, null when the
// slot is absent). DOM-based — immune to attribute order/quoting differences.
function extractSlotPropsAttr(root: DocumentFragment, slotId: string): string | null {
  for (const el of root.querySelectorAll(`[${SLOT_ATTR}]`)) {
    if (el.getAttribute(SLOT_ATTR) === slotId) return el.getAttribute(PROPS_ATTR) ?? "";
  }
  return null;
}

const SLOT_TAG_NAME_RE = /^[a-z][a-z0-9-]*$/i;

function assertValidSlotTagName(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed.length === 0) {
    throw new Error("island.as() requires a non-empty HTML tag name.");
  }
  if (!SLOT_TAG_NAME_RE.test(trimmed)) {
    throw new Error(
      `island.as() tag must be a valid HTML element name (got "${tag}"). ` +
        `Use names like "span", "div", or "li".`,
    );
  }
  return trimmed.toLowerCase();
}

function getIslandSlotTag(island: AnyIsland): string {
  const tag = (island as unknown as Record<symbol, unknown>)[ISLAND_SLOT_TAG];
  if (typeof tag === "string" && tag.length > 0) return tag;
  return "div";
}

function wrapIslandSlotHtml(tag: string, id: string, propsAttr: string, inner: string): string {
  return `<${tag} ${SLOT_ATTR}="${escapeHtml(id)}"${propsAttr}>${inner}</${tag}>`;
}

function isStableInlineSlotMount(
  initialHtml: string,
  renderedHtml: string,
  slotIds: Iterable<string>,
): boolean {
  if (typeof document === "undefined") return false;
  const initialRoot = parseHtmlFragment(initialHtml);
  const renderedRoot = parseHtmlFragment(renderedHtml);
  const initialOrder = extractDirectChildSlotIdsInOrder(initialRoot);
  const renderedOrder = extractDirectChildSlotIdsInOrder(renderedRoot);
  if (
    initialOrder.length !== renderedOrder.length ||
    initialOrder.some((id, i) => id !== renderedOrder[i])
  ) {
    return false;
  }
  for (const id of slotIds) {
    const initialProps = extractSlotPropsAttr(initialRoot, id);
    const renderedProps = extractSlotPropsAttr(renderedRoot, id);
    if (initialProps === null || renderedProps === null) return false;
    if (initialProps !== renderedProps) return false;
  }
  return true;
}

/**
 * Props safe to embed in `data-ilha-props`.
 * Functions cannot round-trip through JSON; children are owned by the live slot
 * map (client) and/or the inlined SSR subtree — never depend on the attr for them.
 * RawHtml is tagged so a rare attr-only mount can revive `Symbol.for("ilha.raw")`.
 */
function slotPropsForAttr(
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (props === undefined) return undefined;
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(props)) {
    if (key === "children") continue;
    const value = props[key];
    if (typeof value === "function" || typeof value === "symbol") continue;
    const encoded = encodeSlotPropValue(value);
    if (encoded === undefined && value !== undefined && value !== null) continue;
    (out ??= {})[key] = encoded as unknown;
  }
  return out;
}

// Use Symbol.for directly — these helpers sit above the RAW const binding.
const SLOT_RAW = Symbol.for("ilha.raw");

function isRawHtmlValue(v: unknown): v is RawHtml {
  return !!(v && typeof v === "object" && SLOT_RAW in v);
}

function encodeSlotPropValue(value: unknown, seen?: WeakSet<object>): unknown {
  if (value == null) return value;
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (typeof value !== "object") return value;
  if (isRawHtmlValue(value)) return { __ilha: "raw", value: value.value };

  const visited = seen ?? new WeakSet<object>();
  if (visited.has(value as object)) {
    throw new TypeError("encodeSlotPropValue: circular reference in slot props");
  }
  visited.add(value as object);

  if (Array.isArray(value)) {
    return value
      .map((item) => encodeSlotPropValue(item, visited))
      .filter((item) => item !== undefined);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const obj = value as Record<string, unknown>;
  const encoded: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const next = encodeSlotPropValue(obj[key], visited);
    if (next !== undefined || obj[key] === null) encoded[key] = next as unknown;
  }
  return encoded;
}

function makeRawHtml(value: string): RawHtml {
  return { [SLOT_RAW]: true, value } as unknown as RawHtml;
}

function reviveSlotPropValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(reviveSlotPropValue);
  const obj = value as Record<string, unknown>;
  if (obj.__ilha === "raw" && typeof obj.value === "string") return makeRawHtml(obj.value);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) out[key] = reviveSlotPropValue(obj[key]);
  return out;
}

/**
 * Exact legacy shape produced when RawHtml lost its brand under JSON.stringify:
 * a plain object with a single own key `value` that is a string.
 */
function isLegacyRawHtmlBlob(value: unknown): value is { value: string } {
  if (!value || typeof value !== "object" || isRawHtmlValue(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value as object);
  return (
    keys.length === 1 &&
    keys[0] === "value" &&
    typeof (value as { value: unknown }).value === "string"
  );
}

/** Revive attr-parsed props (RawHtml tags). Children stay as plain data if present. */
function reviveSlotProps(props: Record<string, unknown>): Record<string, unknown> {
  // Callers normally pass safeParseSnapshot output (already a plain object),
  // but guard so a mistaken non-object never throws inside revival.
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    return {};
  }
  const out = reviveSlotPropValue(props) as Record<string, unknown>;
  // Legacy / debug attrs may still carry children as `{ value: string }` blobs
  // after JSON.stringify stripped the RawHtml brand — restore them so a child
  // island that only sees attr props can still paint compound children.
  if ("children" in out) out.children = reviveLegacyChildren(out.children);
  return out;
}

function reviveLegacyChildren(children: unknown): unknown {
  if (!Array.isArray(children)) {
    if (isLegacyRawHtmlBlob(children)) return makeRawHtml(children.value);
    return reviveSlotPropValue(children);
  }
  return children.map((child) => {
    if (isLegacyRawHtmlBlob(child)) return makeRawHtml(child.value);
    return reviveSlotPropValue(child);
  });
}

/** Serialized form of slot props, matching the decoded `data-ilha-props` attr. */
function serializeSlotProps(props: Record<string, unknown> | undefined): string {
  const safe = slotPropsForAttr(props);
  return safe === undefined ? "" : JSON.stringify(safe);
}

// ---------------------------------------------
// Simplified morph engine
// ---------------------------------------------

// Component libraries (e.g. Areia) reflect bind-driven state onto data-* / aria-*
// presence attrs that SSR templates omit when bind:* is used. Don't let morph
// clobber or strip those controller-owned attrs on any data-slot element.
const MORPH_CONTROLLER_SLOT_SELECTOR = "[data-slot]";
const MORPH_CONTROLLER_ATTRS = new Set([
  // checked/toggle (checkbox, switch, radio, menu items)
  "data-checked",
  "data-unchecked",
  "data-indeterminate",
  "aria-checked",
  // open/closed (dialog, popover, collapsible, dropdown)
  "data-open",
  "data-closed",
  "data-state",
  "aria-expanded",
  "aria-hidden",
  // selection (tabs, toggle-group, combobox, select)
  "data-selected",
  "data-panel-open",
]);

/**
 * Opt-in contract for controller-owned attributes: an element carrying
 * `data-morph-preserve="attr-a attr-b class"` keeps those attributes exactly
 * as they are in the live DOM — the morph neither overwrites nor removes them.
 * The Areia list above stays as a built-in default for `[data-slot]` elements.
 */
const MORPH_PRESERVE_ATTR = "data-morph-preserve";

function shouldPreserveMorphAttr(el: Element, name: string): boolean {
  // The marker itself is imperatively owned — never let a template that
  // omits it strip it (templates that DO emit it can still set it).
  if (name === MORPH_PRESERVE_ATTR) return el.hasAttribute(MORPH_PRESERVE_ATTR);
  const custom = el.getAttribute(MORPH_PRESERVE_ATTR);
  if (custom !== null) {
    for (const token of custom.split(/\s+/)) {
      if (token === name) return true;
    }
  }
  return el.matches(MORPH_CONTROLLER_SLOT_SELECTOR) && MORPH_CONTROLLER_ATTRS.has(name);
}

/** Elements whose imperative state cannot be recreated after a detach —
 * iframes reload, media restarts, canvas pixels vanish. */
const MORPH_IDENTITY_SENSITIVE_SELECTOR = "iframe,video,audio,canvas,embed,object";

/** Dev-only: a positional replace is about to destroy an identity-sensitive
 * element that a `data-key` would have preserved. */
function warnIfMorphDestroys(node: ChildNode): void {
  if (!__DEV__ || !(node instanceof Element)) return;
  const hit = node.matches(MORPH_IDENTITY_SENSITIVE_SELECTOR)
    ? node
    : node.querySelector(MORPH_IDENTITY_SENSITIVE_SELECTOR);
  if (hit) {
    warn(
      `morph: replacing a subtree destroys a <${hit.localName}> element — its state ` +
        `(embedded document, playback position, canvas contents) is lost. Give the ` +
        `element or its containing list items a data-key so the morph can preserve identity.`,
    );
  }
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

/**
 * Morph identity key: explicit `data-key`, or the child-island slot id.
 * Slot hosts are matched by id like keyed list items so a mounted child
 * island's host element is reconciled IN PLACE on parent re-renders — never
 * detached and reinserted, which would blur a focused element inside it.
 */
function morphKeyOf(el: Element): string | null {
  const k = el.getAttribute("data-key");
  if (k !== null) return `k:${k}`;
  const s = el.getAttribute(SLOT_ATTR);
  return s === null ? null : `s:${s}`;
}

function morphChildren(fromParent: Element, toParent: Element): void {
  const toNodes = Array.from(toParent.childNodes);

  // Keyed reconciliation: element children carrying data-key (or a slot id)
  // are matched by key and MOVED into position instead of positionally
  // overwritten, so list reorders preserve element identity — focus,
  // selection, CSS transitions, and any imperatively attached state travel
  // with the element.
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
          // Consume the key so a duplicate data-key later in the new tree
          // cannot steal this node back out of its settled position.
          fromKeyed.delete(toKey);
          if (match !== fromNode) {
            fromParent.insertBefore(match, fromNode ?? null);
            fromNode = match;
          }
        }
      }
      // The from-element at this position belongs to a DIFFERENT surviving
      // key (the to-node is unkeyed, a text/comment node, or a new key) —
      // insert the new child fresh instead of clobbering the survivor. When
      // fromNode is the keyed match itself, its key equals toKey and this
      // guard is skipped.
      if (fromNode instanceof Element) {
        const fromKey = morphKeyOf(fromNode);
        if (fromKey !== null && fromKey !== toKey && toKeys!.has(fromKey)) {
          fromParent.insertBefore(toNode.cloneNode(true), fromNode);
          continue;
        }
      }
    }

    if (!fromNode) {
      fromParent.appendChild(toNode.cloneNode(true));
      continue;
    }

    if (fromNode.nodeType !== toNode.nodeType) {
      warnIfMorphDestroys(fromNode);
      fromParent.replaceChild(toNode.cloneNode(true), fromNode);
      continue;
    }

    if (fromNode.nodeType === 3 || fromNode.nodeType === 8) {
      if (fromNode.nodeValue !== toNode.nodeValue) {
        fromNode.nodeValue = toNode.nodeValue;
      }
      continue;
    }

    if (fromNode.nodeType === 1) {
      const fromEl = fromNode as Element;
      const toEl = toNode as Element;

      if (fromEl.localName !== toEl.localName || fromEl.namespaceURI !== toEl.namespaceURI) {
        warnIfMorphDestroys(fromEl);
        fromParent.replaceChild(toEl.cloneNode(true), fromEl);
        continue;
      }

      // A slot host mid leave-transition no longer participates in matching
      // (its slot id was stripped at teardown). If the template claims this
      // position, replace it outright — the deferred removal then no-ops on
      // the detached element instead of deleting a newly adopted subtree.
      if (fromEl.hasAttribute(LEAVING_ATTR)) {
        fromParent.replaceChild(toEl.cloneNode(true), fromEl);
        continue;
      }

      // Same-id child-island slot host: the mounted child owns this subtree.
      // Patch only the incoming slot props attr and leave everything else —
      // attributes the child island stamped on its host (state snapshots,
      // css markers) and the entire child DOM stay untouched, and the host
      // is never detached (detaching an ancestor of document.activeElement
      // would blur it permanently).
      {
        const slotId = toEl.getAttribute(SLOT_ATTR);
        if (slotId !== null && fromEl.getAttribute(SLOT_ATTR) === slotId) {
          const props = toEl.getAttribute(PROPS_ATTR);
          if (props !== null && fromEl.getAttribute(PROPS_ATTR) !== props) {
            fromEl.setAttribute(PROPS_ATTR, props);
          }
          continue;
        }
      }

      if (
        fromEl.localName === "input" &&
        (fromEl as HTMLInputElement).type !== (toEl as HTMLInputElement).type
      ) {
        fromParent.replaceChild(toEl.cloneNode(true), fromEl);
        continue;
      }

      if (fromEl.localName === "input") {
        // Attributes only set the DEFAULT checked/value; once the user (or a
        // bind write) touches the live property, attribute updates alone no
        // longer reflect in the UI, so a positionally-reused input would keep
        // showing the previous item's state. Mirror the template's attribute
        // into the property — but only when the attribute actually changed,
        // so unrelated re-renders never clobber in-progress user input
        // (same policy as textarea below).
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
        // Like input value/checked: `selected` attributes only set the
        // DEFAULT selection — once the user (or a bind write) touches the
        // live selection, attribute updates alone no longer reflect in the
        // UI. Mirror template-driven `selected` changes into the live
        // property, but never touch the selection when the attributes didn't
        // change, so unrelated re-renders can't clobber the user's choice.
        // Track pre-morph state by option ELEMENT identity, not by index — a
        // keyed reorder moves options, and an index comparison would misread
        // the shifted positions as attribute changes and reset the user's
        // live selection. New options count as previously unselected, so an
        // appended `selected` option triggers the mirror.
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
          // No template-driven change: re-assert each surviving option's live
          // selectedness — some engines recompute it from attributes when an
          // option node is moved, which would silently drop the user's choice.
          for (const o of options) {
            const prev = before.get(o);
            if (prev && o.selected !== prev.live) o.selected = prev.live;
          }
        }
        continue;
      }

      syncAttributes(fromEl, toEl);

      if (fromEl.localName === "textarea") {
        // Only touch the live value when the template's text actually changed;
        // resetting unconditionally would clobber user typing in an unbound
        // textarea every time unrelated state re-renders the parent.
        const newText = toEl.textContent ?? "";
        if (fromEl.textContent !== newText) {
          fromEl.textContent = newText;
          (fromEl as HTMLTextAreaElement).value = newText;
        }
      } else {
        morphChildren(fromEl, toEl);
      }
    }
  }

  // Positions 0..toNodes.length-1 are now correct; anything past that is
  // surplus (including keyed elements whose key disappeared this render).
  while (fromParent.childNodes.length > toNodes.length) {
    fromParent.lastChild!.remove();
  }
}

type MorphFocusSnapshot = {
  active: HTMLElement;
  selection: {
    start: number | null;
    end: number | null;
    dir: "forward" | "backward" | "none" | null;
  } | null;
  range: Range | null;
};

/**
 * Invariant: the morph must never lose focus for an element that survives it.
 * Surviving slot hosts and keyed elements are patched in place, but a genuine
 * reorder still detaches-and-reinserts an ancestor of `document.activeElement`,
 * which blurs it in real engines — snapshot before, restore after.
 */
function snapshotFocusForMorph(): MorphFocusSnapshot | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  let selection: MorphFocusSnapshot["selection"] = null;
  let range: Range | null = null;
  try {
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      selection = {
        start: active.selectionStart,
        end: active.selectionEnd,
        dir: active.selectionDirection,
      };
    } else if (active.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) range = sel.getRangeAt(0).cloneRange();
    }
  } catch {
    // selection APIs are best-effort (type=email inputs throw on selectionStart)
  }
  return { active, selection, range };
}

function restoreFocusAfterMorph(snapshot: MorphFocusSnapshot | null): void {
  if (!snapshot) return;
  const { active, selection, range } = snapshot;
  if (!active.isConnected) return;
  try {
    if (document.activeElement !== active) {
      active.focus({ preventScroll: true });
    }
    // Selection can be disturbed even when focus survives — a template-driven
    // value write moves an input's caret to the end, and morphing text nodes
    // inside a contenteditable collapses its range. Restore in both cases;
    // skip when the live selection already matches, so no-op morphs stay
    // side-effect free.
    if (selection && selection.start !== null) {
      const el = active as HTMLInputElement;
      if (el.selectionStart !== selection.start || el.selectionEnd !== selection.end) {
        el.setSelectionRange(selection.start, selection.end, selection.dir ?? "none");
      }
    }
    if (range && range.startContainer.isConnected) {
      const sel = window.getSelection();
      if (sel) {
        const current = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        const matches =
          current !== null &&
          current.startContainer === range.startContainer &&
          current.startOffset === range.startOffset &&
          current.endContainer === range.endContainer &&
          current.endOffset === range.endOffset;
        if (!matches) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }
  } catch {
    // focus/selection restore is best-effort
  }
}

function morphInner(from: Element, to: Element): void {
  if (from.localName !== to.localName || from.namespaceURI !== to.namespaceURI)
    throw new Error("[ilha] morph: elements must match");
  const focus = snapshotFocusForMorph();
  morphChildren(from, to);
  restoreFocusAfterMorph(focus);
}

// ---------------------------------------------
// Internal helpers
// ---------------------------------------------

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (value == null || typeof value !== "object") return false;
  const std = (value as StandardSchemaV1)["~standard"];
  return std != null && typeof std.validate === "function" && std.version === 1;
}

function validateSchema<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
): StandardSchemaV1.InferOutput<S> {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) throw new Error("[ilha] Async schemas are not supported.");
  if (result.issues)
    throw new Error(
      `[ilha] Validation failed:\n${result.issues.map((i) => `  - ${i.message}`).join("\n")}`,
    );
  return result.value as StandardSchemaV1.InferOutput<S>;
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ESC[c]!);
}

function dedentString(str: string): string {
  if (str.length === 0 || str[0] !== "\n") return str;
  const lines = str.split("\n");
  while (lines.length && lines[0]!.trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (!lines.length) return "";
  const indent = Math.min(
    ...lines.filter((l) => l.trim() !== "").map((l) => l.match(/^(\s*)/)![1]!.length),
  );
  return lines.map((l) => l.slice(indent)).join("\n");
}

// ---------------------------------------------
// Symbols & constants
// ---------------------------------------------

// Symbol.for keeps brands stable when Vite/Rollup dedupe fails and multiple
// ilha copies end up in the same page (e.g. app + Areia peer import).
const RAW = Symbol.for("ilha.raw");
const SIGNAL_ACCESSOR = Symbol.for("ilha.signalAccessor");
const ISLAND = Symbol.for("ilha.island");
const ISLAND_CALL = Symbol.for("ilha.islandCall");
/** @internal Internal hook used by a parent's mountSlots to mount a child island and
 * retain a handle to push updated props into it on subsequent parent
 * re-renders. Not part of the public surface. */
export const ISLAND_MOUNT_INTERNAL = Symbol.for("ilha.islandMountInternal");
const ISLAND_SLOT_TAG = Symbol.for("ilha.islandSlotTag");

/** @internal Live mount handles keyed by host element. Lets @ilha/router adopt
 * islands hydrated by `ilha.mount()` (whose handles it never saw) and push new
 * loader props into them in place instead of remounting. Entries are removed
 * on unmount. Not part of the public surface. */
export const ISLAND_MOUNT_HANDLES: WeakMap<
  Element,
  {
    unmount: () => void | Promise<void>;
    updateProps: (props?: Record<string, unknown>) => void;
  }
> = new WeakMap();

const SLOT_ATTR = "data-ilha-slot";
/** Marks a slot host whose child island is mid leave-transition: it has been
 * unmounted (and its slot id stripped) but stays connected so the leave
 * animation can paint. The morph replaces such elements instead of matching
 * or mutating them. */
const LEAVING_ATTR = "data-ilha-leaving";
const PROPS_ATTR = "data-ilha-props";
const STATE_ATTR = "data-ilha-state";
const CSS_ATTR = "data-ilha-css";

// ---------------------------------------------
// CSS scoping
// ---------------------------------------------
//
// Wrap the user's CSS in an @scope rule bounded by the island host (upper) and
// any nested island root (lower). This gives us:
//   - Selectors resolved against the host's descendants only
//   - Low-specificity selectors that don't win cascade wars with utilities
//   - A donut hole at every `[data-ilha]` descendant so parent styles don't
//     leak into child islands
//
// The resulting <style> element is emitted as the first child of the host on
// every render. Because it's deterministically the same node on both `from`
// and `to` sides of the morph, `morphChildren` sees a matching <style> and
// leaves it alone — no flicker, no re-parse, no special-case code in the morph.
function buildScopedStyle(css: string): string {
  // Prevent a stray "</style" in author CSS from breaking out of the element.
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  return `<style ${CSS_ATTR}>@scope (:scope) to ([data-ilha]){${safeCss}}</style>`;
}

export interface RawHtml {
  [RAW]: true;
  value: string;
}

// ---------------------------------------------
// Render-time composition: island interpolation
// ---------------------------------------------
//
// Islands are directly interpolatable inside html``. When interpolateValue sees
// an Island (or an IslandCall, produced by calling an Island as a function or
// via .key()), it:
//   1. Generates a stable slot id — either user-supplied via .key() or
//      positional based on appearance order within the current render frame.
//   2. Records { id -> { island, props } } in the active RenderContext so the
//      parent's mount pass can look it up and mount the child onto the slot.
//   3. Emits <tag data-ilha-slot="{id}" data-ilha-props="...">{child SSR}</tag>
//      (tag from child island .as(), default div) — data-* attrs let hydration
//      recover props without the map.
//
// Nested islands: each island's renderToString pushes its own RenderContext
// onto the stack, so child-of-child interpolations are scoped to the correct
// parent. The stack is thread-safe because rendering is synchronous (derived
// resolution happens before fn() is called, not during).

interface IslandCall {
  [ISLAND_CALL]: true;
  island: AnyIsland;
  props: Record<string, unknown> | undefined;
  key: string | undefined;
}

interface IslandRenderCtx {
  // Slot id -> island to mount, populated during interpolation.
  slots: Map<string, { island: AnyIsland; props: Record<string, unknown> | undefined }>;
  // Monotonic counter for positional keys (first bare ${Island} = "0", etc.).
  positional: number;
  // When set (client re-render), emitIslandSlot reuses the live child subtree's
  // outerHTML instead of re-running child SSR. This keeps morph from walking
  // into the child and clobbering state-managed DOM.
  liveHost: Element | undefined;
  // When set, emitIslandSlot will attempt async child-island rendering.
  // Populated during SSR when the parent itself is in async mode, so child
  // islands with async derived() can be properly awaited instead of emitting
  // loading markup.
  pending: Map<string, Promise<string>> | undefined;
  // Template-emitted bindings (bind:value=${signal}, etc). Each interpolation
  // site that matched a bind: prefix records its accessor and binding kind
  // here, and emits a data-ilha-bind sentinel attribute referencing the
  // entry by index. Mount-time wiring reads these back out.
  binds: BindRecord[];
}

type BindKind =
  | "value"
  | "checked"
  | "valueAsNumber"
  | "valueAsDate"
  | "files"
  | "open"
  | "group"
  | "this";

interface BindRecord {
  kind: BindKind;
  accessor: ExternalSignal;
}

// Shared across duplicate ilha copies in one realm (app + component library).
// Module-local stacks break nested islands: a child island closed over copy B
// cannot see the parent render context from copy A, so it SSR-stringifies
// instead of returning an IslandCall and the parent only records a slot shell.
const RENDER_CTX_STACK = Symbol.for("ilha.renderCtxStack");

function renderCtxStack(): IslandRenderCtx[] {
  const g = globalThis as typeof globalThis & { [RENDER_CTX_STACK]?: IslandRenderCtx[] };
  return (g[RENDER_CTX_STACK] ??= []);
}

function pushRenderCtx(liveHost?: Element, asyncChildren?: boolean): IslandRenderCtx {
  const ctx: IslandRenderCtx = {
    slots: new Map(),
    positional: 0,
    liveHost,
    pending: asyncChildren ? new Map() : undefined,
    binds: [],
  };
  renderCtxStack().push(ctx);
  return ctx;
}

function popRenderCtx(): void {
  renderCtxStack().pop();
}

function currentRenderCtx(): IslandRenderCtx | undefined {
  const stack = renderCtxStack();
  return stack[stack.length - 1];
}

// Brand checks use `Symbol.for`, which resolves to the SAME symbol across
// duplicate ilha copies in one realm — no description-scanning fallback needed.
function isIsland(v: unknown): v is AnyIsland {
  return typeof v === "function" && ISLAND in (v as object);
}

function isIslandCall(v: unknown): v is IslandCall {
  // IslandCall objects are produced by in-interpolation calls (plain objects);
  // KeyedIsland callables produced by .key() are functions that ALSO carry the
  // ISLAND_CALL brand but need to be invoked (with no props) when interpolated
  // bare. Both paths converge in interpolateValue.
  if (v == null || (typeof v !== "object" && typeof v !== "function")) return false;
  if (ISLAND_CALL in (v as object)) return true;
  return typeof v === "object" && "island" in v && isIsland((v as IslandCall).island);
}

// Emit a slot marker for an island at this interpolation site.
// Records the slot in the active render context so mount can find it.
function emitIslandSlot(
  island: AnyIsland,
  props: Record<string, unknown> | undefined,
  key: string | undefined,
): string {
  const ctx = currentRenderCtx();

  // Assign id: user key wins; otherwise use positional index. Keys are
  // prefixed to avoid collision with positional ids in the same render.
  let id: string;
  if (key !== undefined) {
    id = `k:${key}`;
    if (ctx && __DEV__ && ctx.slots.has(id)) {
      warn(
        `Duplicate slot key "${key}" — two children with the same key in a ` +
          `single render will collide. Each .key() call must be unique.`,
      );
    }
  } else {
    id = ctx ? `p:${ctx.positional++}` : "p:0";
  }

  if (ctx) ctx.slots.set(id, { island, props });

  const slotTag = getIslandSlotTag(island);

  const attrProps = slotPropsForAttr(props);
  const propsAttr = attrProps ? ` ${PROPS_ATTR}='${escapeHtml(JSON.stringify(attrProps))}'` : "";

  // Client re-render path: emit an EMPTY stub. Post-morph, mountSlots rehomes
  // the preserved live slot element (with all its mounted children, listeners,
  // and state) into the stub's position. The morph therefore never walks into
  // a slot subtree — it just places a stub, and we swap the stub for the real
  // thing afterwards. New (not-yet-mounted) slots stay as stubs and get mounted
  // by mountSlots.
  if (ctx?.liveHost) {
    return wrapIslandSlotHtml(slotTag, id, propsAttr, "");
  }

  // SSR path: render the child's HTML inline.
  //
  // When async child rendering is enabled (ctx.pending is set — the parent
  // itself is in async SSR mode), pop the render context so island(props)
  // invokes renderToString (the SSR path) instead of returning an IslandCall.
  // This allows child islands with async derived() to be properly awaited
  // instead of emitting loading markup.
  if (ctx?.pending) {
    popRenderCtx();
    try {
      const result = island(props as Record<string, unknown>);

      if (result instanceof Promise) {
        // Store the pending render for later resolution by renderWithCtx.
        ctx.pending.set(id, result.then(String));
        // Emit a stub containing a unique comment marker; resolveAsyncChildren
        // replaces the marker with the resolved inner HTML. Escaped
        // interpolations can never produce the marker text (it contains `<`).
        return wrapIslandSlotHtml(slotTag, id, propsAttr, asyncSlotMarker(id));
      }

      // Child rendered synchronously — inline its HTML as usual.
      return wrapIslandSlotHtml(slotTag, id, propsAttr, String(result));
    } finally {
      renderCtxStack().push(ctx);
    }
  }

  // Sync SSR path (no async children support). The child's renderToString
  // pushes its own render context so grandchildren are scoped correctly.
  const inner = island.toString(props);
  return wrapIslandSlotHtml(slotTag, id, propsAttr, inner);
}

// Unique inline placeholder for an async child's HTML. HTML comments survive
// intact inside the parent's output string, and escaped interpolations cannot
// forge one (escapeHtml encodes `<`), so exact string substitution is safe.
function asyncSlotMarker(id: string): string {
  return `<!--ilha-async:${escapeHtml(id)}-->`;
}

// After the parent's render function has produced HTML with marker stubs for
// async children, await each pending child and substitute its resolved HTML
// in place of the marker. Returns the final HTML string.
async function resolveAsyncChildren(
  html: string,
  pending: Map<string, Promise<string>>,
): Promise<string> {
  for (const [id, promise] of pending) {
    const inner = await promise;
    html = html.split(asyncSlotMarker(id)).join(inner);
  }
  return html;
}

// ---------------------------------------------
// Signal accessor
// ---------------------------------------------

interface MarkedSignalAccessor<T> {
  (): T;
  (...args: [value: T]): void;
  select<S>(selector: (state: T) => S): MarkedSignalAccessor<S>;
  [SIGNAL_ACCESSOR]: true;
}

function markSignalAccessor<T>(fn: { (): T; (value: T): void }): MarkedSignalAccessor<T> {
  (fn as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
  const accessor = fn as MarkedSignalAccessor<T>;
  accessor.select = <S>(selector: (state: T) => S) => createSelectAccessor(accessor, selector);
  return accessor;
}

function isSignalAccessor(v: unknown): v is MarkedSignalAccessor<unknown> {
  return typeof v === "function" && SIGNAL_ACCESSOR in (v as object);
}

// ---------------------------------------------
// Nested accessors via SignalAccessor.select()
// ---------------------------------------------

type PathSegment = string | number;

function getAtPath(obj: unknown, path: readonly PathSegment[]): unknown {
  let cur = obj;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

function setAtPath(obj: unknown, path: readonly PathSegment[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(obj)) {
    const idx = head as number;
    if (idx < 0 || idx >= obj.length) return obj;
    const next = obj[idx];
    const updated = rest.length === 0 ? value : setAtPath(next, rest, value);
    if (Object.is(next, updated)) return obj;
    const copy = obj.slice();
    copy[idx] = updated;
    return copy;
  }
  if (obj !== null && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    const key = String(head);
    const next = record[key];
    const updated = rest.length === 0 ? value : setAtPath(next, rest, value);
    if (rest.length === 0) {
      if (Object.is(next, value)) return obj;
    } else if (Object.is(next, updated)) {
      return obj;
    }
    return { ...record, [key]: updated };
  }
  return rest.length === 0 ? value : setAtPath(undefined, rest, value);
}

function toPathSegment(prop: string | symbol): PathSegment | null {
  if (typeof prop === "symbol") return null;
  if (prop === "length") return null;
  if (/^\d+$/.test(prop)) return Number(prop);
  return prop;
}

function trackSelectPath<T, S>(rootState: T, selector: (state: T) => S): readonly PathSegment[] {
  const path: PathSegment[] = [];
  const track = (value: unknown): unknown => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      return value;
    }
    return new Proxy(value as object, {
      get(target, prop, receiver) {
        const seg = toPathSegment(prop);
        if (seg != null) path.push(seg);
        const next = Reflect.get(target, prop, receiver);
        return seg != null && next !== null && typeof next === "object" ? track(next) : next;
      },
    });
  };
  selector(track(rootState) as T);
  return path;
}

function createSelectAccessor<T, S>(
  root: MarkedSignalAccessor<T>,
  selector: (state: T) => S,
): MarkedSignalAccessor<S> {
  const path = trackSelectPath(root(), selector);
  const selected = selector(root());
  const resolved = path.length === 0 ? root() : getAtPath(root(), path);
  if (!Object.is(selected, resolved)) {
    const msg =
      "select(): selector must only traverse nested properties or array indexes — derived or transformed values are not supported.";
    if (__DEV__) warn(msg);
    throw new Error(msg);
  }
  if (__DEV__ && path.length === 0) {
    warn(
      "select(): selector did not traverse nested state — bind writes may replace the entire root value.",
    );
  }
  return markSignalAccessor((...args: unknown[]): unknown => {
    if (args.length === 0) {
      return path.length === 0 ? selector(root()) : (getAtPath(root(), path) as S);
    }
    const next = path.length === 0 ? (args[0] as T) : (setAtPath(root(), path, args[0]) as T);
    if (!Object.is(root(), next)) root(next);
  }) as MarkedSignalAccessor<S>;
}

// ---------------------------------------------
// Public helpers
// ---------------------------------------------

function ilhaRaw(value: string): RawHtml {
  return { [RAW]: true, value };
}

// Plain passthrough tagged template for CSS. This exists purely for editor
// tooling — it lets authors tag their stylesheets as `css\`…\`` so LSPs and
// Prettier plugins can syntax-highlight and format the contents. No runtime
// magic: the result is just the interpolated string, identical to what you'd
// get from a plain template literal.
function ilhaCss(strings: TemplateStringsArray | string, ...values: (string | number)[]): string {
  if (typeof strings === "string") return strings;
  let result = "";
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) result += String(values[i]);
  }
  return result;
}

// ---------------------------------------------
// Resolves any interpolated value to an HTML string.
// Arrays are joined with "" — each item is recursively resolved.
// This means string[] is escaped per-item, RawHtml[] is passed through raw,
// and mixed arrays work correctly. No comma-joining ever occurs.
function interpolateValue(v: unknown): string {
  if (v == null || v === true || v === false) return "";
  if (Array.isArray(v)) return v.map(interpolateValue).join("");
  if (isRawHtml(v)) return v.value;
  if (isIslandCall(v)) {
    // A KeyedIsland (e.g. `Item.key("a")`) is a callable branded IslandCall —
    // calling it with no props yields the concrete IslandCall. A plain
    // IslandCall (e.g. `Item({...})`) is already concrete.
    const call = typeof v === "function" ? (v as () => IslandCall)() : v;
    return emitIslandSlot(call.island, call.props, call.key);
  }
  if (isIsland(v)) return emitIslandSlot(v, undefined, undefined);
  if (isSignalAccessor(v)) return escapeHtml(v());
  if (typeof v === "function") return escapeHtml((v as () => unknown)());
  return escapeHtml(v);
}

// ---------------------------------------------
// bind: template syntax
// ---------------------------------------------
//
// `<input bind:value=${state.name}>` and similar are detected during
// template assembly by ilhaHtml. The regex below scans the trailing static
// chunk for `bind:NAME=` (optionally with an opening quote) immediately
// before an interpolation. When matched:
//
//   1. The matched portion is stripped from the static chunk.
//   2. If a closing quote follows the interpolation in the next static
//      chunk, it's stripped too.
//   3. The interpolated signal accessor is recorded in the active render
//      context's `binds` array; the index is the binding's id.
//   4. The canonical SSR output for the kind is emitted (e.g. `value="V"`,
//      `checked`, `open`), plus a `data-ilha-bind="KIND:INDEX"` sentinel
//      that mount-time wiring reads to attach the listener and reflection.
//
// Mount-time wiring lives in applyTemplateBindings — it walks the host for
// `[data-ilha-bind]` and uses resolveBindOps for the canonical
// property/event mapping per kind.
const BIND_VALID_KINDS = new Set<BindKind>([
  "value",
  "checked",
  "valueAsNumber",
  "valueAsDate",
  "files",
  "open",
  "group",
  "this",
]);

// Matches a `bind:NAME=` (with optional opening `"` or `'`) at the end of a
// static chunk. The trailing chunk position is enforced by the `$` anchor.
const BIND_PREFIX_RE = /\bbind:([a-zA-Z]+)\s*=\s*("|')?$/;

// Find the first `>` in a static chunk that actually closes the open tag,
// skipping any `>` inside a quoted attribute value (e.g. placeholder="a > b").
// `initialQuote` carries quote state across chunk boundaries (an interpolation
// can sit inside a quoted attribute value; interpolated values themselves are
// entity-escaped and never alter quote state). Returns the index of the
// closing `>` (-1 if none) plus the quote state at the end of the chunk.
function findTagCloseIndex(
  chunk: string,
  initialQuote: '"' | "'" | null,
): { index: number; quote: '"' | "'" | null } {
  let quote = initialQuote;
  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return { index: i, quote };
    }
  }
  return { index: -1, quote };
}

// Format a Date for an <input type=date|datetime-local|time|month|week>.
// We pick `date` semantics by default; users wanting datetime-local should
// pre-format the string themselves on the value side.
function formatDateForInput(d: unknown): string {
  if (d instanceof Date) {
    if (isNaN(d.getTime())) {
      if (__DEV__)
        warn("bind:valueAsDate received an invalid Date object — value attribute will be empty.");
      return "";
    }
    // YYYY-MM-DD
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return "";
}

// Try to extract the element's static `value="..."` attribute from the
// trailing prefix of the current open tag. Used for SSR reflection of
// bind:group on radio/checkbox inputs, where the runtime needs the
// element's option-value to decide whether to emit `checked`. Returns
// null when no static value is found in the prefix — the most common
// cause is the value is itself interpolated, in which case SSR
// reflection is skipped and hydration covers it.
function extractElementStaticValue(prefix: string): string | null {
  // Walk backwards from the end of the prefix until we find the opening
  // '<' of the current tag. Anything past that is a different element.
  const lastOpen = prefix.lastIndexOf("<");
  if (lastOpen === -1) return null;
  const tagPrefix = prefix.slice(lastOpen);
  // Skip if a '>' appears between lastOpen and end — that would mean the
  // tag already closed and bind:group is somehow stray text.
  if (tagPrefix.includes(">")) return null;
  const m = tagPrefix.match(/\bvalue\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

// Emit the canonical SSR attribute(s) for a binding, plus the sentinel.
// Returns [valueAttrs, specFragment] — valueAttrs are HTML attributes to
// inject into the element (may be empty for ref/file bindings), and
// specFragment is the sentinel token for the combined data-ilha-bind attr.
function emitBindSSR(
  kind: BindKind,
  index: number,
  accessor: ExternalSignal,
  prefixForStaticPeek: string,
): [string, string] {
  const spec = `${kind}:${index}`;
  // Reflect current value into output attributes. The morph engine will
  // pick this up on subsequent renders. For boolean attributes we emit
  // the bare attribute name without a value (HTML spec compliant).
  let v: unknown;
  try {
    v = accessor();
  } catch {
    v = undefined;
  }
  switch (kind) {
    case "value":
      return [` value="${escapeHtml(v ?? "")}"`, spec];
    case "valueAsNumber":
      return [` value="${escapeHtml(v == null ? "" : String(v))}"`, spec];
    case "valueAsDate":
      return [` value="${escapeHtml(formatDateForInput(v))}"`, spec];
    case "checked":
      return [v ? ` checked` : ``, spec];
    case "open":
      return [v ? ` open` : ``, spec];
    case "files":
      // File inputs cannot carry their selected files in HTML output;
      // mount-time wiring is read-only-into-state for this kind.
      // No attribute reflection — sentinel only.
      return [``, spec];
    case "this":
      // Pure ref binding — no observable, no reflection.
      // No attribute reflection — sentinel only.
      return [``, spec];
    case "group": {
      // Try to determine this element's option value from the static
      // prefix. If the signal value (or array, for checkbox groups)
      // matches, emit `checked`.
      const optionValue = extractElementStaticValue(prefixForStaticPeek);
      if (optionValue == null) return [``, spec];
      const isMatched = Array.isArray(v)
        ? v.map(String).includes(optionValue)
        : v != null && String(v) === optionValue;
      return [isMatched ? ` checked` : ``, spec];
    }
  }
}

// html`` now returns RawHtml instead of string so that arrays of html`` results
// (e.g. from .map()) can be passed directly as interpolated values in a parent
// html`` without triggering JS's default Array.toString() comma-joining.
//
// Also scans static chunks for the `bind:NAME=${signal}` template syntax,
// stripping the prefix and registering the binding with the active render
// context. The output carries a `data-ilha-bind="kind:index"` sentinel that
// mount-time wiring reads back to attach listeners and reflect updates.
function ilhaHtml(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  let result = "";
  // We may need to strip a closing quote from the *next* static chunk when
  // the current interpolation matched a quoted bind: prefix. Track that
  // pending strip with this flag.
  let stripLeadingQuote: '"' | "'" | null = null;
  // Accumulate bind specs for the current open tag and emit as a single
  // data-ilha-bind attribute before the closing `>`.
  let pendingBindSpecs = "";
  // Quote state carried across chunks while bind specs are pending, so a `>`
  // inside a quoted attribute value is not mistaken for the tag close.
  let pendingQuote: '"' | "'" | null = null;
  const ctx = currentRenderCtx();

  for (let i = 0; i < strings.length; i++) {
    let chunk = strings[i]!;
    if (stripLeadingQuote !== null) {
      // Eat one leading quote of the matching kind, if present.
      if (chunk.startsWith(stripLeadingQuote)) {
        chunk = chunk.slice(1);
      }
      stripLeadingQuote = null;
    }

    // If the chunk contains a closing `>`, emit any pending bind specs
    // right before the first `>` so they land inside the open tag.
    if (pendingBindSpecs !== "") {
      const { index: gtIdx, quote } = findTagCloseIndex(chunk, pendingQuote);
      if (gtIdx !== -1) {
        // Drop a self-closing `/` (plus surrounding whitespace) so the
        // sentinel lands as the last attribute: `<input ... data-ilha-bind>`.
        const head = chunk.slice(0, gtIdx).replace(/\s*\/\s*$/, "");
        chunk = head + ` data-ilha-bind="${pendingBindSpecs}">` + chunk.slice(gtIdx + 1);
        pendingBindSpecs = "";
        pendingQuote = null;
      } else {
        pendingQuote = quote;
      }
    }

    if (i >= values.length) {
      result += chunk;
      continue;
    }

    const value = values[i];
    const m = chunk.match(BIND_PREFIX_RE);

    if (m && isSignalAccessor(value)) {
      const name = m[1]!;
      const openQuote = (m[2] ?? null) as '"' | "'" | null;

      if (!BIND_VALID_KINDS.has(name as BindKind)) {
        if (__DEV__) {
          warn(
            `Unknown bind:${name} — supported bindings are ` +
              `${[...BIND_VALID_KINDS].map((k) => `bind:${k}`).join(", ")}.`,
          );
        }
        // Fall through to default interpolation.
        result += chunk + interpolateValue(value);
        continue;
      }

      if (!ctx) {
        // No active render context (e.g. html`` invoked at module top
        // level outside an island render). Bindings only work inside a
        // .render() body; emit plain reflection without sentinel so the
        // output still has the signal's current value, and warn in dev.
        if (__DEV__) {
          warn(
            `bind:${name} used outside an island render — bindings only ` +
              `work in .render(). The value is reflected once but not wired.`,
          );
        }
        const stripped = chunk.slice(0, chunk.length - m[0]!.length);
        // Emit the canonical attribute (name=value) without the sentinel so
        // the output is valid HTML even outside a render context.
        // interpolateValue already HTML-escapes primitives; RawHtml values
        // pass through unescaped (author's responsibility).
        const quote = openQuote ?? '"';
        result += stripped + name + "=" + quote + interpolateValue(value) + quote;
        if (openQuote) stripLeadingQuote = openQuote;
        continue;
      }

      // Strip the matched `bind:NAME=` plus optional opening quote from
      // the chunk; the leading whitespace before `bind:` is preserved by
      // the regex (it's not in the match), but the match starts at the
      // word boundary `bind`. Note that there's typically a space before
      // bind: (between attributes), which we leave alone — the emitted
      // sentinel starts with its own leading space.
      const matchStart = chunk.length - m[0]!.length;
      const prefixBeforeBind = chunk.slice(0, matchStart);
      // Trim trailing whitespace before bind: because emitBindSSR's output
      // starts with its own space.
      const cleanPrefix = prefixBeforeBind.replace(/\s+$/, "");

      const index = ctx.binds.length;
      ctx.binds.push({ kind: name as BindKind, accessor: value as ExternalSignal });

      const [valueAttrs, spec] = emitBindSSR(
        name as BindKind,
        index,
        value as ExternalSignal,
        cleanPrefix,
      );
      result += cleanPrefix + valueAttrs;
      pendingBindSpecs += (pendingBindSpecs ? "," : "") + spec;

      if (openQuote) stripLeadingQuote = openQuote;
      continue;
    }

    if (m && __DEV__) {
      warn(
        `bind:${m[1]} requires a signal accessor — got ${typeof value}. ` +
          `Use ilha.signal() or a .state() accessor.`,
      );
    }

    result += chunk + interpolateValue(value);
  }
  // Emit any remaining pending bind specs (e.g. if the last chunk had no `>`).
  if (pendingBindSpecs !== "") {
    result += ` data-ilha-bind="${pendingBindSpecs}"`;
  }
  return { [RAW]: true, value: dedentString(result) };
}

function isRawHtml(v: unknown): v is RawHtml {
  if (typeof v !== "object" || v === null) return false;
  return RAW in v && typeof (v as RawHtml).value === "string";
}

// Unwrap a RawHtml or plain string to a string — used at render boundaries.
function unwrapHtml(v: string | RawHtml): string {
  return isRawHtml(v) ? v.value : (v as string);
}

// ---------------------------------------------
// Context registry
// ---------------------------------------------

type ContextSignal<T> = { (): T; (value: T): void };
const contextRegistry = new Map<string, ContextSignal<unknown>>();

function ilhaContextFn<T>(key: string, initial: T): ContextSignal<T> {
  if (contextRegistry.has(key)) return contextRegistry.get(key) as ContextSignal<T>;
  const s = signal(initial);
  const accessor = (...args: unknown[]): unknown => {
    if (args.length === 0) return s();
    s(args[0] as T);
  };
  contextRegistry.set(key, accessor as ContextSignal<unknown>);
  return accessor as ContextSignal<T>;
}

// The registry is module-level and otherwise append-only; long-lived SPAs or
// HMR cycles that mint dynamic keys need a way to release entries. Deleting a
// key does not affect accessors already handed out — they keep their signal —
// it only makes the next context(key, …) call create a fresh one.
const ilhaContext = Object.assign(ilhaContextFn, {
  /** Remove a context signal from the registry. Returns true if it existed. */
  delete(key: string): boolean {
    return contextRegistry.delete(key);
  },
  /** Remove all context signals from the registry (e.g. between tests). */
  clear(): void {
    contextRegistry.clear();
  },
});

// ---------------------------------------------
// Top-level reactive helpers
// ---------------------------------------------

/**
 * Create a free-standing reactive signal that lives outside any island.
 * Useful for sharing state across islands without prop drilling, or for
 * binding form inputs to module-level state via the `bind:value=${signal}`
 * template syntax.
 *
 * The returned accessor is a getter when called with no arguments and a
 * setter when called with one. Reading it inside a `.derived()`, `.effect()`,
 * or `.render()` automatically subscribes the surrounding reactive scope —
 * so when the signal changes, dependents re-run as if it were local state.
 */
export function ilhaSignal<T>(initial: T): SignalAccessor<T> {
  const s = signal(initial);
  return markSignalAccessor((...args: unknown[]): unknown => {
    if (args.length === 0) return s();
    s(args[0] as T);
  }) as SignalAccessor<T>;
}

/**
 * Create a free-standing read-only reactive value derived from other signals.
 * The computation is lazy and cached: `fn` re-runs only when a signal it read
 * changed and the computed is read again. Reading it inside a `.derived()`,
 * `.effect()`, `.render()`, or top-level `effect()` subscribes that scope —
 * dependents re-run when the computed's value changes.
 *
 * ```ts
 * const items = ilha.signal([1, 2, 3]);
 * const total = ilha.computed(() => items().reduce((a, b) => a + b, 0));
 * ```
 */
function ilhaComputed<T>(fn: () => T): SignalAccessor<T> {
  const c = computed(fn);
  return markSignalAccessor((...args: unknown[]): unknown => {
    if (args.length > 0) {
      if (__DEV__) warn("computed() values are read-only — the write was ignored.");
      return;
    }
    return c();
  }) as SignalAccessor<T>;
}

/**
 * Run a free-standing reactive effect outside any island. `fn` runs once
 * immediately and again whenever a signal it read changes. It may return a
 * cleanup function, invoked before each re-run and on stop. Signal writes
 * inside the effect are batched. Returns a stop function that disposes the
 * effect and runs the final cleanup.
 *
 * ```ts
 * const stop = effect(() => {
 *   document.title = `${cart.count()} items`;
 * });
 * ```
 */
function ilhaEffect(fn: () => void | (() => void)): () => void {
  let cleanup: void | (() => void);
  const runCleanup = () => {
    if (typeof cleanup === "function") {
      try {
        cleanup();
      } catch (err) {
        console.error(err);
      }
      cleanup = undefined;
    }
  };
  const stop = effect(() => {
    runCleanup();
    startBatch();
    try {
      cleanup = fn();
    } catch (err) {
      console.error(err);
    } finally {
      endBatch();
    }
  });
  return () => {
    stop();
    runCleanup();
  };
}

/**
 * Run `fn` with reactive tracking suspended. Reading signals inside `fn`
 * returns their current value without subscribing the surrounding scope.
 * Use this in effects/deriveds when you want to peek at state without
 * causing a re-run on its changes.
 */
export function untrack<T>(fn: () => T): T {
  const prev = setActiveSub(undefined);
  try {
    return fn();
  } finally {
    setActiveSub(prev);
  }
}

/**
 * Run `fn` as an atomic batch — multiple signal writes inside the callback
 * produce a single propagation pass, so dependents (effects, deriveds,
 * island re-renders) see the final state and run once instead of once per
 * write. Returns whatever `fn` returns.
 *
 * Note: `.on()` handlers and `.effect()` runs are batched implicitly, so
 * you only need this when triggering multiple writes from outside an
 * island (e.g. from a top-level event listener or async callback).
 */
export function batch<T>(fn: () => T): T {
  startBatch();
  try {
    return fn();
  } finally {
    endBatch();
  }
}

// ---------------------------------------------
// Derived
// ---------------------------------------------

export interface DerivedValue<T> {
  loading: boolean;
  value: T | undefined;
  error: Error | undefined;
}

export type DerivedAccessor<T> = {
  readonly loading: boolean;
  readonly value: T | undefined;
  readonly error: Error | undefined;
  (): T | undefined;
  (value: T): void;
};

function createDerivedAccessor<T>(
  read: () => DerivedValue<T>,
  write?: (value: T) => void,
): DerivedAccessor<T> {
  const accessor = markSignalAccessor((...args: unknown[]): T | undefined => {
    if (args.length > 0) {
      if (write) write(args[0] as T);
      else if (__DEV__) warn("derived values are read-only");
      return;
    }
    return read().value;
  });

  return new Proxy(accessor, {
    get(target, prop, receiver) {
      if (prop === "loading" || prop === "value" || prop === "error") {
        return read()[prop as keyof DerivedValue<T>];
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as DerivedAccessor<T>;
}

function defaultDerivedAccessor(): DerivedAccessor<unknown> {
  return createDerivedAccessor<unknown>(() => ({
    loading: false,
    value: undefined,
    error: undefined,
  }));
}

function buildDerivedAccessors<TDerivedMap extends Record<string, unknown>>(
  envelopes: Record<string, DerivedValue<unknown>>,
): IslandDerived<TDerivedMap> {
  const accessors = new Map<string, DerivedAccessor<unknown>>();
  for (const [key, envelope] of Object.entries(envelopes)) {
    accessors.set(
      key,
      createDerivedAccessor(
        () => envelope,
        (value) => {
          envelope.loading = false;
          envelope.value = value;
          envelope.error = undefined;
        },
      ),
    );
  }
  return new Proxy({} as IslandDerived<TDerivedMap>, {
    get(_, key) {
      // Symbol keys (Symbol.toPrimitive, Symbol.iterator, …) reach this trap
      // during coercion/spreads; handing them a fresh accessor function
      // produces confusing behavior — report them as absent instead.
      if (typeof key !== "string") return undefined;
      return accessors.get(key) ?? defaultDerivedAccessor();
    },
  });
}

type DerivedFnContext<TInput, TStateMap extends Record<string, unknown>> = {
  state: IslandState<TStateMap>;
  input: TInput;
  signal: AbortSignal;
};

type DerivedFn<TInput, TStateMap extends Record<string, unknown>, V> = (
  ctx: DerivedFnContext<TInput, TStateMap>,
) => V | Promise<V>;

interface DerivedEntry<TInput, TStateMap extends Record<string, unknown>> {
  key: string;
  fn: DerivedFn<TInput, TStateMap, unknown>;
}

export type IslandDerived<TDerivedMap extends Record<string, unknown>> = {
  readonly [K in keyof TDerivedMap]: DerivedAccessor<TDerivedMap[K]>;
};

function createDerivedProxy<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
>(
  entries: DerivedEntry<TInput, TStateMap>[],
  state: IslandState<TStateMap>,
  input: TInput,
  derivedSnapshot?: Record<string, DerivedValue<unknown>>,
): { proxy: IslandDerived<TDerivedMap>; setup: () => () => void } {
  const envelopes = new Map<string, ReturnType<typeof signal<DerivedValue<unknown>>>>();

  for (const entry of entries) {
    let initialEnvelope: DerivedValue<unknown>;

    if (derivedSnapshot != null && entry.key in derivedSnapshot) {
      initialEnvelope = { ...(derivedSnapshot[entry.key] as DerivedValue<unknown>) };
    } else {
      // Probe the derived function to compute an initial value for onMount.
      // Skip async functions to avoid triggering their side effects twice
      // (once here, once in the reactive effect). The heuristic checks the
      // constructor name, which works for native async functions; transpiled
      // async fns fall back to not eagerly computing (safe — the effect
      // handles them).
      // Note: the probe calls entry.fn once synchronously. If the derived fn
      // has observable side effects (beyond reading signals), those effects
      // fire twice on mount — once here and once in setup(). Pure computed
      // functions are fine.
      const looksAsync =
        entry.fn.constructor.name === "AsyncFunction" ||
        entry.fn.constructor.name === "AsyncGeneratorFunction";
      if (!looksAsync) {
        const ac = new AbortController();
        try {
          const result = entry.fn({ state, input, signal: ac.signal });
          if (!(result instanceof Promise)) {
            initialEnvelope = { loading: false, value: result as unknown, error: undefined };
          } else {
            // Sync function that returns a Promise — treat as async
            initialEnvelope = { loading: true, value: undefined, error: undefined };
            result.catch(() => {});
          }
        } catch (err) {
          initialEnvelope = {
            loading: false,
            value: undefined,
            error: err instanceof Error ? err : new Error(String(err)),
          };
        } finally {
          ac.abort();
        }
      } else {
        initialEnvelope = { loading: true, value: undefined, error: undefined };
      }
    }

    const env = signal<DerivedValue<unknown>>(initialEnvelope);
    envelopes.set(entry.key, env);
  }

  const accessors = new Map<string, DerivedAccessor<unknown>>();
  for (const entry of entries) {
    const env = envelopes.get(entry.key)!;
    accessors.set(
      entry.key,
      createDerivedAccessor(
        () => env(),
        (value) => {
          const prevSub = setActiveSub(undefined);
          env({ loading: false, value, error: undefined });
          setActiveSub(prevSub);
        },
      ),
    );
  }

  const proxy = new Proxy({} as IslandDerived<TDerivedMap>, {
    get(_, key) {
      if (typeof key !== "string") return undefined;
      return accessors.get(key) ?? defaultDerivedAccessor();
    },
  });

  const setup = () => {
    const stops: Array<() => void> = [];

    for (const entry of entries) {
      const env = envelopes.get(entry.key)!;
      let ac = new AbortController();

      let skipFirst = derivedSnapshot != null && entry.key in derivedSnapshot;

      const stopEffect = effect(() => {
        ac.abort();
        ac = new AbortController();
        const currentAc = ac;

        let result: unknown;
        try {
          result = entry.fn({ state, input, signal: currentAc.signal });
        } catch (err) {
          if (skipFirst) {
            skipFirst = false;
            return;
          }
          const prevSub = setActiveSub(undefined);
          env({
            loading: false,
            value: undefined,
            error: err instanceof Error ? err : new Error(String(err)),
          });
          setActiveSub(prevSub);
          return;
        }

        if (skipFirst) {
          skipFirst = false;
          if (result instanceof Promise) {
            (result as Promise<unknown>).catch(() => {});
          }
          return;
        }

        if (!(result instanceof Promise)) {
          const prevSub = setActiveSub(undefined);
          env({ loading: false, value: result as unknown, error: undefined });
          setActiveSub(prevSub);
          return;
        }

        const prevSub = setActiveSub(undefined);
        const prevVal = env();
        env({ loading: true, value: prevVal.value, error: undefined });
        setActiveSub(prevSub);

        (result as Promise<unknown>)
          .then((value) => {
            if (currentAc.signal.aborted) return;
            env({ loading: false, value, error: undefined });
          })
          .catch((err: unknown) => {
            if (currentAc.signal.aborted) return;
            env({
              loading: false,
              value: undefined,
              error: err instanceof Error ? err : new Error(String(err)),
            });
          });
      });

      stops.push(() => {
        stopEffect();
        ac.abort();
      });
    }

    return () => stops.forEach((s) => s());
  };

  return { proxy, setup };
}

// ---------------------------------------------
// Bind
// ---------------------------------------------

export type ExternalSignal<T = unknown> = SignalAccessor<T>;

const BIND_SENTINEL_ATTR = "data-ilha-bind";

// Per-element binding spec parsed from a `data-ilha-bind` sentinel. The
// sentinel value is a comma-separated list of `kind:index` pairs so that
// rare cases of multiple bindings on one element work without extra
// attributes — but the common case is a single pair.
interface BindSpec {
  kind: BindKind;
  index: number;
}

function parseBindSentinel(value: string): BindSpec[] {
  const out: BindSpec[] = [];
  for (const part of value.split(",")) {
    const [kind, idx] = part.split(":");
    if (!kind || !idx) continue;
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0) continue;
    out.push({ kind: kind as BindKind, index: i });
  }
  return out;
}

// Resolve the per-element bind operations (read DOM, write DOM, event)
// for a particular binding kind. Centralised here so the template-time
// SSR reflection and runtime wiring share the same understanding of
// each kind's semantics.
function resolveBindOps(
  el: Element,
  kind: BindKind,
): {
  // Event name to listen on, or null for one-shot bindings (e.g. `this`,
  // and SSR-only `valueAsDate` when reflection is the only effect).
  event: string | null;
  // Read the current DOM value back into something writable to the
  // signal. May return undefined to signal "skip this update" (e.g.
  // unchecked radio firing change).
  read: (el: Element) => unknown;
  // Write the signal's current value into the DOM. For boolean
  // properties this toggles them; for `value` properties this sets the
  // string representation.
  write: (el: Element, v: unknown) => void;
} {
  const input = el as HTMLInputElement;
  switch (kind) {
    case "value":
      return {
        event: el.tagName === "SELECT" ? "change" : "input",
        read: (el) => (el as HTMLInputElement).value,
        write: (el, v) => ((el as HTMLInputElement).value = v == null ? "" : String(v)),
      };
    case "valueAsNumber":
      return {
        event: "input",
        read: (el) => {
          const n = (el as HTMLInputElement).valueAsNumber;
          return Number.isNaN(n) ? null : n;
        },
        write: (el, v) =>
          ((el as HTMLInputElement).value =
            v == null || Number.isNaN(v as number) ? "" : String(v)),
      };
    case "valueAsDate":
      return {
        event: "input",
        read: (el) => (el as HTMLInputElement).valueAsDate,
        write: (el, v) => {
          (el as HTMLInputElement).value = formatDateForInput(v);
        },
      };
    case "checked":
      return {
        event: "change",
        read: (el) => (el as HTMLInputElement).checked,
        write: (el, v) => ((el as HTMLInputElement).checked = Boolean(v)),
      };
    case "files":
      return {
        event: "change",
        // Read-only-into-state: the FileList cannot be assigned back into a
        // file input (browser security), so write() is intentionally a no-op.
        read: (el) => (el as HTMLInputElement).files,
        write: () => {},
      };
    case "open":
      return {
        event: "toggle",
        read: (el) => (el as HTMLDetailsElement).open,
        write: (el, v) => ((el as HTMLDetailsElement).open = Boolean(v)),
      };
    case "this":
      return {
        event: null,
        read: () => undefined,
        write: () => {},
      };
    case "group": {
      const isCheckbox = input.type === "checkbox";
      return {
        event: "change",
        read: (el) => {
          const i = el as HTMLInputElement;
          if (isCheckbox) {
            // Array semantics — toggled membership of this option-value.
            return { __ilhaGroup: true, value: i.value, checked: i.checked };
          }
          // Radio semantics — only the now-checked element reports a value.
          return i.checked ? i.value : undefined;
        },
        write: (el, v) => {
          const i = el as HTMLInputElement;
          if (isCheckbox) {
            const arr = Array.isArray(v) ? (v as unknown[]).map(String) : [];
            i.checked = arr.includes(i.value);
          } else {
            i.checked = v != null && String(v) === i.value;
          }
        },
      };
    }
  }
}

// Walk the host's DOM for `[data-ilha-bind]` sentinels and wire each one
// to its corresponding binding record. Called on initial mount and on
// every re-render after morph (mirroring how event listeners are
// reattached). Returns a teardown function that removes every listener
// it added.
function applyTemplateBindings(host: Element, binds: BindRecord[]): () => void {
  if (binds.length === 0) return () => {};

  const cleanups: Array<() => void> = [];

  // Include the host itself in the walk so `<div data-ilha=… data-ilha-bind=…>`
  // (binding the host) works. NodeList from querySelectorAll excludes the
  // root; checking the host explicitly is cheap.
  const elements: Element[] = [];
  if (host.hasAttribute(BIND_SENTINEL_ATTR)) elements.push(host);
  for (const el of host.querySelectorAll<Element>(`[${BIND_SENTINEL_ATTR}]`)) {
    elements.push(el);
  }

  for (const el of elements) {
    const sentinel = el.getAttribute(BIND_SENTINEL_ATTR)!;
    const specs = parseBindSentinel(sentinel);

    for (const spec of specs) {
      const record = binds[spec.index];
      if (!record) {
        if (__DEV__) {
          warn(
            `bind:${spec.kind} index ${spec.index} not found in render — ` +
              `the data-ilha-bind sentinel may have been hand-edited or ` +
              `survived a stale render.`,
          );
        }
        continue;
      }
      if (record.kind !== spec.kind) {
        if (__DEV__) {
          warn(
            `bind:${spec.kind} sentinel points at a binding registered as ` +
              `bind:${record.kind}. Sentinel may be stale.`,
          );
        }
        continue;
      }

      const { event, read, write } = resolveBindOps(el, spec.kind);
      const accessor = record.accessor;

      if (spec.kind === "this") {
        // Ref binding: write the element into the signal on attach,
        // null it on cleanup. No event listener.
        (accessor as (v: unknown) => void)(el);
        cleanups.push(() => (accessor as (v: unknown) => void)(null));
        continue;
      }

      // Reflect current signal value into the DOM property. The morph
      // already syncs attributes, but for properties that diverge from
      // attributes (input.value after user typing, details.open after
      // click, checkbox.checked) we need to write the property here.
      try {
        write(el, accessor());
      } catch (err) {
        if (__DEV__) console.error(`[ilha] bind:${spec.kind} write failed:`, err);
      }

      if (event === null) continue;

      const listener = () => {
        const raw = read(el);
        if (spec.kind === "group") {
          const groupRead = raw as
            | { __ilhaGroup: true; value: string; checked: boolean }
            | string
            | undefined;
          if (groupRead === undefined) return; // unchecked radio firing
          if (typeof groupRead === "object" && groupRead.__ilhaGroup) {
            // Checkbox group: toggle membership in the array.
            const currentArr = accessor();
            const arr = Array.isArray(currentArr) ? [...(currentArr as unknown[])] : [];
            const idx = arr.findIndex((x) => String(x) === groupRead.value);
            if (groupRead.checked && idx === -1) {
              // Coerce to match the signal's current element type, using the
              // first existing element as a template. If the array is currently
              // empty, no type template is available and the raw string is
              // pushed as-is — coercion only applies when at least one existing
              // element provides a type to mirror.
              let coercedVal: unknown = groupRead.value;
              const templateVal =
                Array.isArray(currentArr) && currentArr.length > 0 ? currentArr[0] : undefined;
              if (templateVal !== undefined) {
                if (typeof templateVal === "number") {
                  const n = Number(coercedVal);
                  coercedVal = Number.isNaN(n) ? coercedVal : n;
                } else if (typeof templateVal === "boolean") {
                  coercedVal = Boolean(coercedVal);
                }
              }
              arr.push(coercedVal);
            } else if (!groupRead.checked && idx !== -1) {
              arr.splice(idx, 1);
            }
            (accessor as (v: unknown) => void)(arr);
            return;
          }
          // Radio group: write the now-checked value, coerced to match the
          // signal's existing type (mirrors the non-group path below).
          const currentVal = accessor();
          let coerced: unknown = groupRead;
          if (typeof currentVal === "number" && typeof groupRead === "string") {
            const n = Number(groupRead);
            if (Number.isNaN(n) && __DEV__) {
              warn(
                `bind:group value "${groupRead}" is not numeric but the signal holds a ` +
                  `number — coercing to 0. Use string state or numeric option values.`,
              );
            }
            coerced = Number.isNaN(n) ? 0 : n;
          } else if (typeof currentVal === "boolean") {
            coerced = Boolean(groupRead);
          }
          (accessor as (v: unknown) => void)(coerced);
          return;
        }

        // Coerce to the signal's existing type when sensible. This
        // mirrors the previous .bind() behaviour: a signal holding a
        // number gets a number back even if read returned a string.
        const currentVal = accessor();
        let value: unknown = raw;
        if (typeof currentVal === "number" && typeof raw === "string") {
          const n = Number(raw);
          if (Number.isNaN(n) && __DEV__) {
            warn(
              `bind:${spec.kind} read "${raw}" but the signal holds a number — ` +
                `coercing to 0. Use bind:valueAsNumber (null on invalid input) or string state.`,
            );
          }
          value = Number.isNaN(n) ? 0 : n;
        } else if (typeof currentVal === "boolean") {
          value = Boolean(raw);
        }
        (accessor as (v: unknown) => void)(value);
      };

      el.addEventListener(event, listener);
      cleanups.push(() => el.removeEventListener(event, listener));
    }
  }

  return () => cleanups.forEach((c) => c());
}

// ---------------------------------------------
// Core types
// ---------------------------------------------

export type SignalAccessor<T> = MarkedSignalAccessor<T>;

type MergeState<TStateMap extends Record<string, unknown>, K extends string, V> = Omit<
  TStateMap,
  K
> &
  Record<K, V>;

export type IslandState<TStateMap extends Record<string, unknown>> = {
  readonly [K in keyof TStateMap]-?: SignalAccessor<TStateMap[K]>;
};

// ---------------------------------------------
// Hydratable options
// ---------------------------------------------

export interface HydratableOptions {
  name: string;
  as?: string;
  snapshot?: boolean | { state?: boolean; derived?: boolean };
  skipOnMount?: boolean;
}

// ---------------------------------------------
// Island interface
// ---------------------------------------------

export interface Island<
  TInput = Record<string, unknown>,
  _TStateMap extends Record<string, unknown> = Record<string, unknown>,
> {
  // Top-level call returns SSR HTML. Inside an html`` interpolation the call
  // is intercepted by the render context and produces an IslandCall (a
  // composition marker) instead — but from the caller's perspective the
  // return type is the SSR string union; interpolation handles the rest.
  (props?: Partial<TInput>): string | Promise<string>;
  toString(props?: Partial<TInput>): string;
  mount(host: Element, props?: Partial<TInput>): () => void;
  hydratable(props: Partial<TInput>, options: HydratableOptions): Promise<string>;
  // Create a keyed invocation for use inside html`` list rendering. The key
  // stabilises slot identity across re-renders where positional order is not
  // reliable (e.g. reorderable lists). Keys must be unique within a single
  // parent render.
  key(key: string): KeyedIsland<TInput>;
  /**
   * Register this island as a custom element, usable from plain HTML or any
   * framework: `Counter.define("x-counter", { observe: ["label"] })` then
   * `<x-counter label="hi"></x-counter>`. Observed attributes become string
   * input props and re-resolve input on change; richer props can be assigned
   * via the element's `props` property. Mounts on connect, unmounts on
   * disconnect. No-op (with a dev warning) where customElements is missing.
   */
  define(tagName: string, options?: { observe?: string[] }): void;
  [ISLAND]: true;
}

// Returned by Island.key() — a callable that accepts props and produces an
// IslandCall carrying the key through to interpolation.
export interface KeyedIsland<TInput> {
  (props?: Partial<TInput>): IslandCall;
  [ISLAND_CALL]: true;
}

type AnyIsland = Island<any, any>;

type RenderContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
};

export type EffectContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
  host: Element;
  /**
   * AbortSignal that aborts when the effect re-runs (because a dependency
   * changed) or when the island unmounts. Pass to `fetch` or check
   * `signal.aborted` after `await` boundaries to bail out of stale work
   * without needing a manual cleanup function.
   */
  signal: AbortSignal;
};

export type OnMountContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
  host: Element;
  hydrated: boolean;
};

export type HandlerContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
  host: Element;
  target: Element;
  event: Event;
  /**
   * AbortSignal that fires when the island unmounts. If the handler's selector
   * was registered with the `:abortable` modifier, the signal is also aborted
   * when the same listener fires again on the same target (giving you free
   * race-cancellation for things like search-as-you-type fetches). Pass this
   * to `fetch`, `AbortController`-aware APIs, or check `signal.aborted`
   * after `await` boundaries to bail out of stale work.
   */
  signal: AbortSignal;
};

// ---------------------------------------------
// Event type resolution helpers (cached at module level)
// ---------------------------------------------

type HTMLEventFor<E extends string> = E extends keyof HTMLElementEventMap
  ? HTMLElementEventMap[E]
  : Event;

type HTMLTargetFor<E extends string> = E extends keyof HTMLElementEventMap
  ? NonNullable<HTMLElementEventMap[E]["target"]> extends Element
    ? NonNullable<HTMLElementEventMap[E]["target"]>
    : Element
  : Element;

export type HandlerContextFor<
  TInput,
  TStateMap extends Record<string, unknown>,
  TEventName extends string,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
> = {
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
  host: Element;
  target: HTMLTargetFor<TEventName>;
  event: HTMLEventFor<TEventName>;
  /**
   * AbortSignal that fires when the island unmounts. If the handler's selector
   * was registered with the `:abortable` modifier, the signal is also aborted
   * when the same listener fires again on the same target.
   */
  signal: AbortSignal;
};

// ---------------------------------------------
// State init type
// ---------------------------------------------

type StateInit<TInput, V> = V | ((input: TInput) => V);

interface StateEntry<TInput> {
  key: string;
  init: StateInit<TInput, unknown>;
}

// ---------------------------------------------
// Event modifier parsing
// ---------------------------------------------

interface ParsedOn {
  selector: string;
  eventType: string;
  options: AddEventListenerOptions;
  abortable: boolean;
}

function parseOnArgs(selectorOrCombined: string): ParsedOn {
  const atIdx = selectorOrCombined.lastIndexOf("@");
  const selector = atIdx === -1 ? "" : selectorOrCombined.slice(0, atIdx);
  const rawEvent = atIdx === -1 ? selectorOrCombined : selectorOrCombined.slice(atIdx + 1);
  const parts = rawEvent.split(":");
  const eventType = parts[0]!;
  const modifiers = new Set(parts.slice(1));
  return {
    selector,
    eventType,
    options: {
      once: modifiers.has("once"),
      capture: modifiers.has("capture"),
      passive: modifiers.has("passive"),
    },
    abortable: modifiers.has("abortable"),
  };
}

/**
 * Combine multiple AbortSignals into one that aborts when any input aborts.
 * Uses native AbortSignal.any when available, falls back to a manual chain
 * otherwise (for older runtimes).
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (
    typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any ===
    "function"
  ) {
    return (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any(signals);
  }
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  for (const s of signals) {
    if (s.aborted) {
      controller.abort((s as AbortSignal & { reason?: unknown }).reason);
      cleanups.forEach((c) => c());
      return controller.signal;
    }
    const handler = () => controller.abort((s as AbortSignal & { reason?: unknown }).reason);
    s.addEventListener("abort", handler, { once: true });
    cleanups.push(() => s.removeEventListener("abort", handler));
  }
  if (!controller.signal.aborted) {
    controller.signal.addEventListener("abort", () => {
      cleanups.forEach((c) => c());
    });
  }
  return controller.signal;
}

interface OnEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
> {
  selector: string;
  event: string;
  options: AddEventListenerOptions;
  abortable: boolean;
  handler: (ctx: HandlerContext<TInput, TStateMap, TDerivedMap>) => void | Promise<void>;
}

interface EffectEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
> {
  fn: (ctx: EffectContext<TInput, TStateMap, TDerivedMap>) => (() => void) | void;
}

/** Where the error originated. `"on"` covers sync throws and async rejections
 *  from `.on()` handlers; `"effect"` covers sync throws from `.effect()` runs
 *  (async work spawned inside an effect is not awaited by the runtime). */
// Where a reported error originated.
//  - "on"         : a .on() handler threw (sync) or rejected (async)
//  - "effect"     : a .effect() body or its cleanup threw
//  - "mount"      : a .onMount() callback or its returned cleanup threw
//  - "transition" : transition.enter / transition.leave threw or rejected
// Derived errors are intentionally NOT reported here: they are surfaced as
// first-class state via derived.x.error(). Malformed SSR snapshots are not
// reported either — they degrade gracefully (see safeParseSnapshot).
export type ErrorSource = "on" | "effect" | "mount" | "transition";

// Global error handlers, invoked when an island reports an error and has no
// local .onError() handler registered. Lets apps install a single app-wide
// sink (logging/telemetry) without wiring .onError() on every island.
const globalErrorHandlers = new Set<(error: Error, source: ErrorSource) => void>();

function reportToGlobal(error: Error, source: ErrorSource): boolean {
  if (globalErrorHandlers.size === 0) return false;
  for (const handler of globalErrorHandlers) {
    try {
      handler(error, source);
    } catch (handlerErr) {
      console.error(handlerErr);
    }
  }
  return true;
}

/**
 * Register a global error handler invoked when any island reports an error
 * (from .on, .effect, .onMount, or transitions) and has no local .onError()
 * handler. Returns an unsubscribe function. Islands with their own .onError()
 * are handled locally and do not reach the global sink.
 */
export function onUncaughtError(fn: (error: Error, source: ErrorSource) => void): () => void {
  globalErrorHandlers.add(fn);
  return () => {
    globalErrorHandlers.delete(fn);
  };
}

export type ErrorContext<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
> = {
  error: Error;
  source: ErrorSource;
  state: IslandState<TStateMap>;
  derived: IslandDerived<TDerivedMap>;
  input: TInput;
  host: Element;
};

interface OnErrorEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
> {
  fn: (ctx: ErrorContext<TInput, TStateMap, TDerivedMap>) => void;
}

interface OnMountEntry<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
> {
  fn: (ctx: OnMountContext<TInput, TStateMap, TDerivedMap>) => (() => void) | void;
}

interface TransitionOptions {
  enter?: (host: Element) => Promise<void> | void;
  leave?: (host: Element) => Promise<void> | void;
}

export interface MountOptions {
  root?: Element;
  lazy?: boolean;
}

export interface MountResult {
  unmount: () => void | Promise<void>;
}

// ---------------------------------------------
// Builder config
// ---------------------------------------------

interface BuilderConfig<
  TInput,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown>,
> {
  schema: StandardSchemaV1 | null;
  /** Shallow defaults merged before props (POJO `.input({ ... })` only). */
  defaultInput: Record<string, unknown> | null;
  states: StateEntry<TInput>[];
  deriveds: DerivedEntry<TInput, TStateMap>[];
  ons: OnEntry<TInput, TStateMap, TDerivedMap>[];
  effects: EffectEntry<TInput, TStateMap, TDerivedMap>[];
  onMounts: OnMountEntry<TInput, TStateMap, TDerivedMap>[];
  onErrors: OnErrorEntry<TInput, TStateMap, TDerivedMap>[];
  transition: TransitionOptions | null;
  css: string | null;
  /** Slot wrapper tag when this island is embedded in a parent (default div). */
  as: string | null;
}

// ---------------------------------------------
// Dev-mode: track mounted hosts
// ---------------------------------------------

const _mountedHosts = __DEV__ ? new WeakSet<Element>() : null;

// ---------------------------------------------
// Builder
// ---------------------------------------------

class IlhaBuilder<
  TInput extends Record<string, unknown>,
  TStateMap extends Record<string, unknown>,
  TDerivedMap extends Record<string, unknown> = Record<never, never>,
> {
  readonly _cfg: BuilderConfig<TInput, TStateMap, TDerivedMap>;

  constructor(cfg: BuilderConfig<TInput, TStateMap, TDerivedMap>) {
    this._cfg = cfg;
  }

  input<T extends Record<string, unknown>>(): IlhaBuilder<
    T,
    Record<never, never>,
    Record<never, never>
  >;
  input<S extends StandardSchemaV1>(
    schema: S,
  ): IlhaBuilder<
    StandardSchemaV1.InferOutput<S> & Record<string, unknown>,
    Record<never, never>,
    Record<never, never>
  >;
  input<T extends Record<string, unknown>>(
    defaults: T,
  ): IlhaBuilder<T, Record<never, never>, Record<never, never>>;
  input(
    initialOrSchema?: StandardSchemaV1 | Record<string, unknown>,
  ): IlhaBuilder<Record<string, unknown>, Record<never, never>, Record<never, never>> {
    let schema: StandardSchemaV1 | null = null;
    let defaultInput: Record<string, unknown> | null = null;
    if (initialOrSchema !== undefined) {
      if (isStandardSchema(initialOrSchema)) schema = initialOrSchema;
      else defaultInput = initialOrSchema;
    }
    return new IlhaBuilder({
      schema,
      defaultInput,
      states: [],
      deriveds: [],
      ons: [],
      effects: [],
      onMounts: [],
      onErrors: [],
      transition: null,
      css: null,
      as: null,
    });
  }

  as<Tag extends string>(tag: Tag): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    return new IlhaBuilder({ ...this._cfg, as: assertValidSlotTagName(tag) });
  }

  state<V = undefined, K extends string = string>(
    key: K,
    init?: StateInit<TInput, V> | undefined,
  ): IlhaBuilder<TInput, MergeState<TStateMap, K, V>, TDerivedMap> {
    const cfg = this._cfg;
    return new IlhaBuilder({
      ...cfg,
      states: [...cfg.states, { key, init: init as StateInit<TInput, unknown> }],
    } as unknown as BuilderConfig<TInput, MergeState<TStateMap, K, V>, TDerivedMap>);
  }

  derived<K extends string, V>(
    key: K,
    fn: DerivedFn<TInput, TStateMap, V>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap & Record<K, V>> {
    const cfg = this._cfg;
    return new IlhaBuilder({
      ...cfg,
      deriveds: [...cfg.deriveds, { key, fn: fn as DerivedFn<TInput, TStateMap, unknown> }],
    } as unknown as BuilderConfig<TInput, TStateMap, TDerivedMap & Record<K, V>>);
  }

  on<S extends string>(
    selectorOrCombined: S,
    handler: (
      ctx: S extends `${string}@${infer E}:${string}`
        ? HandlerContextFor<TInput, TStateMap, E, TDerivedMap>
        : S extends `${string}@${infer E}`
          ? HandlerContextFor<TInput, TStateMap, E, TDerivedMap>
          : HandlerContext<TInput, TStateMap, TDerivedMap>,
    ) => void | Promise<void>,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    const parsed = parseOnArgs(selectorOrCombined);
    return new IlhaBuilder({
      ...this._cfg,
      ons: [
        ...this._cfg.ons,
        {
          selector: parsed.selector,
          event: parsed.eventType,
          options: parsed.options,
          abortable: parsed.abortable,
          handler: handler as (
            ctx: HandlerContext<TInput, TStateMap, TDerivedMap>,
          ) => void | Promise<void>,
        },
      ],
    });
  }

  effect(
    fn: (ctx: EffectContext<TInput, TStateMap, TDerivedMap>) => (() => void) | void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    return new IlhaBuilder({ ...this._cfg, effects: [...this._cfg.effects, { fn }] });
  }

  onMount(
    fn: (ctx: OnMountContext<TInput, TStateMap, TDerivedMap>) => (() => void) | void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    return new IlhaBuilder({ ...this._cfg, onMounts: [...this._cfg.onMounts, { fn }] });
  }

  onError(
    fn: (ctx: ErrorContext<TInput, TStateMap, TDerivedMap>) => void,
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    return new IlhaBuilder({ ...this._cfg, onErrors: [...this._cfg.onErrors, { fn }] });
  }

  transition(opts: TransitionOptions): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    return new IlhaBuilder({ ...this._cfg, transition: opts });
  }

  css(
    strings: TemplateStringsArray | string,
    ...values: (string | number)[]
  ): IlhaBuilder<TInput, TStateMap, TDerivedMap> {
    // Accept both tagged-template form and plain-string form. The tagged form
    // is the intended authoring style; plain-string keeps things flexible for
    // users who want to compose CSS externally.
    let source: string;
    if (typeof strings === "string") {
      source = strings;
    } else {
      let result = "";
      for (let i = 0; i < strings.length; i++) {
        result += strings[i];
        if (i < values.length) result += String(values[i]);
      }
      source = result;
    }

    if (__DEV__ && this._cfg.css !== null) {
      warn(
        `css(): called more than once on the same builder chain. ` +
          `The previous stylesheet has been discarded. ` +
          `Compose styles into a single .css() call instead.`,
      );
    }

    return new IlhaBuilder({ ...this._cfg, css: source });
  }

  render(
    fn: (ctx: RenderContext<TInput, TStateMap, TDerivedMap>) => string | RawHtml,
  ): Island<TInput, TStateMap> {
    const {
      schema,
      defaultInput,
      states,
      deriveds,
      ons,
      effects,
      onMounts,
      onErrors,
      transition,
      css: cssSource,
      as: slotAs,
    } = this._cfg;

    const stylePrefix = cssSource != null ? buildScopedStyle(cssSource) : "";
    const configuredSlotTag = slotAs ?? "div";

    function resolveInput(props?: Partial<TInput>): TInput {
      const merged = {
        ...(defaultInput ?? {}),
        ...(props ?? {}),
      } as Record<string, unknown>;
      if (!schema) return merged as TInput;
      return validateSchema(schema, merged) as TInput;
    }

    // Run fn inside a fresh render context so any interpolated ${Island}
    // records itself into ctx.slots. Returns the rendered HTML, the
    // collected slot map, and any bind: bindings emitted by the template.
    // When liveHost is supplied (client re-render path), already-mounted
    // child subtrees are reused as-is instead of re-SSR'd.
    //
    // When asyncChildren is true and any child island has async derived(),
    // the returned value is a Promise that resolves once all children have
    // been awaited and their resolved HTML substituted into the parent output.
    type RenderOut = {
      html: string;
      slots: IslandRenderCtx["slots"];
      binds: BindRecord[];
    };
    function renderWithCtx(fn: () => string | RawHtml, liveHost?: Element): RenderOut;
    function renderWithCtx(
      fn: () => string | RawHtml,
      liveHost: Element | undefined,
      asyncChildren: true,
    ): Promise<RenderOut>;
    function renderWithCtx(
      fn: () => string | RawHtml,
      liveHost?: Element,
      asyncChildren?: boolean,
    ): RenderOut | Promise<RenderOut> {
      const ctx = pushRenderCtx(liveHost, asyncChildren);
      try {
        const html = unwrapHtml(fn());
        // slots/binds are fully populated synchronously by fn(); capture them
        // so the render context can be popped within this synchronous frame
        // (resolveAsyncChildren only does string substitution and never reads
        // the active render context). This balances the stack eagerly and
        // avoids interleaving when two async islands render concurrently.
        const slots = ctx.slots;
        const binds = ctx.binds;

        if (ctx.pending && ctx.pending.size > 0) {
          const pending = ctx.pending;
          return (async () => {
            const resolvedHtml = await resolveAsyncChildren(html, pending);
            return { html: resolvedHtml, slots, binds };
          })();
        }

        return { html, slots, binds };
      } finally {
        popRenderCtx();
      }
    }

    function buildPlainState(input: TInput): IslandState<TStateMap> {
      const state: Record<string, unknown> = {};
      for (const entry of states) {
        const value =
          typeof entry.init === "function"
            ? (entry.init as (i: TInput) => unknown)(input)
            : entry.init;
        const accessor = markSignalAccessor((...args: unknown[]): unknown => {
          if (args.length === 0) return value;
        });
        state[entry.key] = accessor;
      }
      return state as IslandState<TStateMap>;
    }

    function buildSignalState(
      input: TInput,
      snapshot?: Record<string, unknown>,
    ): IslandState<TStateMap> {
      const state: Record<string, unknown> = {};
      for (const entry of states) {
        const initial =
          snapshot && entry.key in snapshot
            ? snapshot[entry.key]
            : typeof entry.init === "function"
              ? (entry.init as (i: TInput) => unknown)(input)
              : entry.init;
        const s = signal(initial);
        const accessor = markSignalAccessor((...args: unknown[]): unknown => {
          if (args.length === 0) return s();
          s(args[0] as typeof initial);
        });
        state[entry.key] = accessor;
      }
      return state as IslandState<TStateMap>;
    }

    /** Detached host for SSR setup hooks; must not be `{}` (Areia/components call host.matches). */
    function createSsrOnMountHost(): Element {
      if (typeof document !== "undefined") return document.createElement("div");
      const stub: Record<string, unknown> = {
        matches: () => false,
        querySelector: () => null,
        querySelectorAll: () => [],
        setAttribute: () => {},
        getAttribute: () => null,
        removeAttribute: () => {},
        appendChild: () => stub,
      };
      return stub as unknown as Element;
    }

    /** Run .onMount() before top-level SSR only (seed module/external state from `input`). */
    function runOnMountForRender(
      input: TInput,
      state: IslandState<TStateMap>,
      derived: RenderContext<TInput, TStateMap, TDerivedMap>["derived"],
    ): void {
      if (onMounts.length === 0) return;
      // Child islands inlined via emitIslandSlot → island.toString() must not run onMount (DOM islands).
      if (currentRenderCtx()) return;
      const host = createSsrOnMountHost();
      const ssrCleanups: Array<() => void> = [];
      for (const entry of onMounts) {
        const prevSub = setActiveSub(undefined);
        let userCleanup: void | (() => void) = undefined;
        try {
          userCleanup = entry.fn({ state, derived, input, host, hydrated: false });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (onErrors.length === 0) {
            if (!reportToGlobal(error, "mount")) console.error(error);
          } else {
            for (const oe of onErrors) {
              try {
                oe.fn({ error, source: "mount", state, derived, input, host });
              } catch (handlerErr) {
                console.error(handlerErr);
              }
            }
          }
        } finally {
          setActiveSub(prevSub);
        }
        if (typeof userCleanup === "function") ssrCleanups.push(userCleanup);
      }
      for (const teardown of ssrCleanups.reverse()) {
        try {
          teardown();
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (onErrors.length === 0) {
            if (!reportToGlobal(error, "mount")) console.error(error);
          }
        }
      }
    }

    function renderToString(props?: Partial<TInput>, sync = false): string | Promise<string> {
      const input = resolveInput(props);
      const state = buildSignalState(input);

      const results = deriveds.map((entry) => {
        const prevSub = setActiveSub(undefined);
        try {
          return {
            key: entry.key,
            result: entry.fn({
              state: state as never,
              input,
              signal: new AbortController().signal,
            }),
          };
        } catch (err) {
          return { key: entry.key, result: Promise.reject(err) };
        } finally {
          setActiveSub(prevSub);
        }
      });

      const hasAsync = results.some((r) => r.result instanceof Promise);

      if (!hasAsync || sync) {
        const envelopes: Record<string, DerivedValue<unknown>> = {};
        for (const r of results) {
          if (r.result instanceof Promise) {
            envelopes[r.key] = { loading: true, value: undefined, error: undefined };
          } else {
            envelopes[r.key] = { loading: false, value: r.result as unknown, error: undefined };
          }
        }
        const derived = buildDerivedAccessors<TDerivedMap>(envelopes);
        if (!currentRenderCtx()) runOnMountForRender(input, state, derived);
        const prevSub = setActiveSub(undefined);
        try {
          const { html } = renderWithCtx(() => fn({ state, derived, input }));
          return stylePrefix + html;
        } finally {
          setActiveSub(prevSub);
        }
      }

      return Promise.all(
        results.map(async (r) => {
          try {
            return {
              key: r.key,
              envelope: {
                loading: false,
                value: await Promise.resolve(r.result),
                error: undefined,
              } satisfies DerivedValue<unknown>,
            };
          } catch (err) {
            return {
              key: r.key,
              envelope: {
                loading: false,
                value: undefined,
                error: err instanceof Error ? err : new Error(String(err)),
              } satisfies DerivedValue<unknown>,
            };
          }
        }),
      ).then(async (resolved) => {
        const envelopes: Record<string, DerivedValue<unknown>> = {};
        for (const r of resolved) envelopes[r.key] = r.envelope;
        const derived = buildDerivedAccessors<TDerivedMap>(envelopes);
        if (!currentRenderCtx()) runOnMountForRender(input, state, derived);
        const prevSub = setActiveSub(undefined);
        try {
          const { html } = await renderWithCtx(
            () => fn({ state, derived, input }),
            undefined,
            true,
          );
          return stylePrefix + html;
        } finally {
          setActiveSub(prevSub);
        }
      });
    }

    type MountHandle = {
      unmount: () => void | Promise<void>;
      // Push new props into an already-mounted island. Used by parent
      // mountSlots when a parent re-render produces new props for an
      // already-mounted child slot. The new props are resolved (and
      // validated against the schema, if any) and written into the input
      // signal — reactive scopes (render, derived, effect) that read input
      // keys re-run automatically.
      updateProps: (props?: Partial<TInput>) => void;
    };

    function mountIsland(host: Element, props?: Partial<TInput>): () => void {
      return mountIslandInternal(host, props).unmount;
    }

    function mountIslandInternal(host: Element, props?: Partial<TInput>): MountHandle {
      const noop: MountHandle = { unmount: () => {}, updateProps: () => {} };

      if (__DEV__ && _mountedHosts) {
        if (_mountedHosts.has(host)) {
          warn(
            `mount(): this element is already mounted. Call the previous unmount() first to avoid ` +
              `memory leaks and duplicate event listeners.\n` +
              `Element: ${host.outerHTML.slice(0, 120)}`,
          );
          return noop;
        }
        _mountedHosts.add(host);
      }

      if (props === undefined) {
        const rawProps = host.getAttribute(PROPS_ATTR);
        if (rawProps) {
          const parsed = safeParseSnapshot(rawProps, PROPS_ATTR);
          if (parsed !== undefined) {
            props = reviveSlotProps(parsed as Record<string, unknown>) as Partial<TInput>;
          }
        }
      }

      // Input is reactive: stored in a signal whose value is the resolved
      // input object, and exposed to user code via a Proxy whose getters
      // read the signal. This lets child islands re-render when a parent
      // passes them updated state via `Child({ value: state.x() })` and
      // the parent's render effect re-runs — see updateProps below.
      const inputSignal = signal(resolveInput(props));
      const input = new Proxy({} as TInput, {
        get(_t, key) {
          return (inputSignal() as Record<PropertyKey, unknown>)[key];
        },
        has(_t, key) {
          return key in (inputSignal() as object);
        },
        ownKeys() {
          // ownKeys is invoked outside a tracking scope (e.g. Object.keys);
          // peek without subscribing to avoid surprises.
          const prevSub = setActiveSub(undefined);
          try {
            return Reflect.ownKeys(inputSignal() as object);
          } finally {
            setActiveSub(prevSub);
          }
        },
        getOwnPropertyDescriptor(_t, key) {
          const prevSub = setActiveSub(undefined);
          try {
            return Reflect.getOwnPropertyDescriptor(inputSignal() as object, key);
          } finally {
            setActiveSub(prevSub);
          }
        },
      });

      let snapshotRaw: Record<string, unknown> | undefined;
      const rawState = host.getAttribute(STATE_ATTR);
      if (rawState) {
        const parsed = safeParseSnapshot(rawState, STATE_ATTR);
        if (parsed !== undefined) snapshotRaw = parsed as Record<string, unknown>;
      }

      const stateSnapshot = snapshotRaw
        ? (Object.fromEntries(
            Object.entries(snapshotRaw).filter(([k]) => k !== "_derived" && k !== "_skipOnMount"),
          ) as Record<string, unknown>)
        : undefined;

      const derivedSnapshotRaw = snapshotRaw?._derived as
        | Record<string, DerivedValue<unknown>>
        | undefined;

      let derivedSnapshot: Record<string, DerivedValue<unknown>> | undefined;
      if (derivedSnapshotRaw) {
        derivedSnapshot = {};
        for (const [k, v] of Object.entries(derivedSnapshotRaw)) {
          if (v.error && !(v.error instanceof Error)) {
            derivedSnapshot[k] = { ...v, error: new Error(String(v.error)) };
          } else {
            derivedSnapshot[k] = v;
          }
        }
      }

      const hydrated = snapshotRaw != null;
      const snapshotHasIslandState = stateSnapshot != null && Object.keys(stateSnapshot).length > 0;
      // _skipOnMount only skips when island .state() was snapshotted (hydration replay).
      // Layout shells snapshot _skipOnMount without state keys — page onMount must still run
      // (e.g. seed @ilha/store from loader input before the first client render).
      const shouldSkipOnMount =
        hydrated && snapshotRaw?.["_skipOnMount"] === true && snapshotHasIslandState;
      const state = buildSignalState(input, stateSnapshot);
      const cleanups: Array<() => void> = [];

      // Per-island AbortController. Aborted on unmount so handler signals
      // (and any downstream fetches/awaits) get cancelled cleanly.
      const unmountController = new AbortController();
      cleanups.push(() => unmountController.abort());

      // Create derived proxy early (envelopes with initial values)
      const { proxy: derived, setup: setupDerived } = createDerivedProxy<
        TInput,
        TStateMap,
        TDerivedMap
      >(deriveds as DerivedEntry<TInput, TStateMap>[], state, input, derivedSnapshot);
      let stopDerived: () => void = () => {};

      // Centralized error sink. Errors thrown by .on() handlers (sync or async)
      // and .effect() runs are routed through here. If any .onError() handlers
      // are registered, they run in declaration order; otherwise we fall back
      // to the global sink, then console.error so errors are never silently
      // swallowed. An error thrown by an onError handler itself is logged (we
      // don't recurse).
      function reportError(err: unknown, source: ErrorSource): void {
        const error = err instanceof Error ? err : new Error(String(err));
        if (onErrors.length === 0) {
          // No local handler — try the app-wide sink, else log so errors are
          // never silently swallowed.
          if (!reportToGlobal(error, source)) console.error(error);
          return;
        }
        for (const entry of onErrors) {
          try {
            entry.fn({ error, source, state, derived, input, host });
          } catch (handlerErr) {
            console.error(handlerErr);
          }
        }
      }

      // Mount-time enter transition. Routed through reportError so a throwing
      // or rejecting enter() surfaces via .onError()/global sink instead of an
      // unhandled rejection.
      if (transition?.enter) {
        try {
          const result = transition.enter(host);
          if (result instanceof Promise) result.catch((err) => reportError(err, "transition"));
        } catch (err) {
          reportError(err, "transition");
        }
      }

      // Tracks slots currently mounted into the host: id -> { element, unmount, updateProps }.
      // mountSlots reconciles this against the fresh slot map from each render.
      // Preservation of identity across re-renders happens in the render effect
      // (detach-before-morph, rehome-after-morph). This function's job is:
      // unmount removed slots, mount newly-added ones, and push fresh props
      // into slots that were already mounted (so children re-render when the
      // parent passes them updated state as input).
      const mountedSlots = new Map<
        string,
        {
          el: Element;
          island: AnyIsland;
          unmount: () => void | Promise<void>;
          updateProps: (props?: Record<string, unknown>) => void;
        }
      >();
      const leavingSlots = new Map<string, { el: Element; token: symbol; stub?: Element }>();

      function teardownMountedSlot(
        id: string,
        entry: {
          el: Element;
          unmount: () => void | Promise<void>;
          updateProps: (props?: Record<string, unknown>) => void;
        },
      ): void | Promise<void> {
        mountedSlots.delete(id);
        const token = Symbol();
        const result = entry.unmount();
        const remove = (stub?: Element) => {
          const leaving = leavingSlots.get(id);
          if (!leaving || leaving.token !== token) return;
          leaving.el.remove();
          stub?.remove();
          leavingSlots.delete(id);
        };
        if (result instanceof Promise) {
          // Keep the child subtree connected so transition.leave (e.g. WAAPI) can
          // paint. Replacing with a stub immediately detached the host and made
          // leave animations invisible. Strip the slot identity and mark the
          // element as leaving so the morph, the slot index, and a same-id
          // remount can never adopt it — its deferred remove() would otherwise
          // delete the NEW island's DOM out from under it.
          entry.el.removeAttribute(SLOT_ATTR);
          entry.el.setAttribute(LEAVING_ATTR, "");
          leavingSlots.set(id, { el: entry.el, token });
          return result.finally(() => remove());
        }
        entry.el.remove();
      }

      // Returns true if `candidate` is a slot owned by this host, i.e. walking
      // up does not cross a [data-ilha] child-island boundary before reaching
      // host.
      function slotBelongsToHost(candidate: Element): boolean {
        let el: Element | null = candidate;
        while (el && el !== host) {
          if (el.hasAttribute("data-ilha")) return false;
          el = el.parentElement;
        }
        return el === host;
      }

      // Single-pass index of all owned slots, keyed by id. Building this once
      // and reusing it across a mount/rehome loop turns the previous O(n) per
      // findSlot (and O(n²) per render for keyed lists) into O(n) total.
      function buildSlotIndex(): Map<string, Element> {
        const leavingEls = new Set([...leavingSlots.values()].map((l) => l.el));
        const index = new Map<string, Element>();
        for (const candidate of host.querySelectorAll(`[${SLOT_ATTR}]`)) {
          if (leavingEls.has(candidate)) continue;
          const id = candidate.getAttribute(SLOT_ATTR);
          if (id === null || index.has(id)) continue;
          if (slotBelongsToHost(candidate)) index.set(id, candidate);
        }
        return index;
      }

      /** Push live props from a fresh slot map into already-mounted children. */
      function pushUpdatedProps(nextSlots: IslandRenderCtx["slots"]): void {
        for (const [id, entry] of mountedSlots) {
          const next = nextSlots.get(id);
          if (next) entry.updateProps(next.props);
        }
      }

      function mountSlots(slotMap: IslandRenderCtx["slots"]) {
        // Unmount slots that are no longer present (conditionally removed).
        for (const [id, entry] of mountedSlots) {
          if (!slotMap.has(id)) {
            teardownMountedSlot(id, entry);
          }
        }

        // Same slot id, different child island (e.g. conditional `${List}` vs `${Edit}` at p:0).
        for (const [id, entry] of mountedSlots) {
          const next = slotMap.get(id);
          if (next && next.island !== entry.island) {
            teardownMountedSlot(id, entry);
          }
        }

        // Mount new slot ids that aren't yet mounted; push updated props
        // into slots that are.
        let slotIndex: Map<string, Element> | null = null;
        for (const [id, { island: childIsland, props }] of slotMap) {
          const existing = mountedSlots.get(id);
          if (existing) {
            // Already mounted — propagate fresh props so the child can
            // re-render. Short-circuit happens inside updateProps when the
            // resolved input is shallow-equal to the previous one.
            existing.updateProps(props);
            continue;
          }

          if (slotIndex === null) slotIndex = buildSlotIndex();
          const slotEl = slotIndex.get(id) ?? null;
          if (!slotEl) continue;

          // Props may have been encoded on the slot element during SSR/hydration
          // (data-ilha-props). Fall back to that if not supplied inline via the
          // slot map. Data-props is preserved as a secondary source for
          // hydration scenarios where the map isn't populated.
          let slotProps = props;
          if (slotProps === undefined) {
            const rawProps = slotEl.getAttribute(PROPS_ATTR) ?? slotEl.getAttribute("data-props");
            if (rawProps) {
              const parsed = safeParseSnapshot(rawProps, `props on [${SLOT_ATTR}="${id}"]`);
              if (parsed !== undefined) {
                slotProps = reviveSlotProps(parsed as Record<string, unknown>);
              }
            }
          }

          // Isolate child island mount from any outer subscriber (e.g. the
          // parent's render effect, when mountSlots is called mid-re-render).
          // Without this, the child's pre-effect render call reads its own
          // signals with the parent as active subscriber, subscribing the
          // parent to child-internal state and preventing the child's own
          // render effect from receiving updates.
          const prevSub = setActiveSub(undefined);
          let handle: {
            unmount: () => void | Promise<void>;
            updateProps: (p?: Record<string, unknown>) => void;
          };
          try {
            // Use the internal mount path so we get a handle that can push
            // new props on subsequent parent re-renders, not just unmount.
            const internal = (childIsland as unknown as Record<symbol, unknown>)[
              ISLAND_MOUNT_INTERNAL
            ] as
              | ((
                  host: Element,
                  props?: Record<string, unknown>,
                ) => {
                  unmount: () => void | Promise<void>;
                  updateProps: (p?: Record<string, unknown>) => void;
                })
              | undefined;
            handle = internal
              ? internal(slotEl, slotProps)
              : { unmount: childIsland.mount(slotEl, slotProps), updateProps: () => {} };
          } finally {
            setActiveSub(prevSub);
          }
          mountedSlots.set(id, { el: slotEl, island: childIsland, ...handle });
        }
      }

      type ListenerEntry = {
        target: Element;
        type: string;
        fn: EventListener;
        options: AddEventListenerOptions;
        entry: OnEntry<TInput, TStateMap, TDerivedMap>;
      };
      const listeners: ListenerEntry[] = [];
      const firedOnce = new Set<OnEntry<TInput, TStateMap, TDerivedMap>>();
      const invocationControllers = new WeakMap<
        OnEntry<TInput, TStateMap, TDerivedMap>,
        WeakMap<Element, AbortController>
      >();

      function attachListeners() {
        for (const entry of ons) {
          if (entry.options.once && firedOnce.has(entry)) continue;
          const targets =
            entry.selector === "" ? [host] : Array.from(host.querySelectorAll(entry.selector));

          if (__DEV__ && entry.selector !== "" && targets.length === 0) {
            warn(
              `on(): selector "${entry.selector}" matched no elements at mount time. ` +
                `If the element is rendered later, this is expected — otherwise check your selector.`,
            );
          }

          targets.forEach((listenerTarget) => {
            const listener = (event: Event) => {
              if (entry.options.once) {
                firedOnce.add(entry);
                for (const l of listeners.filter((l) => l.entry === entry)) {
                  l.target.removeEventListener(l.type, l.fn, l.options);
                }
                listeners.splice(
                  0,
                  listeners.length,
                  ...listeners.filter((l) => l.entry !== entry),
                );
              }
              const eventTarget = (
                event.target instanceof Element ? event.target : listenerTarget
              ) as Element;
              // For selector-based listeners, pass the matched element (the
              // listener host), not the deepest event.target — component libs
              // often wrap label text in inner spans that lack data-* attrs.
              const handlerTarget = entry.selector === "" ? eventTarget : listenerTarget;

              // Build the signal passed to the handler. Always linked to the
              // unmount signal; if abortable, also linked to a per-invocation
              // controller that we abort on the next fire.
              let handlerSignal: AbortSignal;
              if (entry.abortable) {
                let entryMap = invocationControllers.get(entry);
                if (!entryMap) {
                  entryMap = new WeakMap();
                  invocationControllers.set(entry, entryMap);
                }
                const prev = entryMap.get(listenerTarget);
                if (prev) prev.abort();
                const invocationController = new AbortController();
                entryMap.set(listenerTarget, invocationController);
                handlerSignal = anySignal([unmountController.signal, invocationController.signal]);
              } else {
                handlerSignal = unmountController.signal;
              }

              // Batch the synchronous portion of the handler so multiple
              // state writes propagate as a single update. If the handler
              // returns a promise, the batch ends after the sync portion;
              // post-await writes batch themselves implicitly via signal
              // semantics (or can be wrapped in batch() if needed).
              let result: void | Promise<void>;
              startBatch();
              try {
                result = entry.handler({
                  state,
                  derived,
                  input,
                  host,
                  target: handlerTarget,
                  event,
                  signal: handlerSignal,
                });
              } catch (err) {
                reportError(err, "on");
                endBatch();
                return;
              }
              endBatch();
              if (result instanceof Promise) {
                result.catch((err) => {
                  // AbortError is the expected outcome of cancellation —
                  // don't surface it. Anything else is a real handler error.
                  if (err && (err as { name?: string }).name === "AbortError") return;
                  reportError(err, "on");
                });
              }
            };
            const opts = { ...entry.options, once: false };
            listenerTarget.addEventListener(entry.event, listener, opts);
            listeners.push({
              target: listenerTarget,
              type: entry.event,
              fn: listener,
              options: opts,
              entry,
            });
          });
        }
      }

      function detachListeners() {
        for (const l of listeners) l.target.removeEventListener(l.type, l.fn, l.options);
        listeners.length = 0;
      }

      function invokeOnMounts(): void {
        for (const entry of onMounts) {
          const prevSub = setActiveSub(undefined);
          let userCleanup: (() => void) | void = undefined;
          try {
            userCleanup = entry.fn({ state, derived, input, host, hydrated });
          } catch (err) {
            reportError(err, "mount");
          } finally {
            setActiveSub(prevSub);
          }
          if (userCleanup) {
            const teardown = userCleanup;
            cleanups.push(() => {
              try {
                teardown();
              } catch (err) {
                reportError(err, "mount");
              }
            });
          }
        }
      }

      const preserveSSRDom = hydrated && host.childNodes.length > 0;

      // Seed external/module state before the first render walk (store is not snapshotted).
      if (hydrated && onMounts.length > 0 && !shouldSkipOnMount) {
        invokeOnMounts();
      }

      // Initial render. If hydrating over existing SSR output, we still need
      // to walk the render function once to collect the slot map (so mountSlots
      // knows which islands to mount into the existing [data-ilha-slot]
      // elements). In that case we pass the host as liveHost so emitIslandSlot
      // reuses the existing subtrees instead of re-SSR-ing children.
      const initial = renderWithCtx(
        () => fn({ state, derived, input }),
        preserveSSRDom ? host : undefined,
      );
      if (!preserveSSRDom) {
        host.innerHTML = stylePrefix + initial.html;
      }

      let stopBindings = applyTemplateBindings(host, initial.binds);
      cleanups.push(() => stopBindings());

      mountSlots(initial.slots);
      cleanups.push(() => mountedSlots.forEach((entry) => entry.unmount()));

      // Bind after slot islands mount so selector-based handlers see the final DOM.
      attachListeners();

      if (!hydrated && onMounts.length > 0) {
        invokeOnMounts();
      }

      for (const entry of effects) {
        let userCleanup: (() => void) | void;
        let runController: AbortController | null = null;
        const stopEffect = effect(() => {
          if (userCleanup) {
            try {
              userCleanup();
            } catch (err) {
              reportError(err, "effect");
            }
            userCleanup = undefined;
          }
          // Abort the previous run's signal so any in-flight async work bails
          // before we kick off the next run. Race-cancel is the default for
          // effects (unlike .on(), which requires :abortable opt-in) because
          // dependency changes invariably make the previous run stale.
          if (runController) runController.abort();
          runController = new AbortController();
          const runSignal = anySignal([unmountController.signal, runController.signal]);
          // Batch writes inside the effect so multiple state mutations in a
          // single run propagate atomically.
          startBatch();
          try {
            userCleanup = entry.fn({ state, derived, input, host, signal: runSignal });
          } catch (err) {
            reportError(err, "effect");
          } finally {
            endBatch();
          }
        });
        cleanups.push(() => {
          stopEffect();
          if (userCleanup) {
            try {
              userCleanup();
            } catch (err) {
              reportError(err, "effect");
            }
          }
          if (runController) runController.abort();
        });
      }

      // Register derived effects after user effects so that when state
      // changes, the user effect runs first (potentially resetting state)
      // and the derived effect sees the final state.
      stopDerived = setupDerived();
      cleanups.push(stopDerived);

      let initialized = false;
      // Track the rendered HTML from the initial sync render so the first
      // effect pass can detect whether state writes during onMount or
      // synchronous effect setup have produced a divergence that needs a
      // re-paint. Without this, the DOM stays stuck on the initial-render
      // value because the effect's first run short-circuits.
      const initialRenderedHtml = initial.html;
      // Rendered string the live DOM is known to match — set whenever a morph
      // (or a first-pass short-circuit with matching DOM) completes. Enables
      // the identical-output fast path below.
      let lastRendered: string | null = null;
      let renderEpoch = 0;
      const stopRender = effect(() => {
        const epoch = ++renderEpoch;
        // Re-render produces empty stubs for every child island site (see
        // emitIslandSlot). The full strategy for preserving mounted children
        // across parent re-renders:
        //
        //   1. Render a fresh HTML template with empty slot stubs.
        //   2. In the LIVE host, replace each mounted slot element with an
        //      empty stub (same [data-ilha-slot] attr). The live element is
        //      detached and held in a local map.
        //   3. Morph the stubbed live DOM against the stubbed template. Because
        //      both sides now have structurally identical empty stubs at slot
        //      positions, morph can reorder/match them by position without
        //      walking into the child subtree (which was the source of state
        //      corruption when children reorder).
        //   4. After morph, find each stub by id and replace it with the
        //      preserved live element. Children keep their DOM, listeners,
        //      state, event bindings — untouched.
        //
        // Brand-new slot ids (added in this render) stay as stubs after morph;
        // mountSlots mounts their islands onto them.
        const {
          html: rendered,
          slots: newSlotMap,
          binds: newBinds,
        } = renderWithCtx(() => fn({ state, derived, input }), host);
        const html = stylePrefix + rendered;

        if (!initialized) {
          initialized = true;
          // Hydration: listeners/bindings were wired to SSR DOM — never morph
          // on the first effect pass (layout + page slots both use this path).
          if (preserveSSRDom) {
            pushUpdatedProps(newSlotMap);
            if (rendered === initialRenderedHtml) {
              lastRendered = rendered;
              return;
            }
            // onMount or other setup changed output — morph to refresh SSR DOM.
          }
          // Fast path: render output matches the eager initial render. DOM
          // and slot map are already in sync — nothing more to do here. The
          // typical case: no onMount has run yet, or onMount hasn't written
          // any state.
          if (rendered === initialRenderedHtml) {
            lastRendered = rendered;
            return;
          }
          // Client mount: the eager render inlines child SSR, but the first
          // reactive pass uses liveHost stubs by design. That HTML difference
          // is expected — remorphing here would disturb already-mounted child
          // islands (component controllers, bind wiring, etc.). Push fresh
          // props and skip the destructive morph when the slot set is stable.
          if (
            mountedSlots.size > 0 &&
            mountedSlots.size === newSlotMap.size &&
            [...newSlotMap.keys()].every((id) => mountedSlots.has(id)) &&
            isStableInlineSlotMount(initialRenderedHtml, rendered, newSlotMap.keys())
          ) {
            // Slot set is stable, but live props (functions, children RawHtml)
            // are not reflected in the stub markup — still push them.
            pushUpdatedProps(newSlotMap);
            return;
          }
          // Divergence: a state write between the eager initial render and
          // the first effect pass (typically inside onMount) changed what
          // the render fn produces. Fall through to do a full morph + slot
          // reconcile so the DOM and mounted children catch up. The child
          // islands that were already mounted by the eager mountSlots get
          // their new props pushed via updateProps.
        }

        // Identical-output fast path: the DOM, listener wiring, and template
        // bindings all derive from the rendered string, so when a re-render
        // produces the exact markup the DOM already matches (a dependency
        // changed without affecting this island's output) there is nothing to
        // morph or rewire. Slot props are compared as live objects — functions
        // and other non-serializable props can differ while the serialized
        // stub markup doesn't — so still push them into mounted children.
        if (
          rendered === lastRendered &&
          mountedSlots.size === newSlotMap.size &&
          [...newSlotMap].every(([id, next]) => mountedSlots.get(id)?.island === next.island)
        ) {
          pushUpdatedProps(newSlotMap);
          return;
        }

        detachListeners();
        stopBindings();

        const prevMountedCount = mountedSlots.size;
        const leavingPromises: Promise<unknown>[] = [];

        // Unmount slots that are no longer present BEFORE morphInner mutates
        // the DOM. This ensures unmount hooks (transition.leave, effect
        // cleanups, etc.) execute while the elements are still connected.
        for (const [id, entry] of mountedSlots) {
          if (!newSlotMap.has(id)) {
            const r = teardownMountedSlot(id, entry);
            if (r instanceof Promise) leavingPromises.push(r);
          }
        }

        for (const [id, entry] of mountedSlots) {
          const next = newSlotMap.get(id);
          if (next && next.island !== entry.island) {
            const r = teardownMountedSlot(id, entry);
            if (r instanceof Promise) leavingPromises.push(r);
          }
        }

        const applyMorph = () => {
          if (epoch !== renderEpoch) return;
          // Positional ids (p:N) are reused when a list item is removed: after
          // a shrink, every surviving p: slot at or after the removed item's
          // position now represents a DIFFERENT item under the same id, and a
          // reused host (controller-driven DOM, e.g. Areia checkbox) would
          // keep the wrong item's subtree. Detect the first position whose
          // incoming props diverge from what the slot host currently carries
          // and tear down only from there — earlier positional slots keep
          // their state, DOM, and focus.
          if (newSlotMap.size < prevMountedCount) {
            let divergeFrom = Infinity;
            for (const [id, entry] of mountedSlots) {
              if (!id.startsWith("p:")) continue;
              const next = newSlotMap.get(id);
              if (!next) continue; // disappearing ids were torn down above
              const index = Number(id.slice(2));
              if (Number.isNaN(index) || index >= divergeFrom) continue;
              const incoming = serializeSlotProps(next.props);
              const current = entry.el.getAttribute(PROPS_ATTR) ?? "";
              if (incoming !== current) divergeFrom = index;
            }
            for (const [id, entry] of mountedSlots) {
              if (!newSlotMap.has(id)) continue;
              if (!entry.el.isConnected) continue;
              if (id.startsWith("p:") && Number(id.slice(2)) >= divergeFrom) {
                teardownMountedSlot(id, entry);
              }
            }
          }

          // Surviving slot hosts are reconciled IN PLACE by the slot-aware
          // morph (matched by slot id, children untouched) — they are never
          // detached, so a focused element inside a child island keeps focus.
          // morphInner itself guards focus/selection against genuine reorders.
          const tpl = document.createElement("template");
          const morphRootTag = host.tagName.toLowerCase();
          tpl.innerHTML = `<${morphRootTag}>${html}</${morphRootTag}>`;
          morphInner(host, tpl.content.firstElementChild as Element);
          lastRendered = rendered;

          // Rehome mounted slots the morph could not keep in place (a slot
          // host moved to a different parent): the template left a fresh stub
          // with the same id — swap the live element in.
          let rehomeIndex: Map<string, Element> | null = null;
          for (const [id, entry] of mountedSlots) {
            if (!newSlotMap.has(id) || entry.el.isConnected) continue;
            rehomeIndex ??= buildSlotIndex();
            const stub = rehomeIndex.get(id);
            if (stub && stub !== entry.el) stub.replaceWith(entry.el);
          }

          attachListeners();
          stopBindings = applyTemplateBindings(host, newBinds);
          mountSlots(newSlotMap);
        };

        if (leavingPromises.length > 0) {
          void Promise.allSettled(leavingPromises).then((results) => {
            for (const r of results) {
              if (r.status === "rejected") console.error(r.reason);
            }
            applyMorph();
          });
        } else {
          applyMorph();
        }
      });

      let tornDown = false;
      // Teardown order matters:
      //   1. stopRender — prevent re-render loops triggered by step 3.
      //   2. detachListeners — stop new DOM events from firing.
      //   3. cleanups (includes stopBindings which writes null into bind:this
      //      refs; these writes must NOT trigger renders, hence step 1).
      const unmount = (): void | Promise<void> => {
        if (tornDown) return;
        tornDown = true;
        ISLAND_MOUNT_HANDLES.delete(host);
        if (__DEV__ && _mountedHosts) _mountedHosts.delete(host);
        stopRender();
        detachListeners();

        const pending: Promise<unknown>[] = [];
        for (const [, entry] of mountedSlots) {
          const result = entry.unmount();
          if (result instanceof Promise) pending.push(result);
        }

        if (transition?.leave) {
          try {
            const result = transition.leave(host);
            if (result instanceof Promise) pending.push(result);
          } catch (err) {
            reportError(err, "transition");
          }
        }

        const finish = () => {
          for (const c of cleanups) c();
        };

        if (pending.length > 0) {
          return Promise.all(pending)
            .then(finish)
            .catch((err) => {
              reportError(err, "transition");
              finish();
            });
        }
        finish();
      };

      const updateProps = (nextProps?: Partial<TInput>): void => {
        if (tornDown) return;
        const next = resolveInput(nextProps);
        const prev = inputSignal();
        // Shallow-equal short-circuit: don't churn reactive subscribers when
        // the resolved input hasn't actually changed. We compare own keys
        // and values with Object.is. This keeps repeated parent re-renders
        // with identical props free of work.
        if (shallowEqualInput(prev, next)) return;
        inputSignal(next);
      };

      const handle = { unmount, updateProps };
      ISLAND_MOUNT_HANDLES.set(
        host,
        handle as {
          unmount: () => void | Promise<void>;
          updateProps: (props?: Record<string, unknown>) => void;
        },
      );
      return handle;
    }

    /**
     * Dual-mode island invocation:
     * - When called inside an `html` interpolation (i.e. {@link currentRenderCtx}
     *   is active), returns an {@link IslandCall} carrying props to be emitted
     *   as a child slot marker; {@link interpolateValue} consumes this marker.
     * - When called at the top level with no active render context, returns
     *   SSR HTML via {@link renderToString} (backward-compatible public API).
     *
     * The declared return type omits {@link IslandCall} because TypeScript
     * cannot narrow based on runtime stack state.
     */
    const island = function (props?: Partial<TInput>): string | Promise<string> | IslandCall {
      if (currentRenderCtx()) {
        return {
          [ISLAND_CALL]: true,
          island: island as AnyIsland,
          props: props as Record<string, unknown> | undefined,
          key: undefined,
        };
      }
      return renderToString(props);
    } as unknown as Island<TInput, TStateMap>;

    island.toString = (props?: Partial<TInput>) => renderToString(props, true) as string;

    island.mount = (host: Element, props?: Partial<TInput>): (() => void) =>
      mountIsland(host, props);

    // Internal hook for parent mountSlots — returns { unmount, updateProps }
    // so parent re-renders can push new props into already-mounted child
    // islands. Not exported as part of the public Island interface.
    (island as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] = (
      host: Element,
      props?: Partial<TInput>,
    ): MountHandle => mountIslandInternal(host, props);

    (island as unknown as Record<symbol, unknown>)[ISLAND_SLOT_TAG] = configuredSlotTag;

    // Create a keyed invocation for stable slot identity across re-renders
    // (useful in reorderable lists). Returns a callable that, when given
    // optional props, produces an IslandCall that interpolateValue recognises.
    island.key = (key: string): KeyedIsland<TInput> => {
      if (typeof key !== "string" || key.trim().length === 0) {
        throw new Error("island.key() requires a non-empty string.");
      }
      if (key.includes(":")) {
        throw new Error(`island.key() key cannot contain the slot separator ":" (got "${key}").`);
      }
      const keyed = ((props?: Partial<TInput>): IslandCall => ({
        [ISLAND_CALL]: true,
        island: island as AnyIsland,
        props: props as Record<string, unknown> | undefined,
        key,
      })) as unknown as KeyedIsland<TInput>;
      (keyed as unknown as Record<symbol, boolean>)[ISLAND_CALL] = true;
      return keyed;
    };

    (island as unknown as Record<symbol, boolean>)[ISLAND] = true;

    // Custom-element wrapper: makes the island consumable from plain HTML or
    // any other framework without touching ilha's mount API. Observed
    // attributes surface as string input props; richer values go through the
    // element's `props` property (merged over attribute props).
    island.define = (tagName: string, options?: { observe?: string[] }): void => {
      if (typeof customElements === "undefined" || typeof HTMLElement === "undefined") {
        warn(`define("${tagName}"): customElements is unavailable in this environment.`);
        return;
      }
      // Validate the name ourselves so authors get an ilha-worded soft
      // failure instead of an uncaught native SyntaxError from
      // customElements.define. Custom element names must be lowercase,
      // start with a letter, contain a hyphen, and avoid the SVG/MathML
      // reserved names.
      const CE_RESERVED = new Set([
        "annotation-xml",
        "color-profile",
        "font-face",
        "font-face-src",
        "font-face-uri",
        "font-face-format",
        "font-face-name",
        "missing-glyph",
      ]);
      if (
        typeof tagName !== "string" ||
        !/^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/.test(tagName) ||
        CE_RESERVED.has(tagName)
      ) {
        warn(
          `define("${tagName}"): not a valid custom element name — it must ` +
            `be lowercase, start with a letter, and contain a hyphen ` +
            `(e.g. "my-counter"). Skipping registration.`,
        );
        return;
      }
      if (customElements.get(tagName)) {
        warn(`define("${tagName}"): tag is already registered — skipping.`);
        return;
      }
      const observe = options?.observe ?? [];

      class IlhaIslandElement extends HTMLElement {
        static observedAttributes = observe;
        _handle: MountHandle | null = null;
        _props: Record<string, unknown> | undefined;
        // True while an unmount is settling; the handle stays assigned so a
        // reconnect cannot start a second mount over in-flight teardown.
        _unmounting = false;
        _reconnect = false;

        get props(): Record<string, unknown> | undefined {
          return this._props;
        }
        set props(p: Record<string, unknown> | undefined) {
          this._props = p;
          if (this._handle && !this._unmounting) this._handle.updateProps(this._mergedProps());
        }

        _mergedProps(): Partial<TInput> | undefined {
          const attrProps: Record<string, unknown> = {};
          let hasAttrs = false;
          for (const name of observe) {
            const v = this.getAttribute(name);
            if (v !== null) {
              attrProps[name] = v;
              hasAttrs = true;
            }
          }
          // With no observed attrs and no assigned props, pass undefined so
          // mount falls back to reading data-ilha-props off the element.
          if (!hasAttrs && this._props === undefined) return undefined;
          return { ...attrProps, ...(this._props ?? {}) } as Partial<TInput>;
        }

        connectedCallback(): void {
          if (this._unmounting) {
            // Reconnected while the previous mount is still tearing down —
            // defer the new mount until teardown settles.
            this._reconnect = true;
            return;
          }
          if (this._handle) return;
          this._handle = mountIslandInternal(this, this._mergedProps());
        }

        disconnectedCallback(): void {
          if (!this._handle || this._unmounting) return;
          this._unmounting = true;
          this._reconnect = false;
          void Promise.resolve(this._handle.unmount()).finally(() => {
            this._handle = null;
            this._unmounting = false;
            if (this._reconnect) {
              this._reconnect = false;
              if (this.isConnected) this._handle = mountIslandInternal(this, this._mergedProps());
            }
          });
        }

        attributeChangedCallback(): void {
          if (this._handle && !this._unmounting) this._handle.updateProps(this._mergedProps());
        }
      }

      customElements.define(tagName, IlhaIslandElement);
    };

    island.hydratable = async (
      props: Partial<TInput>,
      opts: HydratableOptions,
    ): Promise<string> => {
      const { name, as: rawTag = "div", snapshot = false, skipOnMount: explicitSkipOnMount } = opts;
      const tag = assertValidSlotTagName(rawTag);

      const resolvedProps = props ?? {};
      const inner = await renderToString(resolvedProps);
      const encodedProps = escapeHtml(JSON.stringify(resolvedProps));

      let stateAttr = "";

      if (snapshot !== false) {
        const doState = snapshot === true || (snapshot as { state?: boolean }).state !== false;
        const doDerived =
          snapshot === true || (snapshot as { derived?: boolean }).derived !== false;
        const doSkipOnMount = explicitSkipOnMount ?? (doState || doDerived);

        const snapshotData: Record<string, unknown> = {};
        const input = resolveInput(resolvedProps);
        const plainState = buildPlainState(input);

        if (doState) {
          for (const entry of states) {
            snapshotData[entry.key] = (
              plainState[entry.key as keyof typeof plainState] as () => unknown
            )();
          }
        }

        if (doDerived) {
          const derivedResults: Record<string, unknown> = {};
          for (const entry of deriveds) {
            const prevSub = setActiveSub(undefined);
            let resultPromise: unknown;
            let syncError: unknown;
            let threw = false;
            try {
              resultPromise = entry.fn({
                state: plainState as never,
                input,
                signal: new AbortController().signal,
              });
            } catch (err) {
              threw = true;
              syncError = err;
            } finally {
              setActiveSub(prevSub);
            }

            if (threw) {
              derivedResults[entry.key] = {
                loading: false,
                value: undefined,
                error: syncError instanceof Error ? syncError.message : String(syncError),
              };
              continue;
            }

            try {
              const result = await Promise.resolve(resultPromise);
              derivedResults[entry.key] = { loading: false, value: result, error: undefined };
            } catch (err) {
              derivedResults[entry.key] = {
                loading: false,
                value: undefined,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }
          snapshotData["_derived"] = derivedResults;
        }

        if (doSkipOnMount) snapshotData["_skipOnMount"] = true;

        if (__DEV__) {
          const lossy = findNonJsonSafeValue(snapshotData, "snapshot");
          if (lossy) {
            warn(
              `hydratable("${name}"): state/derived snapshot is not JSON-safe ` +
                `(${lossy}) — hydration will diverge from SSR. ` +
                `Keep snapshotted values to plain JSON types.`,
            );
          }
        }

        stateAttr = ` ${STATE_ATTR}='${escapeHtml(JSON.stringify(snapshotData))}'`;
      }

      return `<${tag} data-ilha="${escapeHtml(name)}" ${PROPS_ATTR}='${encodedProps}'${stateAttr}>${inner}</${tag}>`;
    };

    return island;
  }
}

// ---------------------------------------------
// ilha.from
// ---------------------------------------------

function ilhaFrom<TInput, TStateMap extends Record<string, unknown>>(
  selector: string | Element,
  island: Island<TInput, TStateMap>,
  props?: Partial<TInput>,
): (() => void) | null {
  const host = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!host) {
    console.warn(`[ilha] from(): element not found: ${selector}`);
    return null;
  }
  return island.mount(host, props);
}

// ---------------------------------------------
// ilha.mount — auto-discovery
// ---------------------------------------------

type IslandRegistry = Record<string, AnyIsland>;

function mountAll(registry: IslandRegistry, options: MountOptions = {}): MountResult {
  const root = options.root ?? document.body;
  const lazy = options.lazy ?? false;
  const unmounts: Array<() => void | Promise<void>> = [];

  function activateEl(host: Element) {
    const name = host.getAttribute("data-ilha");
    if (!name) return;
    const island = registry[name];

    if (!island) {
      warn(
        `mount(): no island registered under the name "${name}". ` +
          `Available names: [${Object.keys(registry).join(", ")}]. ` +
          `Check the data-ilha attribute on the element.`,
      );
      return;
    }

    let props: Record<string, unknown> = {};
    const rawProps = host.getAttribute(PROPS_ATTR);
    if (rawProps) {
      const parsed = safeParseSnapshot(rawProps, `${PROPS_ATTR} on [data-ilha="${name}"]`);
      if (parsed !== undefined) props = reviveSlotProps(parsed as Record<string, unknown>);
    }

    unmounts.push(island.mount(host, props));
  }

  const els = Array.from(root.querySelectorAll("[data-ilha]"));

  if (lazy && typeof IntersectionObserver !== "undefined") {
    let disposed = false;
    const io = new IntersectionObserver((entries) => {
      if (disposed) return;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          activateEl(entry.target);
          io.unobserve(entry.target);
        }
      }
    });
    els.forEach((el) => io.observe(el));
    unmounts.push(() => {
      disposed = true;
      io.disconnect();
    });
  } else {
    els.forEach(activateEl);
  }

  return {
    unmount: (): void | Promise<void> => {
      const pending: Promise<unknown>[] = [];
      for (const u of unmounts) {
        const result = u();
        if (result instanceof Promise) pending.push(result);
      }
      if (pending.length > 0) return Promise.all(pending).then(() => {});
    },
  };
}

// ---------------------------------------------
// Default export
// ---------------------------------------------

const EMPTY_CFG: BuilderConfig<
  Record<string, unknown>,
  Record<never, never>,
  Record<never, never>
> = {
  schema: null,
  defaultInput: null,
  states: [],
  deriveds: [],
  ons: [],
  effects: [],
  onMounts: [],
  onErrors: [],
  transition: null,
  css: null,
  as: null,
};

const rootBuilder = new IlhaBuilder(EMPTY_CFG);

const ilha = Object.assign(rootBuilder, {
  html: ilhaHtml,
  raw: ilhaRaw,
  mount: mountAll,
  from: ilhaFrom,
  context: ilhaContext,
  signal: ilhaSignal,
  computed: ilhaComputed,
  // NOTE: no `effect` here — the builder's .effect() method owns that name on
  // the default export. The top-level effect is available as a named import.
  batch,
  untrack,
  onUncaughtError,
});

/** @internal Used by the separate JSX runtime entry to preserve island slot composition. */
export function __ilhaJsxSlot(
  island: unknown,
  props: Record<string, unknown> | undefined,
  key: string | undefined,
): RawHtml {
  return ilhaRaw(emitIslandSlot(island as AnyIsland, props, key));
}

export const html = ilhaHtml;
export const raw = ilhaRaw;
export const css = ilhaCss;
export const mount = mountAll;
export const from = ilhaFrom;
export const context = ilhaContext;
export { ilhaSignal as signal };
export { ilhaComputed as computed };
export { ilhaEffect as effect };
export default ilha;
