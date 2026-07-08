import { __ilhaJsxSlot, html, raw, type RawHtml } from "./index";
export type { JSX } from "./jsx-types";

type JsxChild = unknown;
type JsxProps = Record<string, unknown> | null | undefined;
type JsxType = string | ((props: Record<string, unknown>) => unknown);

const RAW = Symbol.for("ilha.raw");
const SIGNAL_ACCESSOR = Symbol.for("ilha.signalAccessor");
const ISLAND = Symbol.for("ilha.island");
const ISLAND_CALL = Symbol.for("ilha.islandCall");
const RENDER_PART = Symbol.for("ilha.renderPart");

const SAFE_NAME_RE = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;
const SAFE_BIND_LOCAL_RE = /^[A-Za-z][A-Za-z0-9]*$/;
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
const SAFE_CSS_PROP_RE = /^(-{2}[a-zA-Z][a-zA-Z0-9-]*|-?[a-zA-Z][a-zA-Z0-9-]*)$/;
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "cite", "data", "poster"]);
const SAFE_URL_RE =
  /^(?!javascript:|data:text\/html|data:text\/xml|data:application\/xhtml\+xml|data:image\/svg|vbscript:)/i;

// HTML parsers strip ASCII control chars (tab/newline/CR and friends) anywhere
// inside a URL before resolving its scheme, so "java\tscript:" reaches the
// browser as "javascript:". Normalize the same way before testing SAFE_URL_RE.
function isSafeUrl(value: string): boolean {
  return SAFE_URL_RE.test(value.replace(/[\u0000-\u0020]/g, ""));
}

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

function serializeStyle(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([k, v]) => {
      if (!SAFE_CSS_PROP_RE.test(k)) return "";
      const prop = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const str = String(v);
      // Drop the whole declaration instead of silently rewriting the value —
      // a mangled value is harder to debug than a missing one. Quotes are
      // fine (fonts, content strings); `;{}<>` could smuggle in extra
      // declarations or markup-looking text, so those reject.
      if (/[<>{};]/.test(str) || /expression\(/i.test(str) || /javascript:/i.test(str)) return "";
      return `${prop}:${str}`;
    })
    .filter(Boolean)
    .join(";");
}

function pushJsxAttr(chunks: string[], values: unknown[], name: string, value: unknown): void {
  if (value == null || value === false || name === "children" || name === "key") return;
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
  let safeName = name;
  if (safeName === "className") safeName = "class";
  if (safeName === "htmlFor") safeName = "for";
  if (safeName.startsWith("on")) return;
  // srcdoc decodes HTML entities back into live markup, so attribute escaping
  // does not neutralize it — a bound srcdoc is an XSS hole. Refuse it outright.
  if (safeName === "srcdoc") return;
  if (safeName === "class") value = normalizeClass(value);
  if (safeName === "style" && value && typeof value === "object") {
    value = serializeStyle(value as Record<string, unknown>);
  }
  // Coerce non-string values (boxed strings, objects with toString) before
  // the scheme check so they cannot smuggle an unsafe URL past it.
  if (
    (URL_ATTRS.has(safeName) || /:(href|src|action|formaction|cite|data|poster)$/.test(safeName)) &&
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

function renderJsxElement(
  type: string,
  props: JsxProps,
  children: JsxChild[],
  slotKey?: string,
): RawHtml {
  const chunks = [`<${type}`];
  const values: unknown[] = [];
  if (props)
    for (const [name, value] of Object.entries(props)) pushJsxAttr(chunks, values, name, value);
  if (slotKey !== undefined && props?.["data-key"] == null) {
    pushJsxAttr(chunks, values, "data-key", slotKey);
  }
  chunks[chunks.length - 1] += ">";
  if (!VOID_ELEMENTS.has(type)) {
    for (const child of children) {
      values.push(child);
      chunks.push("");
    }
    chunks[chunks.length - 1] += `</${type}>`;
  }
  return html(chunks as unknown as TemplateStringsArray, ...values);
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
      return __ilhaJsxSlot(type, componentProps, slotKey);
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

  return renderJsxElement(type, props, normalizedChildren, slotKey);
}

export const jsxs = jsx;

export function Fragment(props: { children?: JsxChild } | null, ...children: JsxChild[]): RawHtml {
  const normalizedChildren = normalizeJsxChildren(props, children);
  const chunks = ["", ...normalizedChildren.map(() => "")];
  return html(chunks as unknown as TemplateStringsArray, ...normalizedChildren);
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
