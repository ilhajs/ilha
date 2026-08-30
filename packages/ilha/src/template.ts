const ATTRIBUTE = Symbol.for("ilha.templateAttribute");
const PARTS = Symbol.for("ilha.templateParts");

export interface TemplateAttribute {
  [ATTRIBUTE]: true;
  value: unknown;
  quoted: boolean;
  bare: boolean;
}

export interface TemplateParts {
  [PARTS]: true;
  values: unknown[];
}

export type TemplateSegment = string | { slot: number };

export type TemplateNode =
  | { kind: "fragment"; children: TemplateNode[] }
  | {
      kind: "element";
      tag: string;
      props: Record<string, unknown>;
      children: TemplateNode[];
      selfClosing?: boolean;
    }
  | { kind: "text"; value: string }
  | { kind: "comment"; value: string }
  | { kind: "dynamic"; value: unknown };

interface BlueprintSlot {
  slot: number;
}

type BlueprintSegment = string | BlueprintSlot;

type BlueprintNode =
  | { kind: "fragment"; children: BlueprintNode[] }
  | {
      kind: "element";
      tag: string;
      props: Record<string, BlueprintSegment[]>;
      children: BlueprintNode[];
      selfClosing?: boolean;
    }
  | { kind: "text"; value: BlueprintSegment[] }
  | { kind: "comment"; value: string };

const SLOT_START = "\uE000ilha:";
const SLOT_END = ":\uE001";
const SLOT_RE = /\uE000ilha:(\d+):\uE001/g;
const cache = new WeakMap<TemplateStringsArray, BlueprintNode>();

