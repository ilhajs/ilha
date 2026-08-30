import { raw, type RawHtml } from "./index";
import { __ilhaJsxSlot, __ilhaRenderTemplate } from "./internal";
import { elementTemplate, fragmentTemplate } from "./template";
export type { JSX } from "./jsx-types";

type JsxChild = unknown;
type JsxProps = Record<string, unknown> | null | undefined;
type JsxType = string | ((props: Record<string, unknown>) => unknown);

const RAW = Symbol.for("ilha.raw");
const ISLAND = Symbol.for("ilha.island");
const ISLAND_CALL = Symbol.for("ilha.islandCall");
const RENDER_PART = Symbol.for("ilha.renderPart");

function isRawHtml(v: unknown): v is RawHtml {
  return !!(v && typeof v === "object" && RAW in v);
}

// Brand checks use `Symbol.for`, which resolves to the SAME symbol across
// duplicate ilha copies in one realm — no description-scanning fallback needed.
function isIsland(v: unknown): boolean {
  return typeof v === "function" && ISLAND in (v as object);
}

function isIslandCall(v: unknown): boolean {
  if (v == null || (typeof v !== "object" && typeof v !== "function")) return false;
  if (ISLAND_CALL in (v as object)) return true;
  return typeof v === "object" && "island" in v && isIsland((v as { island?: unknown }).island);
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

function renderJsxValue(value: unknown): RawHtml {
  return __ilhaRenderTemplate(fragmentTemplate([value]));
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
  const attrs: Record<string, unknown> = { ...(props ?? {}) };
  delete attrs.children;
  if (slotKey !== undefined) attrs.key = slotKey;
  return __ilhaRenderTemplate(elementTemplate(type, attrs, children));
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
      return renderJsxValue(out);
    }
    if (isRawHtml(out)) return slotKey !== undefined ? injectDataKey(out, slotKey) : out;
    if (typeof out === "string" && isIsland(type)) {
      return __ilhaJsxSlot({ island: type, props: componentProps, key: slotKey });
    }
    if (typeof out === "string") return renderJsxValue(out);
    if (
      typeof out === "object" &&
      out !== null &&
      Object.getPrototypeOf(out) === Object.prototype &&
      (out as Record<symbol, unknown>)[RENDER_PART] === true &&
      typeof (out as { toString?: unknown }).toString === "function"
    ) {
      return raw(String(out));
    }
    return renderJsxValue(out);
  }

  return renderJsxElement({ type, props, children: normalizedChildren, slotKey });
}

export const jsxs = jsx;

export function Fragment(props: { children?: JsxChild } | null, ...children: JsxChild[]): RawHtml {
  return __ilhaRenderTemplate(fragmentTemplate(normalizeJsxChildren(props, children)));
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
