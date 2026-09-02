const VOID = new Set([
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

/** Tags whose children are raw text — do not HTML-escape content. */
const RAW_TEXT = new Set(["script", "style"]);

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// SAFETY: escapes values embedded in double-quoted HTML attributes only.
// Do not reuse for single-quoted or unquoted attribute contexts.
export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

export type SsrText = { kind: "text"; text: string };

export type SsrEl = {
  kind: "element";
  tag: string;
  attrs: Map<string, string>;
  children: SsrNode[];
  isConnected: boolean;
  tagName: string;
  localName: string;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  replaceChildren(...nodes: SsrNode[]): void;
  appendChild(node: SsrNode): void;
  textContent: string;
};

export type SsrNode = SsrText | SsrEl;

export type SsrRoot = {
  kind: "root";
  children: SsrNode[];
  appendChild(node: SsrNode): void;
  replaceChildren(): void;
  readonly innerHTML: string;
};

export function createSsrText(text: string): SsrText {
  return { kind: "text", text };
}

export function createSsrElement(tag: string): SsrEl {
  const lower = tag.toLowerCase();
  const children: SsrNode[] = [];
  const el: SsrEl = {
    kind: "element",
    tag: lower,
    attrs: new Map(),
    children,
    isConnected: true,
    tagName: lower.toUpperCase(),
    localName: lower,
    setAttribute(name, value) {
      el.attrs.set(name, value);
    },
    getAttribute(name) {
      return el.attrs.has(name) ? el.attrs.get(name)! : null;
    },
    removeAttribute(name) {
      el.attrs.delete(name);
    },
    hasAttribute(name) {
      return el.attrs.has(name);
    },
    replaceChildren(...nodes) {
      children.length = 0;
      children.push(...nodes);
    },
    appendChild(node) {
      children.push(node);
    },
    get textContent() {
      return children.map((n) => (n.kind === "text" ? n.text : n.textContent)).join("");
    },
    set textContent(value) {
      children.length = 0;
      children.push(createSsrText(value));
    },
  };
  return el;
}

export function createSsrRoot(): SsrRoot {
  const children: SsrNode[] = [];
  return {
    kind: "root",
    children,
    appendChild(node) {
      children.push(node);
    },
    replaceChildren() {
      children.length = 0;
    },
    get innerHTML() {
      return children.map(serializeNode).join("");
    },
  };
}

function serializeRawText(tag: string, text: string): string {
  // Reject content that would close the element early (`</script`, `</style`).
  if (new RegExp(`</${tag}\\b`, "i").test(text)) return "";
  return text;
}

export function serializeNode(node: SsrNode): string {
  if (node.kind === "text") return escapeText(node.text);
  const parts: string[] = [];
  for (const [name, value] of node.attrs) {
    parts.push(`${name}="${escapeAttr(value)}"`);
  }
  const attr = parts.length > 0 ? ` ${parts.join(" ")}` : "";
  const tag = node.tag;
  if (VOID.has(tag)) return `<${tag}${attr}>`;
  if (RAW_TEXT.has(tag)) {
    const raw = serializeRawText(tag, node.textContent);
    return `<${tag}${attr}>${raw}</${tag}>`;
  }
  return `<${tag}${attr}>${node.children.map(serializeNode).join("")}</${tag}>`;
}
