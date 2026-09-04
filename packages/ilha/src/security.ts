import { isString } from "./shared.ts";
import type { StyleObject } from "./types.ts";

const SAFE_CSS_PROP_RE =
  /^(?:-{2}[a-zA-Z][a-zA-Z0-9-]*|-?[a-zA-Z][a-zA-Z0-9-]*)$/u;
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
const SAFE_DATA_IMAGE_RE = /^data:image\/(?<fmt>png|jpe?g|gif|webp|avif)[;,]/iu;
const UNSAFE_SCHEME_RE = /^(?:javascript|vbscript):/iu;
const DATA_IMAGE_CONTEXTS = new Set([
  "img:src",
  "source:srcset",
  "link:imagesrcset",
]);

// SAFETY: strips ASCII controls (\u0000-\u0020) and the Unicode whitespace /
// zero-width characters used to pad dangerous URL schemes (NBSP, ZWSP, BOM, etc.).
const isBlockedUrlChar = (code: number): boolean =>
  code <= 0x20 ||
  code === 0xa0 ||
  code === 0x16_80 ||
  (code >= 0x20_00 && code <= 0x20_0d) ||
  code === 0x20_28 ||
  code === 0x20_29 ||
  code === 0x20_2f ||
  code === 0x20_5f ||
  code === 0x30_00 ||
  code === 0xfe_ff;

const normalizeUrl = (value: string): string => {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (!isBlockedUrlChar(code)) {
      out += ch;
    }
  }
  return out;
};

const checkUrl = (normalized: string, allowDataImage: boolean): boolean => {
  if (UNSAFE_SCHEME_RE.test(normalized)) {
    return false;
  }
  if (/^data:/iu.test(normalized)) {
    return allowDataImage && SAFE_DATA_IMAGE_RE.test(normalized);
  }
  return true;
};

export const isUrlAttributeName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    URL_ATTRS.has(lower) ||
    /:(?<attr>href|src|srcset|imagesrcset|action|formaction|cite|data|poster)$/u.test(
      lower
    )
  );
};

export const isSafeUrlAttrValue = (
  tagName: string,
  attrName: string,
  value: string
): boolean => {
  const attr = attrName.toLowerCase();
  const allowDataImage =
    DATA_IMAGE_CONTEXTS.has(`${tagName.toLowerCase()}:${attr}`) &&
    !attr.startsWith("srcset") &&
    attr !== "imagesrcset";
  if (/^(?:srcset|imagesrcset)$/iu.test(attr)) {
    return value.split(",").every((candidate) => {
      const url = candidate.trim().split(/\s+/u)[0] ?? "";
      return url === "" || checkUrl(normalizeUrl(url), false);
    });
  }
  return checkUrl(normalizeUrl(value), allowDataImage);
};

const isSafeStyleValue = (str: string): boolean => {
  if (
    /[<>{};]/u.test(str) ||
    /expression\(/iu.test(str) ||
    /javascript:/iu.test(str) ||
    /data:/iu.test(str)
  ) {
    return false;
  }
  if (/\\/u.test(str)) {
    return false;
  }
  const urlRe = /url\s*\(\s*(?<inner>[^)]+)\s*\)/giu;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(str)) !== null) {
    const inner = (m.groups?.inner ?? "")
      .trim()
      .replaceAll(/^['"]|['"]$/gu, "");
    if (!checkUrl(normalizeUrl(inner), false)) {
      return false;
    }
  }
  return true;
};

const serializeStyleEntries = (value: StyleObject): string =>
  Object.entries(value)
    .map(([k, v]) => {
      if (!SAFE_CSS_PROP_RE.test(k)) {
        return "";
      }
      const prop = k.replaceAll(/[A-Z]/gu, (m) => `-${m.toLowerCase()}`);
      const str = String(v);
      if (!isSafeStyleValue(str)) {
        return "";
      }
      return `${prop}:${str}`;
    })
    .filter(Boolean)
    .join(";");

export const serializeStyle = (value: StyleObject): string =>
  serializeStyleEntries(value);

export const serializeStyleAttr = (value: string | StyleObject): string => {
  if (isString(value)) {
    const obj: Record<string, string | number | null | undefined> = {};
    for (const decl of value.split(";")) {
      const colon = decl.indexOf(":");
      if (colon === -1) {
        continue;
      }
      const prop = decl.slice(0, colon).trim();
      const val = decl.slice(colon + 1).trim();
      if (prop) {
        obj[prop] = val;
      }
    }
    return serializeStyleEntries(obj);
  }
  return serializeStyleEntries(value);
};
