/**
 * Render-scoped head collection and document sync.
 *
 * Loaders and render-time `head()` calls push `HeadInput` entries into a
 * store scoped to the current render (`withHeadStore` / `withHeadStoreSync`).
 * SSR serializes them with `serializeHead`; on the client the router applies
 * the collected entries to `document` after each mount/navigation.
 */

const objectTag = <T>(value: T): string =>
  Object.prototype.toString.call(value);

type AnyFn = (...args: never[]) => void;

const isFunction = <T>(value: T): value is Extract<T, AnyFn> => {
  const tag = objectTag(value);
  return (
    tag === "[object Function]" ||
    tag === "[object AsyncFunction]" ||
    tag === "[object GeneratorFunction]"
  );
};

/** Backslash or ASCII control/space chars — HTML parsers strip or mangle these in URLs. */
const hasUnsafeUrlChar = (value: string): boolean => {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x5c) {
      return true;
    }
  }
  return false;
};

const isBrowser =
  globalThis.window !== undefined && globalThis.document !== undefined;

/** Dev-mode check mirroring index.ts — used to surface loader error detail. */
const isDevEnv = (): boolean => {
  if (isBrowser) {
    return false;
  }
  try {
    return (process.env?.["NODE_ENV"] ?? "development") !== "production";
  } catch {
    return true;
  }
};

/** Attribute map contributed to html/body or head tags. */
export type HeadAttrMap = Readonly<Record<string, string | undefined>>;

type MutableHeadAttrs = Record<string, string | undefined>;

type HeadScriptTag = HeadAttrMap & { children?: string };

/**
 * Serializable description of `<head>` (and html/body attributes) contributed
 * by a loader or a render-time `head()` call. Dedup keys mirror unhead so a
 * later move to a runtime head manager stays a drop-in.
 */
export interface HeadInput {
  title?: string;
  /** Wrap the resolved title. The last template in merge order wins. */
  titleTemplate?: string | ((title?: string) => string);
  meta?: HeadAttrMap[];
  link?: HeadAttrMap[];
  /**
   * Inline script bodies are emitted raw in SSR (`serializeHead`). Must be trusted
   * app code and must not contain a literal `</script>` sequence.
   */
  script?: HeadScriptTag[];
  htmlAttrs?: HeadAttrMap;
  bodyAttrs?: HeadAttrMap;
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

interface HeadAls {
  getStore: () => HeadStore | undefined;
  run: <R>(store: HeadStore, fn: () => R) => R;
}

let _headAls: HeadAls | null = null;
let _headAlsInit: Promise<HeadAls> | null = null;

/** ESM dynamic import — Nitro/Vite SSR workers have no `require`. */
const getHeadAlsAsync = async (): Promise<HeadAls> => {
  if (_headAls) {
    return _headAls;
  }
  if (!_headAlsInit) {
    _headAlsInit = (async () => {
      // Vite must leave this dynamic import alone in SSR builds.
      const { AsyncLocalStorage } = await import(
        /* @vite-ignore */
        "node:async_hooks"
      );
      _headAls = new AsyncLocalStorage<HeadStore>();
      return _headAls;
    })();
  }
  return await _headAlsInit;
};

const activeHeadStore = (): HeadStore | null => {
  if (isBrowser) {
    return _browserHeadStore;
  }
  return _headAls?.getStore() ?? null;
};

export const cssEscapeAttr = (value: string): string => {
  const cssApi = globalThis.CSS;
  if (cssApi !== undefined && isFunction(cssApi.escape)) {
    return cssApi.escape(value);
  }
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
};

const headManagedMetaSelector = (tag: HeadAttrMap): string | null => {
  if ("charset" in tag) {
    return `meta[charset][${ILHA_HEAD_ATTR}]`;
  }
  if ("name" in tag) {
    return `meta[name="${cssEscapeAttr(tag.name ?? "")}"][${ILHA_HEAD_ATTR}]`;
  }
  if ("property" in tag) {
    return `meta[property="${cssEscapeAttr(tag.property ?? "")}"][${ILHA_HEAD_ATTR}]`;
  }
  if ("http-equiv" in tag) {
    return `meta[http-equiv="${cssEscapeAttr(tag["http-equiv"] ?? "")}"][${ILHA_HEAD_ATTR}]`;
  }
  return null;
};

const headManagedLinkSelector = (tag: HeadAttrMap): string | null => {
  if (tag.rel && tag.href) {
    return `link[rel="${cssEscapeAttr(tag.rel)}"][href="${cssEscapeAttr(tag.href)}"][${ILHA_HEAD_ATTR}]`;
  }
  return null;
};

const HEAD_ESC = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
} as const;

