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

export const escapeText = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// SAFETY: escapes values embedded in double-quoted HTML attributes only.
// Do not reuse for single-quoted or unquoted attribute contexts.
export const escapeAttr = (s: string): string =>
  escapeText(s).replaceAll('"', "&quot;");

export interface SsrText {
  kind: "text";
  text: string;
}

export interface SsrEl {
  kind: "element";
  tag: string;
  attrs: Map<string, string>;
  children: SsrNode[];
  isConnected: boolean;
  tagName: string;
  localName: string;
  dataset: DOMStringMap;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  removeAttribute: (name: string) => void;
  hasAttribute: (name: string) => boolean;
  replaceChildren: (...nodes: SsrNode[]) => void;
  appendChild: (node: SsrNode) => void;
  append: (...nodes: SsrNode[]) => void;
  textContent: string;
}

export type SsrNode = SsrText | SsrEl;

export interface SsrRoot {
  kind: "root";
  children: SsrNode[];
  appendChild: (node: SsrNode) => void;
  append: (...nodes: SsrNode[]) => void;
  replaceChildren: () => void;
  readonly innerHTML: string;
}

export const createSsrText = (text: string): SsrText => ({
  kind: "text",
  text,
});

const serializeRawText = (tag: string, text: string): string => {
  // Raw-text tags cannot HTML-escape children; a matching closer would end the
  // element early. Fail loudly so callers do not ship truncated markup.
  if (new RegExp(`</${tag}\\b`, "iu").test(text)) {
    throw new Error(`ilha: unsafe raw text in <${tag}> (contains "</${tag}")`);
  }
  return text;
};

export const serializeNode = (node: SsrNode): string => {
  if (node.kind === "text") {
    return escapeText(node.text);
  }
  const parts: string[] = [];
  for (const [name, value] of node.attrs) {
    parts.push(`${name}="${escapeAttr(value)}"`);
  }
  const attr = parts.length > 0 ? ` ${parts.join(" ")}` : "";
  const { tag } = node;
  if (VOID.has(tag)) {
    return `<${tag}${attr}>`;
  }
  if (RAW_TEXT.has(tag)) {
    const raw = serializeRawText(tag, node.textContent);
    return `<${tag}${attr}>${raw}</${tag}>`;
  }
  return `<${tag}${attr}>${node.children.map(serializeNode).join("")}</${tag}>`;
};

const toDataAttr = (key: string): string =>
  `data-${key.replaceAll(/[A-Z]/gu, (ch) => `-${ch.toLowerCase()}`)}`;

const isSymbolKey = <T>(value: T): boolean =>
  Object.prototype.toString.call(value) === "[object Symbol]";

export const createSsrElement = (tag: string): SsrEl => {
  const lower = tag.toLowerCase();
  const children: SsrNode[] = [];
  const el: SsrEl = {
    append: (...nodes) => {
      children.push(...nodes);
    },
    appendChild: (node) => {
      children.push(node);
    },
    attrs: new Map(),
    children,
    // SAFETY: DOMStringMap proxy mirrors data-* attrs for paint/events.
    dataset: new Proxy({} as DOMStringMap, {
      get: (_t, prop) => {
        if (prop === "undefined" || isSymbolKey(prop)) {
          return;
        }
        return el.getAttribute(toDataAttr(prop)) ?? undefined;
      },
      set: (_t, prop, value) => {
        if (isSymbolKey(prop)) {
          return false;
        }
        // SAFETY: dataset proxy keys are string attribute names.
        const attr = toDataAttr(prop as string);
        if (value === undefined || value === null) {
          el.removeAttribute(attr);
        } else {
          el.setAttribute(attr, String(value));
        }
        return true;
      },
    }),
    getAttribute: (name) => {
      const value = el.attrs.get(name);
      return value === undefined ? null : value;
    },
    hasAttribute: (name) => el.attrs.has(name),
    isConnected: true,
    kind: "element",
    localName: lower,
    removeAttribute: (name) => {
      el.attrs.delete(name);
    },
    replaceChildren: (...nodes) => {
      children.length = 0;
      children.push(...nodes);
    },
    setAttribute: (name, value) => {
      el.attrs.set(name, value);
    },
    tag: lower,
    tagName: lower.toUpperCase(),
    get textContent() {
      return children
        .map((n) => (n.kind === "text" ? n.text : n.textContent))
        .join("");
    },
    set textContent(value) {
      children.length = 0;
      children.push(createSsrText(value));
    },
  };
  return el;
};

export const createSsrRoot = (): SsrRoot => {
  const children: SsrNode[] = [];
  return {
    append: (...nodes) => {
      children.push(...nodes);
    },
    appendChild: (node) => {
      children.push(node);
    },
    children,
    get innerHTML() {
      return children.map(serializeNode).join("");
    },
    kind: "root",
    replaceChildren: () => {
      children.length = 0;
    },
  };
};
