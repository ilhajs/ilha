import { signal, effect as alienEffect, setActiveSub, startBatch, endBatch } from "alien-signals";

import {
  ISLAND_MOUNT_HANDLES,
  ISLAND_MOUNT_INTERNAL,
  __ilhaJsxEvent,
  serializeServerManifest,
  setJsxRuntimeBridge,
  setServerActionBinder,
  setTemplateRenderer,
  type JsxEventRegistration,
  type ServerAction,
} from "./internal";
import { htmlTemplate, templateAttribute, templateParts, type TemplateNode } from "./template";

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
  typeof __ILHA_DEV__ === "undefined"
    ? typeof process === "undefined"
      ? true
      : process.env?.["NODE_ENV"] !== "production"
    : __ILHA_DEV__;

function warn(msg: string): void {
  if (__DEV__) console.warn(`[ilha] ${msg}`);
}

// Dev-only: find the first value in a snapshot that will not survive a JSON
// round-trip (dropped or silently transformed by JSON.stringify), so authors
// hear about hydration divergence instead of debugging it. Returns a
// "path: reason" description, or null when the value is JSON-safe.
function findNonJsonSafeValue({
  value,
  path,
  seen = new WeakSet(),
}: {
  value: unknown;
  path: string;
  seen?: WeakSet<object>;
}): string | null {
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
      const found = findNonJsonSafeValue({ value: value[i], path: `${path}[${i}]`, seen });
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
      const found = findNonJsonSafeValue({ value: v, path: `${path}.${k}`, seen });
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
    if (!Object.hasOwn(value, key)) continue;
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
    if (!Object.hasOwn(b, k)) return false;
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

// Detect the expected client-mount divergence: eager render inlines child
// SSR while the first reactive pass emits empty slot stubs. Props encoded on
// the stub must match — if they differ, state changed before the first
// effect (e.g. an effect.once in the parent wrote new props) and we must reconcile.
function parseHtmlFragment(html: string): DocumentFragment {
  const tpl = document.createElement("template");
  // parse into a detached <template> (no script execution, not the live
  // document) to inspect the rendered tree.
  // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
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
    throw new Error("The { as } option requires a non-empty HTML tag name.");
  }
  if (!SLOT_TAG_NAME_RE.test(trimmed)) {
    throw new Error(
      `The { as } option tag must be a valid HTML element name (got "${tag}"). ` +
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

function wrapIslandSlotHtml({
  tag,
  id,
  propsAttr,
  inner,
}: {
  tag: string;
  id: string;
  propsAttr: string;
  inner: string;
}): string {
  return `<${tag} ${SLOT_ATTR}="${escapeHtml(id)}"${propsAttr}>${inner}</${tag}>`;
}

function isStableInlineSlotMount({
  initialHtml,
  renderedHtml,
  slotIds,
}: {
  initialHtml: string;
  renderedHtml: string;
  slotIds: Iterable<string>;
}): boolean {
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
  captureActions = false,
): Record<string, unknown> | undefined {
  if (props === undefined) return undefined;
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(props)) {
    if (key === "children") continue;
    const value = props[key];
    if (typeof value === "function") {
      // Function props on client-referenced child slots become replayable
      // `{ __ilha: "action" }` markers so server islands can revive them.
      // Only brand-recognized action references qualify — arbitrary closures
      // are NEVER invoked or serialized during SSR (fail closed).
      const id = captureActions && !isRawHtmlValue(value) ? actionManifestId(value) : undefined;
      if (id) {
        const a = actionBoundArgs(value);
        (out ??= {})[key] = Array.isArray(a)
          ? { __ilha: "action", k: id, a }
          : { __ilha: "action", k: id };
      }
      continue;
    }
    if (typeof value === "symbol") continue;
    const encoded = encodeSlotPropValue(value);
    if (encoded === undefined && value !== undefined && value !== null) continue;
    (out ??= {})[key] = encoded;
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
    if (next !== undefined || obj[key] === null) encoded[key] = next;
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

/** Revive attr-parsed props, restoring tagged `__ilha:raw` RawHtml values. */
function reviveSlotProps(props: Record<string, unknown>): Record<string, unknown> {
  // Callers normally pass safeParseSnapshot output (already a plain object),
  // but guard so a mistaken non-object never throws inside revival.
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    return {};
  }
  return reviveSlotPropValue(props) as Record<string, unknown>;
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

      // A slot host that no longer belongs to a live child island no longer
      // participates in matching. If the template claims this position,
      // replace it outright.
      if (fromEl.hasAttribute(SLOT_ATTR) && !fromEl.isConnected) {
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

// ---------------------------------------------
// Shared URL / style safety policy
// ---------------------------------------------
//
// One implementation shared by the JSX runtime (jsx-runtime.ts) and the
// html`` template path (ilhaHtml) so both authoring styles apply the same
// scheme filtering and style serialization. If they diverge, a value that is
// safe in one style can become an injection vector in the other.
const SAFE_CSS_PROP_RE = /^(-{2}[a-zA-Z][a-zA-Z0-9-]*|-?[a-zA-Z][a-zA-Z0-9-]*)$/;
const URL_ATTRS = new Set([
  "href",
  "src",
  "srcset",
  "imagesrcset",
  "action",
  "formaction",
  "cite",
  "data",
  "poster",
]);
// Denylist of scheme prefixes plus an allowlist for `data:` — ALL data: URLs
// are rejected except tightly-scoped raster image types. This blocks not only
// text/html, xml, xhtml, and svg, but executable script MIME types like
// data:text/javascript and data:application/javascript too.
const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|avif)[;,]/i;
const UNSAFE_SCHEME_RE = /^(?:javascript|vbscript):/i;

// Raster data: URLs are allowed ONLY in true image contexts. Everywhere else
// (script/iframe/embed src, object data, navigation and form actions, …)
// every data: URL is rejected unconditionally.
const DATA_IMAGE_CONTEXTS = new Set(["img:src", "source:srcset", "link:imagesrcset"]);

// HTML parsers strip ASCII control chars (tab/newline/CR and friends) anywhere
// inside a URL before resolving its scheme, so "java\tscript:" reaches the
// browser as "javascript:". Normalize the same way before testing.
function normalizeUrl(value: string): string {
  // oxlint-disable-next-line no-control-regex -- intentional: mirrors the HTML parser stripping control chars from URLs
  return value.replace(/[\u0000-\u0020]/g, "");
}

function checkUrl(normalized: string, allowDataImage: boolean): boolean {
  if (UNSAFE_SCHEME_RE.test(normalized)) return false;
  if (/^data:/i.test(normalized)) return allowDataImage && SAFE_DATA_IMAGE_RE.test(normalized);
  return true;
}

/** Strict single-URL check — all data: URLs rejected. */
function isSafeUrl(value: string): boolean {
  return checkUrl(normalizeUrl(value), false);
}

/** Element- and attribute-aware URL policy for rendered attributes.
 * `srcset`/`imagesrcset` validate each comma-separated candidate URL. */
function isSafeUrlAttrValue(tagName: string, attrName: string, value: string): boolean {
  const attr = attrName.toLowerCase();
  // ponytail: naive comma-split srcset parsing misreads commas inside URLs
  // (e.g. base64 data: candidates), so srcset rejects ALL data: URLs instead
  // of context-gating them — img[src] remains the data-image escape hatch.
  // Upgrade path: a syntax-aware srcset parser.
  const allowDataImage =
    DATA_IMAGE_CONTEXTS.has(`${tagName.toLowerCase()}:${attr}`) &&
    !attr.startsWith("srcset") &&
    attr !== "imagesrcset";
  if (/^(?:srcset|imagesrcset)$/i.test(attr)) {
    return value.split(",").every((candidate) => {
      const url = candidate.trim().split(/\s+/)[0] ?? "";
      return url === "" || checkUrl(normalizeUrl(url), false);
    });
  }
  return checkUrl(normalizeUrl(value), allowDataImage);
}

function isUrlAttributeName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    URL_ATTRS.has(lower) ||
    /:(href|src|srcset|imagesrcset|action|formaction|cite|data|poster)$/.test(lower)
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
}

// Serialize a style object through the same allowlisted property list the JSX
// runtime uses. Unsafe values (markup-looking text, javascript:/expression())
// drop the whole declaration instead of silently rewriting it.
function serializeStyle(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([k, v]) => {
      if (!SAFE_CSS_PROP_RE.test(k)) return "";
      const prop = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const str = String(v);
      if (/[<>{};]/.test(str) || /expression\(/i.test(str) || /javascript:/i.test(str)) return "";
      return `${prop}:${str}`;
    })
    .filter(Boolean)
    .join(";");
}

// Escape data for a `<script>` element body: `<` becomes \u003C so neither
// `</script` nor the `<!--` script-escape hatch can truncate the block. The JS
// engine decodes `\u003C` inside string literals, so values round-trip
// exactly.
function serializeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003C");
}

// Escape text for a `<style>` element body: `<` becomes the CSS hex escape
// `\3C ` (the space terminates the escape and is valid in CSS strings, URLs
// and selector text).
function escapeStyleText(text: string): string {
  return text.replace(/</g, "\\3C ");
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

// Optional Astro renderer routing. @ilha/astro records its renderer name on
// this global when loaded; island construction reads it and, if present, tags
// the island with Astro's `astro:renderer` symbol so Astro routes the island to
// ilha's renderer regardless of the integration's position in `astro.config`.
// Astro otherwise picks the FIRST renderer whose `check()` accepts a component,
// and a permissive check (Solid's accepts any function whose output stringifies)
// registered first will claim ilha islands and render them as escaped raw HTML.
const ASTRO_RENDERER_GLOBAL = Symbol.for("ilha.astroRenderer");

const ISLAND_SLOT_TAG = Symbol.for("ilha.islandSlotTag");
const ISLAND_CLIENT_REF = Symbol.for("ilha.clientRef");

/** @internal Sync re-render of an island from a state snapshot. Attached by
 * render(); used by server-frame endpoints to produce HTML for streamed
 * updates without a live mount. Not part of the public surface. */
const ISLAND_RENDER_STATE = Symbol.for("ilha.renderState");

/** Hydration-manifest entry: an action key, optionally with the static
 * `[handler, ...args]` payload captured at render time. */
type EventManifestEntry = string | { k: string; a: unknown[] };

/** @internal Async SSR render that records the event→action manifest into the
 * provided map. Used by emitIslandSlot so nested server islands ship their
 * interactive surface alongside their inlined HTML. */
const ISLAND_SSR_MANIFEST = Symbol.for("ilha.ssrManifest");

const SLOT_ATTR = "data-ilha-slot";
const PROPS_ATTR = "data-ilha-props";
const CLIENT_REF_ATTR = "data-ilha-client-ref";
const STATE_ATTR = "data-ilha-state";
/** Hydration manifest mapping `${type}:${index}` event-sentinel pairs to the
 * action keys that own them. Emitted by hydratable(); lets server-owned
 * islands (whose render fn never ships to the client) reconnect their
 * interactive surface. */
export interface RawHtml {
  [RAW]: true;
  value: string;
}

// ---------------------------------------------
// each() — Svelte-style {#each} iteration
// ---------------------------------------------

/** Mapped list result — usable directly in templates; chain `.else()` for empty fallback. */
export type EachResult<TItem, TOut> = TOut[] & {
  else<TEmpty>(fn: (items: readonly TItem[]) => TEmpty): TOut[] | TEmpty;
  else<TEmpty>(value: TEmpty): TOut[] | TEmpty;
};

export interface EachKeyedBuilder<TItem, TKey> {
  as<TOut>(fn: (item: TItem, index: number, key: TKey) => TOut): EachResult<TItem, TOut>;
}

export interface EachBuilder<TItem> {
  key<TKey>(fn: (item: TItem, index: number) => TKey): EachKeyedBuilder<TItem, TKey>;
  as<TOut>(fn: (item: TItem, index: number) => TOut): EachResult<TItem, TOut>;
}

function normalizeElseOutput<T>(value: T): T | readonly T[] {
  if (value == null || value === false) return value;
  return Array.isArray(value) ? value : [value];
}

function createEachResult<TItem, TOut>(
  items: readonly TItem[],
  mapFn: (item: TItem, index: number) => TOut,
): EachResult<TItem, TOut> {
  const mapped = items.length === 0 ? [] : items.map(mapFn);
  const result = mapped as EachResult<TItem, TOut>;
  Object.defineProperty(result, "else", {
    value<TEmpty>(fallback: TEmpty | ((items: readonly TItem[]) => TEmpty)): TOut[] | TEmpty {
      if (items.length === 0) {
        const resolved =
          typeof fallback === "function"
            ? (fallback as (items: readonly TItem[]) => TEmpty)(items)
            : fallback;
        return normalizeElseOutput(resolved) as TOut[] | TEmpty;
      }
      return mapped;
    },
    enumerable: false,
  });
  return result;
}

function createEachBuilder<TItem>(items: readonly TItem[]): EachBuilder<TItem> {
  return {
    key(keyFn) {
      return {
        as(mapFn) {
          return createEachResult(items, (item, index) => mapFn(item, index, keyFn(item, index)));
        },
      };
    },
    as(mapFn) {
      return createEachResult(items, mapFn);
    },
  };
}

/**
 * Svelte-style `{#each}` helper for mapping collections to rendered output
 * with an optional empty fallback.
 *
 * @example — plain list (empty → [])
 * each(items).as((item) => html`<li>${item.name}</li>`)
 *
 * @example — keyed list feeding island.key(), with empty fallback
 * each(items)
 *   .key((item) => item.id)
 *   .as((item, _i, id) => Row.key(id)({ item }))
 *   .else(() => html`<EmptyState />`)
 */
export function each<TItem>(items: readonly TItem[]): EachBuilder<TItem> {
  if (typeof items === "function") {
    throw new TypeError(
      "[ilha] each() expected an array but received a function. " +
        "Call accessors first (each(state.items())) or pass a snapshot from a reactive render.",
    );
  }
  return createEachBuilder(Array.isArray(items) ? items : []);
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
  // JSX event props (onclick={handler}, etc.) share the containing island's
  // lifecycle. Plain function components execute inside this same context,
  // so their handlers are collected and disposed with the parent island.
  events: JsxEventRecord[];
  // True when this render collects the hydration manifest (hydratable /
  // frame rendering). Only then are forwarding closures capture-invoked —
  // client renders never execute handlers at registration time.
  manifest?: boolean;
}

type BindKind = "value" | "checked" | "files" | "open" | "group" | "this";

interface BindRecord {
  kind: BindKind;
  accessor: ExternalSignal;
}

export type NativeEventModifier = "abortable" | "once" | "capture" | "passive";

export interface NativeEventContext {
  readonly signal: AbortSignal;
}

export type NativeEventHandler<E extends Event = Event> = (
  event: E,
  context: NativeEventContext,
) => unknown;

interface JsxEventRecord {
  type: string;
  handler: NativeEventHandler;
  modifier?: NativeEventModifier;
}

/** Marks SSR action stubs so event registration can recognize action
 * references without ever invoking them (executing a handler body during
 * render would run its side effects server-side). Symbol.for brands keep
 * this recognizable across duplicate ilha copies and external action
 * implementations (e.g. oxidejs) in the same realm. */
const SSR_ACTION_STUB = Symbol.for("ilha.ssrActionStub");
const ACTION_MANIFEST_ID = Symbol.for("ilha.actionManifestId");
const ACTION_BOUND_ARGS = Symbol.for("ilha.actionBoundArgs");

/** Serialized size ceiling for `.with()` payloads (JSON chars). */
const MAX_BOUND_ARGS_CHARS = 8192;

/** Manifest id for a brand-recognized action reference, else undefined.
 * Anything that isn't a branded action stub is rejected outright — event
 * handlers are never executed during SSR to discover what they call. */
function actionManifestId(fn: unknown): string | undefined {
  if (typeof fn !== "function" || !(SSR_ACTION_STUB in fn)) return undefined;
  return (fn as Record<symbol, string | undefined>)[ACTION_MANIFEST_ID];
}

/** Bound args recorded by `.with()` on an action reference, else undefined. */
function actionBoundArgs(fn: unknown): unknown[] | undefined {
  if (typeof fn !== "function" || !(ACTION_BOUND_ARGS in fn)) return undefined;
  const args = (fn as Record<symbol, unknown>)[ACTION_BOUND_ARGS];
  return Array.isArray(args) ? args : undefined;
}

/** Attach `.with(...args)` to an action accessor. Returns an explicit,
 * serializable action REFERENCE — never a closure to inspect or probe.
 * Arguments are validated JSON-safe at bind time; the hydration manifest
 * stores `{ actionId, args }` directly and the client RPC path sends them
 * only after a real user event. On the client, calling the bound reference
 * invokes the accessor with the bound payload. */
/** Keys that must never appear in a bound payload — they become dangerous
 * if an RPC handler or downstream library merges the object into another. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Strict JSON-safety validator: accept, or throw — never transform.
 * Rejects undefined, functions, symbols, bigint, non-finite numbers,
 * Dates/custom prototypes/Map/Set, circular values, and unsafe keys so a
 * bound payload is byte-identical to what the author wrote. */
function assertJsonSafe(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null) return;
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      if (Number.isFinite(value)) return;
      throw new TypeError("with() rejects non-finite numbers.");
    case "object":
      break;
    default:
      // undefined, function, symbol, bigint
      throw new TypeError(`with() rejects ${typeof value} values.`);
  }
  if (seen.has(value as object)) throw new TypeError("with() rejects circular values.");
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonSafe(item, seen);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("with() accepts plain objects only.");
  }
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) {
      throw new TypeError(`with() rejects unsafe key "${key}".`);
    }
    assertJsonSafe(child, seen);
  }
}

