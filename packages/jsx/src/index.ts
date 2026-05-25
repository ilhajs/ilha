import { html, raw, type RawHtml } from "ilha";

type JsxChild = unknown;
type JsxProps = Record<string, unknown> | null | undefined;
type JsxType = string | ((props: Record<string, unknown>) => unknown);

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
  return all.flat(Infinity);
}

function pushAttr(chunks: string[], values: unknown[], name: string, value: unknown): void {
  if (value == null || value === false || name === "children" || name === "key") return;

  if (name === "className") name = "class";
  if (name === "htmlFor") name = "for";
  if (typeof value === "function" && /^on[A-Z]/.test(name)) return;
  if (name === "class") value = normalizeClass(value);

  if (name.startsWith("bind:")) {
    chunks[chunks.length - 1] += ` ${name}=`;
    values.push(value);
    chunks.push("");
    return;
  }

  if (value === true) {
    chunks[chunks.length - 1] += ` ${name}`;
    return;
  }

  chunks[chunks.length - 1] += ` ${name}="`;
  values.push(value);
  chunks.push('"');
}

function renderElement(type: string, props: JsxProps, children: JsxChild[]): RawHtml {
  const chunks = [`<${type}`];
  const values: unknown[] = [];

  if (props) {
    for (const [name, value] of Object.entries(props)) pushAttr(chunks, values, name, value);
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

export function jsx(type: JsxType, props: JsxProps, ...children: JsxChild[]): RawHtml {
  const normalizedChildren = normalizeJsxChildren(props, children);

  if (typeof type === "function") {
    const componentProps = {
      ...(props ?? {}),
      ...(normalizedChildren.length > 0 ? { children: normalizedChildren } : {}),
    };
    const out = type(Object.keys(componentProps).length === 0 ? undefined! : componentProps);
    if (typeof out === "string") return raw(out);
    if (out && typeof out === "object" && "value" in out) return out as RawHtml;
    return html`${out}`;
  }

  return renderElement(type, props, normalizedChildren);
}

export const jsxs = jsx;

export function Fragment(props: { children?: JsxChild } | null, ...children: JsxChild[]): RawHtml {
  const normalizedChildren = normalizeJsxChildren(props, children);
  const chunks = ["", ...normalizedChildren.map(() => "")];
  return html(chunks as unknown as TemplateStringsArray, ...normalizedChildren);
}

export function jsxDEV(type: JsxType, props: JsxProps): RawHtml {
  return jsx(type, props);
}
