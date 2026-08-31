const SAFE_CSS_PROP_RE = /^(-{2}[a-zA-Z][a-zA-Z0-9-]*|-?[a-zA-Z][a-zA-Z0-9-]*)$/;
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
const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|avif)[;,]/i;
const UNSAFE_SCHEME_RE = /^(?:javascript|vbscript):/i;
const DATA_IMAGE_CONTEXTS = new Set(["img:src", "source:srcset", "link:imagesrcset"]);

// SAFETY: strips raw control characters from URL attribute values — the
// control-character range is the point of the regex.
function normalizeUrl(value: string): string {
  // SAFETY: strips raw control characters from URL attribute values — the
  // control-character range is the point of the regex.
  // oxlint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0020]/g, "");
}

function checkUrl(normalized: string, allowDataImage: boolean): boolean {
  if (UNSAFE_SCHEME_RE.test(normalized)) return false;
  if (/^data:/i.test(normalized)) return allowDataImage && SAFE_DATA_IMAGE_RE.test(normalized);
  return true;
}

export function isUrlAttributeName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    URL_ATTRS.has(lower) ||
    /:(href|src|srcset|imagesrcset|action|formaction|cite|data|poster)$/.test(lower)
  );
}

export function isSafeUrlAttrValue(tagName: string, attrName: string, value: string): boolean {
  const attr = attrName.toLowerCase();
  const allowDataImage =
    DATA_IMAGE_CONTEXTS.has(`${tagName.toLowerCase()}:${attr}`) &&
    !attr.startsWith("srcset") &&
    attr !== "imagesrcset";
  if (/^(?:srcset|imagesrcset)$/i.test(attr)) {
    return value.split(",").every((candidate) => {
      const url = candidate.trim().split(/\s+/)[0] ?? "";
      return url === "" || checkUrl(normalizeUrl(url), false);
    });
  }
  return checkUrl(normalizeUrl(value), allowDataImage);
}

export function serializeStyle(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([k, v]) => {
      if (!SAFE_CSS_PROP_RE.test(k)) return "";
      const prop = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const str = String(v);
      if (/[<>{};]/.test(str) || /expression\(/i.test(str) || /javascript:/i.test(str)) return "";
      return `${prop}:${str}`;
    })
    .filter(Boolean)
    .join(";");
}
