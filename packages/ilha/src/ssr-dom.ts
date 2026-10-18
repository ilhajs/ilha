import { ilhaError } from "./diagnostics.ts";
import { SLOT_ATTR } from "./shared.ts";

const VOID =
  /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/u;

/** Tags whose children are raw text — content is not HTML-escaped. */
const RAW_TEXT = /^(?:script|style)$/u;

export const escapeText = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// SAFETY: escapes values embedded in double-quoted HTML attributes only.
export const escapeAttr = (s: string): string =>
  escapeText(s).replaceAll('"', "&quot;");

export interface SsrText {
  kind: "text";
  text: string;
}

export interface SsrRaw {
  kind: "raw";
  html: string;
}

export type SsrNode = SsrText | SsrRaw | SsrEl;

/** Minimal element for string rendering; the root is an element without a tag. */
export class SsrEl {
  readonly kind = "element";
  readonly localName: string;
  readonly tagName: string;
  readonly attrs = new Map<string, string>();
  children: SsrNode[] = [];

  constructor(tag: string) {
    this.localName = tag.toLowerCase();
    this.tagName = this.localName.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  append(...nodes: SsrNode[]): void {
    this.children.push(...nodes);
  }

  get textContent(): string {
    return this.children
      .map((n) => {
        if (n.kind === "text") {
          return n.text;
        }
        return n.kind === "raw" ? n.html : n.textContent;
      })
      .join("");
  }

  set textContent(text: string) {
    this.children = [{ kind: "text", text }];
  }
}

/**
 * Serialize a node. With `bare`, hole hosts (`data-ilha-slot`) vanish and only
 * their content remains: a render that never hydrates needs no hole markers.
 */
export const serializeNode = (node: SsrNode, bare = false): string => {
  if (node.kind === "text") {
    return escapeText(node.text);
  }
  if (node.kind === "raw") {
    return node.html;
  }
  const inner = node.children.map((c) => serializeNode(c, bare)).join("");
  const tag = node.localName;
  if (!tag || (bare && node.attrs.has(SLOT_ATTR))) {
    return inner;
  }
  let open = `<${tag}`;
  for (const [name, value] of node.attrs) {
    open += ` ${name}="${escapeAttr(value)}"`;
  }
  open += ">";
  if (VOID.test(tag)) {
    return open;
  }
  if (RAW_TEXT.test(tag)) {
    const raw = node.textContent;
    // Raw-text tags cannot escape children; a matching closer would end the
    // element early. Fail loudly instead of shipping truncated markup.
    if (new RegExp(`</${tag}\\b`, "iu").test(raw)) {
      throw ilhaError("ILHA007", `<${tag}> contains "</${tag}"`);
    }
    return `${open}${raw}</${tag}>`;
  }
  return `${open}${inner}</${tag}>`;
};
