import {
  html,
  isSafeUrl,
  isUrlAttributeName,
  raw,
  serializeStyle,
  type NativeEventHandler,
  type NativeEventModifier,
  type RawHtml,
} from "./index";
import { __ilhaJsxEvent, __ilhaJsxSlot } from "./internal";
export type { JSX } from "./jsx-types";

type JsxChild = unknown;
type JsxProps = Record<string, unknown> | null | undefined;
type JsxType = string | ((props: Record<string, unknown>) => unknown);

// nd: build a TemplateStringsArray from a fresh local chunk array. `html` only
// reads `strings.length` and `strings[i]`; raw mirrors content so a future read
// of `.raw` is consistent. `chunks` is always freshly built per call.
function toTemplateStrings(chunks: string[]): TemplateStringsArray {
  return Object.assign(chunks, { raw: chunks });
}

const RAW = Symbol.for("ilha.raw");
const SIGNAL_ACCESSOR = Symbol.for("ilha.signalAccessor");
const ISLAND = Symbol.for("ilha.island");
const ISLAND_CALL = Symbol.for("ilha.islandCall");
const RENDER_PART = Symbol.for("ilha.renderPart");

const SAFE_NAME_RE = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;
const SAFE_BIND_LOCAL_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const SAFE_EVENT_PROP_RE = /^on([a-z][a-z0-9-]*)(?::(abortable|once|capture|passive))?$/;
const JSX_ATTRIBUTE_ALIASES: Record<string, string> = {
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
const STRING_BOOLEAN_ATTRIBUTES = new Set(["contenteditable", "draggable", "spellcheck"]);
const VOID_ELEMENTS = new Set([
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

function isRawHtml(v: unknown): v is RawHtml {
  return !!(v && typeof v === "object" && RAW in v);
}

// Brand checks use `Symbol.for`, which resolves to the SAME symbol across
// duplicate ilha copies in one realm — no description-scanning fallback needed.
function isSignalAccessor(v: unknown): boolean {
  return typeof v === "function" && SIGNAL_ACCESSOR in (v as object);
}

function isIsland(v: unknown): boolean {
  return typeof v === "function" && ISLAND in (v as object);
}

function isIslandCall(v: unknown): boolean {
  if (v == null || (typeof v !== "object" && typeof v !== "function")) return false;
  if (ISLAND_CALL in (v as object)) return true;
  return typeof v === "object" && "island" in v && isIsland((v as { island?: unknown }).island);
}

function normalizeClass(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([name]) => name)
      .join(" ");
  }
  return String(value);
}

function normalizeJsxChildren(props: JsxProps, children: JsxChild[]): JsxChild[] {
  const propChildren = props && "children" in props ? props.children : undefined;
  const all = children.length > 0 ? children : propChildren === undefined ? [] : [propChildren];
  return all.flat(1);
}

function normalizeJsxSlotKey(rawKey: string | number): string {
  const key = String(rawKey);
  if (key.trim().length === 0) throw new Error("jsx key requires a non-empty string.");
  if (key.includes(":")) {
    throw new Error(`jsx key cannot contain the slot separator ":" (got "${key}").`);
  }
  return key;
}

function extractJsxSlotKey(props: JsxProps, keyArg?: string | number): string | undefined {
  const fromProps = props?.key;
  const rawKey =
    keyArg ??
    (typeof fromProps === "string" || typeof fromProps === "number" ? fromProps : undefined);
  if (rawKey == null) return undefined;
  return normalizeJsxSlotKey(rawKey);
}

function pushJsxAttr({
  chunks,
  values,
  eventSpecs,
  name,
  value,
}: {
  chunks: string[];
  values: unknown[];
  eventSpecs: string[];
  name: string;
  value: unknown;
}): void {
  if (value == null || name === "children" || name === "key") return;
  if (name === "__proto__" || name === "constructor" || name === "prototype") return;

  if (name.startsWith("bind:")) {
    const [prefix, localName, ...rest] = name.split(":");
    if (prefix !== "bind" || rest.length > 0 || !localName || !SAFE_BIND_LOCAL_RE.test(localName)) {
      return;
    }
    if (!isSignalAccessor(value)) return;
    chunks[chunks.length - 1] += ` ${prefix}:${localName}=`;
    values.push(value);
    chunks.push("");
    return;
  }

  if (!SAFE_NAME_RE.test(name)) return;
  const safeName = JSX_ATTRIBUTE_ALIASES[name] ?? name;
  if (safeName.startsWith("on")) {
    const eventMatch = SAFE_EVENT_PROP_RE.exec(safeName);
    if (typeof value !== "function" || !eventMatch) return;
    const eventName = eventMatch[1]!;
    const modifier = eventMatch[2] as NativeEventModifier | undefined;
    // Forwarding closures (`onclick={() => action.remove(id)}`) are
    // capture-invoked by the core runtime; direct action references are
    // matched by identity. Either way the hydration manifest lands.
    const index = __ilhaJsxEvent({
      type: eventName,
      handler: value as NativeEventHandler,
      modifier,
    });
    if (index !== undefined) eventSpecs.push(`${eventName}:${index}`);
    return;
  }
  const securityName = safeName.toLowerCase();
  // srcdoc decodes HTML entities back into live markup, so attribute escaping
  // does not neutralize it — a bound srcdoc is an XSS hole. Refuse it outright,
  // including JSX's camelCase srcDoc alias.
  if (securityName === "srcdoc") return;
  const stringBoolean =
    securityName.startsWith("aria-") || STRING_BOOLEAN_ATTRIBUTES.has(securityName);
  if (typeof value === "boolean" && stringBoolean) value = String(value);
  else if (value === false) return;
  if (safeName === "class" && !isRawHtml(value)) value = normalizeClass(value);
  if (safeName === "style" && value && typeof value === "object" && !isRawHtml(value)) {
    value = serializeStyle(value as Record<string, unknown>);
  }
  // Coerce non-string values (boxed strings, objects with toString) before
  // the scheme check so they cannot smuggle an unsafe URL past it.
  if (
    isUrlAttributeName(securityName) &&
    !isSafeUrl(typeof value === "string" ? value : String(value))
  ) {
    return;
  }
  if (value === true) {
    chunks[chunks.length - 1] += ` ${safeName}`;
    return;
  }
  chunks[chunks.length - 1] += ` ${safeName}="`;
  values.push(value);
  chunks.push('"');
}

function escapeAttrValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Stamp the JSX `key` onto the root element of already-rendered HTML as
// `data-key`, so the morph engine's keyed reconciliation can match children
// produced by function components. No-op when the output doesn't start with
// an element or the root already carries an explicit data-key.
function injectDataKey(out: RawHtml, key: string): RawHtml {
  const m = /^\s*<([a-zA-Z][a-zA-Z0-9:._-]*)/.exec(out.value);
  if (!m) return out;
  const openEnd = out.value.indexOf(">", m.index);
  const openTag = out.value.slice(m.index, openEnd === -1 ? undefined : openEnd);
  if (/\sdata-key\s*=/.test(openTag)) return out;
  const insertAt = m.index + m[0].length;
  return raw(
    `${out.value.slice(0, insertAt)} data-key="${escapeAttrValue(key)}"${out.value.slice(insertAt)}`,
  );
}

function renderJsxElement({
  type,
  props,
  children,
  slotKey,
}: {
  type: string;
  props: JsxProps;
  children: JsxChild[];
  slotKey?: string;
}): RawHtml {
  const chunks = [`<${type}`];
  const values: unknown[] = [];
  const eventSpecs: string[] = [];
  if (props) {
    for (const [name, value] of Object.entries(props)) {
      pushJsxAttr({ chunks, values, eventSpecs, name, value });
    }
  }
  if (slotKey !== undefined && props?.["data-key"] == null) {
    pushJsxAttr({ chunks, values, eventSpecs, name: "data-key", value: slotKey });
  }
  if (eventSpecs.length > 0) {
    chunks[chunks.length - 1] += ` data-ilha-on="${eventSpecs.join(",")}"`;
  }
  chunks[chunks.length - 1] += ">";
  if (!VOID_ELEMENTS.has(type)) {
    for (const child of children) {
      values.push(child);
      chunks.push("");
    }
    chunks[chunks.length - 1] += `</${type}>`;
  }
  // chunks/values alternate one-to-one (each attribute pushes a value
  // then an opening-quote chunk; children push a value then an empty chunk),
  // so the array is a valid TemplateStringsArray even though TS can't see it.
  return html(toTemplateStrings(chunks), ...values);
}

export function jsx(
  type: JsxType,
  props: JsxProps,
  maybeKey?: JsxChild | string | number,
  ...restChildren: JsxChild[]
): RawHtml {
  const hasKeyArg = typeof maybeKey === "string" || typeof maybeKey === "number";
  const keyFromArg = hasKeyArg ? maybeKey : undefined;
  const children: JsxChild[] =
    hasKeyArg || maybeKey === undefined ? restChildren : [maybeKey, ...restChildren];
  const normalizedChildren = normalizeJsxChildren(props, children);
  const slotKey = extractJsxSlotKey(
    props,
    typeof keyFromArg === "string" || typeof keyFromArg === "number" ? keyFromArg : undefined,
  );

  if (typeof type === "function") {
    const componentProps: Record<string, unknown> = {
      ...props,
      ...(normalizedChildren.length > 0 ? { children: normalizedChildren } : {}),
    };
    delete componentProps.key;
    const out = type(Object.keys(componentProps).length ? componentProps : {});
    if (isIslandCall(out)) {
      if (slotKey !== undefined) (out as { key?: string }).key = slotKey;
      return html`${out}`;
    }
    if (isRawHtml(out)) return slotKey !== undefined ? injectDataKey(out, slotKey) : out;
    if (typeof out === "string" && isIsland(type)) {
      return __ilhaJsxSlot({ island: type, props: componentProps, key: slotKey });
    }
    if (typeof out === "string") return html`${out}`;
    if (
      typeof out === "object" &&
      out !== null &&
      Object.getPrototypeOf(out) === Object.prototype &&
      (out as Record<symbol, unknown>)[RENDER_PART] === true &&
      typeof (out as { toString?: unknown }).toString === "function"
    ) {
      return raw(String(out));
    }
    return html`${out}`;
  }

  return renderJsxElement({ type, props, children: normalizedChildren, slotKey });
}

export const jsxs = jsx;

export function Fragment(props: { children?: JsxChild } | null, ...children: JsxChild[]): RawHtml {
  const normalizedChildren = normalizeJsxChildren(props, children);
  const chunks = ["", ...normalizedChildren.map(() => "")];
  // One empty chunk precedes every child value, keeping the chunks/values
  // alternation valid for the html`` call below.
  return html(toTemplateStrings(chunks), ...normalizedChildren);
}

export function jsxDEV(
  type: JsxType,
  props: JsxProps,
  maybeKey?: string | number,
  _source?: unknown,
  _self?: unknown,
): RawHtml {
  return jsx(type, props, maybeKey);
}
