import { isString } from "./shared.ts";
import type { StyleObject } from "./types.ts";

const SAFE_CSS_PROP = /^-{0,2}[a-zA-Z][a-zA-Z0-9-]*$/u;
const URL_ATTR =
  /(?:^|:)(?:href|src|srcset|imagesrcset|action|formaction|cite|data|poster)$/iu;
const SRCSET_ATTR = /^(?:srcset|imagesrcset)$/iu;
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif)[;,]/iu;
const UNSAFE_SCHEME = /^(?:javascript|vbscript):/iu;
// ASCII controls plus the Unicode whitespace and zero-width characters used to
// pad dangerous URL schemes (NBSP, ZWSP, BOM, …).
// oxlint-disable-next-line no-control-regex -- stripping controls is the point
const URL_PADDING =
  /[\0-\u0020\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]/gu;
const UNSAFE_CSS = /[<>{};\\]|expression\(|javascript:|data:/iu;
const CSS_URL = /url\s*\(\s*(?<inner>[^)]+)\s*\)/giu;

const isSafeUrl = (value: string, allowDataImage = false): boolean => {
  const url = value.replaceAll(URL_PADDING, "");
  if (UNSAFE_SCHEME.test(url)) {
    return false;
  }
  return !/^data:/iu.test(url) || (allowDataImage && SAFE_DATA_IMAGE.test(url));
};

export const isUrlAttributeName = (name: string): boolean =>
  URL_ATTR.test(name);

export const isSafeUrlAttrValue = (
  tagName: string,
  attrName: string,
  value: string
): boolean => {
  if (SRCSET_ATTR.test(attrName)) {
    return value
      .split(",")
      .every((candidate) => isSafeUrl(candidate.trim().split(/\s+/u)[0] ?? ""));
  }
  // Raster data: images are allowed only as an <img src>.
  return isSafeUrl(
    value,
    tagName.toLowerCase() === "img" && attrName.toLowerCase() === "src"
  );
};

const isSafeStyleValue = (str: string): boolean =>
  !UNSAFE_CSS.test(str) &&
  [...str.matchAll(CSS_URL)].every((m) =>
    isSafeUrl((m.groups?.inner ?? "").trim().replaceAll(/^['"]|['"]$/gu, ""))
  );

/** Serialize a style string or object, dropping unsafe properties and values. */
export const serializeStyleAttr = (value: string | StyleObject): string => {
  const entries = isString(value)
    ? value.split(";").map((decl) => {
        const colon = decl.indexOf(":");
        return colon === -1
          ? ["", ""]
          : [decl.slice(0, colon).trim(), decl.slice(colon + 1).trim()];
      })
    : Object.entries(value);
  return entries
    .filter(
      ([k, v]) =>
        k &&
        v !== null &&
        v !== undefined &&
        SAFE_CSS_PROP.test(k) &&
        isSafeStyleValue(String(v))
    )
    .map(
      ([k, v]) =>
        `${(k ?? "").replaceAll(/[A-Z]/gu, (m) => `-${m.toLowerCase()}`)}:${String(v)}`
    )
    .join(";");
};
