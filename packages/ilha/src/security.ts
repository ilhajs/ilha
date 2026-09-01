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

// SAFETY: strips ASCII controls and common Unicode whitespace tricks used to
// pad dangerous URL schemes (NBSP, zero-width space, BOM, etc.).
// oxlint-disable-next-line no-control-regex
const URL_WHITESPACE_RE =
  /[\u0000-\u0020\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]/g;

function normalizeUrl(value: string): string {
  return value.replace(URL_WHITESPACE_RE, "");
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

function isSafeStyleValue(str: string): boolean {
  if (
    /[<>{};]/.test(str) ||
    /expression\(/i.test(str) ||
    /javascript:/i.test(str) ||
    /data:/i.test(str)
  )
    return false;
  if (/\\/.test(str)) return false;
  const urlRe = /url\s*\(\s*([^)]+)\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(str)) !== null) {
    const inner = m[1].trim().replace(/^['"]|['"]$/g, "");
    if (!checkUrl(normalizeUrl(inner), false)) return false;
  }
  return true;
}

function serializeStyleEntries(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([k, v]) => {
      if (!SAFE_CSS_PROP_RE.test(k)) return "";
      const prop = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const str = String(v);
      if (!isSafeStyleValue(str)) return "";
      return `${prop}:${str}`;
    })
    .filter(Boolean)
    .join(";");
}

export function serializeStyle(value: Record<string, unknown>): string {
  return serializeStyleEntries(value);
}

export function serializeStyleAttr(value: string | Record<string, unknown>): string {
  if (typeof value === "string") {
    const obj: Record<string, unknown> = {};
    for (const decl of value.split(";")) {
      const colon = decl.indexOf(":");
      if (colon < 0) continue;
      const prop = decl.slice(0, colon).trim();
      const val = decl.slice(colon + 1).trim();
      if (prop) obj[prop] = val;
    }
    return serializeStyleEntries(obj);
  }
  return serializeStyleEntries(value);
}