const VOID_TAGS = new Set([
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
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

type FragNode = {
  nodeName: string;
  tagName?: string;
  value?: string;
  data?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: FragNode[];
  sourceCodeLocation?: {
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
    startTag?: { startOffset: number; endOffset: number };
  };
};

function skipWs(s: string, i: number): number {
  while (i < s.length && /[\t\n\f\r ]/.test(s[i]!)) i++;
  return i;
}

function parseFragment(source: string): FragNode {
  const children: FragNode[] = [];
  parseNodes(source, 0, null, children);
  return { nodeName: "#document-fragment", childNodes: children };
}

function parseNodes(s: string, i: number, stop: string | null, out: FragNode[]): number {
  while (i < s.length) {
    if (stop && s.toLowerCase().startsWith(`</${stop}`, i)) {
      const gt = s.indexOf(">", i);
      return gt === -1 ? s.length : gt + 1;
    }
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      const close = end === -1 ? s.length : end + 3;
      out.push({ nodeName: "#comment", data: s.slice(i + 4, end === -1 ? s.length : end) });
      i = close;
      continue;
    }
    if (s[i] === "<" && s[i + 1] === "/") {
      const gt = s.indexOf(">", i);
      i = gt === -1 ? s.length : gt + 1;
      continue;
    }
    if (s[i] === "<" && /[A-Za-z]/.test(s[i + 1] ?? "")) {
      const start = i;
      i++;
      const tagStart = i;
      while (i < s.length && /[A-Za-z0-9:-]/.test(s[i]!)) i++;
      const tagOrig = s.slice(tagStart, i);
      const tag = tagOrig.toLowerCase();
      const attrs: Array<{ name: string; value: string }> = [];
      const attrLocs: Record<string, { startOffset: number; endOffset: number }> = {};
      i = skipWs(s, i);
      while (i < s.length && s[i] !== ">" && s[i] !== "/") {
        const attrStart = i;
        while (i < s.length && /[^\s=>/]/.test(s[i]!)) i++;
        const rawName = s.slice(attrStart, i);
        if (!rawName) break;
        const name = rawName;
        i = skipWs(s, i);
        let value = "";
        if (s[i] === "=") {
          i++;
          i = skipWs(s, i);
          if (s[i] === '"' || s[i] === "'") {
            const q = s[i]!;
            i++;
            const vs = i;
            while (i < s.length && s[i] !== q) i++;
            value = s.slice(vs, i);
            if (s[i] === q) i++;
          } else {
            const vs = i;
            // Keep `/` inside values (`href=/docs`, `src=https://…`). Treat
            // `/` as a self-closing marker only when it ends the value
            // (optional whitespace, then `>` or EOF).
            while (i < s.length && /[^\s>]/.test(s[i]!)) {
              if (s[i] === "/") {
                let j = i + 1;
                while (j < s.length && /\s/.test(s[j]!)) j++;
                if (j >= s.length || s[j] === ">") break;
              }
              i++;
            }
            value = s.slice(vs, i);
          }
        }
        attrs.push({ name, value });
        attrLocs[name] = { startOffset: attrStart, endOffset: i };
        i = skipWs(s, i);
      }
      if (s[i] === "/") {
        i++;
        i = skipWs(s, i);
      }
      if (s[i] === ">") i++;
      const el: FragNode = {
        nodeName: tagOrig,
        tagName: tagOrig,
        attrs,
        childNodes: [],
        sourceCodeLocation: { attrs: attrLocs, startTag: { startOffset: start, endOffset: i } },
      };
      if (!VOID_TAGS.has(tag)) {
        if (RAW_TEXT_TAGS.has(tag)) {
          const close = `</${tag}`;
          const ci = s.toLowerCase().indexOf(close, i);
          const textEnd = ci === -1 ? s.length : ci;
          if (textEnd > i) el.childNodes!.push({ nodeName: "#text", value: s.slice(i, textEnd) });
          i = ci === -1 ? s.length : s.indexOf(">", ci) === -1 ? s.length : s.indexOf(">", ci) + 1;
        } else {
          i = parseNodes(s, i, tag, el.childNodes!);
        }
      }
      out.push(el);
      continue;
    }
    const next = s.indexOf("<", i);
    const end = next === -1 ? s.length : next;
    if (end > i) {
      out.push({ nodeName: "#text", value: s.slice(i, end) });
      i = end;
      continue;
    }
    out.push({ nodeName: "#text", value: s[i]! });
    i++;
  }
  return i;
}

function segments(value: string): BlueprintSegment[] {
  const out: BlueprintSegment[] = [];
  let offset = 0;
  for (const match of value.matchAll(SLOT_RE)) {
    if (match.index! > offset) out.push(value.slice(offset, match.index));
    out.push({ slot: Number(match[1]) });
    offset = match.index! + match[0].length;
  }
  if (offset < value.length) out.push(value.slice(offset));
  return out;
}

function blueprint(node: any, source: string): BlueprintNode | null {
  if (node.nodeName === "#text") return { kind: "text", value: segments(node.value) };
  if (node.nodeName === "#comment") return { kind: "comment", value: node.data };
  if (node.nodeName === "#document-fragment") {
    return {
      kind: "fragment",
      children: node.childNodes
        .map((child: any) => blueprint(child, source))
        .filter(Boolean) as BlueprintNode[],
    };
  }
  if (typeof node.tagName === "string") {
    const props: Record<string, BlueprintSegment[]> = {};
    for (const attr of node.attrs ?? []) {
      const location = node.sourceCodeLocation?.attrs?.[attr.name];
      const sourceAttr = location
        ? source.slice(location.startOffset, location.endOffset)
        : attr.name;
      const parts = segments(attr.value) as BlueprintSegment[] & {
        quoted?: boolean;
        bare?: boolean;
      };
      parts.quoted = /=\s*["']/.test(sourceAttr);
      parts.bare = !sourceAttr.includes("=");
      props[attr.name] = parts;
    }
    return {
      kind: "element",
      tag: node.tagName,
      props,
      children: (node.childNodes ?? [])
        .map((child: any) => blueprint(child, source))
        .filter(Boolean) as BlueprintNode[],
      selfClosing: node.sourceCodeLocation?.startTag
        ? /\/\s*>$/.test(
            source.slice(
              node.sourceCodeLocation.startTag.startOffset,
              node.sourceCodeLocation.startTag.endOffset,
            ),
          )
        : false,
    };
  }
  return null;
}

function compile(strings: TemplateStringsArray): BlueprintNode {
  let source = strings[0] ?? "";
  for (let i = 0; i < strings.length - 1; i++) {
    source += `${SLOT_START}${i}${SLOT_END}${strings[i + 1] ?? ""}`;
  }
  return (
    blueprint(parseFragment(source), source) ?? {
      kind: "fragment",
      children: [],
    }
  );
}

function bindSegments(
  parts: BlueprintSegment[] & { quoted?: boolean; bare?: boolean },
  values: unknown[],
): TemplateAttribute {
  let value: unknown;
  if (parts.length === 1 && typeof parts[0] !== "string") value = values[parts[0].slot];
  else if (parts.some((part) => typeof part !== "string")) {
    value = {
      [PARTS]: true,
      values: parts.map((part) => (typeof part === "string" ? part : values[part.slot])),
    } satisfies TemplateParts;
  } else value = parts.join("");
  return { [ATTRIBUTE]: true, value, quoted: parts.quoted ?? true, bare: parts.bare ?? false };
}

function bind(node: BlueprintNode, values: unknown[]): TemplateNode | TemplateNode[] {
  if (node.kind === "text") {
    const out: TemplateNode[] = [];
    for (const part of node.value) {
      if (typeof part === "string") {
        if (part) out.push({ kind: "text", value: part });
      } else {
        out.push({ kind: "dynamic", value: values[part.slot] });
      }
    }
    return out;
  }
  if (node.kind === "comment") return { kind: "comment", value: node.value };
  if (node.kind === "element") {
    const props: Record<string, unknown> = {};
    for (const [name, parts] of Object.entries(node.props))
      props[name] = bindSegments(parts, values);
    return {
      kind: "element",
      tag: node.tag,
      props,
      children: node.children.flatMap((child) => bind(child, values)),
      selfClosing: node.selfClosing,
    };
  }
  return {
    kind: "fragment",
    children: node.children.flatMap((child) => bind(child, values)),
  };
}

export function htmlTemplate(strings: TemplateStringsArray, values: unknown[]): TemplateNode {
  let compiled = cache.get(strings);
  if (!compiled) {
    compiled = compile(strings);
    cache.set(strings, compiled);
  }
  const result = bind(compiled, values);
  return Array.isArray(result) ? { kind: "fragment", children: result } : result;
}

export function templateAttribute(value: unknown): TemplateAttribute | null {
  return value && typeof value === "object" && ATTRIBUTE in value
    ? (value as TemplateAttribute)
    : null;
}

export function templateParts(value: unknown): unknown[] | null {
  return value && typeof value === "object" && PARTS in value
    ? (value as TemplateParts).values
    : null;
}

export function elementTemplate(
  tag: string,
  props: Record<string, unknown> | null | undefined,
  children: unknown[],
): TemplateNode {
  const attrs = { ...props };
  delete attrs.children;
  return {
    kind: "element",
    tag,
    props: attrs,
    children: children.flat(Infinity).map((value) => ({ kind: "dynamic", value })),
  };
}

export function fragmentTemplate(children: unknown[]): TemplateNode {
  return {
    kind: "fragment",
    children: children.flat(Infinity).map((value) => ({ kind: "dynamic", value })),
  };
}
