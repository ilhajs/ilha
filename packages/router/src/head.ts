/**
 * Render-scoped head collection and serialization.
 *
 * Loaders and render-time `head()` calls push `HeadInput` entries into a
 * store scoped to the current render (`withHeadStore`); `serializeHead`
 * turns the collected entries into document-shell fragments.
 */

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

/** Dev-mode check mirroring index.ts — used to surface loader error detail. */
function isDevEnv(): boolean {
  return isBrowser
    ? false
    : (() => {
        try {
          return (process.env?.["NODE_ENV"] ?? "development") !== "production";
        } catch {
          return true;
        }
      })();
}

/**
 * Serializable description of `<head>` (and html/body attributes) contributed
 * by a loader or a render-time `head()` call. Deliberately a plain POJO — Tier
 * 1 head management is SSR-only, so there is no reactive wrapper. Dedup keys
 * mirror unhead so a later move to a runtime head manager stays a drop-in.
 */
export interface HeadInput {
  title?: string;
  /** Wrap the resolved title. The last template in merge order wins. */
  titleTemplate?: string | ((title?: string) => string);
  meta?: Array<Record<string, string>>;
  link?: Array<Record<string, string>>;
  /**
   * Inline script bodies are emitted raw in SSR (`serializeHead`). Must be trusted
   * app code and must not contain a literal `</script>` sequence.
   */
  script?: Array<Record<string, string> & { children?: string }>;
  htmlAttrs?: Record<string, string>;
  bodyAttrs?: Record<string, string>;
}

/** Serialized head fragments ready to inject into a document shell. */
export interface SerializedHead {
  /** Markup for inside `<head>` (title, meta, link, script). */
  headTags: string;
  /** Attribute string for the `<html>` tag (leading space included). */
  htmlAttrs: string;
  /** Attribute string for the `<body>` tag (leading space included). */
  bodyAttrs: string;
}

export interface HeadStore {
  entries: HeadInput[];
}

const ILHA_HEAD_ATTR = "data-ilha-head";
const ILHA_ROUTER_HTML_ATTR = "data-ilha-router-html";
const ILHA_ROUTER_BODY_ATTR = "data-ilha-router-body";

/** Browser-only fallback; SSR uses AsyncLocalStorage (see `withHeadStore`). */
let _browserHeadStore: HeadStore | null = null;

type HeadAls = {
  getStore(): HeadStore | undefined;
  run<R>(store: HeadStore, fn: () => R): R;
};

let _headAls: HeadAls | null = null;
let _headAlsInit: Promise<HeadAls> | null = null;

/** ESM dynamic import — Nitro/Vite SSR workers have no `require`. */
async function getHeadAlsAsync(): Promise<HeadAls> {
  if (_headAls) return _headAls;
  if (!_headAlsInit) {
    _headAlsInit = import("node:async_hooks").then(({ AsyncLocalStorage }) => {
      _headAls = new AsyncLocalStorage<HeadStore>();
      return _headAls;
    });
  }
  return _headAlsInit;
}

function activeHeadStore(): HeadStore | null {
  if (isBrowser) return _browserHeadStore;
  return _headAls?.getStore() ?? null;
}

/**
 * Contribute `<head>` data from inside an island's `.render()` body or a
 * layout. During SSR this collects into the active render window; on the
 * client, entries are collected when the router re-renders a route inside
 * `withHeadStore` and then applied to `document`. Prefer a loader's `ctx.head`
 * for data that depends on the request.
 */
export function head(input: HeadInput): void {
  const store = activeHeadStore();
  if (!store) {
    if (!isBrowser) {
      console.warn("[ilha-router] head() called outside an SSR render window — ignored.");
    }
    return;
  }
  store.entries.push(input);
}