/** Deep-clone an already-validated JSON-safe value. */
function cloneJsonSafe(value: unknown): unknown {
  return structuredClone(value);
}

function attachWith(accessor: Function): void {
  Object.defineProperty(accessor, "with", {
    enumerable: false,
    value: (...args: unknown[]) => {
      for (const arg of args) assertJsonSafe(arg);
      const serialized = cloneJsonSafe(args) as unknown[];
      if (JSON.stringify(serialized).length > MAX_BOUND_ARGS_CHARS) {
        throw new RangeError(`with() payload exceeds ${MAX_BOUND_ARGS_CHARS} JSON characters.`);
      }
      const manifestId = actionManifestId(accessor);
      const bound = (...runtimeArgs: unknown[]) => {
        // Bound payload wins; runtime args (the DOM event) apply only when
        // nothing was bound — matching a plain direct reference.
        const payload =
          serialized.length > 0
            ? serialized.length === 1
              ? serialized[0]
              : serialized
            : runtimeArgs.length === 1
              ? runtimeArgs[0]
              : runtimeArgs;
        return (accessor as (...a: unknown[]) => unknown)(payload);
      };
      // SAFETY: internal Symbol.for branding on our own function object.
      const brand = bound as unknown as Record<symbol, unknown>;
      brand[SSR_ACTION_STUB] = true;
      brand[ACTION_MANIFEST_ID] = manifestId;
      brand[ACTION_BOUND_ARGS] = serialized;
      return bound;
    },
  });
}

setServerActionBinder(function bindExternalAction<A extends unknown[], R>(
  fn: (...args: A) => R,
  manifestId?: string,
): ServerAction<A, R> {
  const action = fn as typeof fn & Record<symbol, unknown>;
  action[SSR_ACTION_STUB] = true;
  action[ACTION_MANIFEST_ID] = manifestId;
  attachWith(action);
  return action as unknown as ServerAction<A, R>;
});

// Shared across duplicate ilha copies in one realm (app + component library).
// Module-local stacks break nested islands: a child island closed over copy B
// cannot see the parent render context from copy A, so it SSR-stringifies
// instead of returning an IslandCall and the parent only records a slot shell.
const RENDER_CTX_STACK = Symbol.for("ilha.renderCtxStack");

function renderCtxStack(): IslandRenderCtx[] {
  const g = globalThis as typeof globalThis & { [RENDER_CTX_STACK]?: IslandRenderCtx[] };
  return (g[RENDER_CTX_STACK] ??= []);
}

function pushRenderCtx(
  liveHost?: Element,
  asyncChildren?: boolean,
  manifest?: boolean,
): IslandRenderCtx {
  const ctx: IslandRenderCtx = {
    slots: new Map(),
    positional: 0,
    liveHost,
    pending: asyncChildren ? new Map() : undefined,
    binds: [],
    events: [],
    manifest,
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
function emitIslandSlot({
  island,
  props,
  key,
}: {
  island: AnyIsland;
  props: Record<string, unknown> | undefined;
  key: string | undefined;
}): string {
  const ctx = currentRenderCtx();

  // Assign id: user key wins; otherwise use positional index. Keys are
  // prefixed to avoid collision with positional ids in the same render.
  let id: string;
  if (key === undefined) {
    id = ctx ? `p:${ctx.positional++}` : "p:0";
  } else {
    id = `k:${key}`;
    if (ctx && __DEV__ && ctx.slots.has(id)) {
      warn(
        `Duplicate slot key "${key}" — two children with the same key in a ` +
          `single render will collide. Each .key() call must be unique.`,
      );
    }
  }

  if (ctx) ctx.slots.set(id, { island, props });

  const slotTag = getIslandSlotTag(island);

  const clientRef = (island as unknown as Record<symbol, unknown>)[ISLAND_CLIENT_REF];
  const attrProps = slotPropsForAttr(
    props,
    typeof clientRef === "string" && ctx?.manifest === true,
  );
  const propsAttr =
    (attrProps ? ` ${PROPS_ATTR}='${escapeHtml(JSON.stringify(attrProps))}'` : "") +
    (typeof clientRef === "string" ? ` ${CLIENT_REF_ATTR}="${escapeHtml(clientRef)}"` : "");

  // Client re-render path: emit an EMPTY stub. Post-morph, mountSlots rehomes
  // the preserved live slot element (with all its mounted children, listeners,
  // and state) into the stub's position. The morph therefore never walks into
  // a slot subtree — it just places a stub, and we swap the stub for the real
  // thing afterwards. New (not-yet-mounted) slots stay as stubs and get mounted
  // by mountSlots.
  if (ctx?.liveHost) {
    return wrapIslandSlotHtml({ tag: slotTag, id, propsAttr, inner: "" });
  }

  // SSR path: render the child's HTML inline.
  //
  // When async child rendering is enabled (ctx.pending is set — the parent
  // itself is in async SSR mode), pop the render context before rendering the
  // child through its explicit async SSR API. This allows child islands with
  // async derived() to settle instead of emitting loading markup.
  if (ctx?.pending) {
    popRenderCtx();
    try {
      // Prefer the manifest-recording path so nested server islands ship
      // their event→action manifest alongside the inlined HTML.
      const manifest: Map<string, EventManifestEntry> = new Map();
      const ssrWithManifest = (island as unknown as Record<symbol, unknown>)[
        ISLAND_SSR_MANIFEST
      ] as
        | ((
            props?: Record<string, unknown>,
            out?: Map<string, EventManifestEntry>,
          ) => string | Promise<string>)
        | undefined;
      const result = ssrWithManifest
        ? ssrWithManifest(props as Record<string, unknown>, manifest)
        : island.toStringAsync(props as Record<string, unknown>);
      const prefix = (): string => serializeServerManifest(manifest);

      if (result instanceof Promise) {
        // Store the pending render for later resolution by renderWithCtx.
        ctx.pending.set(
          id,
          result.then(String).then((html) => prefix() + html),
        );
        // Emit a stub containing a unique comment marker; resolveAsyncChildren
        // replaces the marker with the resolved inner HTML. Escaped
        // interpolations can never produce the marker text (it contains `<`).
        return wrapIslandSlotHtml({
          tag: slotTag,
          id,
          propsAttr,
          inner: asyncSlotMarker(id),
        });
      }

      // Child rendered synchronously — inline its HTML as usual.
      return wrapIslandSlotHtml({ tag: slotTag, id, propsAttr, inner: prefix() + String(result) });
    } finally {
      renderCtxStack().push(ctx);
    }
  }

  // Sync SSR path (no async children support). The child's renderToString
  // pushes its own render context so grandchildren are scoped correctly.
  const inner = island.toString(props);
  return wrapIslandSlotHtml({ tag: slotTag, id, propsAttr, inner });
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

declare const SIGNAL_WRITER_TYPE: unique symbol;

/** @internal Type-level write target carried by signal accessors. */
export interface SignalWriter<T> {
  readonly [SIGNAL_WRITER_TYPE]?: (value: T) => void;
}

type PathValue<T, P extends readonly PathSegment[]> = P extends readonly [infer Head, ...infer Tail]
  ? Head extends keyof T
    ? Tail extends readonly PathSegment[]
      ? PathValue<T[Head], Tail>
      : never
    : unknown
  : T;

interface MarkedSignalAccessor<T> extends SignalWriter<T> {
  (): T;
  set(value: T): void;
  update(fn: (previous: T) => T): void;
  select<S>(selector: (state: T) => S): MarkedSignalAccessor<S>;
  select<const P extends readonly PathSegment[]>(...path: P): MarkedSignalAccessor<PathValue<T, P>>;
  [SIGNAL_ACCESSOR]: true;
}

function markSignalAccessor<T>(read: () => T, write: (value: T) => void): MarkedSignalAccessor<T> {
  // SAFETY: brand stamp on the read function; Record<symbol, boolean> is the stamp shape.
  (read as unknown as Record<symbol, boolean>)[SIGNAL_ACCESSOR] = true;
  const accessor = read as MarkedSignalAccessor<T>;
  accessor.set = (value) => write(value);
  accessor.update = (fn) => {
    const prevSub = setActiveSub(undefined);
    try {
      write(fn(read()));
    } finally {
      setActiveSub(prevSub);
    }
  };
  accessor.select = ((...args: Array<((state: unknown) => unknown) | PathSegment>) =>
    createSelectAccessor(accessor, args)) as MarkedSignalAccessor<T>["select"];
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

function setAtPath({
  object,
  path,
  value,
}: {
  object: unknown;
  path: readonly PathSegment[];
  value: unknown;
}): unknown {
  const obj = object;
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(obj)) {
    const idx = head as number;
    if (idx < 0 || idx >= obj.length) return obj;
    const next = obj[idx];
    const updated = rest.length === 0 ? value : setAtPath({ object: next, path: rest, value });
    if (Object.is(next, updated)) return obj;
    const copy = obj.slice();
    copy[idx] = updated;
    return copy;
  }
  if (obj !== null && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    const key = String(head);
    const next = record[key];
    const updated = rest.length === 0 ? value : setAtPath({ object: next, path: rest, value });
    if (rest.length === 0) {
      if (Object.is(next, value)) return obj;
    } else if (Object.is(next, updated)) {
      return obj;
    }
    return { ...record, [key]: updated };
  }
  return rest.length === 0 ? value : setAtPath({ object: undefined, path: rest, value });
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

function createSelectAccessor(
  root: MarkedSignalAccessor<any>,
  input: Array<((state: unknown) => unknown) | PathSegment>,
): MarkedSignalAccessor<unknown> {
  const hasSelector = typeof input[0] === "function";
  const selector = hasSelector ? (input[0] as (state: unknown) => unknown) : undefined;
  // Resolve the traversal path either by running the selector through the
  // tracking proxy (selector form) or by taking the literal property path
  // (variadic form). The variadic path skips the Proxy tracker entirely.
  let path: readonly PathSegment[];
  if (selector) {
    path = trackSelectPath(root(), selector);
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
  } else {
    path = input as PathSegment[];
  }
  const read = (from: unknown): unknown =>
    selector ? (path.length === 0 ? selector(from) : getAtPath(from, path)) : getAtPath(from, path);
  return markSignalAccessor(
    () => read(root()),
    (value) => {
      const previousRoot = root();
      const next =
        path.length === 0 && selector ? value : setAtPath({ object: previousRoot, path, value });
      if (!Object.is(previousRoot, next)) root.set(next);
    },
  );
}

// ---------------------------------------------
// Public helpers
// ---------------------------------------------

function ilhaRaw(value: string): RawHtml {
  return { [RAW]: true, value };
}

/**
 * Serialize a JSON-safe value into executable `<script>` content safely. `<`
 * is escaped as `\u003C`, so a value can never close the script block or open
 * the `<!--` escape hatch. Use it for script-element data:
 *
 * ```ts
 * html`<script>const d = ${json(payload)};</script>`
 * ```
 *
 * Like `raw()`, `json()` is for element *content* only — interpolating it into
 * an attribute is author error. It does not protect against values that are
 * not valid JSON (functions, symbols, undefined, cyclic objects are dropped
 * or throw, matching `JSON.stringify`).
 */
export function json(value: unknown): RawHtml {
  return ilhaRaw(serializeScriptJson(value));
}

/**
 * Escape text for a `<style>` element body. `<` becomes the CSS hex escape
 * `\3C `, so the value can never close the style block or open the `<!--`
 * escape hatch while surviving CSS parsing:
 *
 * ```ts
 * html`<style>${css(cssSource)}</style>`
 * ```
 *
 * Like `raw()`, `css()` is for element *content* only — interpolating it into
 * an attribute is author error.
 */
export function css(value: string): RawHtml {
  return ilhaRaw(escapeStyleText(value));
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
    return emitIslandSlot({ island: call.island, props: call.props, key: call.key });
  }
  if (isIsland(v)) return emitIslandSlot({ island: v, props: undefined, key: undefined });
  if (isSignalAccessor(v)) return escapeHtml(v());
  if (typeof v === "function") return escapeHtml((v as () => unknown)());
  return escapeHtml(v);
}

// ---------------------------------------------
// bind: template syntax
// ---------------------------------------------
//
// html`` parses into the shared template IR so attribute policy (URL, class,
// aria booleans, bind:/on*) matches JSX. Bindings record a
// `data-ilha-bind="KIND:INDEX"` sentinel that applyTemplateBindings reads back.
const BIND_VALID_KINDS = new Set<BindKind>(["value", "checked", "files", "open", "group", "this"]);
const NATIVE_EVENT_MODIFIERS = new Set<NativeEventModifier>([
  "abortable",
  "once",
  "capture",
  "passive",
]);

function resolveTemplateValue(v: unknown): unknown {
  if (isSignalAccessor(v)) return v();
  if (typeof v === "function") return (v as () => unknown)();
  return v;
}

// Emit the canonical SSR attribute(s) for a binding, plus the sentinel.
// Returns [valueAttrs, specFragment] — valueAttrs are HTML attributes to
// inject into the element (may be empty for ref/file bindings), and
// specFragment is the sentinel token for the combined data-ilha-bind attr.
function emitBindSSR({
  kind,
  index,
  accessor,
  optionValue,
}: {
  kind: BindKind;
  index: number;
  accessor: ExternalSignal;
  optionValue?: string | null;
}): [string, string] {
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
      if (optionValue == null) return [``, spec];
      const isMatched = Array.isArray(v)
        ? v.map(String).includes(optionValue)
        : v != null && String(v) === optionValue;
      return [isMatched ? ` checked` : ``, spec];
    }
  }
}

const TEMPLATE_ATTRIBUTE_ALIASES: Record<string, string> = {
  className: "class",
  htmlFor: "for",
  acceptCharset: "accept-charset",
  httpEquiv: "http-equiv",
  accentHeight: "accent-height",
  alignmentBaseline: "alignment-baseline",
  baselineShift: "baseline-shift",
  clipPath: "clip-path",
  clipRule: "clip-rule",
  dominantBaseline: "dominant-baseline",
  fillOpacity: "fill-opacity",
  fillRule: "fill-rule",
  floodColor: "flood-color",
  floodOpacity: "flood-opacity",
  fontFamily: "font-family",
  fontSize: "font-size",
  fontStyle: "font-style",
  fontWeight: "font-weight",
  markerEnd: "marker-end",
  markerMid: "marker-mid",
  markerStart: "marker-start",
  stopColor: "stop-color",
  stopOpacity: "stop-opacity",
  strokeDasharray: "stroke-dasharray",
  strokeDashoffset: "stroke-dashoffset",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeMiterlimit: "stroke-miterlimit",
  strokeOpacity: "stroke-opacity",
  strokeWidth: "stroke-width",
  textAnchor: "text-anchor",
  vectorEffect: "vector-effect",
  xlinkHref: "xlink:href",
};
const TEMPLATE_VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const TEMPLATE_STRING_BOOLEANS = new Set(["contenteditable", "draggable", "spellcheck"]);
const TEMPLATE_SAFE_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;
const TEMPLATE_EVENT = /^on([a-z][a-z0-9-]*)(?::([a-z][a-z0-9-]*))?$/;

function normalizeTemplateClass(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(" ");
  if (isPlainObject(value)) {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([name]) => name)
      .join(" ");
  }
  return String(value);
}