type HeadEscKey = keyof typeof HEAD_ESC;

const escapeMappedChar = (c: string): string => {
  if (c in HEAD_ESC) {
    // SAFETY: `c in HEAD_ESC` narrows to a known escape table key.
    return HEAD_ESC[c as HeadEscKey];
  }
  return c;
};

export const escapeHeadAttr = <T>(value: T): string =>
  String(value).replaceAll(/[&<>"']/gu, escapeMappedChar);

/** Escape text content for inline HTML (loader error messages etc.). */
export const escapeHtml = <T>(value: T): string =>
  String(value).replaceAll(/[&<>]/gu, escapeMappedChar);

const metaDedupKey = (tag: HeadAttrMap): string => {
  if ("charset" in tag) {
    return "charset";
  }
  if ("name" in tag) {
    return `name:${tag.name}`;
  }
  if ("property" in tag) {
    return `property:${tag.property}`;
  }
  if ("http-equiv" in tag) {
    return `http-equiv:${tag["http-equiv"]}`;
  }
  return JSON.stringify(tag);
};

const dedupByKey = <T extends HeadAttrMap>(
  tags: T[],
  keyOf: (t: T) => string
): T[] => {
  const map = new Map<string, T>();
  for (const tag of tags) {
    map.set(keyOf(tag), tag);
  }
  return [...map.values()];
};

const applyTitleTemplate = (
  title: string | undefined,
  template: HeadInput["titleTemplate"]
): string | undefined => {
  if (template === undefined) {
    return title;
  }
  if (isFunction(template)) {
    return template(title);
  }
  // String template uses `%s` as the title placeholder.
  return template.replaceAll("%s", title ?? "");
};

const serializeAttrs = (attrs: HeadAttrMap): string => {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    // Reject empty / nonsensical attribute names and event-handler attributes
    // (`on*`) so a loader-controlled key can't inject an `onload`/`onclick`
    // sink into the serialized tag.
    if (
      !/^[A-Za-z_:][A-Za-z0-9:._-]*$/u.test(k) ||
      /^on[a-z]/iu.test(k) ||
      v === undefined
    ) {
      if (isDevEnv()) {
        console.warn(`[ilha-router] Dropping unsafe head attribute "${k}".`);
      }
      continue;
    }
    parts.push(` ${k}="${escapeHeadAttr(v)}"`);
  }
  return parts.join("");
};

const isSafeUrl = (value: string): boolean => {
  const v = value.trim();
  if (v === "") {
    return true;
  }
  // Reject backslashes and URL-ignored control chars — the WHATWG parser
  // treats `\` as `/` and drops tab/newline/CR, so `\evil.com` re-parses as
  // an external origin and bypasses the protocol-relative check below.
  if (hasUnsafeUrlChar(v)) {
    return false;
  }
  // Relative and in-page targets are fine, but protocol-relative URLs are external.
  if (v.startsWith("//")) {
    return false;
  }
  if (v.startsWith("#") || v.startsWith("/") || v.startsWith("./")) {
    return true;
  }
  if (/^(?:javascript|vbscript|data):/iu.test(v)) {
    return false;
  }
  try {
    const u = new URL(v, "http://localhost");
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

const isSafeRefreshTarget = (content: string): boolean => {
  const match = /url\s*=\s*(?<quote>['"]?)(?<target>[^'";\s]+)\k<quote>/iu.exec(
    content
  );
  if (!match) {
    return true;
  }
  const target = match.groups?.target ?? "";
  // Meta refresh must stay same-origin (it navigates the whole document).
  // serializeHead has no document URL at hand, so only relative path targets
  // are provably same-origin; absolute and smuggled (`\`, control chars)
  // targets are dropped. External resources like script/link keep their own
  // (broader) policy in isSafeUrl.
  if (hasUnsafeUrlChar(target)) {
    return false;
  }
  if (target.startsWith("//")) {
    return false;
  }
  return target.startsWith("/") || target.startsWith("./");
};

interface MergedHead {
  title: string | undefined;
  titleTemplate: HeadInput["titleTemplate"];
  meta: HeadAttrMap[];
  link: HeadAttrMap[];
  script: HeadScriptTag[];
  htmlAttrs: MutableHeadAttrs;
  bodyAttrs: MutableHeadAttrs;
}

const mergeHeadEntries = (
  entries: HeadInput[],
  includeScripts: boolean
): MergedHead => {
  let title: string | undefined;
  let titleTemplate: HeadInput["titleTemplate"];
  const meta: HeadAttrMap[] = [];
  const link: HeadAttrMap[] = [];
  const script: HeadScriptTag[] = [];
  const htmlAttrs: MutableHeadAttrs = {};
  const bodyAttrs: MutableHeadAttrs = {};

  for (const entry of entries) {
    const {
      title: entryTitle,
      titleTemplate: entryTemplate,
      meta: entryMeta,
      link: entryLink,
      script: entryScript,
      htmlAttrs: entryHtml,
      bodyAttrs: entryBody,
    } = entry;
    if (entryTitle !== undefined) {
      title = entryTitle;
    }
    if (entryTemplate !== undefined) {
      titleTemplate = entryTemplate;
    }
    if (entryMeta) {
      meta.push(...entryMeta);
    }
    if (entryLink) {
      link.push(...entryLink);
    }
    if (includeScripts && entryScript) {
      script.push(...entryScript);
    }
    if (entryHtml) {
      Object.assign(htmlAttrs, entryHtml);
    }
    if (entryBody) {
      Object.assign(bodyAttrs, entryBody);
    }
  }

  return { bodyAttrs, htmlAttrs, link, meta, script, title, titleTemplate };
};

const syncManagedMeta = (metaTags: HeadAttrMap[], keep: Set<Element>): void => {
  for (const tag of metaTags) {
    const selector = headManagedMetaSelector(tag);
    if (!selector) {
      continue;
    }
    const found = document.querySelector(selector);
    let el: HTMLMetaElement;
    if (found instanceof HTMLMetaElement) {
      el = found;
    } else {
      el = document.createElement("meta");
      el.setAttribute(ILHA_HEAD_ATTR, "");
      document.head.append(el);
    }
    for (const [k, v] of Object.entries(tag)) {
      if (v !== undefined) {
        el.setAttribute(k, v);
      }
    }
    keep.add(el);
  }
};

const syncManagedLink = (linkTags: HeadAttrMap[], keep: Set<Element>): void => {
  for (const tag of linkTags) {
    const selector = headManagedLinkSelector(tag);
    let el: HTMLLinkElement | null = null;
    if (selector) {
      const found = document.querySelector(selector);
      if (found instanceof HTMLLinkElement) {
        el = found;
      }
    }
    if (!el) {
      el = document.createElement("link");
      el.setAttribute(ILHA_HEAD_ATTR, "");
      document.head.append(el);
    }
    for (const [k, v] of Object.entries(tag)) {
      if (v !== undefined) {
        el.setAttribute(k, v);
      }
    }
    keep.add(el);
  }
};

const applyRouterAttrs = (
  el: HTMLElement,
  attrs: MutableHeadAttrs,
  trackAttr: string
): void => {
  const prevKeys = (el.getAttribute(trackAttr) ?? "")
    .split(/\s+/u)
    .filter(Boolean);
  for (const k of prevKeys) {
    el.removeAttribute(k);
  }
  const nextKeys = Object.keys(attrs);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) {
      el.setAttribute(k, v);
    }
  }
  if (nextKeys.length) {
    el.setAttribute(trackAttr, nextKeys.join(" "));
  } else {
    el.removeAttribute(trackAttr);
  }
};

/**
 * Apply merged head entries on client navigations. Updates `document.title` and
 * managed meta/link nodes (`data-ilha-head`). Script tags from HeadInput are
 * SSR-only and are not re-injected here. Removes managed tags from the previous
 * route that are not part of this navigation's set.
 */
export const applyHeadEntriesToDocument = (entries: HeadInput[]): void => {
  if (!isBrowser) {
    return;
  }

  const merged = mergeHeadEntries(entries, false);
  const resolvedTitle = applyTitleTemplate(merged.title, merged.titleTemplate);
  if (resolvedTitle !== undefined) {
    document.title = resolvedTitle;
  }

  const metaTags = dedupByKey(merged.meta, metaDedupKey);
  const linkTags = dedupByKey(
    merged.link,
    (t) => `${t.rel ?? ""}:${t.href ?? ""}`
  );
  const keepManaged = new Set<Element>();

  syncManagedMeta(metaTags, keepManaged);
  syncManagedLink(linkTags, keepManaged);

  for (const el of document.head.querySelectorAll(`[${ILHA_HEAD_ATTR}]`)) {
    if (!keepManaged.has(el)) {
      el.remove();
    }
  }

  applyRouterAttrs(
    document.documentElement,
    merged.htmlAttrs,
    ILHA_ROUTER_HTML_ATTR
  );
  applyRouterAttrs(document.body, merged.bodyAttrs, ILHA_ROUTER_BODY_ATTR);
};

export const withHeadStore = async <T>(
  store: HeadStore,
  fn: () => T | Promise<T>
): Promise<T> => {
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
};

let _flushScheduled = false;
let _flushTarget: HeadStore | null = null;

const scheduleBrowserHeadFlush = (store: HeadStore): void => {
  _flushTarget = store;
  if (_flushScheduled) {
    return;
  }
  _flushScheduled = true;
  queueMicrotask(() => {
    _flushScheduled = false;
    const target = _flushTarget;
    _flushTarget = null;
    if (target && _browserHeadStore === target) {
      applyHeadEntriesToDocument(target.entries);
    }
  });
};

/**
 * Contribute `<head>` data from inside a page, layout, or island render.
 *
 * During SSR (or a client mount with an open browser head window), entries
 * collect into the active store. On the client with no store, the entry is
 * applied to `document` immediately.
 */
export const head = (input: HeadInput): void => {
  const store = activeHeadStore();
  if (store) {
    store.entries.push(input);
    if (isBrowser) {
      scheduleBrowserHeadFlush(store);
    }
    return;
  }
  if (isBrowser) {
    applyHeadEntriesToDocument([input]);
    return;
  }
  console.warn(
    "[ilha-router] head() called outside a render window — ignored."
  );
};

export interface BrowserHeadSession {
  flush: () => void;
  close: () => void;
}

/**
 * Open a browser head collection window for a client route mount.
 * Nested page/layout `head()` calls may land after `mount()` returns; keep
 * the window open until `close()`, and flush on a microtask (or via `flush()`).
 */
export const openBrowserHead = (): BrowserHeadSession => {
  const store: HeadStore = { entries: [] };
  _browserHeadStore = store;
  return {
    close: () => {
      if (_browserHeadStore === store) {
        _browserHeadStore = null;
      }
    },
    flush: () => {
      applyHeadEntriesToDocument(store.entries);
    },
  };
};

const pushSerializedMeta = (parts: string[], meta: HeadAttrMap[]): void => {
  for (const tag of dedupByKey(meta, metaDedupKey)) {
    // Neutralize a meta-refresh that tries to bounce the page to an unsafe URL.
    if (
      /^refresh$/iu.test(tag["http-equiv"] ?? "") &&
      !isSafeRefreshTarget(tag.content ?? "")
    ) {
      if (isDevEnv()) {
        console.warn(
          `[ilha-router] Dropping unsafe meta refresh target "${tag.content}".`
        );
      }
      continue;
    }
    parts.push(`<meta${serializeAttrs({ ...tag, [ILHA_HEAD_ATTR]: "" })} />`);
  }
};

const pushSerializedLink = (parts: string[], link: HeadAttrMap[]): void => {
  for (const tag of dedupByKey(link, (t) => `${t.rel ?? ""}:${t.href ?? ""}`)) {
    if (tag.href !== undefined && !isSafeUrl(tag.href)) {
      if (isDevEnv()) {
        console.warn(`[ilha-router] Dropping unsafe link href "${tag.href}".`);
      }
      continue;
    }
    parts.push(`<link${serializeAttrs({ ...tag, [ILHA_HEAD_ATTR]: "" })} />`);
  }
};

const pushSerializedScript = (
  parts: string[],
  script: HeadScriptTag[]
): void => {
  for (const tag of script) {
    if (tag.src !== undefined && !isSafeUrl(tag.src)) {
      if (isDevEnv()) {
        console.warn(`[ilha-router] Dropping unsafe script src "${tag.src}".`);
      }
      continue;
    }
    const { children, ...attrs } = tag;
    // Script bodies are trusted app code, but neutralise a literal `</script>`
    // so a stray sequence can't terminate the tag and inject markup.
    const body = (children ?? "").replaceAll(/<\/script/giu, "<\\/script");
    parts.push(`<script${serializeAttrs(attrs)}>${body}</script>`);
  }
};

/**
 * Merge head entries in contribution order (loader first as the base, then
 * render-time outer→inner layouts, then the page) and serialize. Later entries
 * win on collision; the last `titleTemplate` wraps the resolved title.
 */
export const serializeHead = (entries: HeadInput[]): SerializedHead => {
  const merged = mergeHeadEntries(entries, true);
  const resolvedTitle = applyTitleTemplate(merged.title, merged.titleTemplate);

  const parts: string[] = [];
  if (resolvedTitle !== undefined) {
    parts.push(`<title>${escapeHeadAttr(resolvedTitle)}</title>`);
  }
  pushSerializedMeta(parts, merged.meta);
  pushSerializedLink(parts, merged.link);
  pushSerializedScript(parts, merged.script);

  return {
    bodyAttrs: serializeAttrs(merged.bodyAttrs),
    headTags: parts.join("\n  "),
    htmlAttrs: serializeAttrs(merged.htmlAttrs),
  };
};