export function cssEscapeAttr(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function headManagedMetaSelector(tag: Record<string, string>): string | null {
  if ("charset" in tag) return `meta[charset][${ILHA_HEAD_ATTR}]`;
  if ("name" in tag) return `meta[name="${cssEscapeAttr(tag.name)}"][${ILHA_HEAD_ATTR}]`;
  if ("property" in tag)
    return `meta[property="${cssEscapeAttr(tag.property)}"][${ILHA_HEAD_ATTR}]`;
  if ("http-equiv" in tag)
    return `meta[http-equiv="${cssEscapeAttr(tag["http-equiv"])}"][${ILHA_HEAD_ATTR}]`;
  return null;
}

function headManagedLinkSelector(tag: Record<string, string>): string | null {
  if (tag.rel && tag.href) {
    return `link[rel="${cssEscapeAttr(tag.rel)}"][href="${cssEscapeAttr(tag.href)}"][${ILHA_HEAD_ATTR}]`;
  }
  return null;
}

/**
 * Apply merged head entries on client navigations. Updates `document.title` and
 * managed meta/link nodes (`data-ilha-head`). Script tags from HeadInput are
 * SSR-only and are not re-injected here. Removes managed tags from the previous
 * route that are not part of this navigation's set.
 */
export function applyHeadEntriesToDocument(entries: HeadInput[]): void {
  if (!isBrowser) return;

  let title: string | undefined;
  let titleTemplate: HeadInput["titleTemplate"];
  const meta: Array<Record<string, string>> = [];
  const link: Array<Record<string, string>> = [];
  let htmlAttrs: Record<string, string> = {};
  let bodyAttrs: Record<string, string> = {};

  for (const entry of entries) {
    if (entry.title !== undefined) title = entry.title;
    if (entry.titleTemplate !== undefined) titleTemplate = entry.titleTemplate;
    if (entry.meta) meta.push(...entry.meta);
    if (entry.link) link.push(...entry.link);
    if (entry.htmlAttrs) htmlAttrs = { ...htmlAttrs, ...entry.htmlAttrs };
    if (entry.bodyAttrs) bodyAttrs = { ...bodyAttrs, ...entry.bodyAttrs };
  }

  const resolvedTitle = applyTitleTemplate(title, titleTemplate);
  if (resolvedTitle !== undefined) document.title = resolvedTitle;

  const metaTags = dedupByKey(meta, metaDedupKey);
  const linkTags = dedupByKey(link, (t) => `${t.rel ?? ""}:${t.href ?? ""}`);
  const keepManaged = new Set<Element>();

  for (const tag of metaTags) {
    const selector = headManagedMetaSelector(tag);
    if (!selector) continue;
    let el = document.querySelector(selector) as HTMLMetaElement | null;
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(ILHA_HEAD_ATTR, "");
      document.head.appendChild(el);
    }
    for (const [k, v] of Object.entries(tag)) el.setAttribute(k, v);
    keepManaged.add(el);
  }

  for (const tag of linkTags) {
    const selector = headManagedLinkSelector(tag);
    let el: HTMLLinkElement | null = selector
      ? (document.querySelector(selector) as HTMLLinkElement | null)
      : null;
    if (!el) {
      el = document.createElement("link");
      el.setAttribute(ILHA_HEAD_ATTR, "");
      document.head.appendChild(el);
    }
    for (const [k, v] of Object.entries(tag)) el.setAttribute(k, v);
    keepManaged.add(el);
  }

  for (const el of document.head.querySelectorAll(`[${ILHA_HEAD_ATTR}]`)) {
    if (!keepManaged.has(el)) el.remove();
  }

  const htmlEl = document.documentElement;
  const prevHtmlKeys = (htmlEl.getAttribute(ILHA_ROUTER_HTML_ATTR) ?? "")
    .split(/\s+/)
    .filter(Boolean);
  for (const k of prevHtmlKeys) htmlEl.removeAttribute(k);
  const nextHtmlKeys = Object.keys(htmlAttrs);
  for (const [k, v] of Object.entries(htmlAttrs)) htmlEl.setAttribute(k, v);
  if (nextHtmlKeys.length) htmlEl.setAttribute(ILHA_ROUTER_HTML_ATTR, nextHtmlKeys.join(" "));
  else htmlEl.removeAttribute(ILHA_ROUTER_HTML_ATTR);

  const bodyEl = document.body;
  const prevBodyKeys = (bodyEl.getAttribute(ILHA_ROUTER_BODY_ATTR) ?? "")
    .split(/\s+/)
    .filter(Boolean);
  for (const k of prevBodyKeys) bodyEl.removeAttribute(k);
  const nextBodyKeys = Object.keys(bodyAttrs);
  for (const [k, v] of Object.entries(bodyAttrs)) bodyEl.setAttribute(k, v);
  if (nextBodyKeys.length) bodyEl.setAttribute(ILHA_ROUTER_BODY_ATTR, nextBodyKeys.join(" "));
  else bodyEl.removeAttribute(ILHA_ROUTER_BODY_ATTR);
}