function resolvedAttrText(rawSourceValue: unknown): string | null {
  const attribute = templateAttribute(rawSourceValue);
  const sourceValue = attribute ? attribute.value : rawSourceValue;
  if (sourceValue == null) return null;
  const parts = templateParts(sourceValue);
  const value = parts
    ? parts.map((part) => resolveTemplateValue(part) ?? "").join("")
    : resolveTemplateValue(sourceValue);
  if (value == null || value === false) return null;
  return String(value);
}

function renderTemplateElement(node: Extract<TemplateNode, { kind: "element" }>): string {
  const ctx = currentRenderCtx();
  let attrs = "";
  const eventSpecs: string[] = [];
  const bindSpecs: string[] = [];
  for (const [sourceName, rawSourceValue] of Object.entries(node.props)) {
    const attribute = templateAttribute(rawSourceValue);
    const sourceValue = attribute ? attribute.value : rawSourceValue;
    if (sourceName === "children" || sourceName === "key" || sourceValue == null) continue;
    if (sourceName === "__proto__" || sourceName === "constructor" || sourceName === "prototype")
      continue;
    const name =
      TEMPLATE_ATTRIBUTE_ALIASES[sourceName] ??
      (/^on[A-Z]/.test(sourceName) ? sourceName.toLowerCase() : sourceName);
    if (!TEMPLATE_SAFE_NAME.test(name)) continue;
    if (name.startsWith("bind:")) {
      const kind = name.slice(5) as BindKind;
      if (!BIND_VALID_KINDS.has(kind) || !isSignalAccessor(sourceValue)) {
        if (__DEV__) warn(`${name} requires a supported binding and signal accessor.`);
        continue;
      }
      if (!ctx) {
        if (__DEV__)
          warn(
            `${name} used outside an island render — the value is reflected once but not wired.`,
          );
        const value = sourceValue();
        if (kind === "value") attrs += ` value="${escapeHtml(value ?? "")}"`;
        else if ((kind === "checked" || kind === "open") && value) attrs += ` ${kind}`;
        continue;
      }
      const index = ctx.binds.length;
      ctx.binds.push({ kind, accessor: sourceValue as ExternalSignal });
      const [reflected, spec] = emitBindSSR({
        kind,
        index,
        accessor: sourceValue as ExternalSignal,
        optionValue: resolvedAttrText(node.props.value),
      });
      attrs += reflected;
      bindSpecs.push(spec);
      continue;
    }
    if (/^on/i.test(name)) {
      const match = TEMPLATE_EVENT.exec(name.toLowerCase());
      const parts = templateParts(sourceValue);
      if (parts?.some((part) => typeof part === "function")) {
        throw new Error(
          `[ilha] ${name} handler must occupy the entire attribute value. Write ${name}=\${handler}.`,
        );
      }
      if (!match || typeof sourceValue !== "function") {
        if (__DEV__) warn(`${name} requires an event handler function.`);
        continue;
      }
      const eventName = match[1]!;
      const rawModifier = match[2];
      const modifier =
        rawModifier !== undefined && NATIVE_EVENT_MODIFIERS.has(rawModifier as NativeEventModifier)
          ? (rawModifier as NativeEventModifier)
          : undefined;
      if (rawModifier && !modifier) {
        if (__DEV__) {
          warn(
            `Unknown native event modifier ":${rawModifier}" on on${eventName}. ` +
              `Supported modifiers are :once, :capture, :passive, and :abortable.`,
          );
        }
        continue;
      }
      const index = __ilhaJsxEvent({
        type: eventName,
        handler: sourceValue as NativeEventHandler,
        modifier,
      });
      if (index !== undefined) eventSpecs.push(`${eventName}:${index}`);
      continue;
    }
    const lower = name.toLowerCase();
    if (lower === "srcdoc") continue;
    const parts = templateParts(sourceValue);
    let value = parts
      ? parts.map((part) => resolveTemplateValue(part) ?? "").join("")
      : resolveTemplateValue(sourceValue);
    if (
      (lower.startsWith("aria-") || TEMPLATE_STRING_BOOLEANS.has(lower)) &&
      typeof value === "boolean"
    )
      value = String(value);
    if (lower === "class" && !isRawHtml(value)) value = normalizeTemplateClass(value);
    const structuredStyle = lower === "style" && isPlainObject(value) && !isRawHtml(value);
    if (structuredStyle) value = serializeStyle(value as Record<string, unknown>);
    if (
      isUrlAttributeName(lower) &&
      !isRawHtml(value) &&
      !isSafeUrlAttrValue(node.tag, lower, String(value))
    )
      continue;
    if (value === false || value == null) continue;
    if (
      (attribute?.bare && value === "") ||
      (value === true && !TEMPLATE_STRING_BOOLEANS.has(lower) && !lower.startsWith("aria-"))
    ) {
      attrs += ` ${name}`;
      continue;
    }
    const text = isRawHtml(value) ? value.value : String(value);
    const escaped = isRawHtml(value) ? text : escapeHtml(text);
    attrs +=
      attribute && !attribute.quoted && !structuredStyle && !/[\s"'`=<>]/.test(text)
        ? ` ${name}=${escaped}`
        : ` ${name}="${escaped}"`;
  }
  const key = node.props.key;
  if (key != null && node.props["data-key"] == null) attrs += ` data-key="${escapeHtml(key)}"`;
  if (bindSpecs.length) attrs += ` data-ilha-bind="${bindSpecs.join(",")}"`;
  if (eventSpecs.length) attrs += ` data-ilha-on="${eventSpecs.join(",")}"`;
  if (TEMPLATE_VOID_ELEMENTS.has(node.tag.toLowerCase()))
    return `<${node.tag}${attrs}${node.selfClosing ? " /" : ""}>`;
  return `<${node.tag}${attrs}>${node.children.map((child) => renderTemplateNode(child, node.tag)).join("")}</${node.tag}>`;
}

function renderTemplateNode(node: TemplateNode, parentTag?: string): string {
  switch (node.kind) {
    case "fragment":
      return node.children.map((child) => renderTemplateNode(child, parentTag)).join("");
    case "element":
      return renderTemplateElement(node);
    case "dynamic":
      return interpolateValue(node.value);
    case "comment":
      return `<!--${node.value.replace(/--/g, "- -")}-->`;
    case "text": {
      const parent = parentTag?.toLowerCase();
      return parent === "script" || parent === "style" ? node.value : escapeHtml(node.value);
    }
  }
}

function renderTemplate(node: TemplateNode): RawHtml {
  return ilhaRaw(renderTemplateNode(node));
}

setTemplateRenderer(renderTemplate);

function ilhaHtml(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  return renderTemplate(htmlTemplate(strings, values));
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

// Same accessor shape as state()/signal accessors; marked with SIGNAL_ACCESSOR
// so context signals work in render subscription, bind:* syntax, and .select().
type ContextSignal<T> = SignalAccessor<T>;
const contextRegistry = new Map<string, ContextSignal<unknown>>();

function ilhaContextFn<T>(key: string, initial: T): ContextSignal<T> {
  if (contextRegistry.has(key)) return contextRegistry.get(key) as ContextSignal<T>;
  const s = signal(initial);
  // Marked as a signal accessor so context signals work everywhere a local
  // state accessor does: render subscription, bind:* template syntax,
  // .select() paths, and standalone effect()/persist().
  const accessor = markSignalAccessor(
    () => s() as T,
    (next) => {
      s(next);
    },
  );
  contextRegistry.set(key, accessor as unknown as ContextSignal<unknown>);
  return accessor as unknown as ContextSignal<T>;
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
 * Internal: used by state()'s slot-drift fallback. The public way to create
 * free-standing shared state is `context(key, initial)`.
 */
function ilhaSignal<T>(initial: T): SignalAccessor<T> {
  if (currentFrame()?.creating && __DEV__) {
    warn(
      "signal() created during an island render resets on every rerender — " +
        "use state() for island-local state.",
    );
  }
  const s = signal(initial);
  return markSignalAccessor(
    () => s(),
    (next) => {
      s(next);
    },
  );
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
  const stop = alienEffect(() => {
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
// persist() — storage sync for standalone signals
// ---------------------------------------------

/** Minimal storage surface — `localStorage`, `sessionStorage`, or a custom adapter. */
export type PersistStorage = Pick<Storage, "getItem" | "setItem">;

export interface PersistOptions<T> {
  /** Storage backend. Default: `window.localStorage`. */
  storage?: PersistStorage;
  /**
   * Mirror writes from other tabs via the window `storage` event. Only active
   * for the default `localStorage` backend. Default: `true`.
   */
  crossTab?: boolean;
  /** Value → string. Default: `JSON.stringify`. */
  serialize?: (value: T) => string;
  /** String → value. Default: `JSON.parse` (malformed payloads are ignored). */
  deserialize?: (raw: string) => T | null;
}

/**
 * Keep a standalone signal in sync with persistent storage:
 *
 * 1. On call, reads `key` and writes the stored value into the signal.
 * 2. Subscribes to the signal and writes its value back on every change.
 * 3. Optionally mirrors writes from other tabs (`storage` events).
 *
 * No-op on the server (returns an inert unsubscribe). Call the returned
 * unsubscribe to stop syncing.
 *
 * ```ts
 * const cart = signal([] as string[]);
 * persist(cart, "cart");
 * ```
 */
export function persist<T>(
  accessor: SignalAccessor<T>,
  key: string,
  options: PersistOptions<T> = {},
): () => void {
  if (typeof window === "undefined") return () => {};
  const storage = options.storage ?? window.localStorage;
  const serialize = options.serialize ?? (JSON.stringify as (value: T) => string);
  const deserialize =
    options.deserialize ??
    ((raw: string): T | null => {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    });

  const label = `[ilha] persist("${key}")`;
  const applyRaw = (raw: string | null): void => {
    if (raw == null) return;
    try {
      const value = deserialize(raw);
      if (value !== null) {
        const prevSub = setActiveSub(undefined);
        try {
          accessor.set(value as T);
        } finally {
          setActiveSub(prevSub);
        }
      }
    } catch (err) {
      console.error(`${label}: failed to restore`, err);
    }
  };

  // 1. Hydrate from storage.
  try {
    applyRaw(storage.getItem(key));
  } catch (err) {
    console.error(`${label}: failed to read storage`, err);
  }

  // 2. Write-through on every signal change.
  const stopEffect = ilhaEffect(() => {
    try {
      storage.setItem(key, serialize(accessor()));
    } catch (err) {
      console.error(`${label}: failed to write storage`, err);
    }
  });

  // 3. Cross-tab sync (localStorage only — sessionStorage/custom backends
  // don't emit cross-tab storage events).
  let onStorage: ((e: StorageEvent) => void) | null = null;
  if (options.crossTab !== false && storage === window.localStorage) {
    onStorage = (e) => {
      if (e.key !== key) return;
      applyRaw(e.newValue);
    };
    window.addEventListener("storage", onStorage);
  }

  return () => {
    stopEffect();
    if (onStorage) window.removeEventListener("storage", onStorage);
  };
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
  set(value: T): void;
  update(fn: (previous: T | undefined) => T | undefined): void;
};

function createDerivedAccessor<T>(
  read: () => DerivedValue<T>,
  write?: (value: T | undefined) => void,
): DerivedAccessor<T> {
  const accessor = markSignalAccessor(
    () => read().value,
    (value) => {
      if (write) write(value);
      else if (__DEV__) warn("derived values are read-only");
    },
  );

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

// ---------------------------------------------
// Bind
// ---------------------------------------------

// The contract type for `bind:*` template plumbing: a signal accessor the
// template can read/write. `ExternalSignal<T>` is an alias of
// `SignalAccessor<T>` — one type, two names (kept for template-syntax
// documentation and back-compat).
export type ExternalSignal<T = unknown> = SignalAccessor<T>;

const BIND_SENTINEL_ATTR = "data-ilha-bind";
const EVENT_SENTINEL_ATTR = "data-ilha-on";

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
  // Event name to listen on, or null for one-shot bindings such as `this`.
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

function templateElementBelongsToHost(host: Element, candidate: Element): boolean {
  if (candidate === host) return true;
  let current: Element | null = candidate;
  while (current && current !== host) {
    if (current.hasAttribute(SLOT_ATTR) || current.hasAttribute("data-ilha")) return false;
    current = current.parentElement;
  }
  return current === host;
}

// Walk the host's DOM for event sentinels owned by this island. Child island
// slots have independent render-local indexes and must wire themselves.
function applyJsxEvents({
  host,
  records,
  reportError,
  unmountSignal,
  onceFired,
}: {
  host: Element;
  records: JsxEventRecord[];
  reportError: (error: unknown) => void;
  unmountSignal: AbortSignal;
  onceFired: WeakMap<Element, Set<string>>;
}): () => void {
  if (records.length === 0) return () => {};

  const cleanups: Array<() => void> = [];
  const elements: Element[] = [];
  if (host.hasAttribute(EVENT_SENTINEL_ATTR)) elements.push(host);
  elements.push(
    ...Array.from(host.querySelectorAll<Element>(`[${EVENT_SENTINEL_ATTR}]`)).filter((element) =>
      templateElementBelongsToHost(host, element),
    ),
  );

  for (const el of elements) {
    const sentinel = el.getAttribute(EVENT_SENTINEL_ATTR) ?? "";
    for (const part of sentinel.split(",")) {
      const separator = part.lastIndexOf(":");
      if (separator < 1) continue;
      const type = part.slice(0, separator);
      const index = Number(part.slice(separator + 1));
      if (!Number.isInteger(index) || index < 0) continue;
      const record = records[index];
      if (!record || record.type !== type) continue;
      if (record.modifier === "once" && onceFired.get(el)?.has(type)) continue;

      const listenerController = new AbortController();
      let invocationController: AbortController | undefined;
      const options: AddEventListenerOptions = {
        once: record.modifier === "once",
        capture: record.modifier === "capture",
        passive: record.modifier === "passive",
      };
      const reportHandlerError = (error: unknown) => {
        if ((error as { name?: string })?.name !== "AbortError") reportError(error);
      };
      const listener: EventListener = (event) => {
        if (record.modifier === "once") {
          let fired = onceFired.get(el);
          if (!fired) onceFired.set(el, (fired = new Set()));
          fired.add(type);
        }
        if (record.modifier === "abortable") {
          invocationController?.abort();
          invocationController = new AbortController();
        }
        const signal = invocationController
          ? AbortSignal.any([listenerController.signal, invocationController.signal])
          : listenerController.signal;
        let result: unknown;
        startBatch();
        try {
          result = record.handler(event, { signal });
        } catch (error) {
          reportHandlerError(error);
          return;
        } finally {
          endBatch();
        }
        if (result != null && typeof (result as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(result).catch(reportHandlerError);
        }
      };
      const stop = () => {
        listenerController.abort();
        invocationController?.abort();
        el.removeEventListener(type, listener, options);
      };
      el.addEventListener(type, listener, options);
      unmountSignal.addEventListener("abort", stop, { once: true });
      cleanups.push(() => {
        unmountSignal.removeEventListener("abort", stop);
        stop();
      });
    }
  }

  return () => cleanups.forEach((cleanup) => cleanup());
}

function applyTemplateBindings(
  host: Element,
  binds: BindRecord[],
  phase: "all" | "reflect" | "listen" = "all",
): () => void {
  if (binds.length === 0) return () => {};

  const cleanups: Array<() => void> = [];

  // Include the host itself in the walk so `<div data-ilha=… data-ilha-bind=…>`
  // (binding the host) works. NodeList from querySelectorAll excludes the
  // root; checking the host explicitly is cheap.
  const elements: Element[] = [];
  if (host.hasAttribute(BIND_SENTINEL_ATTR)) elements.push(host);
  for (const el of host.querySelectorAll<Element>(`[${BIND_SENTINEL_ATTR}]`)) {
    if (templateElementBelongsToHost(host, el)) elements.push(el);
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
        if (phase !== "listen") {
          accessor.set(el);
          cleanups.push(() => accessor.set(null));
        }
        continue;
      }

      if (phase !== "listen") {
        // Reflect current signal value into the DOM property. The morph
        // already syncs attributes, but for properties that diverge from
        // attributes (input.value after user typing, details.open after
        // click, checkbox.checked) we need to write the property here.
        try {
          write(el, accessor());
        } catch (err) {
          if (__DEV__) console.error(`[ilha] bind:${spec.kind} write failed:`, err);
        }
      }

      if (phase === "reflect" || event === null) continue;

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
            accessor.set(arr);
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
          accessor.set(coerced);
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
                `coercing to 0. Use a native oninput handler with valueAsNumber or string state.`,
            );
          }
          value = Number.isNaN(n) ? 0 : n;
        } else if (typeof currentVal === "boolean") {
          value = Boolean(raw);
        }
        accessor.set(value);
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

/** Island-local reactive state returned by the state() primitive. */
export type StateAccessor<T> = MarkedSignalAccessor<T>;

/** A function component body: receives current props, returns HTML. */
export type IslandComponent<P> = (props: P) => string | RawHtml;

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

export interface Island<TInput = Record<string, unknown>> {
  // Calling an island is reserved for child composition inside another
  // island's render. Use toString()/toStringAsync() for top-level SSR.
  (props?: Partial<TInput>): IslandCall;
  toString(props?: Partial<TInput>): string;
  /**
   * Async SSR: renders the island and awaits async derived values before
   * returning the HTML string. Always returns a Promise.
   */
  toStringAsync(props?: Partial<TInput>): Promise<string>;
  mount(host: Element, props?: Partial<TInput>): () => void;
  hydratable(props: Partial<TInput>, options: HydratableOptions): Promise<string>;
  // Create a keyed invocation for use inside html``/JSX list rendering. The
  // key stabilises slot identity across re-renders where positional order is
  // not reliable (e.g. reorderable lists). Keys must be unique within a
  // single parent render.
  key(key: string): KeyedIsland<TInput>;
  /**
   * Register this island as a custom element, usable from plain HTML or any
   * framework: `Counter.define("x-counter", { observe: ["label"] })` then
   * `<x-counter label="hi"></x-counter>`. Observed attributes become string
   * props and re-resolve on change; richer props can be assigned via the
   * element's `props` property. Mounts on connect, unmounts on disconnect.
   * No-op (with a dev warning) where customElements is missing.
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

type AnyIsland = Island<any>;

// ---------------------------------------------
// Actions
// ---------------------------------------------

type ActionCall<P> = [P] extends [undefined]
  ? () => void
  : unknown extends P
    ? () => void
    : (payload: P) => void;

/** A bound action can back native events or component callback props.
 * Runtime arguments are ignored when `.with()` binds a payload. */
type BoundActionHandler = (...runtimeArgs: unknown[]) => unknown;

/**
 * Reactive operation with execution state. `pending`, `data`, and `error`
 * are reactive: reading them during render subscribes the island render.
 */
export type ActionAccessor<P = undefined, R = void> = ActionCall<P> & {
  readonly pending: boolean;
  readonly data: Awaited<R> | undefined;
  readonly error: Error | undefined;
  /** Bind an explicit serializable payload into an RPC-replayable action
   * reference for server-owned islands (`onclick={remove.with(id)}`).
   * Arguments are validated JSON-safe (≤ 8 KiB serialized) at bind time and
   * stored in the hydration manifest — never extracted by executing code. */
  with: (...args: unknown[]) => BoundActionHandler;
};

// ---------------------------------------------
// Effect / error contexts
// ---------------------------------------------

export interface EffectContext {
  /**
   * AbortSignal that aborts when the effect re-runs (a dependency changed)
   * or when the island unmounts. Pass to `fetch` or check `signal.aborted`
   * after `await` boundaries to bail out of stale work.
   */
  signal: AbortSignal;
}

export interface EffectOnceContext {
  host: Element;
  /** AbortSignal that aborts when the island unmounts. */
  signal: AbortSignal;
  /** True when hydration restored existing markup/state for this instance. */
  hydrated: boolean;
}

export type EffectFn = (ctx: EffectContext) => void | (() => void);
export type EffectOnceFn = (ctx: EffectOnceContext) => void | (() => void);

// Where a reported error originated.
//  - "effect"     : an effect() body or its cleanup threw
//  - "once"       : an effect.once() callback or its cleanup threw
//  - "event"      : a JSX/html`` event handler threw or rejected
//  - "action"     : an action() callback threw or rejected
// Derived errors are intentionally NOT reported here: they are surfaced as
// first-class state via the accessor's `.error`. Malformed SSR snapshots are
// not reported either — they degrade gracefully (see safeParseSnapshot).
export type ErrorSource = "effect" | "once" | "event" | "action";

// Global error handlers, invoked when an island reports an error and has no
// local onError() handler registered. Lets apps install a single app-wide
// sink (logging/telemetry) without wiring onError() on every island.
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
 * and has no local onError() handler. Returns an unsubscribe function.
 */
export function onUncaughtError(fn: (error: Error, source: ErrorSource) => void): () => void {
  globalErrorHandlers.add(fn);
  return () => {
    globalErrorHandlers.delete(fn);
  };
}

export interface ErrorContext {
  error: Error;
  source: ErrorSource;
  host: Element;
}

export interface MountOptions {
  root?: Element;
  lazy?: boolean;
}

export interface MountResult {
  unmount: () => void | Promise<void>;
}

// ---------------------------------------------
// Combining abort signals
// ---------------------------------------------

// ---------------------------------------------
// Primitive frame — order-based slots
// ---------------------------------------------
//
// Every island instance owns one persistent frame: an ordered list of slots,
// one per primitive call site. The component function runs inside the frame;
// each primitive retrieves its slot by call order. On the first client pass
// (and on every fresh SSR render) slots are CREATED; on later client passes
// the existing accessors are returned so state survives re-renders.

type SlotKind = "state" | "derived" | "action" | "effect" | "once" | "error";

interface BaseSlot {
  kind: SlotKind;
}

interface StateSlot extends BaseSlot {
  kind: "state";
  acc: MarkedSignalAccessor<any>;
}

type DerivedUserFn = (ctx: { signal: AbortSignal }) => unknown;

interface DerivedSlot extends BaseSlot {
  kind: "derived";
  env: ReturnType<typeof signal<DerivedValue<unknown>>>;
  acc: DerivedAccessor<any>;
  fn: DerivedUserFn;
  /** The first SSR probe returned a Promise or async iterable. */
  ssrAsync: boolean;
  /** Seeded from a hydration snapshot — skip the first reactive run. */
  fromSnapshot: boolean;
}

interface ActionSlot extends BaseSlot {
  kind: "action";
  acc: ActionAccessor<any, any>;
  fn: (payload: any, ctx: { signal: AbortSignal }) => unknown;
}

interface EffectSlot extends BaseSlot {
  kind: "effect";
  fn: EffectFn;
}

interface OnceSlot extends BaseSlot {
  kind: "once";
  fn: EffectOnceFn;
}

interface ErrorSlot extends BaseSlot {
  kind: "error";
  fn: (ctx: ErrorContext) => void;
}

type FrameSlot = StateSlot | DerivedSlot | ActionSlot | EffectSlot | OnceSlot | ErrorSlot;

/** Per-render bookkeeping while a component executes inside a frame. */
interface PrimitiveFrame {
  slots: FrameSlot[];
  cursor: number;
  creating: boolean;
  ssr: boolean;
  instance: MountedInstance | null;
  /** Per-kind counters for positional snapshot indexes. */
  stateIndex: number;
  derivedIndex: number;
  actionIndex: number;
  /** SSR only: async derived results awaiting resolution. */
  pendingDerived: Array<{ index: number; promise: Promise<void> }> | null;
  /** SSR only: action stub identities → deterministic manifest id (`a0`…). */
  actionManifest: Map<Function, string> | null;
  /** Dev-only: primitive-count-decrease already warned for this instance. */
  driftWarned?: boolean;
}

// Shared across duplicate ilha copies in one realm (app + component library),
// same as RENDER_CTX_STACK: a component bundled against copy B must register
// primitives into copy A's frame when copy A drives the render.
const FRAME_STACK = Symbol.for("ilha.primitiveFrameStack");

function frameStack(): PrimitiveFrame[] {
  const g = globalThis as typeof globalThis & { [FRAME_STACK]?: PrimitiveFrame[] };
  return (g[FRAME_STACK] ??= []);
}

function currentFrame(): PrimitiveFrame | undefined {
  const stack = frameStack();
  return stack[stack.length - 1];
}

function withFrame<T>(frame: PrimitiveFrame, fn: () => T): T {
  frameStack().push(frame);
  try {
    return fn();
  } finally {
    frameStack().pop();
  }
}

function freshFrame(options?: {
  ssr?: boolean;
  instance?: MountedInstance | null;
}): PrimitiveFrame {
  return {
    slots: [],
    cursor: 0,
    creating: true,
    ssr: options?.ssr ?? false,
    instance: options?.instance ?? null,
    stateIndex: 0,
    derivedIndex: 0,
    actionIndex: 0,
    pendingDerived: options?.ssr ? [] : null,
    actionManifest: options?.ssr ? new Map() : null,
  };
}

/** Dev-only post-pass check: fewer primitive calls than persistent slots means
 * a conditional primitive registration changed the hook sequence. Detect it
 * here (calls that merely disappear never reach acquireSlot). */
function checkFrameDrift(frame: PrimitiveFrame): void {
  if (!__DEV__ || frame.driftWarned || frame.cursor >= frame.slots.length) return;
  frame.driftWarned = true;
  warn(
    `Primitive call count decreased from ${frame.slots.length} to ${frame.cursor} — ` +
      `a conditional primitive registration changed the hook sequence after mount. ` +
      `Call primitives unconditionally in the same order on every render.`,
  );
}

const PRIMITIVE_NAMES: Record<SlotKind, string> = {
  state: "state",
  derived: "derived",
  action: "action",
  effect: "effect",
  once: "effect.once",
  error: "onError",
};

/** Reserve the next slot for a primitive call. Throws outside an island
 * render; warns in dev on hook count/kind drift during re-renders. */
function acquireSlot<K extends SlotKind>(kind: K): Extract<FrameSlot, { kind: K }> | undefined {
  const frame = currentFrame();
  if (!frame) {
    throw new Error(
      `[ilha] ${PRIMITIVE_NAMES[kind]}() called outside an island render. Primitives ` +
        `are only valid while an island component (or a plain component owned by ` +
        `one) is rendering.`,
    );
  }
  const index = frame.cursor++;
  if (frame.creating) return undefined;
  const existing = frame.slots[index];
  if (__DEV__) {
    if (!existing) {
      warn(
        `${PRIMITIVE_NAMES[kind]}() at primitive position ${index} has no persistent slot — ` +
          `the number of primitive calls changed after mount. Keep the same primitive ` +
          `sequence on every render.`,
      );
    } else if (existing.kind !== kind) {
      warn(
        `${PRIMITIVE_NAMES[kind]}() at primitive position ${index} was previously registered ` +
          `as ${PRIMITIVE_NAMES[existing.kind]}(). Primitive calls must keep the same order ` +
          `and kind on every render.`,
      );
    }
  }
  return existing && existing.kind === kind
    ? (existing as Extract<FrameSlot, { kind: K }>)
    : undefined;
}

// ---------------------------------------------
// state()
// ---------------------------------------------

/**
 * Declare island-local reactive state at this call position. The initializer
 * applies only when the instance is created — later renders reuse the same
 * underlying signal, so prop-driven initializers never reset user state.
 *
 * A function argument is treated as a lazy initializer:
 *   const count = state(() => expensiveInitialValue());
 * To store a function VALUE, pass it to `.set`:
 *   onSave.set(nextCallback);
 */
export function state<T>(init?: T | (() => T)): StateAccessor<T> {
  const frame = currentFrame();
  const existing = acquireSlot("state");
  if (existing) return existing.acc as StateAccessor<T>;
  const f = frame!;
  if (!f.creating) {
    // Slot drift after mount (already warned in dev) — degrade gracefully.
    // SAFETY: a fresh standalone signal is a valid state accessor stand-in
    // once slot persistence is gone; the accessor shape is identical.
    return ilhaSignal(undefined as unknown as T) as StateAccessor<T>;
  }
  const index = f.stateIndex++;

  // A hydration snapshot wins over the initializer (and skips lazy work).
  const snap = f.ssr ? undefined : f.instance?.stateSnapshot?.s?.[index];
  const initial: unknown =
    snap === undefined ? (typeof init === "function" ? (init as () => T)() : init) : snap;

  const s = signal(initial);
  const acc = markSignalAccessor(
    () => s() as T,
    (next) => {
      s(next);
    },
  );
  f.slots[f.cursor - 1] = { kind: "state", acc };
  return acc as StateAccessor<T>;
}

// ---------------------------------------------
// derived()
// ---------------------------------------------

/** True for async iterables (incl. async generators). */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
  );
}

/**
 * Declare derived state at this call position: synchronous computations,
 * Promises, or async generators. Reads track their dependencies; async work
 * races latest-run-wins and aborts stale runs through `ctx.signal`.
 */
export function derived<V>(
  fn: (ctx: { signal: AbortSignal }) => V | Promise<V> | AsyncIterable<V>,
): DerivedAccessor<V> {
  const frame = currentFrame();
  const existing = acquireSlot("derived");
  const f = frame!;
  if (existing) {
    // Refresh the closure so re-renders capture current props.
    const slot = existing as DerivedSlot;
    slot.fn = fn as DerivedUserFn;
    // Async SSR renders twice: once to discover pending work, then again after
    // it resolves. Recompute synchronous slots during that second pass so
    // derived chains observe the resolved upstream envelopes. Never restart an
    // async slot here — its first pull already populated the envelope.
    if (f.ssr && !f.creating && !slot.ssrAsync) {
      const ac = new AbortController();
      const prevSub = setActiveSub(undefined);
      try {
        const result = slot.fn({ signal: ac.signal });
        if (!(result instanceof Promise) && !isAsyncIterable(result)) {
          slot.env({ loading: false, value: result, error: undefined });
        }
      } catch (err) {
        slot.env({
          loading: false,
          value: undefined,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      } finally {
        setActiveSub(prevSub);
      }
    }
    return slot.acc as DerivedAccessor<V>;
  }
  if (!f.creating) {
    return defaultDerivedAccessor() as DerivedAccessor<V>;
  }
  const index = f.derivedIndex++;

  const env = signal<DerivedValue<unknown>>({ loading: false, value: undefined, error: undefined });

  let fromSnapshot = false;
  if (!f.ssr) {
    const snap = f.instance?.stateSnapshot?.d?.[index];
    if (snap) {
      env({ ...snap });
      fromSnapshot = true;
    }
  }

  const accessor = createDerivedAccessor(
    () => env(),
    (value) => {
      const prevSub = setActiveSub(undefined);
      try {
        env({ loading: false, value, error: undefined });
      } finally {
        setActiveSub(prevSub);
      }
    },
  );

  const slot: DerivedSlot = {
    kind: "derived",
    env,
    acc: accessor as DerivedAccessor<any>,
    fn: fn as DerivedUserFn,
    ssrAsync: false,
    fromSnapshot,
  };

  if (f.ssr) {
    // Probe once synchronously: sync results resolve immediately; Promises
    // and async generators are pulled asynchronously and recorded so
    // toStringAsync()/hydratable() can await them.
    const ac = new AbortController();
    const prevSub = setActiveSub(undefined);
    let result: unknown;
    let threw = false;
    let syncError: unknown;
    try {
      result = slot.fn({ signal: ac.signal });
    } catch (err) {
      threw = true;
      syncError = err;
    } finally {
      setActiveSub(prevSub);
    }

    let pull: Promise<void> | null = null;
    if (threw) {
      env({
        loading: false,
        value: undefined,
        error: syncError instanceof Error ? syncError : new Error(String(syncError)),
      });
    } else if (result instanceof Promise) {
      env({ loading: true, value: undefined, error: undefined });
      pull = result.then(
        (value) => env({ loading: false, value, error: undefined }),
        (err: unknown) =>
          env({
            loading: false,
            value: undefined,
            error: err instanceof Error ? err : new Error(String(err)),
          }),
      );
      // Swallow double-reporting; the envelope carries the error.
      (result as Promise<unknown>).catch(() => {});
    } else if (isAsyncIterable(result)) {
      env({ loading: true, value: undefined, error: undefined });
      const iterable = result;
      pull = (async () => {
        const it = iterable[Symbol.asyncIterator]();
        try {
          const first = await it.next();
          env({ loading: false, value: first.done ? undefined : first.value, error: undefined });
        } finally {
          await it.return?.(undefined);
        }
      })();
    } else {
      env({ loading: false, value: result, error: undefined });
    }

    slot.ssrAsync = pull !== null;
    if (pull) f.pendingDerived!.push({ index, promise: pull.catch(() => {}) });
  }

  f.slots[f.cursor - 1] = slot;
  return accessor as DerivedAccessor<V>;
}

// ---------------------------------------------
// action()
// ---------------------------------------------

/**
 * Declare a reactive operation at this call position. Use plain functions
 * for ordinary operations; action() adds pending/data/error tracking,
 * concurrent-invocation bookkeeping, and lifecycle cancellation.
 */
export function action<P, R>(
  fn: (payload: P, ctx: { signal: AbortSignal }) => R,
): ActionAccessor<P, R> {
  const frame = currentFrame();
  const existing = acquireSlot("action");
  const f = frame!;
  if (existing) {
    // Keep the first-render closure: actions may capture mount-time locals
    // (e.g. `let host` assigned by effect.once), and swapping closures after
    // rerenders would orphan those assignments.
    return existing.acc as ActionAccessor<P, R>;
  }
  if (!f.creating) {
    const noop = (() => {}) as ActionAccessor<P, R>;
    Object.defineProperties(noop, {
      pending: { get: () => false },
      data: { get: () => undefined },
      error: { get: () => undefined },
    });
    attachWith(noop);
    return noop;
  }
  const index = f.actionIndex++;
  const manifestId = `a${index}`;

  if (f.ssr) {
    // SSR stub: actions run only after mount; never execute side effects
    // during render. Calls are ignored with a dev warning.
    let warned = false;
    const invoke = (..._callArgs: unknown[]) => {
      if (__DEV__ && !warned) {
        warned = true;
        warn(`An action was called during SSR and was ignored. Actions run only after mount.`);
      }
    };
    // SAFETY: SSR_ACTION_STUB is a Symbol.for brand this module sets and the
    // SSR manifest capture path checks; the Record cast is internal branding.
    (invoke as unknown as Record<symbol, unknown>)[SSR_ACTION_STUB] = true;
    (invoke as unknown as Record<symbol, unknown>)[ACTION_MANIFEST_ID] = manifestId;
    Object.defineProperties(invoke, {
      pending: { get: () => false, enumerable: true },
      data: { get: () => undefined, enumerable: true },
      error: { get: () => undefined, enumerable: true },
    });
    f.actionManifest!.set(invoke, manifestId);
    f.slots[f.cursor - 1] = {
      kind: "action",
      acc: invoke as ActionAccessor<any, any>,
      fn: fn as ActionSlot["fn"],
    };
    // SAFETY: invoke is a closure branded with ISLAND_ACCESSOR / action
    // symbols and registered in f.slots; the cast widens it to the public
    // accessor shape (pending/data/error accessors + invoke signature).
    const ssrAccessor = invoke as unknown as ActionAccessor<P, R>;
    attachWith(ssrAccessor);
    return ssrAccessor;
  }

  const instance = f.instance!;
  const envelope = signal<{ pending: number; data: unknown; error: Error | undefined }>({
    pending: 0,
    data: undefined,
    error: undefined,
  });
  const readEnvelope = () => untrack(() => envelope());
  let latestRun = 0;

  const invoke = (payload?: unknown): void => {
    if (currentRenderCtx()) {
      if (__DEV__)
        warn(
          `An action was called during render and was ignored. Call actions from an event handler, effect, or effect.once.`,
        );
      return;
    }
    if (instance.disposed) {
      if (__DEV__) warn(`An action was called after unmount and was ignored.`);
      return;
    }
    const run = ++latestRun;
    const runSignal = instance.unmountController.signal;
    let result: unknown;
    let isAsync = false;
    startBatch();
    try {
      result = slot.fn(payload, { signal: runSignal });
      isAsync = result != null && typeof (result as PromiseLike<unknown>).then === "function";
      const current = readEnvelope();
      envelope(
        isAsync
          ? { pending: current.pending + 1, data: current.data, error: undefined }
          : { pending: current.pending, data: result, error: undefined },
      );
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      envelope({ pending: readEnvelope().pending, data: undefined, error: normalized });
      instance.reportError(normalized, "action");
      return;
    } finally {
      endBatch();
    }
    if (!isAsync) return;
    void Promise.resolve(result)
      .then((data) => {
        if (instance.disposed || runSignal.aborted || run !== latestRun) return;
        const value = readEnvelope();
        envelope({ pending: value.pending, data, error: undefined });
      })
      .catch((error: unknown) => {
        if (
          instance.disposed ||
          runSignal.aborted ||
          (error as { name?: string })?.name === "AbortError"
        ) {
          return;
        }
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (run === latestRun) {
          const value = readEnvelope();
          envelope({ pending: value.pending, data: undefined, error: normalized });
        }
        instance.reportError(normalized, "action");
      })
      .finally(() => {
        if (instance.disposed) return;
        const value = readEnvelope();
        envelope({ ...value, pending: Math.max(0, value.pending - 1) });
      });
  };

  const slot: ActionSlot = {
    kind: "action",
    acc: invoke as ActionAccessor<any, any>,
    fn: fn as ActionSlot["fn"],
  };

  Object.defineProperties(invoke, {
    pending: { get: () => envelope().pending > 0, enumerable: true },
    data: { get: () => envelope().data, enumerable: true },
    error: { get: () => envelope().error, enumerable: true },
  });
  // Manifest identity maps the accessor itself (used directly as an event
  // handler) AND the raw invoke — same function object here.
  f.slots[f.cursor - 1] = slot;
  instance.actionIds.set(slot.acc, manifestId);
  // SAFETY: invoke is the same closure object stored in the slot; the cast
  // restores the public action accessor type for the caller.
  const clientAccessor = invoke as unknown as ActionAccessor<P, R>;
  (clientAccessor as unknown as Record<symbol, string>)[ACTION_MANIFEST_ID] = manifestId;
  attachWith(clientAccessor);
  return clientAccessor;
}

// ---------------------------------------------
// effect() / effect.once()
// ---------------------------------------------

/**
 * Reactive side effect. Inside an island render, registers an ordered effect
 * slot that tracks signals read in the body, reruns on change, cleans up
 * before rerun and on unmount, and is client-only. Outside an island render,
 * behaves as the standalone reactive effect and returns a stop function.
 *
 * @returns Inside an island render, `void` (an effect slot is registered and
 * cleaned up automatically). At module scope, a stop function that disposes
 * the effect and runs its final cleanup. The union return type is deliberate:
 * the same call shape cannot be discriminated at the call site.
 */
export const effect: ((fn: EffectFn) => void | (() => void)) & {
  once(fn: EffectOnceFn): void;
} = Object.assign(
  (fn: EffectFn): void | (() => void) => {
    const frame = currentFrame();
    if (!frame) {
      // Standalone reactive effect (outside islands).
      let cleanup: void | (() => void);
      let controller: AbortController | null = null;
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
      const stop = ilhaEffect(() => {
        runCleanup();
        if (controller) controller.abort();
        controller = new AbortController();
        startBatch();
        try {
          cleanup = fn({ signal: controller.signal });
        } catch (err) {
          console.error(err);
        } finally {
          endBatch();
        }
      });
      return () => {
        stop();
        runCleanup();
        controller?.abort();
      };
    }
    const existing = acquireSlot("effect");
    if (existing) {
      // Refresh the closure so reruns see current props.
      existing.fn = fn;
      return;
    }
    if (!frame.creating) return;
    frame.slots[frame.cursor - 1] = { kind: "effect", fn };
    return;
  },
  {
    once(fn: EffectOnceFn): void {
      const existing = acquireSlot("once");
      if (existing) {
        // First-render closure wins — see the note in action().
        return;
      }
      const f = currentFrame();
      if (!f) {
        throw new Error(
          `[ilha] effect.once() called outside an island render. It registers per-instance ` +
            `setup and is only valid while an island component is rendering.`,
        );
      }
      if (!f.creating) return;
      f.slots[f.cursor - 1] = { kind: "once", fn };
    },
  },
);

/**
 * Register an error handler slot for this island. Handlers run in
 * declaration order; state, derived values, actions, and props should be
 * accessed through lexical closure rather than the context object.
 */
export function onError(fn: (ctx: ErrorContext) => void): void {
  const frame = currentFrame();
  if (!frame) {
    throw new Error(
      `[ilha] onError() called outside an island render. Register it while an island ` +
        `component is rendering.`,
    );
  }
  const existing = acquireSlot("error");
  if (existing) {
    existing.fn = fn;
    return;
  }
  const f = currentFrame();
  if (!f || !f.creating) return;
  f.slots[f.cursor - 1] = { kind: "error", fn };
}

// ---------------------------------------------
// Hydration snapshots (versioned positional format v2)
// ---------------------------------------------

interface SnapshotV2 {
  s?: unknown[];
  d?: DerivedValue<unknown>[];
}

function parseStateSnapshot(raw: string): (SnapshotV2 & { skipOnce: boolean }) | undefined {
  const parsed = safeParseSnapshot(raw, STATE_ATTR);
  if (parsed === undefined) return undefined;
  const rec = parsed as Record<string, unknown>;
  if (rec["v"] !== 2) {
    if (__DEV__)
      warn(
        `Unsupported state snapshot version (expected 2) — snapshot ignored. Re-render ` +
          `the page with the current Ilha version.`,
      );
    return undefined;
  }
  const out: SnapshotV2 & { skipOnce: boolean } = { skipOnce: rec["_skipOnMount"] === true };
  if (Array.isArray(rec["s"])) {
    stripUnsafeKeys(rec["s"]);
    out.s = rec["s"];
  }
  if (Array.isArray(rec["d"])) {
    stripUnsafeKeys(rec["d"]);
    out.d = (rec["d"] as unknown[]).map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      const errorValue = e.error;
      return {
        loading: e.loading === true,
        value: e.value,
        error:
          errorValue == null
            ? undefined
            : errorValue instanceof Error
              ? errorValue
              : new Error(String(errorValue)),
      } satisfies DerivedValue<unknown>;
    });
  }
  return out;
}

// ---------------------------------------------
// Mounted instance
// ---------------------------------------------

interface MountedInstance {
  host: Element;
  inputSignal: ReturnType<typeof signal<Record<string, unknown>>>;
  input: Record<string, unknown>;
  unmountController: AbortController;
  cleanups: Array<() => void>;
  reportError: (err: unknown, source: ErrorSource) => void;
  /** Deterministic action ids keyed by accessor identity (manifest). */
  actionIds: Map<Function, string>;
  stateSnapshot?: SnapshotV2;
  derivedSnapshot?: DerivedValue<unknown>[];
  hydrated: boolean;
  disposed: boolean;
  frame: PrimitiveFrame;
}

// ---------------------------------------------
// ilha() — the island constructor
// ---------------------------------------------

type IlhaFactory = {
  <P>(component: IslandComponent<P>): Island<P>;
  <P>(component: IslandComponent<P>, options: { as?: string }): Island<P>;
  <S extends StandardSchemaV1>(
    schema: S,
    component: IslandComponent<StandardSchemaV1.InferOutput<S>>,
  ): Island<StandardSchemaV1.InferOutput<S>>;
  <S extends StandardSchemaV1>(
    schema: S,
    component: IslandComponent<StandardSchemaV1.InferOutput<S>>,
    options: { as?: string },
  ): Island<StandardSchemaV1.InferOutput<S>>;
};

// Dev-mode: track mounted hosts
const _mountedHosts = __DEV__ ? new WeakSet<Element>() : null;

export const ilha: IlhaFactory = ((...args: unknown[]): unknown => {
  let schema: StandardSchemaV1 | null = null;
  let component: IslandComponent<any> | undefined;
  let options: { as?: string } | undefined;
  const first = args[0];
  const second = args[1];
  if (isStandardSchema(first)) {
    schema = first;
    component = second as IslandComponent<any>;
    options = args[2] as { as?: string } | undefined;
  } else {
    component = first as IslandComponent<any>;
    options = second as { as?: string } | undefined;
  }
  if (typeof component !== "function") {
    throw new Error("[ilha] ilha() requires a component function.");
  }
  const configuredSlotTag = options?.as === undefined ? "div" : assertValidSlotTagName(options.as);

  function resolveInput(props?: Partial<any>): Record<string, unknown> {
    const merged = { ...props } as Record<string, unknown>;
    if (!schema) return merged;
    return validateSchema(schema, merged) as Record<string, unknown>;
  }

  // Run the component inside a render context so interpolated islands
  // record themselves into ctx.slots. See the composition section above.
  type RenderOut = {
    html: string;
    slots: IslandRenderCtx["slots"];
    binds: BindRecord[];
    events: JsxEventRecord[];
  };
  function renderWithCtx(options: {
    render: () => string | RawHtml;
    liveHost?: Element;
    asyncChildren?: false;
    manifest?: boolean;
  }): RenderOut;
  function renderWithCtx(options: {
    render: () => string | RawHtml;
    liveHost?: Element;
    asyncChildren: true;
    manifest?: boolean;
  }): Promise<RenderOut>;
  function renderWithCtx({
    render,
    liveHost,
    asyncChildren,
    manifest,
  }: {
    render: () => string | RawHtml;
    liveHost?: Element;
    asyncChildren?: boolean;
    manifest?: boolean;
  }): RenderOut | Promise<RenderOut> {
    const ctx = pushRenderCtx(liveHost, asyncChildren, manifest);
    try {
      const html = unwrapHtml(render());
      const slots = ctx.slots;
      const binds = ctx.binds;
      const events = ctx.events;

      if (ctx.pending && ctx.pending.size > 0) {
        const pending = ctx.pending;
        return (async () => {
          const resolvedHtml = await resolveAsyncChildren(html, pending);
          return { html: resolvedHtml, slots, binds, events };
        })();
      }

      return { html, slots, binds, events };
    } finally {
      popRenderCtx();
    }
  }

  /** Invoke the component inside the given frame + render context. */
  function runInFrame(frame: PrimitiveFrame, props: Record<string, unknown>): () => RawHtml {
    return () => withFrame(frame, () => component!(props) as RawHtml);
  }

  // ─── SSR ────────────────────────────────────────────────────────────────

  function recordEventsManifest(
    eventsOut: Map<string, EventManifestEntry> | undefined,
    events: JsxEventRecord[],
    frame: PrimitiveFrame,
  ): void {
    if (!eventsOut || events.length === 0) return;
    events.forEach((record, index) => {
      // Brand-recognized action references only — matched by identity first,
      // then by the cross-copy Symbol.for manifest id on the stub itself.
      const id = frame.actionManifest?.get(record.handler) ?? actionManifestId(record.handler);
      if (!id) return;
      // `.with()` references carry an explicit serializable payload —
      // stored in the manifest directly, replayed by the client verbatim.
      const args = actionBoundArgs(record.handler);
      eventsOut.set(`${record.type}:${index}`, Array.isArray(args) ? { k: id, a: args } : id);
    });
  }

  function renderToString(
    props?: Partial<any>,
    sync = false,
    eventsOut?: Map<string, EventManifestEntry>,
    forceAsyncChildren = false,
  ): string | Promise<string> {
    const input = resolveInput(props);
    const frame = freshFrame({ ssr: true });

    const first = forceAsyncChildren
      ? renderWithCtx({
          render: runInFrame(frame, input),
          asyncChildren: true,
          manifest: eventsOut !== undefined,
        })
      : renderWithCtx({ render: runInFrame(frame, input), manifest: eventsOut !== undefined });

    const finish = (firstHtml: RenderOut): string => firstHtml.html;

    const needsAsync = forceAsyncChildren || (frame.pendingDerived?.length ?? 0) > 0;

    if (first instanceof Promise) {
      return first.then((out) => {
        recordEventsManifest(eventsOut, out.events, frame);
        return needsAsync ? awaitPending(out) : out.html;
      });
    }
    recordEventsManifest(eventsOut, first.events, frame);
    if (!needsAsync || sync) {
      if (sync && (frame.pendingDerived?.length ?? 0) > 0 && __DEV__) {
        warn(
          "toString() rendered async derived values in their loading state — " +
            "call await toStringAsync() when the island may resolve async derived.",
        );
      }
      return finish(first);
    }
    return awaitPending(first);

    function awaitPending(out: RenderOut): Promise<string> {
      const pendings = frame.pendingDerived ?? [];
      if (pendings.length === 0) return Promise.resolve(out.html);
      return Promise.all(pendings.map((p) => p.promise)).then(() => {
        // Second pass: envelopes hold resolved values; produce final HTML.
        frame.creating = false;
        frame.cursor = 0;
        const second = forceAsyncChildren
          ? renderWithCtx({
              render: runInFrame(frame, input),
              asyncChildren: true,
              manifest: eventsOut !== undefined,
            })
          : renderWithCtx({ render: runInFrame(frame, input), manifest: eventsOut !== undefined });
        const done = (o: RenderOut): string => {
          recordEventsManifest(eventsOut, o.events, frame);
          return o.html;
        };
        return second instanceof Promise ? second.then(done) : done(second);
      });
    }
  }

  // ─── Client mount ───────────────────────────────────────────────────────

  type MountHandle = {
    unmount: () => void | Promise<void>;
    updateProps: (props?: Partial<any>) => void;
  };

  function mountIsland(host: Element, props?: Partial<any>): () => void {
    return mountIslandInternal(host, props).unmount;
  }

  function mountIslandInternal(host: Element, props?: Partial<any>): MountHandle {
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
          props = reviveSlotProps(parsed as Record<string, unknown>) as Partial<any>;
        }
      }
    }

    const inputSignal = signal(resolveInput(props));
    // Derived scopes register before the render effect so source changes settle
    // derived envelopes before rendering. Prop changes use a separate trigger:
    // the render first refreshes slot.fn closures, then derived scopes recompute.
    const derivedPropsVersion = signal(0);
    const input = new Proxy({} as Record<string, unknown>, {
      get(_t, key) {
        return (inputSignal() as Record<PropertyKey, unknown>)[key];
      },
      has(_t, key) {
        return key in (inputSignal() as object);
      },
      ownKeys() {
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

    // Positional hydration snapshot.
    const snapshotRaw: string | null = host.getAttribute(STATE_ATTR);
    const snapshot = snapshotRaw ? parseStateSnapshot(snapshotRaw) : undefined;
    const hydrated = snapshot != null;
    const shouldSkipOnce = snapshot?.skipOnce === true;

    const cleanups: Array<() => void> = [];
    const unmountController = new AbortController();
    cleanups.push(() => unmountController.abort());

    const errorSlots: ErrorSlot[] = [];
    const reportError = (err: unknown, source: ErrorSource): void => {
      const error = err instanceof Error ? err : new Error(String(err));
      if (errorSlots.length === 0) {
        if (!reportToGlobal(error, source)) console.error(error);
        return;
      }
      for (const slot of errorSlots) {
        try {
          slot.fn({ error, source, host });
        } catch (handlerErr) {
          console.error(handlerErr);
        }
      }
    };

    const instance: MountedInstance = {
      host,
      inputSignal,
      input,
      unmountController,
      cleanups,
      reportError,
      actionIds: new Map(),
      stateSnapshot: snapshot ? { s: snapshot.s, d: snapshot.d } : undefined,
      hydrated,
      disposed: false,
      // SAFETY: the frame is attached right after construction by
      // runInFrame/mountIslandInternal; null here is the "not yet mounted"
      // pre-state that freshFrame() replaces before any render runs.
      frame: null as unknown as PrimitiveFrame,
    };
    cleanups.push(() => {
      instance.disposed = true;
    });

    const frame = freshFrame({ ssr: false, instance });
    instance.frame = frame;

    // Tracks mounted child slots across re-renders.
    const mountedSlots = new Map<
      string,
      {
        el: Element;
        island: AnyIsland;
        unmount: () => void;
        updateProps: (props?: Record<string, unknown>) => void;
      }
    >();

    function teardownMountedSlot(
      id: string,
      entry: {
        el: Element;
        unmount: () => void;
        updateProps: (props?: Record<string, unknown>) => void;
      },
    ): void {
      mountedSlots.delete(id);
      entry.el.remove();
      entry.unmount();
    }

    function slotBelongsToHost(candidate: Element): boolean {
      let el: Element | null = candidate.parentElement;
      while (el && el !== host) {
        if (el.hasAttribute(SLOT_ATTR) || el.hasAttribute("data-ilha")) return false;
        el = el.parentElement;
      }
      return el === host;
    }

    function buildSlotIndex(): Map<string, Element> {
      const index = new Map<string, Element>();
      for (const candidate of host.querySelectorAll(`[${SLOT_ATTR}]`)) {
        const id = candidate.getAttribute(SLOT_ATTR);
        if (id === null || index.has(id)) continue;
        if (slotBelongsToHost(candidate)) index.set(id, candidate);
      }
      return index;
    }

    function pushUpdatedProps(nextSlots: IslandRenderCtx["slots"]): void {
      for (const [id, entry] of mountedSlots) {
        const next = nextSlots.get(id);
        if (next) entry.updateProps(next.props);
      }
    }

    function mountSlots(slotMap: IslandRenderCtx["slots"]) {
      for (const [id, entry] of mountedSlots) {
        if (!slotMap.has(id)) teardownMountedSlot(id, entry);
      }
      for (const [id, entry] of mountedSlots) {
        const next = slotMap.get(id);
        if (next && next.island !== entry.island) teardownMountedSlot(id, entry);
      }

      let slotIndex: Map<string, Element> | null = null;
      for (const [id, { island: childIsland, props: childProps }] of slotMap) {
        const existing = mountedSlots.get(id);
        if (existing) {
          existing.updateProps(childProps);
          continue;
        }

        if (slotIndex === null) slotIndex = buildSlotIndex();
        const slotEl = slotIndex.get(id) ?? null;
        if (!slotEl) continue;

        let slotProps = childProps;
        if (slotProps === undefined) {
          const rawProps = slotEl.getAttribute(PROPS_ATTR) ?? slotEl.getAttribute("data-props");
          if (rawProps) {
            const parsed = safeParseSnapshot(rawProps, `props on [${SLOT_ATTR}="${id}"]`);
            if (parsed !== undefined) {
              slotProps = reviveSlotProps(parsed as Record<string, unknown>);
            }
          }
        }

        const prevSub = setActiveSub(undefined);
        let handle: {
          unmount: () => void | Promise<void>;
          updateProps: (p?: Record<string, unknown>) => void;
        };
        try {
          // SAFETY: ISLAND_MOUNT_INTERNAL is a Symbol.for brand this module sets
          // on every island function; the Record cast is internal branding.
          const internal = (childIsland as unknown as Record<symbol, unknown>)[
            ISLAND_MOUNT_INTERNAL
          ] as ((host: Element, props?: Record<string, unknown>) => MountHandle) | undefined;
          handle = internal
            ? internal(slotEl, slotProps)
            : { unmount: childIsland.mount(slotEl, slotProps), updateProps: () => {} };
        } finally {
          setActiveSub(prevSub);
        }
        mountedSlots.set(id, { el: slotEl, island: childIsland, ...handle });
      }
    }

    const nativeOnceFired = new WeakMap<Element, Set<string>>();
    let stopJsxEvents: () => void = () => {};
    let stopBindings: () => void = () => {};

    /** Register derived scopes before the render effect so source updates
     * settle derived envelopes before a render can consume them. */
    function startDerivedScopes(): void {
      for (const slot of frame.slots) {
        if (slot.kind === "derived") startDerivedScope(slot);
      }
    }

    /** Register side-effecting scopes after the render effect so prop-change
     * renders refresh their closures before those scopes execute. */
    function startEffectScopes(): void {
      for (const slot of frame.slots) {
        if (slot.kind === "effect") {
          startEffectScope(slot);
        } else if (slot.kind === "once") {
          startOnceScope(slot);
        } else if (slot.kind === "error") {
          errorSlots.push(slot);
        }
      }
    }

    function startDerivedScope(slot: DerivedSlot): void {
      let ac = new AbortController();
      let skipFirst = slot.fromSnapshot;
      const stopScope = alienEffect(() => {
        ac.abort();
        ac = new AbortController();
        const currentAc = ac;

        // Prop updates trigger this only after the render has refreshed slot.fn.
        void derivedPropsVersion();

        let result: unknown;
        try {
          result = slot.fn({ signal: currentAc.signal });
        } catch (err) {
          if (skipFirst) {
            skipFirst = false;
            return;
          }
          writeEnvelope(currentAc, {
            loading: false,
            value: undefined,
            error: err instanceof Error ? err : new Error(String(err)),
          });
          return;
        }

        if (skipFirst) {
          skipFirst = false;
          if (result instanceof Promise) (result as Promise<unknown>).catch(() => {});
          return;
        }

        if (!(result instanceof Promise)) {
          if (isAsyncIterable(result)) {
            const iterable = result;
            const previous = readEnv();
            writeEnvelope(currentAc, {
              loading: true,
              value: previous.value,
              error: undefined,
            });
            void (async () => {
              try {
                for await (const value of iterable) {
                  const stopped = writeEnvelope(currentAc, {
                    loading: false,
                    value,
                    error: undefined,
                  });
                  if (stopped) break;
                }
              } catch (err) {
                writeEnvelope(currentAc, {
                  loading: false,
                  value: undefined,
                  error: err instanceof Error ? err : new Error(String(err)),
                });
              }
            })();
            return;
          }
          writeEnvelope(currentAc, { loading: false, value: result, error: undefined });
          return;
        }

        const previous = readEnv();
        writeEnvelope(currentAc, { loading: true, value: previous.value, error: undefined });
        void (result as Promise<unknown>)
          .then((value) => {
            writeEnvelope(currentAc, { loading: false, value, error: undefined });
          })
          .catch((err: unknown) => {
            writeEnvelope(currentAc, {
              loading: false,
              value: undefined,
              error: err instanceof Error ? err : new Error(String(err)),
            });
          });
      });
      cleanups.push(() => {
        stopScope();
        ac.abort();
      });

      function readEnv(): DerivedValue<unknown> {
        const prevSub = setActiveSub(undefined);
        try {
          return slot.env();
        } finally {
          setActiveSub(prevSub);
        }
      }
      function writeEnvelope(ac: AbortController, patch: DerivedValue<unknown>): boolean {
        if (ac.signal.aborted) return true;
        const prevSub = setActiveSub(undefined);
        try {
          slot.env(patch);
        } finally {
          setActiveSub(prevSub);
        }
        return false;
      }
    }

    function startEffectScope(slot: EffectSlot): void {
      let userCleanup: (() => void) | void;
      let runController: AbortController | null = null;
      const stopScope = alienEffect(() => {
        if (userCleanup) {
          try {
            userCleanup();
          } catch (err) {
            reportError(err, "effect");
          }
          userCleanup = undefined;
        }
        if (runController) runController.abort();
        runController = new AbortController();
        const runSignal = AbortSignal.any([unmountController.signal, runController.signal]);
        // Props changes rerun prop-closure effects; see startDerivedScope.
        void inputSignal();
        startBatch();
        try {
          userCleanup = slot.fn({ signal: runSignal });
        } catch (err) {
          reportError(err, "effect");
        } finally {
          endBatch();
        }
      });
      cleanups.push(() => {
        stopScope();
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

    function startOnceScope(slot: OnceSlot): void {
      if (shouldSkipOnce) return;
      const prevSub = setActiveSub(undefined);
      let userCleanup!: (() => void) | void;
      try {
        userCleanup = slot.fn({
          host,
          hydrated,
          signal: unmountController.signal,
        });
      } catch (err) {
        reportError(err, "once");
      } finally {
        setActiveSub(prevSub);
      }
      if (userCleanup) {
        const teardown = userCleanup;
        cleanups.push(() => {
          try {
            teardown();
          } catch (err) {
            reportError(err, "once");
          }
        });
      }
    }

    const preserveSSRDom = hydrated && host.childNodes.length > 0;

    // Initial (creation) pass: creates primitive slots, produces HTML.
    const initial = renderWithCtx({
      render: runInFrame(frame, input),
      liveHost: preserveSSRDom ? host : undefined,
    });
    if (!preserveSSRDom) {
      // host is this island's render target; the markup is the island's
      // html``/JSX output, escaped by default.
      // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
      host.innerHTML = initial.html;
    }

    const stopInitialBindingReflection = applyTemplateBindings(host, initial.binds, "reflect");
    let stopInitialBindingListeners: (() => void) | null = null;
    stopBindings = stopInitialBindingReflection;
    cleanups.push(() => stopBindings());
    stopJsxEvents = applyJsxEvents({
      host,
      records: initial.events,
      reportError: (error) => reportError(error, "event"),
      unmountSignal: unmountController.signal,
      onceFired: nativeOnceFired,
    });
    cleanups.push(() => stopJsxEvents());

    mountSlots(initial.slots);
    cleanups.push(() => mountedSlots.forEach((entry) => entry.unmount()));

    stopInitialBindingListeners = applyTemplateBindings(host, initial.binds, "listen");
    stopBindings = () => {
      stopInitialBindingListeners!();
      stopInitialBindingReflection();
    };

    let initialized = false;
    const initialRenderedHtml = initial.html;
    let lastRendered: string | null = null;
    let renderEpoch = 0;
    const renderReactive = () => {
      const epoch = ++renderEpoch;
      frame.creating = false;
      frame.cursor = 0;
      const {
        html: rendered,
        slots: newSlotMap,
        binds: newBinds,
        events: newEvents,
      } = renderWithCtx({
        render: runInFrame(frame, input),
        liveHost: host,
      });

      checkFrameDrift(frame);

      // Handler closures may change even when their rendered HTML does not.
      stopJsxEvents();
      stopJsxEvents = applyJsxEvents({
        host,
        records: newEvents,
        reportError: (error) => reportError(error, "event"),
        unmountSignal: unmountController.signal,
        onceFired: nativeOnceFired,
      });

      if (!initialized) {
        initialized = true;
        if (preserveSSRDom) {
          pushUpdatedProps(newSlotMap);
          if (rendered === initialRenderedHtml) {
            lastRendered = rendered;
            return;
          }
        }
        if (rendered === initialRenderedHtml) {
          lastRendered = rendered;
          return;
        }
        if (
          mountedSlots.size > 0 &&
          mountedSlots.size === newSlotMap.size &&
          [...newSlotMap.keys()].every((id) => mountedSlots.has(id)) &&
          isStableInlineSlotMount({
            initialHtml: initialRenderedHtml,
            renderedHtml: rendered,
            slotIds: newSlotMap.keys(),
          })
        ) {
          pushUpdatedProps(newSlotMap);
          return;
        }
      }

      if (
        rendered === lastRendered &&
        mountedSlots.size === newSlotMap.size &&
        [...newSlotMap].every(([id, next]) => mountedSlots.get(id)?.island === next.island)
      ) {
        pushUpdatedProps(newSlotMap);
        return;
      }

      stopBindings();
      stopJsxEvents();

      const prevMountedCount = mountedSlots.size;

      for (const [id, entry] of mountedSlots) {
        if (!newSlotMap.has(id)) teardownMountedSlot(id, entry);
      }
      for (const [id, entry] of mountedSlots) {
        const next = newSlotMap.get(id);
        if (next && next.island !== entry.island) teardownMountedSlot(id, entry);
      }

      const applyMorph = () => {
        if (epoch !== renderEpoch) return;
        if (newSlotMap.size < prevMountedCount) {
          let divergeFrom = Infinity;
          for (const [id, entry] of mountedSlots) {
            if (!id.startsWith("p:")) continue;
            const next = newSlotMap.get(id);
            if (!next) continue;
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

        const tpl = document.createElement("template");
        const morphRootTag = host.tagName.toLowerCase();
        // parse into a detached <template> for structural comparison;
        // morphInner patches the live DOM.
        // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
        tpl.innerHTML = `<${morphRootTag}>${rendered}</${morphRootTag}>`;
        morphInner(host, tpl.content.firstElementChild as Element);
        lastRendered = rendered;

        let rehomeIndex: Map<string, Element> | null = null;
        for (const [id, entry] of mountedSlots) {
          if (!newSlotMap.has(id) || entry.el.isConnected) continue;
          rehomeIndex ??= buildSlotIndex();
          const stub = rehomeIndex.get(id);
          if (stub && stub !== entry.el) stub.replaceWith(entry.el);
        }

        stopBindings = applyTemplateBindings(host, newBinds);
        stopJsxEvents = applyJsxEvents({
          host,
          records: newEvents,
          reportError: (error) => reportError(error, "event"),
          unmountSignal: unmountController.signal,
          onceFired: nativeOnceFired,
        });
        mountSlots(newSlotMap);
      };

      applyMorph();
    };

    // Run once before derived scopes to preserve the initial mount path. Then
    // re-register after derived scopes so shared source dependencies notify
    // derived computations before the render that consumes their envelopes.
    let stopRender = alienEffect(renderReactive);
    startDerivedScopes();
    stopRender();
    stopRender = alienEffect(renderReactive);
    startEffectScopes();

    let tornDown = false;
    const unmount = (): void => {
      if (tornDown) return;
      tornDown = true;
      instance.disposed = true;
      unmountController.abort();
      ISLAND_MOUNT_HANDLES.delete(host);
      if (__DEV__ && _mountedHosts) _mountedHosts.delete(host);
      stopRender();
      for (const [, entry] of mountedSlots) entry.unmount();
      for (const c of cleanups) c();
    };

    const updateProps = (nextProps?: Partial<any>): void => {
      if (tornDown) return;
      const next = resolveInput(nextProps);
      const prev = inputSignal();
      if (shallowEqualInput(prev, next)) return;
      inputSignal(next);
      derivedPropsVersion(derivedPropsVersion() + 1);
    };

    const handle: MountHandle = { unmount, updateProps };
    ISLAND_MOUNT_HANDLES.set(
      host,
      handle as {
        unmount: () => void | Promise<void>;
        updateProps: (props?: Record<string, unknown>) => void;
      },
    );
    return handle;
  }

  // ─── Island object ──────────────────────────────────────────────────────

  // SAFETY: the callable carries the ISLAND_CALL / ISLAND symbol brands that
  // interpolateValue and the JSX runtime check; the cast widens the closure
  // to the public Island interface (callable + toString/toStringAsync/mount).
  const island = ((props?: Partial<any>): IslandCall => ({
    [ISLAND_CALL]: true,
    island: island as AnyIsland,
    props: props as Record<string, unknown> | undefined,
    key: undefined,
  })) as unknown as Island<any>;

  island.toString = (props?: Partial<any>) => renderToString(props, true) as string;
  island.toStringAsync = (props?: Partial<any>): Promise<string> =>
    Promise.resolve(renderToString(props, false));
  island.mount = (host: Element, props?: Partial<any>): (() => void) => mountIsland(host, props);

  // SAFETY: ISLAND_MOUNT_INTERNAL is a Symbol.for brand this module defines;
  // the Record cast is internal branding, read by mountIslandInternal callers.
  (island as unknown as Record<symbol, unknown>)[ISLAND_MOUNT_INTERNAL] = (
    host: Element,
    props?: Partial<any>,
  ): MountHandle => mountIslandInternal(host, props);

  // SAFETY: ISLAND_SLOT_TAG is a Symbol.for brand read by the nested-slot
  // emission path; the Record cast is internal branding.
  (island as unknown as Record<symbol, unknown>)[ISLAND_SLOT_TAG] = configuredSlotTag;

  // SAFETY: ISLAND_RENDER_STATE is a Symbol.for brand consumed by the router's
  // server-island frame renderer; the Record cast is internal branding.
  (island as unknown as Record<symbol, unknown>)[ISLAND_RENDER_STATE] = async (
    props?: Record<string, unknown>,
  ): Promise<string> => {
    const manifest: Map<string, EventManifestEntry> = new Map();
    const html = await renderToString(
      (props ?? undefined) as Partial<any> | undefined,
      false,
      manifest,
      true,
    );
    return serializeServerManifest(manifest) + html;
  };

  // SAFETY: ISLAND_SSR_MANIFEST is a Symbol.for brand consumed by the
  // router's server-island frame renderer; the Record cast is internal branding.
  (island as unknown as Record<symbol, unknown>)[ISLAND_SSR_MANIFEST] = (
    props?: Partial<any>,
    eventsOut?: Map<string, EventManifestEntry>,
  ): string | Promise<string> => renderToString(props, false, eventsOut, true);

  island.key = (key: string): KeyedIsland<any> => {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new Error("island.key() requires a non-empty string.");
    }
    if (key.includes(":")) {
      throw new Error(`island.key() key cannot contain the slot separator ":" (got "${key}").`);
    }
    // SAFETY: keyed is the same ISLAND_CALL-branded closure; the cast restores
    // the KeyedIsland public type (callable + branded), matching Island.key's
    // documented contract.
    const keyed = ((props?: Partial<any>): IslandCall => ({
      [ISLAND_CALL]: true,
      island: island as AnyIsland,
      props: props as Record<string, unknown> | undefined,
      key,
    })) as unknown as KeyedIsland<any>;
    // SAFETY: keyed is the same ISLAND_CALL-branded closure; re-stamping the
    // symbol on the returned callable keeps the brand on the exact object the
    // caller receives.
    (keyed as unknown as Record<symbol, boolean>)[ISLAND_CALL] = true;
    return keyed;
  };

  // SAFETY: ISLAND is the public island-function brand interpolateValue and
  // the JSX runtime check; the Record cast is internal branding.
  (island as unknown as Record<symbol, boolean>)[ISLAND] = true;

  const astroRendererName = (globalThis as unknown as Record<symbol, unknown>)[
    ASTRO_RENDERER_GLOBAL
  ];
  if (typeof astroRendererName === "string") {
    (island as unknown as Record<symbol, unknown>)[Symbol.for("astro:renderer")] =
      astroRendererName;
  }

  island.define = (tagName: string, options?: { observe?: string[] }): void => {
    if (typeof customElements === "undefined" || typeof HTMLElement === "undefined") {
      warn(`define("${tagName}"): customElements is unavailable in this environment.`);
      return;
    }
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
      _unmounting = false;
      _reconnect = false;

      get props(): Record<string, unknown> | undefined {
        return this._props;
      }
      set props(p: Record<string, unknown> | undefined) {
        this._props = p;
        if (this._handle && !this._unmounting) this._handle.updateProps(this._mergedProps());
      }

      _mergedProps(): Partial<any> | undefined {
        const attrProps: Record<string, unknown> = {};
        let hasAttrs = false;
        for (const name of observe) {
          const v = this.getAttribute(name);
          if (v !== null) {
            attrProps[name] = v;
            hasAttrs = true;
          }
        }
        if (!hasAttrs && this._props === undefined) return undefined;
        return { ...attrProps, ...this._props } as Partial<any>;
      }

      connectedCallback(): void {
        if (this._unmounting) {
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

  island.hydratable = async (props: Partial<any>, opts: HydratableOptions): Promise<string> => {
    const { name, as: rawTag = "div", snapshot = false, skipOnMount: explicitSkipOnMount } = opts;
    const tag = assertValidSlotTagName(rawTag);

    const resolvedProps = props ?? {};
    // No event-manifest serialization here: @ilha/router owns server-action
    // manifests via its frame/hydration adapters. hydratable() emits plain
    // hydration markup only.
    const innerPromise = renderToString(resolvedProps, false, undefined, true);

    // Snapshot collection: after the async pass settles, primitive slots hold
    // resolved envelopes — read them positionally.
    let stateAttr = "";

    if (snapshot !== false) {
      const doState = snapshot === true || (snapshot as { state?: boolean }).state !== false;
      const doDerived = snapshot === true || (snapshot as { derived?: boolean }).derived !== false;
      // effect.once is client-only under the function-component API — it never
      // runs during SSR, so a snapshot never means "setup already happened".
      // Only an explicit `skipOnMount: true` opts out of once-slots at mount.
      const doSkipOnMount = explicitSkipOnMount ?? false;

      const snapshotData: Record<string, unknown> = { v: 2 };
      const input = resolveInput(resolvedProps);
      const probeFrame = freshFrame({ ssr: true });
      withFrame(probeFrame, () => {
        void component(input);
      });

      if (doState) {
        const states: unknown[] = [];
        for (const slot of probeFrame.slots) {
          if (slot.kind !== "state") continue;
          const prevSub = setActiveSub(undefined);
          try {
            states.push((slot.acc as () => unknown)());
          } finally {
            setActiveSub(prevSub);
          }
        }
        snapshotData["s"] = states;
      }

      if (doDerived) {
        // Await pending probes from the probe frame so snapshots carry values.
        const probePendings = probeFrame.pendingDerived ?? [];
        if (probePendings.length > 0) {
          await Promise.all(probePendings.map((p) => p.promise));
          // Mirror toStringAsync()'s resolved second pass so synchronous
          // derived chains are snapshotted from their final SSR values.
          probeFrame.creating = false;
          probeFrame.cursor = 0;
          withFrame(probeFrame, () => {
            void component(input);
          });
          checkFrameDrift(probeFrame);
        }
        const derivedEntries: unknown[] = [];
        for (const slot of probeFrame.slots) {
          if (slot.kind !== "derived") continue;
          const prevSub = setActiveSub(undefined);
          let envelope: DerivedValue<unknown>;
          try {
            envelope = { ...(slot as DerivedSlot).env() };
          } finally {
            setActiveSub(prevSub);
          }
          const entry: Record<string, unknown> = { loading: false, value: envelope.value };
          if (envelope.error) entry["error"] = envelope.error.message;
          derivedEntries.push(entry);
        }
        snapshotData["d"] = derivedEntries;
      }

      if (doSkipOnMount) snapshotData["_skipOnMount"] = true;

      if (__DEV__) {
        const lossy = findNonJsonSafeValue({ value: snapshotData, path: "snapshot" });
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

    const inner = await innerPromise;

    return `<${tag} data-ilha="${escapeHtml(name)}" ${PROPS_ATTR}='${escapeHtml(JSON.stringify(resolvedProps))}'${stateAttr}>${inner}</${tag}>`;
  };

  return island;
}) as IlhaFactory;

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

setJsxRuntimeBridge({
  registerEvent({ type, handler, modifier }: JsxEventRegistration): number | undefined {
    const ctx = currentRenderCtx();
    if (!ctx) return undefined;
    // Direct SSR action stubs are matched by brand in recordEventsManifest —
    // never invoked. Any other handler gets no manifest entry; closures are
    // NEVER executed during server rendering to inspect their captured args.
    const isActionStub = SSR_ACTION_STUB in (handler as object);
    if (__DEV__ && ctx.manifest === true && !isActionStub) {
      warn(
        `Event handler is not an action() reference, so it cannot appear in the ` +
          `hydration manifest. Handlers are never executed during server rendering; ` +
          `pass an action() slot directly as the handler ` +
          `so the client can replay it. The closure will only run on the client after mount.`,
      );
    }
    const index = ctx.events.length;
    ctx.events.push({ type, handler, modifier });
    return index;
  },
  slot({ island, props, key }) {
    return ilhaRaw(emitIslandSlot({ island: island as AnyIsland, props, key }));
  },
});

/**
 * Morph an element's children toward `html`, patching in place: surviving
 * elements keep their identity, listeners, and focus (see the morph engine).
 * Falls back to an innerHTML write when the root tags don't match.
 */
export function morph(host: Element, html: string): void {
  if (typeof document === "undefined") return;
  const openTag = host.localName ?? "div";
  const tpl = document.createElement("template");
  // parse into a detached <template> (no script execution, not the live
  // document) before morphing in place.
  // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
  tpl.innerHTML = `<${openTag}>${html}</${openTag}>`;
  const next = tpl.content.firstElementChild;
  if (!next || next.localName !== host.localName) {
    // host is this island's render target; markup is the island's
    // html``/JSX output, escaped by default.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
    host.innerHTML = html;
    return;
  }
  try {
    morphInner(host, next);
  } catch {
    // fallback render write to host.
    // pi-lens-ignore: ast-grep:no-inner-html, ts-xss-dom-sink, slop
    host.innerHTML = html;
  }
}

export const html = ilhaHtml;
export const raw = ilhaRaw;
export const mount = mountAll;
export const context = ilhaContext;

// Shared URL/style policy — used by the template IR renderer and available to
// advanced template authors who want the same checks in custom builders.
export { isSafeUrl, isSafeUrlAttrValue, isUrlAttributeName, serializeStyle };