export async function withHeadStore<T>(store: HeadStore, fn: () => T | Promise<T>): Promise<T> {
  if (isBrowser) {
    const prev = _browserHeadStore;
    _browserHeadStore = store;
    try {
      return await fn();
    } finally {
      _browserHeadStore = prev;
    }
  }
  const als = await getHeadAlsAsync();
  return await als.run(store, () => Promise.resolve(fn()));
}

const HEAD_ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHeadAttr(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => HEAD_ESC[c]!);
}

/** Escape text content for inline HTML (loader error messages etc.). */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>]/g, (c) => HEAD_ESC[c]!);
}

function serializeAttrs(attrs: Record<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    // Reject empty / nonsensical attribute names and event-handler attributes
    // (`on*`) so a loader-controlled key can't inject an `onload`/`onclick`
    // sink into the serialized tag.
    if (!/^[A-Za-z_:][A-Za-z0-9:._-]*$/.test(k) || /^on[a-z]/i.test(k)) {
      if (isDevEnv()) console.warn(`[ilha-router] Dropping unsafe head attribute "${k}".`);
      continue;
    }
    parts.push(` ${k}="${escapeHeadAttr(v)}"`);
  }
  return parts.join("");
}

function isSafeUrl(value: string): boolean {
  const v = value.trim();
  if (v === "") return true;
  // Reject backslashes and URL-ignored control chars — the WHATWG parser
  // treats `\` as `/` and drops tab/newline/CR, so `\evil.com` re-parses as
  // an external origin and bypasses the protocol-relative check below.
  // oxlint-disable-next-line no-control-regex -- intentional: HTML parsers strip these control chars from URLs
  if (/[\\\u0000-\u0020]/.test(v)) return false;
  // Relative and in-page targets are fine, but protocol-relative URLs are external.
  if (v.startsWith("//")) return false;
  if (v.startsWith("#") || v.startsWith("/") || v.startsWith("./")) return true;
  if (/^(?:javascript|vbscript|data):/i.test(v)) return false;
  try {
    const u = new URL(v, "http://localhost");
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function metaDedupKey(tag: Record<string, string>): string {
  if ("charset" in tag) return "charset";
  if ("name" in tag) return `name:${tag.name}`;
  if ("property" in tag) return `property:${tag.property}`;
  if ("http-equiv" in tag) return `http-equiv:${tag["http-equiv"]}`;
  return JSON.stringify(tag);
}

function dedupByKey<T extends Record<string, string>>(tags: T[], keyOf: (t: T) => string): T[] {
  const map = new Map<string, T>();
  for (const tag of tags) map.set(keyOf(tag), tag);
  return [...map.values()];
}

function applyTitleTemplate(
  title: string | undefined,
  template: HeadInput["titleTemplate"],
): string | undefined {
  if (template === undefined) return title;
  if (typeof template === "function") return template(title);
  // String template uses `%s` as the title placeholder.
  return template.replace(/%s/g, title ?? "");
}

/**
 * Merge head entries in contribution order (loader first as the base, then
 * render-time outer→inner layouts, then the page) and serialize. Later entries
 * win on collision; the last `titleTemplate` wraps the resolved title.
 */
export function serializeHead(entries: HeadInput[]): SerializedHead {
  let title: string | undefined;
  let titleTemplate: HeadInput["titleTemplate"];
  const meta: Array<Record<string, string>> = [];
  const link: Array<Record<string, string>> = [];
  const script: Array<Record<string, string> & { children?: string }> = [];
  let htmlAttrs: Record<string, string> = {};
  let bodyAttrs: Record<string, string> = {};

  for (const entry of entries) {
    if (entry.title !== undefined) title = entry.title;
    if (entry.titleTemplate !== undefined) titleTemplate = entry.titleTemplate;
    if (entry.meta) meta.push(...entry.meta);
    if (entry.link) link.push(...entry.link);
    if (entry.script) script.push(...entry.script);
    if (entry.htmlAttrs) htmlAttrs = { ...htmlAttrs, ...entry.htmlAttrs };
    if (entry.bodyAttrs) bodyAttrs = { ...bodyAttrs, ...entry.bodyAttrs };
  }

  const resolvedTitle = applyTitleTemplate(title, titleTemplate);

  const parts: string[] = [];
  if (resolvedTitle !== undefined) parts.push(`<title>${escapeHeadAttr(resolvedTitle)}</title>`);
  for (const tag of dedupByKey(meta, metaDedupKey)) {
    // Neutralize a meta-refresh that tries to bounce the page to an unsafe URL.
    if (/^refresh$/i.test(tag["http-equiv"] ?? "") && !isSafeRefreshTarget(tag.content ?? "")) {
      if (isDevEnv())
        console.warn(`[ilha-router] Dropping unsafe meta refresh target "${tag.content}".`);
      continue;
    }
    parts.push(`<meta${serializeAttrs({ ...tag, [ILHA_HEAD_ATTR]: "" })} />`);
  }
  for (const tag of dedupByKey(link, (t) => `${t.rel ?? ""}:${t.href ?? ""}`)) {
    if (tag.href !== undefined && !isSafeUrl(tag.href)) {
      if (isDevEnv()) console.warn(`[ilha-router] Dropping unsafe link href "${tag.href}".`);
      continue;
    }
    parts.push(`<link${serializeAttrs({ ...tag, [ILHA_HEAD_ATTR]: "" })} />`);
  }
  for (const tag of script) {
    if (tag.src !== undefined && !isSafeUrl(tag.src)) {
      if (isDevEnv()) console.warn(`[ilha-router] Dropping unsafe script src "${tag.src}".`);
      continue;
    }
    const { children, ...attrs } = tag;
    // Script bodies are trusted app code, but neutralise a literal `</script`
    // so a stray sequence can't terminate the tag and inject markup.
    const body = (children ?? "").replace(/<\/script/gi, "<\\/script");
    parts.push(`<script${serializeAttrs(attrs)}>${body}</script>`);
  }

  return {
    headTags: parts.join("\n  "),
    htmlAttrs: serializeAttrs(htmlAttrs),
    bodyAttrs: serializeAttrs(bodyAttrs),
  };
}

function isSafeRefreshTarget(content: string): boolean {
  const match = /url\s*=\s*(['"]?)([^'";\s]+)\1/i.exec(content);
  if (!match) return true;
  const target = match[2] ?? "";
  // Meta refresh must stay same-origin (it navigates the whole document).
  // serializeHead has no document URL at hand, so only relative path targets
  // are provably same-origin; absolute and smuggled (`\`, control chars)
  // targets are dropped. External resources like script/link keep their own
  // (broader) policy in isSafeUrl.
  // oxlint-disable-next-line no-control-regex -- intentional: CR/LF/backslash are redirect-vector chars
  if (/[\\\u0000-\u0020]/.test(target)) return false;
  if (target.startsWith("//")) return false;
  return target.startsWith("/") || target.startsWith("./");
}
